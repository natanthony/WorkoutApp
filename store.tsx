/**
 * Application state — Document 2 §8. Persisted entity/configuration state
 * lives in IndexedDB (via repositories) and is mirrored here for rendering.
 * Dialog state, drafts, search state, active session and object URLs stay
 * transient (component/context level), never in this store.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { seedIfEmpty } from './persistence/db';
import {
  bodyPartRepo,
  categoryRepo,
  completionRepo,
  customWorkoutRepo,
  exerciseRepo,
  favouriteRepo,
  migratePlanSchema,
  planRepo,
  playbackRepo,
  workoutSectionRepo,
} from './persistence/repositories';
import type {
  BodyPart,
  Category,
  Completion,
  CustomWorkout,
  CustomWorkoutExercise,
  DayPlan,
  DayPlanSection,
  DayPlanSectionWorkout,
  Exercise,
  Favourite,
  ID,
  PlaybackState,
  WorkoutSection,
} from './types';

export interface AppSettings {
  /** Auto-play next queue item on natural end (Document 1 §15). */
  autoNext: boolean;
  /** Rest countdown length in seconds, started from the player screen. */
  restSeconds: number;
  theme: 'dark' | 'light';
  /** Settings schema version — bump when a default's meaning changes. */
  version: number;
}

export const SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS: AppSettings = {
  autoNext: false,
  restSeconds: 60,
  theme: 'dark',
  version: SETTINGS_VERSION,
};

export const REST_SECONDS_MIN = 5;
export const REST_SECONDS_MAX = 600;

/** Clamp a user-supplied rest length into the supported range. */
export function sanitizeRestSeconds(value: unknown): number {
  const n = typeof value === 'number' ? Math.round(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.restSeconds;
  return Math.min(REST_SECONDS_MAX, Math.max(REST_SECONDS_MIN, n));
}

const SETTINGS_KEY = 'workout-player-settings';

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // v1 settings predate "replay by default"; v2 predates the rest timer.
    // Adopt the new defaults once, preserving the user's existing choices.
    if (typeof parsed.version !== 'number' || parsed.version < SETTINGS_VERSION) {
      return {
        ...DEFAULT_SETTINGS,
        autoNext:
          (parsed.version ?? 0) >= 2 && typeof parsed.autoNext === 'boolean'
            ? parsed.autoNext
            : DEFAULT_SETTINGS.autoNext,
        theme: parsed.theme === 'light' ? 'light' : 'dark',
      };
    }
    return {
      autoNext: typeof parsed.autoNext === 'boolean' ? parsed.autoNext : DEFAULT_SETTINGS.autoNext,
      restSeconds: sanitizeRestSeconds(parsed.restSeconds),
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      version: SETTINGS_VERSION,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export interface AppData {
  loading: boolean;
  error: string | null;
  categories: Category[];
  bodyParts: BodyPart[];
  workoutSections: WorkoutSection[];
  exercises: Exercise[];
  dayPlans: DayPlan[];
  dayPlanSections: DayPlanSection[];
  dayPlanSectionWorkouts: DayPlanSectionWorkout[];
  customWorkouts: CustomWorkout[];
  customWorkoutExercises: CustomWorkoutExercise[];
  favourites: Favourite[];
  playbackStates: PlaybackState[];
  completions: Completion[];
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  refresh: () => Promise<void>;
}

const AppContext = createContext<AppData | null>(null);

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bodyParts, setBodyParts] = useState<BodyPart[]>([]);
  const [workoutSections, setWorkoutSections] = useState<WorkoutSection[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [dayPlans, setDayPlans] = useState<DayPlan[]>([]);
  const [dayPlanSections, setDayPlanSections] = useState<DayPlanSection[]>([]);
  const [dayPlanSectionWorkouts, setDayPlanSectionWorkouts] = useState<DayPlanSectionWorkout[]>([]);
  const [customWorkouts, setCustomWorkouts] = useState<CustomWorkout[]>([]);
  const [customWorkoutExercises, setCustomWorkoutExercises] = useState<CustomWorkoutExercise[]>([]);
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [playbackStates, setPlaybackStates] = useState<PlaybackState[]>([]);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [settings, setSettingsState] = useState<AppSettings>(loadSettings);

  const refresh = useCallback(async () => {
    const [
      categoriesData,
      bodyPartsData,
      workoutSectionsData,
      exercisesData,
      dayPlansData,
      dayPlanSectionsData,
      dayPlanSectionWorkoutsData,
      customWorkoutsData,
      customWorkoutExercisesData,
      favouritesData,
      playbackData,
      completionsData,
    ] = await Promise.all([
      categoryRepo.list(),
      bodyPartRepo.list(),
      workoutSectionRepo.list(),
      exerciseRepo.list(),
      planRepo.getWeek(),
      planRepo.listSections(),
      planRepo.listSectionWorkouts(),
      customWorkoutRepo.list(),
      customWorkoutRepo.listAllItems(),
      favouriteRepo.list(),
      playbackRepo.list(),
      completionRepo.list(),
    ]);
    setCategories(categoriesData);
    setBodyParts(bodyPartsData);
    setWorkoutSections(workoutSectionsData);
    setExercises(exercisesData);
    setDayPlans(dayPlansData);
    setDayPlanSections(dayPlanSectionsData);
    setDayPlanSectionWorkouts(dayPlanSectionWorkoutsData);
    setCustomWorkouts(customWorkoutsData);
    setCustomWorkoutExercises(customWorkoutExercisesData);
    setFavourites(favouritesData);
    setPlaybackStates(playbackData);
    setCompletions(completionsData);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await seedIfEmpty();
        await migratePlanSchema();
        await refresh();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load local data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const setSettings = useCallback((next: AppSettings) => {
    setSettingsState(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* settings persistence failure is non-fatal */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const value = useMemo<AppData>(
    () => ({
      loading,
      error,
      categories,
      bodyParts,
      workoutSections,
      exercises,
      dayPlans,
      dayPlanSections,
      dayPlanSectionWorkouts,
      customWorkouts,
      customWorkoutExercises,
      favourites,
      playbackStates,
      completions,
      settings,
      setSettings,
      refresh,
    }),
    [
      loading,
      error,
      categories,
      bodyParts,
      workoutSections,
      exercises,
      dayPlans,
      dayPlanSections,
      dayPlanSectionWorkouts,
      customWorkouts,
      customWorkoutExercises,
      favourites,
      playbackStates,
      completions,
      settings,
      setSettings,
      refresh,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/* ------------------------- Derived lookup helpers ------------------------- */

export function useExerciseById(): Map<ID, Exercise> {
  const { exercises } = useApp();
  return useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
}

export function useCategoryNames(): Map<ID, string> {
  const { categories } = useApp();
  return useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
}

export function useFavouriteIds(): Set<ID> {
  const { favourites } = useApp();
  return useMemo(() => new Set(favourites.map((f) => f.exerciseId)), [favourites]);
}

export function usePlaybackByExercise(): Map<ID, PlaybackState> {
  const { playbackStates } = useApp();
  return useMemo(() => new Map(playbackStates.map((p) => [p.exerciseId, p])), [playbackStates]);
}
