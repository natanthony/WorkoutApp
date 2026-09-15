/**
 * Domain logic — pure functions, no React, no browser storage.
 * Queue generation (Document 2 §12), ordering rules, day detection,
 * search/filter semantics (Document 2 §20).
 */
import type {
  CustomWorkout,
  CustomWorkoutExercise,
  DayPlan,
  DayPlanExercise,
  DayPlanSection,
  Difficulty,
  Exercise,
  ID,
  QueueItem,
  Weekday,
  WorkoutSection,
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
  sectionExercises: DayPlanExercise[];
  workoutSections: WorkoutSection[];
  exercises: Exercise[];
  /** Required only when a day section references a saved workout (playlist). */
  customWorkouts?: CustomWorkout[];
  customWorkoutExercises?: CustomWorkoutExercise[];
}

/**
 * Generate the deterministic playback queue for a DayPlan:
 * section order first, then exercise order within each section
 * (Document 2 §12.1). A day section that references a CustomWorkout
 * expands to the workout's exercises in the workout's own order.
 * Missing references are surfaced, never substituted.
 */
export function generatePlanQueue(input: PlanQueueInput): QueueItem[] {
  if (input.dayPlan.isRestDay) return [];
  const exercisesById = new Map(input.exercises.map((e) => [e.id, e]));
  const wsById = new Map(input.workoutSections.map((w) => [w.id, w]));
  const cwById = new Map((input.customWorkouts ?? []).map((w) => [w.id, w]));
  const cwItemsByWorkout = new Map<ID, CustomWorkoutExercise[]>();
  for (const item of input.customWorkoutExercises ?? []) {
    const list = cwItemsByWorkout.get(item.customWorkoutId) ?? [];
    list.push(item);
    cwItemsByWorkout.set(item.customWorkoutId, list);
  }
  const daySections = sortByOrder(input.sections.filter((s) => s.dayPlanId === input.dayPlan.id));

  const queue: QueueItem[] = [];
  const missing: string[] = [];
  daySections.forEach((section, sectionIdx) => {
    const customWorkoutId = section.customWorkoutId ?? null;
    if (customWorkoutId != null) {
      const workout = cwById.get(customWorkoutId);
      if (!workout) {
        missing.push(`workout ${customWorkoutId}`);
        return;
      }
      const items = sortByOrder(cwItemsByWorkout.get(customWorkoutId) ?? []);
      items.forEach((item, itemIdx) => {
        if (!exercisesById.has(item.exerciseId)) missing.push(`exercise ${item.exerciseId}`);
        queue.push({
          exerciseId: item.exerciseId,
          sectionId: section.id,
          sectionName: workout.name,
          sectionIndex: sectionIdx + 1,
          sectionPosition: itemIdx + 1,
          sectionSize: items.length,
          overallPosition: queue.length + 1,
          overallSize: 0,
        });
      });
      return;
    }
    const wsId = section.workoutSectionId ?? null;
    const ws = wsId != null ? wsById.get(wsId) : undefined;
    if (!ws) missing.push(`workout section ${String(wsId)}`);
    const items = sortByOrder(input.sectionExercises.filter((x) => x.dayPlanSectionId === section.id));
    items.forEach((item, itemIdx) => {
      if (!exercisesById.has(item.exerciseId)) missing.push(`exercise ${item.exerciseId}`);
      queue.push({
        exerciseId: item.exerciseId,
        sectionId: section.id,
        sectionName: ws ? ws.name : 'Unknown section',
        sectionIndex: sectionIdx + 1,
        sectionPosition: itemIdx + 1,
        sectionSize: items.length,
        overallPosition: queue.length + 1,
        overallSize: 0,
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
