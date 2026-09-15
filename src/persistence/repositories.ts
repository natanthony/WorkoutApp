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
  Exercise,
  Favourite,
  ID,
  MediaRecord,
  PlaybackState,
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
  async addSection(dayPlanId: ID, workoutSectionId: ID): Promise<DayPlanSection> {
    const dayPlan = await getOne<DayPlan>('dayPlans', dayPlanId);
    const ws = await getOne<WorkoutSection>('workoutSections', workoutSectionId);
    if (!dayPlan) throw new DomainError('Day plan not found');
    if (!ws) throw new DomainError('Choose a valid section');
    const siblings = await getByIndex<DayPlanSection>('dayPlanSections', 'dayPlanId', dayPlanId);
    const record: DayPlanSection = {
      id: newId(),
      dayPlanId,
      workoutSectionId,
      sortOrder: siblings.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 10,
      createdAt: now(),
      updatedAt: now(),
    };
    await putRecord('dayPlanSections', record);
    return record;
  },
  /**
   * Add a saved CustomWorkout (playlist) to a day as a section. The workout
   * is referenced, never copied — later edits to the workout are reflected
   * in the plan, and playback expands it in the workout's exercise order.
   */
  async addWorkout(dayPlanId: ID, customWorkoutId: ID): Promise<DayPlanSection> {
    const dayPlan = await getOne<DayPlan>('dayPlans', dayPlanId);
    const workout = await getOne<CustomWorkout>('customWorkouts', customWorkoutId);
    if (!dayPlan) throw new DomainError('Day plan not found');
    if (!workout) throw new DomainError('Choose a valid workout');
    const siblings = await getByIndex<DayPlanSection>('dayPlanSections', 'dayPlanId', dayPlanId);
    const record: DayPlanSection = {
      id: newId(),
      dayPlanId,
      workoutSectionId: null,
      customWorkoutId,
      sortOrder: siblings.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 10,
      createdAt: now(),
      updatedAt: now(),
    };
    await putRecord('dayPlanSections', record);
    return record;
  },
  async removeSection(sectionId: ID): Promise<void> {
    // Removes the DayPlanSection and its DayPlanExercise relations only —
    // never the underlying WorkoutSection or Exercise records (§17).
    await withTx(['dayPlanSections', 'dayPlanExercises'], 'readwrite', async (tx) => {
      const items = tx.objectStore('dayPlanExercises');
      for (const item of (await req(items.index('dayPlanSectionId').getAll(sectionId))) as DayPlanExercise[]) {
        await req(items.delete(item.id));
      }
      await req(tx.objectStore('dayPlanSections').delete(sectionId));
    });
  },
  async addExerciseToSection(sectionId: ID, exerciseId: ID): Promise<DayPlanExercise> {
    const section = await getOne<DayPlanSection>('dayPlanSections', sectionId);
    const exercise = await getOne<Exercise>('exercises', exerciseId);
    if (!section) throw new DomainError('Section not found');
    if (!exercise) throw new DomainError('Choose a valid exercise');
    const siblings = await getByIndex<DayPlanExercise>('dayPlanExercises', 'dayPlanSectionId', sectionId);
    if (siblings.some((s) => s.exerciseId === exerciseId)) {
      throw new DomainError('This exercise is already in the section');
    }
    const record: DayPlanExercise = {
      id: newId(),
      dayPlanSectionId: sectionId,
      exerciseId,
      sortOrder: siblings.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 10,
      createdAt: now(),
      updatedAt: now(),
    };
    await putRecord('dayPlanExercises', record);
    return record;
  },
  async removeExerciseFromSection(itemId: ID): Promise<void> {
    await deleteRecord('dayPlanExercises', itemId);
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
  async reorderSectionExercises(sectionId: ID, orderedIds: ID[]): Promise<void> {
    const order = applyOrder(orderedIds);
    const siblings = await getByIndex<DayPlanExercise>('dayPlanExercises', 'dayPlanSectionId', sectionId);
    await putMany(
      'dayPlanExercises',
      siblings
        .filter((s) => order.has(s.id))
        .map((s) => ({ ...s, sortOrder: order.get(s.id)!, updatedAt: now() })),
    );
  },
  async listSections(): Promise<DayPlanSection[]> {
    return getAll<DayPlanSection>('dayPlanSections');
  },
  async listSectionExercises(): Promise<DayPlanExercise[]> {
    return getAll<DayPlanExercise>('dayPlanExercises');
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
   * Day-plan sections that embed this workout are removed too (the plan
   * entry is a reference to the playlist, not content of its own).
   */
  async remove(id: ID): Promise<void> {
    await withTx(['customWorkouts', 'customWorkoutExercises', 'dayPlanSections', 'dayPlanExercises'], 'readwrite', async (tx) => {
      const items = tx.objectStore('customWorkoutExercises');
      for (const item of (await req(items.index('customWorkoutId').getAll(id))) as CustomWorkoutExercise[]) {
        await req(items.delete(item.id));
      }
      const daySections = tx.objectStore('dayPlanSections');
      const dpe = tx.objectStore('dayPlanExercises');
      for (const section of (await req(daySections.getAll())) as DayPlanSection[]) {
        if (section.customWorkoutId !== id) continue;
        for (const item of (await req(dpe.index('dayPlanSectionId').getAll(section.id))) as DayPlanExercise[]) {
          await req(dpe.delete(item.id));
        }
        await req(daySections.delete(section.id));
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

export { clearStore };
