/**
 * IndexedDB persistence — Document 2 §9.
 * Versioned database, separate object stores for metadata and media,
 * explicit migrations. UI/feature code must use repositories, not this file.
 */
import type {
  BodyPart,
  Category,
  CustomWorkout,
  CustomWorkoutExercise,
  DayPlan,
  Exercise,
  MediaRecord,
} from '../types';

export const DB_NAME = 'workout-player';
// v2: indexes are now created on the upgrade transaction itself.
// v1 databases may exist with stores but no indexes (older Chrome tolerated
// spawning new versionchange transactions during upgrade; current Chrome
// throws "A version change transaction is running"), so migration 1→2
// re-runs index creation — it is guarded by indexNames.contains checks.
// v3: adds the dayPlanSectionWorkouts join store (sections contain workouts).
export const DB_VERSION = 4;

export const STORE_NAMES = [
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
  'playback',
  'favourites',
  'completions',
  'media',
  'mediaBlobs',
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

/** KeyPath differs for records keyed by exercise ID. */
const KEY_PATHS: Partial<Record<StoreName, string>> = {
  playback: 'exerciseId',
  favourites: 'exerciseId',
};

let dbPromise: Promise<IDBDatabase> | null = null;

function createObjectStores(db: IDBDatabase): void {
  for (const name of STORE_NAMES) {
    if (db.objectStoreNames.contains(name)) continue;
    db.createObjectStore(name, { keyPath: KEY_PATHS[name] ?? 'id' });
  }
}

/**
 * Create indexes on the running upgrade transaction. Never call
 * db.transaction() from inside onupgradeneeded — the implicit version
 * change transaction is already running, and current Chrome throws
 * "A version change transaction is running" (older Chrome silently
 * tolerated it, which is why this bug only surfaced on newer browsers).
 * All index creation is guarded so re-running is a no-op.
 */
function ensureIndexes(tx: IDBTransaction): void {
  // Suggested indexes — Document 2 §6.
  const exercises = tx.objectStore('exercises');
  if (!exercises.indexNames.contains('categoryId')) exercises.createIndex('categoryId', 'categoryId');
  if (!exercises.indexNames.contains('sortOrder')) exercises.createIndex('sortOrder', 'sortOrder');
  const dps = tx.objectStore('dayPlanSections');
  if (!dps.indexNames.contains('dayPlanId')) dps.createIndex('dayPlanId', 'dayPlanId');
  const dpe = tx.objectStore('dayPlanExercises');
  if (!dpe.indexNames.contains('dayPlanSectionId')) dpe.createIndex('dayPlanSectionId', 'dayPlanSectionId');
  if (!dpe.indexNames.contains('exerciseId')) dpe.createIndex('exerciseId', 'exerciseId');
  const cwe = tx.objectStore('customWorkoutExercises');
  if (!cwe.indexNames.contains('customWorkoutId')) cwe.createIndex('customWorkoutId', 'customWorkoutId');
  if (!cwe.indexNames.contains('exerciseId')) cwe.createIndex('exerciseId', 'exerciseId');
  const dpsw = tx.objectStore('dayPlanSectionWorkouts');
  if (!dpsw.indexNames.contains('dayPlanSectionId')) dpsw.createIndex('dayPlanSectionId', 'dayPlanSectionId');
  if (!dpsw.indexNames.contains('customWorkoutId')) dpsw.createIndex('customWorkoutId', 'customWorkoutId');
}

function upgrade(db: IDBDatabase, oldVersion: number, tx: IDBTransaction | null): void {
  // Migration 0→1: initial schema. 1→2: create missing indexes in-place
  // for databases half-created by the old buggy upgrade path. All steps
  // are idempotent; unknown future versions are rejected by IndexedDB.
  if (oldVersion < 4) {
    createObjectStores(db);
  }
  if (oldVersion < 4) {
    if (!tx) throw new Error('Upgrade transaction unavailable');
    ensureIndexes(tx);
  }
}

export function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        try {
          upgrade(request.result, (event as IDBVersionChangeEvent).oldVersion, request.transaction);
        } catch (error) {
          dbPromise = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error ?? new Error('Failed to open database'));
      };
      request.onblocked = () => {
        dbPromise = null;
        reject(new Error('Database upgrade blocked by another tab'));
      };
    });
  }
  return dbPromise;
}

export function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Run `fn` inside a transaction. The returned promise resolves only after
 * the transaction completes, so writes are durable before we report success
 * (Document 2 §19.3).
 */
export function withTx<T>(
  storeNames: StoreName | StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const names = (Array.isArray(storeNames) ? storeNames : [storeNames]) as string[];
  return getDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(names, mode);
        fn(tx).then(
          (result) => {
            tx.oncomplete = () => resolve(result);
          },
          (error) => {
            try {
              tx.abort();
            } catch {
              /* already finished */
            }
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
        tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
      }),
  );
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return withTx(store, 'readonly', async (tx) => (await req(tx.objectStore(store).getAll())) as T[]);
}

export async function getOne<T>(store: StoreName, key: string): Promise<T | undefined> {
  return withTx(store, 'readonly', async (tx) => (await req(tx.objectStore(store).get(key))) as T | undefined);
}

export async function putRecord<T>(store: StoreName, value: T): Promise<void> {
  await withTx(store, 'readwrite', async (tx) => {
    await req(tx.objectStore(store).put(value));
  });
}

export async function putMany<T>(store: StoreName, values: T[]): Promise<void> {
  await withTx(store, 'readwrite', async (tx) => {
    const os = tx.objectStore(store);
    for (const value of values) await req(os.put(value));
  });
}

export async function deleteRecord(store: StoreName, key: string): Promise<void> {
  await withTx(store, 'readwrite', async (tx) => {
    await req(tx.objectStore(store).delete(key));
  });
}

export async function clearStore(store: StoreName): Promise<void> {
  await withTx(store, 'readwrite', async (tx) => {
    await req(tx.objectStore(store).clear());
  });
}

export async function getByIndex<T>(
  store: StoreName,
  index: string,
  value: string,
): Promise<T[]> {
  return withTx(store, 'readonly', async (tx) => {
    const os = tx.objectStore(store);
    return (await req(os.index(index).getAll(value))) as T[];
  });
}

/* ------------------------------------------------------------------ */
/* Seed data — Document 1 §7/§8/§9. Initial data, not hardcoded enums. */
/* ------------------------------------------------------------------ */

const SEED_CATEGORIES = ['Mobility', 'Core', 'HIIT', 'Dumbbell', 'Calisthenics'];
const SEED_BODY_PARTS = ['Arms', 'Shoulders', 'Chest', 'Back', 'Legs', 'Core', 'Glutes'];

export async function seedIfEmpty(): Promise<void> {
  const existing = await getAll<Category>('categories');
  if (existing.length > 0) return;
  const now = Date.now();
  const categories: Category[] = SEED_CATEGORIES.map((name, i) => ({
    id: `seed-category-${i + 1}`,
    name,
    sortOrder: (i + 1) * 10,
    createdAt: now,
    updatedAt: now,
  }));
  const bodyParts: BodyPart[] = SEED_BODY_PARTS.map((name, i) => ({
    id: `seed-bodypart-${i + 1}`,
    name,
    sortOrder: (i + 1) * 10,
    createdAt: now,
    updatedAt: now,
  }));
  // All seven days start as Rest Days with no content — the app never
  // hardcodes weekday workout content (Document 1 §28).
  const dayPlans: DayPlan[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: `dayplan-${weekday}`,
    weekday: weekday as DayPlan['weekday'],
    isRestDay: true,
    bodyPartIds: [],
    createdAt: now,
    updatedAt: now,
  }));

  await withTx(
    ['categories', 'bodyParts', 'workoutSections', 'dayPlans'],
    'readwrite',
    async (tx) => {
      const cats = tx.objectStore('categories');
      for (const c of categories) await req(cats.put(c));
      const bps = tx.objectStore('bodyParts');
      for (const b of bodyParts) await req(bps.put(b));
      const dps = tx.objectStore('dayPlans');
      for (const d of dayPlans) await req(dps.put(d));
    },
  );
}

export type { MediaRecord, Exercise, CustomWorkout, CustomWorkoutExercise };
