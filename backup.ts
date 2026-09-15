/**
 * Backup / restore — Document 2 §21.
 * Metadata only; video binaries are not embedded (§21.1). Import validates
 * format, version, fields and references BEFORE anything is written, and
 * commits in one controlled transaction (§21.2).
 */
import { clearStore, getAll, req, withTx } from './persistence/db';
import { mediaRepo } from './persistence/repositories';
import type { BackupFile } from './types';
import { DomainError } from './domain';

export async function exportBackup(): Promise<BackupFile> {
  const [
    categories,
    bodyParts,
    workoutSections,
    exercises,
    dayPlans,
    dayPlanSections,
    dayPlanExercises,
    dayPlanSectionWorkouts,
    customWorkouts,
    customWorkoutExercises,
    favourites,
    playbackState,
    completion,
  ] = await Promise.all([
    getAll<BackupFile['categories'][number]>('categories'),
    getAll<BackupFile['bodyParts'][number]>('bodyParts'),
    getAll<BackupFile['workoutSections'][number]>('workoutSections'),
    getAll<BackupFile['exercises'][number]>('exercises'),
    getAll<BackupFile['dayPlans'][number]>('dayPlans'),
    getAll<BackupFile['dayPlanSections'][number]>('dayPlanSections'),
    getAll<BackupFile['dayPlanExercises'][number]>('dayPlanExercises'),
    getAll<BackupFile['dayPlanSectionWorkouts'][number]>('dayPlanSectionWorkouts'),
    getAll<BackupFile['customWorkouts'][number]>('customWorkouts'),
    getAll<BackupFile['customWorkoutExercises'][number]>('customWorkoutExercises'),
    getAll<BackupFile['favourites'][number]>('favourites'),
    getAll<BackupFile['playbackState'][number]>('playback'),
    getAll<BackupFile['completion'][number]>('completions'),
  ]);
  return {
    format: 'workout-player-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    categories,
    bodyParts,
    workoutSections,
    exercises,
    dayPlans,
    dayPlanSections,
    dayPlanExercises,
    dayPlanSectionWorkouts,
    customWorkouts,
    customWorkoutExercises,
    favourites,
    playbackState,
    completion,
  };
}

export function downloadBackup(file: BackupFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `workout-player-backup-${file.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface BackupValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  data: BackupFile | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasString(value: unknown, field: string): boolean {
  return isRecord(value) && typeof value[field] === 'string' && (value[field] as string).length > 0;
}

/**
 * Validate a parsed backup before any write. Checks format, version,
 * required fields, duplicate IDs and cross-entity references.
 * Unknown future versions are rejected safely (§21.3).
 */
export function validateBackup(raw: unknown): BackupValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ['Not a valid backup file'], warnings, data: null };
  }
  if (raw.format !== 'workout-player-backup') {
    errors.push('Unrecognised backup format');
  }
  if (raw.version !== 1) {
    errors.push(`Unsupported backup version: ${String(raw.version)}`);
  }
  if (errors.length > 0) return { ok: false, errors, warnings, data: null };

  const data = raw as unknown as BackupFile;
  const arrayFields = [
    'categories',
    'bodyParts',
    'workoutSections',
    'exercises',
    'dayPlans',
    'dayPlanSections',
    'dayPlanExercises',
    'dayPlanSectionWorkouts',
    'customWorkouts',
    'customWorkoutExercises',
    'favourites',
    'playbackState',
    'completion',
  ] as const;
  // v1 backups predate section→workout links; default before the array check.
  if (!Array.isArray(data.dayPlanSectionWorkouts)) {
    (data as { dayPlanSectionWorkouts: unknown[] }).dayPlanSectionWorkouts = [];
  }
  for (const field of arrayFields) {
    if (!Array.isArray(data[field])) errors.push(`Missing array: ${field}`);
  }
  if (errors.length > 0) return { ok: false, errors, warnings, data: null };

  const duplicateCheck = (items: { id?: unknown }[], label: string) => {
    const seen = new Set<string>();
    for (const item of items) {
      if (!hasString(item, 'id')) {
        errors.push(`${label}: entry without a stable id`);
        continue;
      }
      const id = (item as { id: string }).id;
      if (seen.has(id)) errors.push(`${label}: duplicate id ${id}`);
      seen.add(id);
    }
    return seen;
  };

  const categoryIds = duplicateCheck(data.categories, 'categories');
  const bodyPartIds = duplicateCheck(data.bodyParts, 'bodyParts');
  duplicateCheck(data.workoutSections, 'workoutSections');
  const exerciseIds = duplicateCheck(data.exercises, 'exercises');
  const dayPlanIds = duplicateCheck(data.dayPlans, 'dayPlans');
  const dayPlanSectionIds = duplicateCheck(data.dayPlanSections, 'dayPlanSections');
  duplicateCheck(data.dayPlanExercises, 'dayPlanExercises');
  const customWorkoutIds = duplicateCheck(data.customWorkouts, 'customWorkouts');
  duplicateCheck(data.customWorkoutExercises, 'customWorkoutExercises');

  for (const c of data.categories) if (!hasString(c, 'name')) errors.push('categories: entry without name');
  for (const b of data.bodyParts) if (!hasString(b, 'name')) errors.push('bodyParts: entry without name');
  for (const s of data.workoutSections) if (!hasString(s, 'name')) errors.push('workoutSections: entry without name');

  for (const e of data.exercises) {
    if (!hasString(e, 'name')) errors.push(`exercise ${e.id}: missing name`);
    if (hasString(e, 'categoryId') && !categoryIds.has(e.categoryId)) {
      errors.push(`exercise ${e.id}: unknown category ${e.categoryId}`);
    }
  }
  for (const d of data.dayPlans) {
    if (typeof d.weekday !== 'number' || d.weekday < 0 || d.weekday > 6) {
      errors.push(`dayPlan ${d.id}: invalid weekday`);
    }
    if (Array.isArray(d.bodyPartIds)) {
      for (const bp of d.bodyPartIds) {
        if (!bodyPartIds.has(bp)) errors.push(`dayPlan ${d.id}: unknown body part ${bp}`);
      }
    }
  }
  for (const s of data.dayPlanSections) {
    if (!dayPlanIds.has(s.dayPlanId)) errors.push(`dayPlanSection ${s.id}: unknown day plan`);
    if (!hasString(s, 'name') || !s.name.trim()) {
      errors.push(`dayPlanSection ${s.id}: missing name`);
    }
  }
  for (const l of data.dayPlanSectionWorkouts) {
    if (!dayPlanSectionIds.has(l.dayPlanSectionId)) {
      errors.push(`dayPlanSectionWorkout ${l.id}: unknown section`);
    }
    if (!customWorkoutIds.has(l.customWorkoutId)) {
      errors.push(`dayPlanSectionWorkout ${l.id}: unknown workout`);
    }
  }
  for (const x of data.dayPlanExercises) {
    if (!dayPlanSectionIds.has(x.dayPlanSectionId)) {
      errors.push(`dayPlanExercise ${x.id}: unknown section`);
    }
    if (!exerciseIds.has(x.exerciseId)) {
      errors.push(`dayPlanExercise ${x.id}: unknown exercise ${x.exerciseId}`);
    }
  }
  for (const w of data.customWorkouts) if (!hasString(w, 'name')) errors.push('customWorkouts: entry without name');
  for (const x of data.customWorkoutExercises) {
    if (!customWorkoutIds.has(x.customWorkoutId)) {
      errors.push(`customWorkoutExercise ${x.id}: unknown workout`);
    }
    if (!exerciseIds.has(x.exerciseId)) {
      errors.push(`customWorkoutExercise ${x.id}: unknown exercise`);
    }
  }
  for (const f of data.favourites) {
    if (!exerciseIds.has(f.exerciseId)) warnings.push(`favourite references missing exercise ${f.exerciseId}`);
  }
  for (const p of data.playbackState) {
    if (!exerciseIds.has(p.exerciseId)) warnings.push(`playback state for missing exercise ${p.exerciseId}`);
  }

  return { ok: errors.length === 0, errors, warnings, data: errors.length === 0 ? data : null };
}

export interface RestoreResult {
  missingMedia: string[];
}

/**
 * Replace-all restore, committed in one transaction. Video binaries are
 * NOT part of the backup; afterwards we report every media reference that
 * cannot be resolved locally so the user knows which videos to re-import.
 */
export async function restoreBackup(data: BackupFile): Promise<RestoreResult> {
  const validation = validateBackup(data);
  if (!validation.ok || !validation.data) {
    throw new DomainError(`Invalid backup: ${validation.errors.join('; ')}`);
  }
  const clean = validation.data;
  await withTx(
    [
      'categories',
      'bodyParts',
      'workoutSections',
      'exercises',
      'dayPlans',
      'dayPlanSections',
      'dayPlanExercises',
      'dayPlanSectionWorkouts',
      'customWorkouts',
      'customWorkoutExercises',
      'favourites',
      'playback',
      'completions',
    ],
    'readwrite',
    async (tx) => {
      for (const store of [
        'categories',
        'bodyParts',
        'workoutSections',
        'exercises',
        'dayPlans',
        'dayPlanSections',
        'dayPlanExercises',
        'dayPlanSectionWorkouts',
        'customWorkouts',
        'customWorkoutExercises',
        'favourites',
        'playback',
        'completions',
      ] as const) {
        await req(tx.objectStore(store).clear());
      }
      const put = async (store: string, values: readonly unknown[]) => {
        const os = tx.objectStore(store);
        for (const value of values) await req(os.put(value));
      };
      await put('categories', clean.categories);
      await put('bodyParts', clean.bodyParts);
      await put('workoutSections', clean.workoutSections);
      await put('exercises', clean.exercises);
      await put('dayPlans', clean.dayPlans);
      await put('dayPlanSections', clean.dayPlanSections);
      await put('dayPlanExercises', clean.dayPlanExercises);
      await put('dayPlanSectionWorkouts', clean.dayPlanSectionWorkouts);
      await put('customWorkouts', clean.customWorkouts);
      await put('customWorkoutExercises', clean.customWorkoutExercises);
      await put('favourites', clean.favourites);
      await put('playback', clean.playbackState);
      await put('completions', clean.completion);
    },
  );

  // Report unresolved media references after restore (§21.2 step 7).
  const missingMedia: string[] = [];
  for (const exercise of clean.exercises) {
    for (const mediaId of [exercise.mediaId, exercise.thumbnailMediaId]) {
      if (mediaId && !(await mediaRepo.exists(mediaId))) missingMedia.push(mediaId);
    }
  }
  return { missingMedia };
}

export { clearStore };
