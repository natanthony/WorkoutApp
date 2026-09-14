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
  DayPlanExercise,
  DayPlanSection,
  Exercise,
  Favourite,
  ID,
  PlaybackState,
  WorkoutSection,
} from './types';

export interface AppSettings {
  /** Auto-play next queue item on natural end (Document 1 §15). */
  autoNext: boolean;
  theme: 'dark' | 'light';
}

export const DEFAULT_SETTINGS: AppSettings = { autoNext: true, theme: 'dark' };

const SETTINGS_KEY = 'workout-player-settings';

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      autoNext: typeof parsed.autoNext === 'boolean' ? parsed.autoNext : DEFAULT_SETTINGS.autoNext,
      theme: parsed.theme === 'light' ? 'light' : 'dark',
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
  dayPlanExercises: DayPlanExercise[];
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
  const [dayPlanExercises, setDayPlanExercises] = useState<DayPlanExercise[]>([]);
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
      dayPlanExercisesData,
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
      planRepo.listSectionExercises(),
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
    setDayPlanExercises(dayPlanExercisesData);
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
      dayPlanExercises,
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
      dayPlanExercises,
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
