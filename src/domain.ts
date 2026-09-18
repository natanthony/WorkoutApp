/**
 * Domain logic — pure functions, no React, no browser storage.
 * Queue generation (Document 2 §12), ordering rules, day detection,
 * search/filter semantics (Document 2 §20).
 */
import type {
  CustomWorkout,
  CustomWorkoutExercise,
  DayPlan,
  DayPlanSection,
  DayPlanSectionWorkout,
  Difficulty,
  Exercise,
  ExerciseKind,
  ID,
  QueueItem,
  Weekday,
} from './types';

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export const WEEKDAY_NAMES: readonly string[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** Device-local weekday, Monday-first (Monday = 0). Document 1 §13. */
export function mondayFirstWeekday(date: Date): Weekday {
  return ((date.getDay() + 6) % 7) as Weekday;
}

export function todayWeekday(): Weekday {
  return mondayFirstWeekday(new Date());
}

export function sortByOrder<T extends { sortOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Explicit deterministic reorder: returns the IDs with their new explicit
 * sortOrder values. Callers persist; DOM/index order is never the rule.
 */
export function applyOrder(orderedIds: ID[]): Map<ID, number> {
  const map = new Map<ID, number>();
  orderedIds.forEach((id, index) => map.set(id, (index + 1) * 10));
  return map;
}

/** Pure move within an ordered ID list (UI reorder, caller persists). */
export function moveId(ids: ID[], from: number, to: number): ID[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) {
    return [...ids];
  }
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export interface PlanQueueInput {
  dayPlan: DayPlan;
  sections: DayPlanSection[];
  sectionWorkouts: DayPlanSectionWorkout[];
  customWorkouts: CustomWorkout[];
  customWorkoutExercises: CustomWorkoutExercise[];
  exercises: Exercise[];
}

/**
 * Generate the deterministic playback queue for a DayPlan:
 * section order first, then workout order within each section, then the
 * workout's own exercise order — so playback runs Section → Workout → Vid.
 * Missing references are surfaced, never substituted.
 */
export function generatePlanQueue(input: PlanQueueInput): QueueItem[] {
  if (input.dayPlan.isRestDay) return [];
  const exercisesById = new Map(input.exercises.map((e) => [e.id, e]));
  const cwById = new Map(input.customWorkouts.map((w) => [w.id, w]));
  const cwItemsByWorkout = new Map<ID, CustomWorkoutExercise[]>();
  for (const item of input.customWorkoutExercises) {
    const list = cwItemsByWorkout.get(item.customWorkoutId) ?? [];
    list.push(item);
    cwItemsByWorkout.set(item.customWorkoutId, list);
  }
  const linksBySection = new Map<ID, DayPlanSectionWorkout[]>();
  for (const link of input.sectionWorkouts) {
    const list = linksBySection.get(link.dayPlanSectionId) ?? [];
    list.push(link);
    linksBySection.set(link.dayPlanSectionId, list);
  }
  const daySections = sortByOrder(input.sections.filter((s) => s.dayPlanId === input.dayPlan.id));

  const queue: QueueItem[] = [];
  const missing: string[] = [];
  daySections.forEach((section, sectionIdx) => {
    const links = sortByOrder(linksBySection.get(section.id) ?? []);
    links.forEach((link) => {
      const workout = cwById.get(link.customWorkoutId);
      if (!workout) {
        missing.push(`workout ${link.customWorkoutId}`);
        return;
      }
      const items = sortByOrder(cwItemsByWorkout.get(link.customWorkoutId) ?? []);
      items.forEach((item, itemIdx) => {
        if (!exercisesById.has(item.exerciseId)) missing.push(`exercise ${item.exerciseId}`);
        queue.push({
          exerciseId: item.exerciseId,
          sectionId: section.id,
          sectionName: section.name,
          sectionIndex: sectionIdx + 1,
          sectionPosition: itemIdx + 1,
          sectionSize: items.length,
          overallPosition: queue.length + 1,
          overallSize: 0,
        });
      });
    });
  });
  if (missing.length > 0) {
    throw new DomainError(`Plan has broken references: ${missing.join(', ')}`);
  }
  queue.forEach((item, i) => {
    item.overallPosition = i + 1;
    item.overallSize = queue.length;
  });
  return queue;
}

/** Generate a queue from a custom workout's ordered references (§12.2). */
export function generateCustomQueue(
  items: { exerciseId: ID }[],
  exercises: Exercise[],
): QueueItem[] {
  const exercisesById = new Map(exercises.map((e) => [e.id, e]));
  const missing: string[] = [];
  const queue: QueueItem[] = items.map((item, i) => {
    if (!exercisesById.has(item.exerciseId)) missing.push(`exercise ${item.exerciseId}`);
    return {
      exerciseId: item.exerciseId,
      sectionId: null,
      sectionName: null,
      sectionIndex: 1,
      sectionPosition: i + 1,
      sectionSize: items.length,
      overallPosition: i + 1,
      overallSize: 0,
    };
  });
  if (missing.length > 0) {
    throw new DomainError(`Custom workout has broken references: ${missing.join(', ')}`);
  }
  queue.forEach((item, i) => {
    item.overallPosition = i + 1;
    item.overallSize = queue.length;
  });
  return queue;
}

export function singleExerciseQueue(exercise: Exercise): QueueItem[] {
  return [
    {
      exerciseId: exercise.id,
      sectionId: null,
      sectionName: null,
      sectionIndex: 1,
      sectionPosition: 1,
      sectionSize: 1,
      overallPosition: 1,
      overallSize: 1,
    },
  ];
}

/* ------------------------------ Search ------------------------------ */

export interface SearchFilters {
  query: string;
  categoryId: ID | 'all';
  difficulty: Difficulty | 'all';
  equipment: string | 'all';
}

export const EMPTY_FILTERS: SearchFilters = {
  query: '',
  categoryId: 'all',
  difficulty: 'all',
  equipment: 'all',
};

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Search canonical Exercise records across name, category, equipment,
 * target and description (Document 1 §20). Case-insensitive substring
 * matching; deterministic; no AI relevance scoring (Document 2 §20).
 */
export function searchExercises(
  exercises: Exercise[],
  categoryNames: Map<ID, string>,
  filters: SearchFilters,
): Exercise[] {
  const query = normalize(filters.query);
  return exercises
    .filter((e) => {
      if (filters.categoryId !== 'all' && e.categoryId !== filters.categoryId) return false;
      if (filters.difficulty !== 'all' && e.difficulty !== filters.difficulty) return false;
      if (filters.equipment !== 'all' && !e.equipment.includes(filters.equipment)) return false;
      if (!query) return true;
      const haystack = [
        e.name,
        categoryNames.get(e.categoryId) ?? '',
        e.equipment.join(' '),
        e.targets.join(' '),
        e.description ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => a.sortOrder - b.sortOrder); // explicit library order
}

/** Distinct equipment values currently used in the library (filter list). */
export function distinctEquipment(exercises: Exercise[]): string[] {
  const set = new Set<string>();
  for (const e of exercises) for (const v of e.equipment) set.add(v);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/* --------------------------- Exercise dose ---------------------------- */
/**
 * Timed vs sets & reps dosing. Sanitization lives here (pure) so the
 * repository and UI share one set of rules; presentation labels are used
 * by the detail page, the player and its queue.
 */

export interface ExerciseDose {
  kind: ExerciseKind | null;
  durationSeconds: number | null;
  sets: number | null;
  reps: number | null;
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return n > 0 ? n : null;
}

/**
 * Normalize a dose payload into a consistent, valid shape: unknown kinds
 * become null, numbers are rounded positive integers, and fields that do
 * not apply to the chosen kind are cleared. Throws on incomplete input so
 * a half-filled dose is never persisted.
 */
export function sanitizeExerciseDose(input: {
  kind?: ExerciseKind | null;
  durationSeconds?: number | null;
  sets?: number | null;
  reps?: number | null;
}): ExerciseDose {
  const kind: ExerciseKind | null =
    input.kind === 'timed' || input.kind === 'sets-reps' ? input.kind : null;
  if (kind === 'timed') {
    const durationSeconds = positiveInt(input.durationSeconds);
    if (durationSeconds === null) {
      throw new DomainError('Set a duration in seconds for a timed exercise (e.g. 30)');
    }
    return { kind, durationSeconds, sets: null, reps: null };
  }
  if (kind === 'sets-reps') {
    const sets = positiveInt(input.sets);
    const reps = positiveInt(input.reps);
    if (sets === null || reps === null) {
      throw new DomainError('Set both sets and reps (e.g. 2 sets of 10 reps)');
    }
    return { kind, durationSeconds: null, sets, reps };
  }
  return { kind: null, durationSeconds: null, sets: null, reps: null };
}

/** Read the dose of a stored exercise, tolerating pre-feature records. */
export function exerciseDose(exercise: Exercise): ExerciseDose {
  try {
    return sanitizeExerciseDose(exercise);
  } catch {
    return { kind: null, durationSeconds: null, sets: null, reps: null };
  }
}

/**
 * Human-readable dose label, e.g. "30 seconds" or "2 sets of 10 reps".
 * Returns null when the exercise has no dose configured.
 */
export function doseLabel(exercise: Exercise): string | null {
  const dose = exerciseDose(exercise);
  if (dose.kind === 'timed' && dose.durationSeconds !== null) {
    return `Timed · ${formatClock(dose.durationSeconds)}`;
  }
  if (dose.kind === 'sets-reps' && dose.sets !== null && dose.reps !== null) {
    const sets = `${dose.sets} set${dose.sets === 1 ? '' : 's'}`;
    const reps = `${dose.reps} rep${dose.reps === 1 ? '' : 's'}`;
    return `${sets} of ${reps}`;
  }
  return null;
}

/* --------------------------- Presentation --------------------------- */

export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Estimate day/workout duration in minutes from known video durations. */
export function estimateMinutes(
  exerciseIds: ID[],
  durations: Map<ID, number | null>,
): number | null {
  let total = 0;
  let anyKnown = false;
  for (const id of exerciseIds) {
    const d = durations.get(id);
    if (d != null && Number.isFinite(d) && d > 0) {
      total += d;
      anyKnown = true;
    }
  }
  if (!anyKnown) return null;
  return Math.max(1, Math.round(total / 60));
}

export function sessionCompletionKey(date: Date, weekday: Weekday): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `session:${yyyy}-${mm}-${dd}:${weekday}`;
}

export function exerciseCompletionKey(exerciseId: ID): string {
  return `exercise:${exerciseId}`;
}

/* ------------------------- Suggestion seeds ------------------------- */
/**
 * Starter suggestion values only (Document 1 §6). Equipment and targets are
 * canonical free-text values on the Exercise record; the UI offers these as
 * chip suggestions and derives filter options from the library itself.
 */
export const EQUIPMENT_SUGGESTIONS: readonly string[] = [
  'None',
  'Dumbbell',
  'Kettlebell',
  'Resistance Band',
  'Mat',
  'Chair',
  'Wall',
];

export const TARGET_SUGGESTIONS: readonly string[] = [
  'Ankles',
  'Calves',
  'Hamstrings',
  'Hips',
  'Lower Back',
  'Neck',
  'Wrists',
  'Full Body',
];
