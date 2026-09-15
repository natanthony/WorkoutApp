/**
 * Domain model — Document 2 §6 (Domain Model & Persistence Schema).
 * Field names are implementation details; relationships and constraints
 * follow the handoff documents. Monday = weekday 0.
 */
export type ID = string;
/** Monday = 0 … Sunday = 6 (device-local weekday, Monday-first). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';
export const DIFFICULTIES: Difficulty[] = ['Beginner', 'Intermediate', 'Advanced'];

export interface Timestamps {
  createdAt: number;
  updatedAt: number;
}

export interface Category extends Timestamps {
  id: ID;
  name: string;
  /** Explicit, user-controlled order. Never alphabetical / insertion order. */
  sortOrder: number;
}

export interface BodyPart extends Timestamps {
  id: ID;
  name: string;
  sortOrder: number;
}

export interface WorkoutSection extends Timestamps {
  id: ID;
  name: string;
  sortOrder: number;
}

export interface Exercise extends Timestamps {
  id: ID;
  name: string;
  /** Stable media ID into the `media` object store. Never an object URL. */
  mediaId: ID | null;
  thumbnailMediaId: ID | null;
  categoryId: ID;
  description: string | null;
  difficulty: Difficulty | null;
  /** Multiple values, including 'None'. Canonical strings, user-extensible. */
  equipment: string[];
  /** Multiple target values (e.g. 'Ankles', 'Calves'). */
  targets: string[];
  sortOrder: number;
}

export interface DayPlan extends Timestamps {
  id: ID;
  weekday: Weekday;
  isRestDay: boolean;
  /**
   * Body-part references in explicit user-controlled order.
   * (Implementation decision: stored inline on the DayPlan record instead of
   * a join table; the order is explicit and user-controlled, which preserves
   * the Document 2 §6 ordering constraint.)
   */
  bodyPartIds: ID[];
}

export interface DayPlanSection extends Timestamps {
  id: ID;
  dayPlanId: ID;
  /**
   * Exactly one of the two references is set. `workoutSectionId` points at a
   * configurable named section whose exercises are added per-day;
   * `customWorkoutId` embeds a saved CustomWorkout (playlist) by reference,
   * expanded in the workout's own exercise order at queue time.
   */
  workoutSectionId: ID | null;
  customWorkoutId?: ID | null;
  sortOrder: number;
}

export interface DayPlanExercise extends Timestamps {
  id: ID;
  dayPlanSectionId: ID;
  /** Reference to a canonical Exercise — never a copy. */
  exerciseId: ID;
  sortOrder: number;
}

export interface CustomWorkout extends Timestamps {
  id: ID;
  name: string;
}

export interface CustomWorkoutExercise extends Timestamps {
  id: ID;
  customWorkoutId: ID;
  exerciseId: ID;
  sortOrder: number;
}

export interface PlaybackState {
  /** Keyed by stable exercise ID. */
  exerciseId: ID;
  positionSeconds: number;
  durationSeconds: number | null;
  updatedAt: number;
}

export interface Favourite {
  exerciseId: ID;
  createdAt: number;
}

/** Basic completion state only (Document 1 §18). Not analytics. */
export interface Completion {
  /** Stable key: `exercise:<id>` or `session:<yyyy-mm-dd>:<weekday>`. */
  id: ID;
  completedAt: number;
}

export interface MediaRecord {
  id: ID;
  mediaType: 'video' | 'thumbnail';
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

/** Transient playback-session queue entry (Document 2 §12). */
export interface QueueItem {
  exerciseId: ID;
  sectionId: ID | null;
  sectionName: string | null;
  sectionIndex: number;
  sectionPosition: number;
  sectionSize: number;
  overallPosition: number;
  overallSize: number;
}

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error'
  | 'completed';

/** Backup file format — Document 2 §21.1. Version 1. */
export interface BackupFile {
  format: 'workout-player-backup';
  version: 1;
  exportedAt: string;
  categories: Category[];
  bodyParts: BodyPart[];
  workoutSections: WorkoutSection[];
  exercises: Exercise[];
  dayPlans: DayPlan[];
  dayPlanSections: DayPlanSection[];
  dayPlanExercises: DayPlanExercise[];
  customWorkouts: CustomWorkout[];
  customWorkoutExercises: CustomWorkoutExercise[];
  favourites: Favourite[];
  playbackState: PlaybackState[];
  completion: Completion[];
}
