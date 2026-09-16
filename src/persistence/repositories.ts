/**
 * Repository layer — Document 2 §7. Domain-oriented repositories over
 * IndexedDB. Feature/UI code never touches object stores directly.
 * References are validated here because IndexedDB has no foreign keys.
 */
import {
  clearStore,
  deleteRecord,
  getAll,
  getByIndex,
  getOne,
  putMany,
  putRecord,
  req,
  withTx,
} from './db';
import type { StoreName } from './db';
import type {
  BodyPart,
  Category,
  Completion,
  CustomWorkout,
  CustomWorkoutExercise,
  DayPlan,
  DayPlanExercise,
  DayPlanSection,
  DayPlanSectionWorkout,
  Exercise,
  Favourite,
  ID,
  MediaRecord,
  PlaybackState,
  Timestamps,
  Weekday,
  WorkoutSection,
} from '../types';
import { applyOrder, DomainError, exerciseCompletionKey, sortByOrder } from '../domain';

export function newId(): ID {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const now = (): number => Date.now();

/* --------------------- Configurable named records --------------------- */
/* Categories, body parts, workout sections share the same CRUD shape. */

type OrderedNamedRecord = { id: ID; name: string; sortOrder: number; createdAt: number; updatedAt: number };

function makeOrderedRecordRepo<T extends OrderedNamedRecord>(store: StoreName, label: string) {
  return {
    async list(): Promise<T[]> {
      return sortByOrder(await getAll<T>(store));
    },
    get(id: ID): Promise<T | undefined> {
      return getOne<T>(store, id);
    },
    async create(name: string): Promise<T> {
      const trimmed = name.trim();
      if (!trimmed) throw new DomainError(`${label} name is required`);
      const all = await getAll<T>(store);
      if (all.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new DomainError(`A ${label.toLowerCase()} with this name already exists`);
      }
      const maxOrder = all.reduce((m, r) => Math.max(m, r.sortOrder), 0);
      const record = {
        id: newId(),
        name: trimmed,
        sortOrder: maxOrder + 10,
        createdAt: now(),
        updatedAt: now(),
      } as T;
      await putRecord(store, record);
      return record;
    },
    async update(id: ID, name: string): Promise<T> {
      const trimmed = name.trim();
      if (!trimmed) throw new DomainError(`${label} name is required`);
      const existing = await getOne<T>(store, id);
      if (!existing) throw new DomainError(`${label} not found`);
      const all = await getAll<T>(store);
      if (all.some((r) => r.id !== id && r.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new DomainError(`A ${label.toLowerCase()} with this name already exists`);
      }
      const record = { ...existing, name: trimmed, updatedAt: now() };
      await putRecord(store, record);
      return record;
    },
    async remove(id: ID): Promise<void> {
      await deleteRecord(store, id);
    },
    async reorder(orderedIds: ID[]): Promise<void> {
      const order = applyOrder(orderedIds);
      const all = await getAll<T>(store);
      const updated = all
        .filter((r) => order.has(r.id))
        .map((r) => ({ ...r, sortOrder: order.get(r.id)!, updatedAt: now() }));
      await putMany(store, updated);
    },
  };
}

export const categoryRepo = makeOrderedRecordRepo<Category>('categories', 'Category');
export const bodyPartRepo = makeOrderedRecordRepo<BodyPart>('bodyParts', 'Body part');
export const workoutSectionRepo = makeOrderedRecordRepo<WorkoutSection>('workoutSections', 'Section');

/* ------------------------------ Exercise ------------------------------ */

export interface ExerciseInput {
  name: string;
  mediaId: ID | null;
  thumbnailMediaId: ID | null;
  categoryId: ID;
  description: string | null;
  difficulty: Exercise['difficulty'];
  equipment: string[];
  targets: string[];
}

export interface ExerciseDependents {
  dayPlanRefs: number;
  customWorkoutRefs: number;
  isFavourite: boolean;
  hasPlaybackState: boolean;
  mediaIds: ID[];
}

export const exerciseRepo = {
  async list(): Promise<Exercise[]> {
    return sortByOrder(await getAll<Exercise>('exercises'));
  },
  get(id: ID): Promise<Exercise | undefined> {
    return getOne<Exercise>('exercises', id);
  },
  async create(input: ExerciseInput): Promise<Exercise> {
    const name = input.name.trim();
    if (!name) throw new DomainError('Exercise name is required');
    const category = await getOne<Category>('categories', input.categoryId);
    if (!category) throw new DomainError('Choose a valid category');
    if (!input.mediaId) throw new DomainError('A video file is required');
    const all = await getAll<Exercise>('exercises');
    const maxOrder = all.reduce((m, e) => Math.max(m, e.sortOrder), 0);
    const record: Exercise = {
      id: newId(),
      name,
      mediaId: input.mediaId,
      thumbnailMediaId: input.thumbnailMediaId,
      categoryId: input.categoryId,
      description: input.description?.trim() ? input.description.trim() : null,
      difficulty: input.difficulty,
      equipment: [...new Set(input.equipment.map((e) => e.trim()).filter(Boolean))],
      targets: [...new Set(input.targets.map((t) => t.trim()).filter(Boolean))],
      sortOrder: maxOrder + 10,
      createdAt: now(),
      updatedAt: now(),
    };
    await putRecord('exercises', record);
    return record;
  },
  async update(id: ID, patch: Partial<ExerciseInput>): Promise<Exercise> {
    const existing = await getOne<Exercise>('exercises', id);
    if (!existing) throw new DomainError('Exercise not found');
    if (patch.categoryId) {
      const category = await getOne<Category>('categories', patch.categoryId);
      if (!category) throw new DomainError('Choose a valid category');
    }
    const next: Exercise = {
      ...existing,
      ...patch,
      name: patch.name !== undefined ? patch.name.trim() : existing.name,
      equipment: patch.equipment
        ? [...new Set(patch.equipment.map((e) => e.trim()).filter(Boolean))]
        : existing.equipment,
      targets: patch.targets
        ? [...new Set(patch.targets.map((t) => t.trim()).filter(Boolean))]
        : existing.targets,
      description:
        patch.description !== undefined
          ? typeof patch.description === 'string' && patch.description.trim()
            ? patch.description.trim()
            : null
          : existing.description,
      updatedAt: now(),
    };
    if (!next.name) throw new DomainError('Exercise name is required');
    await putRecord('exercises', next);
    return next;
  },
  async reorder(orderedIds: ID[]): Promise<void> {
    const order = applyOrder(orderedIds);
    const all = await getAll<Exercise>('exercises');
    const updated = all
      .filter((e) => order.has(e.id))
      .map((e) => ({ ...e, sortOrder: order.get(e.id)!, updatedAt: now() }));
    await putMany('exercises', updated);
  },
  /** Dependency check for the safe-deletion dialog (Document 2 §19.1). */
  async findDependents(id: ID): Promise<ExerciseDependents> {
    const [exercise, dpe, cwe, fav, playback] = await Promise.all([
      getOne<Exercise>('exercises', id),
      getByIndex<DayPlanExercise>('dayPlanExercises', 'exerciseId', id),
      getByIndex<CustomWorkoutExercise>('customWorkoutExercises', 'exerciseId', id),
      getOne<Favourite>('favourites', id),
      getOne<PlaybackState>('playback', id),
    ]);
    return {
      dayPlanRefs: dpe.length,
      customWorkoutRefs: cwe.length,
      isFavourite: !!fav,
      hasPlaybackState: !!playback,
      mediaIds: exercise ? [exercise.mediaId, exercise.thumbnailMediaId].filter((m): m is ID => !!m) : [],
    };
  },
  /**
   * Transactional delete: removes the canonical Exercise plus every
   * reference (plan items, custom-workout items, favourite, playback,
   * completion, media). Never called merely for plan removal (§19.1).
   */
  async removeWithDependents(id: ID): Promise<void> {
    const exercise = await getOne<Exercise>('exercises', id);
    if (!exercise) throw new DomainError('Exercise not found');
    await withTx(
      [
        'exercises',
        'dayPlanExercises',
        'customWorkoutExercises',
        'favourites',
        'playback',
        'completions',
        'media',
        'mediaBlobs',
      ],
      'readwrite',
      async (tx) => {
        const dpe = tx.objectStore('dayPlanExercises');
        for (const item of (await req(dpe.index('exerciseId').getAll(id))) as DayPlanExercise[]) {
          await req(dpe.delete(item.id));
        }
        const cwe = tx.objectStore('customWorkoutExercises');
        for (const item of (await req(cwe.index('exerciseId').getAll(id))) as CustomWorkoutExercise[]) {
          await req(cwe.delete(item.id));
        }
        await req(tx.objectStore('favourites').delete(id));
        await req(tx.objectStore('playback').delete(id));
        const completions = tx.objectStore('completions');
        const completionKey = exerciseCompletionKey(id);
        if (await req(completions.getKey(completionKey))) {
          await req(completions.delete(completionKey));
        }
        await req(tx.objectStore('exercises').delete(id));
        for (const mediaId of [exercise.mediaId, exercise.thumbnailMediaId]) {
          if (!mediaId) continue;
          await req(tx.objectStore('media').delete(mediaId));
          await req(tx.objectStore('mediaBlobs').delete(mediaId));
        }
      },
    );
  },
};

/* -------------------------------- Plan -------------------------------- */

export const planRepo = {
  async getWeek(): Promise<DayPlan[]> {
    const all = await getAll<DayPlan>('dayPlans');
    return all.sort((a, b) => a.weekday - b.weekday);
  },
  async getDay(weekday: Weekday): Promise<DayPlan | undefined> {
    const week = await this.getWeek();
    return week.find((d) => d.weekday === weekday);
  },
  async saveDayState(id: ID, patch: { isRestDay?: boolean; bodyPartIds?: ID[] }): Promise<DayPlan> {
    const existing = await getOne<DayPlan>('dayPlans', id);
    if (!existing) throw new DomainError('Day plan not found');
    const next: DayPlan = { ...existing, ...patch, updatedAt: now() };
    await putRecord('dayPlans', next);
    return next;
  },
  /** Create a named section (e.g. "Mobility") on a day. */
  async addSection(dayPlanId: ID, name: string): Promise<DayPlanSection> {
    const dayPlan = await getOne<DayPlan>('dayPlans', dayPlanId);
    if (!dayPlan) throw new DomainError('Day plan not found');
    const trimmed = name.trim();
    if (!trimmed) throw new DomainError('Section name is required');
    const siblings = await getByIndex<DayPlanSection>('dayPlanSections', 'dayPlanId', dayPlanId);
    if (siblings.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new DomainError('A section with that name already exists on this day');
    }
    const record: DayPlanSection = {
      id: newId(),
      dayPlanId,
      name: trimmed,
      sortOrder: siblings.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 10,
      createdAt: now(),
      updatedAt: now(),
    };
    await putRecord('dayPlanSections', record);
    return record;
  },
  async renameSection(sectionId: ID, name: string): Promise<void> {
    const section = await getOne<DayPlanSection>('dayPlanSections', sectionId);
    if (!section) throw new DomainError('Section not found');
    const trimmed = name.trim();
    if (!trimmed) throw new DomainError('Section name is required');
    const siblings = await getByIndex<DayPlanSection>('dayPlanSections', 'dayPlanId', section.dayPlanId);
    if (siblings.some((s) => s.id !== sectionId && s.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new DomainError('A section with that name already exists on this day');
    }
    await putRecord('dayPlanSections', { ...section, name: trimmed, updatedAt: now() });
  },
  async removeSection(sectionId: ID): Promise<void> {
    // Removes the DayPlanSection and its workout links only — never the
    // underlying CustomWorkout records (§17).
    await withTx(['dayPlanSections', 'dayPlanSectionWorkouts'], 'readwrite', async (tx) => {
      const links = tx.objectStore('dayPlanSectionWorkouts');
      for (const link of (await req(links.index('dayPlanSectionId').getAll(sectionId))) as DayPlanSectionWorkout[]) {
        await req(links.delete(link.id));
      }
      await req(tx.objectStore('dayPlanSections').delete(sectionId));
    });
  },
  /** Add a saved workout (playlist) into a section, by reference. */
  async addWorkoutToSection(sectionId: ID, customWorkoutId: ID): Promise<DayPlanSectionWorkout> {
    const section = await getOne<DayPlanSection>('dayPlanSections', sectionId);
    const workout = await getOne<CustomWorkout>('customWorkouts', customWorkoutId);
    if (!section) throw new DomainError('Section not found');
    if (!workout) throw new DomainError('Choose a valid workout');
    const siblings = await getByIndex<DayPlanSectionWorkout>('dayPlanSectionWorkouts', 'dayPlanSectionId', sectionId);
    if (siblings.some((l) => l.customWorkoutId === customWorkoutId)) {
      throw new DomainError('That workout is already in this section');
    }
    const record: DayPlanSectionWorkout = {
      id: newId(),
      dayPlanSectionId: sectionId,
      customWorkoutId,
      sortOrder: siblings.reduce((m, l) => Math.max(m, l.sortOrder), 0) + 10,
      createdAt: now(),
      updatedAt: now(),
    };
    await putRecord('dayPlanSectionWorkouts', record);
    return record;
  },
  async removeWorkoutFromSection(linkId: ID): Promise<void> {
    await deleteRecord('dayPlanSectionWorkouts', linkId);
  },
  async reorderSections(dayPlanId: ID, orderedIds: ID[]): Promise<void> {
    const order = applyOrder(orderedIds);
    const siblings = await getByIndex<DayPlanSection>('dayPlanSections', 'dayPlanId', dayPlanId);
    await putMany(
      'dayPlanSections',
      siblings
        .filter((s) => order.has(s.id))
        .map((s) => ({ ...s, sortOrder: order.get(s.id)!, updatedAt: now() })),
    );
  },
  async reorderSectionWorkouts(sectionId: ID, orderedIds: ID[]): Promise<void> {
    const order = applyOrder(orderedIds);
    const siblings = await getByIndex<DayPlanSectionWorkout>('dayPlanSectionWorkouts', 'dayPlanSectionId', sectionId);
    await putMany(
      'dayPlanSectionWorkouts',
      siblings
        .filter((l) => order.has(l.id))
        .map((l) => ({ ...l, sortOrder: order.get(l.id)!, updatedAt: now() })),
    );
  },
  async listSections(): Promise<DayPlanSection[]> {
    return getAll<DayPlanSection>('dayPlanSections');
  },
  async listSectionWorkouts(): Promise<DayPlanSectionWorkout[]> {
    return getAll<DayPlanSectionWorkout>('dayPlanSectionWorkouts');
  },
};

/* ---------------------------- Custom workout ---------------------------- */

export const customWorkoutRepo = {
  async list(): Promise<CustomWorkout[]> {
    const all = await getAll<CustomWorkout>('customWorkouts');
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },
  get(id: ID): Promise<CustomWorkout | undefined> {
    return getOne<CustomWorkout>('customWorkouts', id);
  },
  async create(name: string): Promise<CustomWorkout> {
    const trimmed = name.trim();
    if (!trimmed) throw new DomainError('Workout name is required');
    const record: CustomWorkout = { id: newId(), name: trimmed, createdAt: now(), updatedAt: now() };
    await putRecord('customWorkouts', record);
    return record;
  },
  async rename(id: ID, name: string): Promise<CustomWorkout> {
    const existing = await getOne<CustomWorkout>('customWorkouts', id);
    if (!existing) throw new DomainError('Workout not found');
    const trimmed = name.trim();
    if (!trimmed) throw new DomainError('Workout name is required');
    const record = { ...existing, name: trimmed, updatedAt: now() };
    await putRecord('customWorkouts', record);
    return record;
  },
  /**
   * Deletes the workout and its item relations — never the Exercises.
   * Plan-section links to this workout are removed too; the sections
   * themselves stay (they just lose that workout).
   */
  async remove(id: ID): Promise<void> {
    await withTx(['customWorkouts', 'customWorkoutExercises', 'dayPlanSectionWorkouts'], 'readwrite', async (tx) => {
      const items = tx.objectStore('customWorkoutExercises');
      for (const item of (await req(items.index('customWorkoutId').getAll(id))) as CustomWorkoutExercise[]) {
        await req(items.delete(item.id));
      }
      const links = tx.objectStore('dayPlanSectionWorkouts');
      for (const link of (await req(links.index('customWorkoutId').getAll(id))) as DayPlanSectionWorkout[]) {
        await req(links.delete(link.id));
      }
      await req(tx.objectStore('customWorkouts').delete(id));
    });
  },
  async items(workoutId: ID): Promise<CustomWorkoutExercise[]> {
    const items = await getByIndex<CustomWorkoutExercise>('customWorkoutExercises', 'customWorkoutId', workoutId);
    return sortByOrder(items);
  },
  async listAllItems(): Promise<CustomWorkoutExercise[]> {
    return getAll<CustomWorkoutExercise>('customWorkoutExercises');
  },
  async addExercise(workoutId: ID, exerciseId: ID): Promise<CustomWorkoutExercise> {
    const workout = await getOne<CustomWorkout>('customWorkouts', workoutId);
    const exercise = await getOne<Exercise>('exercises', exerciseId);
    if (!workout) throw new DomainError('Workout not found');
    if (!exercise) throw new DomainError('Choose a valid exercise');
    const siblings = await getByIndex<CustomWorkoutExercise>('customWorkoutExercises', 'customWorkoutId', workoutId);
    if (siblings.some((s) => s.exerciseId === exerciseId)) {
      throw new DomainError('This exercise is already in the workout');
    }
    const record: CustomWorkoutExercise = {
      id: newId(),
      customWorkoutId: workoutId,
      exerciseId,
      sortOrder: siblings.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 10,
      createdAt: now(),
      updatedAt: now(),
    };
    await putRecord('customWorkoutExercises', record);
    return record;
  },
  async removeExercise(itemId: ID): Promise<void> {
    await deleteRecord('customWorkoutExercises', itemId);
  },
  async reorder(workoutId: ID, orderedIds: ID[]): Promise<void> {
    const order = applyOrder(orderedIds);
    const siblings = await getByIndex<CustomWorkoutExercise>('customWorkoutExercises', 'customWorkoutId', workoutId);
    await putMany(
      'customWorkoutExercises',
      siblings
        .filter((s) => order.has(s.id))
        .map((s) => ({ ...s, sortOrder: order.get(s.id)!, updatedAt: now() })),
    );
  },
};

/* ------------------------- Playback / favourites ------------------------- */

export const playbackRepo = {
  get(exerciseId: ID): Promise<PlaybackState | undefined> {
    return getOne<PlaybackState>('playback', exerciseId);
  },
  async save(exerciseId: ID, positionSeconds: number, durationSeconds: number | null): Promise<void> {
    const record: PlaybackState = {
      exerciseId,
      positionSeconds: Math.max(0, positionSeconds),
      durationSeconds,
      updatedAt: now(),
    };
    await putRecord('playback', record);
  },
  async clear(exerciseId: ID): Promise<void> {
    await deleteRecord('playback', exerciseId);
  },
  async list(): Promise<PlaybackState[]> {
    return getAll<PlaybackState>('playback');
  },
};

export const favouriteRepo = {
  async list(): Promise<Favourite[]> {
    const all = await getAll<Favourite>('favourites');
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  async isFavourite(exerciseId: ID): Promise<boolean> {
    return !!(await getOne<Favourite>('favourites', exerciseId));
  },
  async set(exerciseId: ID, favourite: boolean): Promise<void> {
    if (favourite) {
      const existing = await getOne<Favourite>('favourites', exerciseId);
      if (!existing) await putRecord<Favourite>('favourites', { exerciseId, createdAt: now() });
    } else {
      await deleteRecord('favourites', exerciseId);
    }
  },
};

export const completionRepo = {
  get(key: string): Promise<Completion | undefined> {
    return getOne<Completion>('completions', key);
  },
  async markComplete(key: string): Promise<void> {
    await putRecord<Completion>('completions', { id: key, completedAt: now() });
  },
  async list(): Promise<Completion[]> {
    return getAll<Completion>('completions');
  },
};

/* --------------------------------- Media --------------------------------- */

export const mediaRepo = {
  async put(record: MediaRecord, blob: Blob): Promise<void> {
    await withTx(['media', 'mediaBlobs'], 'readwrite', async (tx) => {
      await req(tx.objectStore('media').put(record));
      await req(tx.objectStore('mediaBlobs').put({ id: record.id, blob }));
    });
  },
  getRecord(id: ID): Promise<MediaRecord | undefined> {
    return getOne<MediaRecord>('media', id);
  },
  async getBlob(id: ID): Promise<Blob | undefined> {
    const entry = await getOne<{ id: ID; blob: Blob }>('mediaBlobs', id);
    return entry?.blob;
  },
  async exists(id: ID): Promise<boolean> {
    return !!(await getOne<MediaRecord>('media', id));
  },
  async remove(id: ID): Promise<void> {
    await withTx(['media', 'mediaBlobs'], 'readwrite', async (tx) => {
      await req(tx.objectStore('media').delete(id));
      await req(tx.objectStore('mediaBlobs').delete(id));
    });
  },
  async list(): Promise<MediaRecord[]> {
    return getAll<MediaRecord>('media');
  },
  async estimateUsage(): Promise<{ usage: number; quota: number } | null> {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    }
    return null;
  },
};

/* ------------------------- Legacy plan migration ------------------------- */

/**
 * One-time, idempotent migration to the section→workout model. Legacy day
 * plan sections carried a workoutSectionId (Settings section) or an embedded
 * customWorkoutId; both become a plain `name`, and embedded playlists become
 * DayPlanSectionWorkout links. Legacy per-day exercises and the Settings
 * section list are dropped.
 */
interface LegacyDayPlanSection extends Timestamps {
  id: ID;
  dayPlanId: ID;
  sortOrder: number;
  name?: string;
  workoutSectionId?: ID | null;
  customWorkoutId?: ID | null;
}

export async function migratePlanSchema(): Promise<void> {
  const [sections, workoutSections, workouts, legacyItems] = await Promise.all([
    getAll<LegacyDayPlanSection>('dayPlanSections'),
    getAll<WorkoutSection>('workoutSections'),
    getAll<CustomWorkout>('customWorkouts'),
    getAll<DayPlanExercise>('dayPlanExercises'),
  ]);
  const wsName = new Map(workoutSections.map((w) => [w.id, w.name]));
  const cwName = new Map(workouts.map((w) => [w.id, w.name]));
  const legacySections = sections.filter((s) => typeof s.name !== 'string');
  if (legacySections.length === 0 && legacyItems.length === 0 && workoutSections.length === 0) return;
  await withTx(['dayPlanSections', 'dayPlanSectionWorkouts', 'dayPlanExercises', 'workoutSections'], 'readwrite', async (tx) => {
    const dps = tx.objectStore('dayPlanSections');
    const dpsw = tx.objectStore('dayPlanSectionWorkouts');
    const dpe = tx.objectStore('dayPlanExercises');
    const wss = tx.objectStore('workoutSections');
    for (const s of legacySections) {
      const base = {
        id: s.id,
        dayPlanId: s.dayPlanId,
        sortOrder: s.sortOrder,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
      if (s.customWorkoutId != null) {
        await req(dps.put({ ...base, name: cwName.get(s.customWorkoutId) ?? 'Workout' }));
        await req(
          dpsw.put({
            id: newId(),
            dayPlanSectionId: s.id,
            customWorkoutId: s.customWorkoutId,
            sortOrder: 10,
            createdAt: now(),
            updatedAt: now(),
          }),
        );
      } else {
        await req(dps.put({ ...base, name: wsName.get(s.workoutSectionId ?? '') ?? 'Section' }));
      }
    }
    for (const item of legacyItems) await req(dpe.delete(item.id));
    for (const ws of workoutSections) await req(wss.delete(ws.id));
  });
}

export { clearStore };
