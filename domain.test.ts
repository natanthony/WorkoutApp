import { describe, expect, it } from 'vitest';
import {
  applyOrder,
  distinctEquipment,
  estimateMinutes,
  exerciseCompletionKey,
  formatClock,
  generateCustomQueue,
  generatePlanQueue,
  mondayFirstWeekday,
  moveId,
  searchExercises,
  sessionCompletionKey,
  singleExerciseQueue,
  sortByOrder,
} from './domain';
import { validateBackup } from './backup';
import type {
  DayPlan,
  DayPlanSection,
  DayPlanSectionWorkout,
  Exercise,
} from './types';

const now = 1_700_000_000_000;

function makeExercise(id: string, sortOrder: number, patch: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name: `Exercise ${id}`,
    mediaId: `media-${id}`,
    thumbnailMediaId: null,
    categoryId: 'cat-1',
    description: null,
    difficulty: null,
    equipment: [],
    targets: [],
    sortOrder,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function makeSection(id: string, dayPlanId: string, name: string, sortOrder: number): DayPlanSection {
  return { id, dayPlanId, name, sortOrder, createdAt: now, updatedAt: now };
}

function makeLink(id: string, dayPlanSectionId: string, customWorkoutId: string, sortOrder: number): DayPlanSectionWorkout {
  return { id, dayPlanSectionId, customWorkoutId, sortOrder, createdAt: now, updatedAt: now };
}

const warmUpWorkout = { id: 'cw-1', name: 'Warm Up', createdAt: now, updatedAt: now };
const coolDownWorkout = { id: 'cw-2', name: 'Cool Down', createdAt: now, updatedAt: now };
const cwItems = [
  { id: 'c-1', customWorkoutId: 'cw-1', exerciseId: 'e-1', sortOrder: 10, createdAt: now, updatedAt: now },
  { id: 'c-2', customWorkoutId: 'cw-1', exerciseId: 'e-2', sortOrder: 20, createdAt: now, updatedAt: now },
  { id: 'c-3', customWorkoutId: 'cw-2', exerciseId: 'e-3', sortOrder: 10, createdAt: now, updatedAt: now },
  { id: 'c-4', customWorkoutId: 'cw-2', exerciseId: 'e-4', sortOrder: 20, createdAt: now, updatedAt: now },
];

const workoutDay: DayPlan = {
  id: 'day-0',
  weekday: 0,
  isRestDay: false,
  bodyPartIds: [],
  createdAt: now,
  updatedAt: now,
};

describe('weekday helpers', () => {
  it('maps Sunday-first getDay() to Monday-first', () => {
    // 2023-01-01 was a Sunday, 2023-01-02 a Monday.
    expect(mondayFirstWeekday(new Date(2023, 0, 2))).toBe(0);
    expect(mondayFirstWeekday(new Date(2023, 0, 1))).toBe(6);
    expect(mondayFirstWeekday(new Date(2023, 0, 7))).toBe(5); // Saturday
  });

  it('builds stable completion keys', () => {
    const date = new Date(2026, 8, 14);
    const key = sessionCompletionKey(date, mondayFirstWeekday(date));
    expect(key).toMatch(/^session:\d{4}-\d{2}-\d{2}:\d$/);
    expect(exerciseCompletionKey('abc')).toBe('exercise:abc');
  });
});

describe('ordering', () => {
  it('applyOrder assigns explicit spaced orders', () => {
    expect(Array.from(applyOrder(['a', 'b', 'c']).entries())).toEqual([
      ['a', 10],
      ['b', 20],
      ['c', 30],
    ]);
  });

  it('moveId is pure and bounds-checked', () => {
    expect(moveId(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveId(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveId(['a', 'b', 'c'], -1, 2)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'b', 'c']);
  });

  it('sortByOrder does not mutate the input', () => {
    const input = [{ sortOrder: 30 }, { sortOrder: 10 }];
    const sorted = sortByOrder(input);
    expect(sorted.map((i) => i.sortOrder)).toEqual([10, 30]);
    expect(input[0].sortOrder).toBe(30);
  });
});

describe('queue generation', () => {
  const sections = [makeSection('s-2', 'day-0', 'Cool Down', 20), makeSection('s-1', 'day-0', 'Warm Up', 10)];
  const exercises = [makeExercise('e-1', 10), makeExercise('e-2', 20), makeExercise('e-3', 30), makeExercise('e-4', 40)];
  const sectionWorkouts = [
    makeLink('l-2', 's-1', 'cw-2', 20),
    makeLink('l-1', 's-1', 'cw-1', 10),
    makeLink('l-3', 's-2', 'cw-1', 10),
  ];
  const base = {
    sections,
    sectionWorkouts,
    customWorkouts: [warmUpWorkout, coolDownWorkout],
    customWorkoutExercises: cwItems,
    exercises,
  };

  it('orders by section, then workout, then exercise, with running positions', () => {
    const queue = generatePlanQueue({ dayPlan: workoutDay, ...base });
    expect(queue.map((q) => q.exerciseId)).toEqual(['e-1', 'e-2', 'e-3', 'e-4', 'e-1', 'e-2']);
    expect(queue.map((q) => q.sectionName)).toEqual(['Warm Up', 'Warm Up', 'Warm Up', 'Warm Up', 'Cool Down', 'Cool Down']);
    expect(queue.map((q) => q.overallPosition)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(queue.every((q) => q.overallSize === 6)).toBe(true);
    expect(queue[0].sectionSize).toBe(2);
    expect(queue[4].sectionPosition).toBe(1);
  });

  it('returns an empty queue for rest days', () => {
    expect(
      generatePlanQueue({ dayPlan: { ...workoutDay, isRestDay: true }, ...base }),
    ).toEqual([]);
  });

  it('throws on a section containing a missing workout', () => {
    expect(() =>
      generatePlanQueue({
        dayPlan: workoutDay,
        ...base,
        sectionWorkouts: [...sectionWorkouts, makeLink('l-9', 's-1', 'gone', 30)],
      }),
    ).toThrow(/broken references/);
  });

  it('throws on a workout containing a missing exercise', () => {
    expect(() =>
      generatePlanQueue({
        dayPlan: workoutDay,
        ...base,
        customWorkoutExercises: [
          ...cwItems,
          { id: 'c-x', customWorkoutId: 'cw-2', exerciseId: 'missing', sortOrder: 30, createdAt: now, updatedAt: now },
        ],
      }),
    ).toThrow(/broken references/);
  });

  it('generates custom workout queues in item order', () => {
    const queue = generateCustomQueue([{ exerciseId: 'e-3' }, { exerciseId: 'e-1' }], exercises);
    expect(queue.map((q) => q.exerciseId)).toEqual(['e-3', 'e-1']);
    expect(queue[0].overallSize).toBe(2);
    expect(() => generateCustomQueue([{ exerciseId: 'nope' }], exercises)).toThrow();
  });

  it('single exercise queue is a one-item queue', () => {
    const queue = singleExerciseQueue(exercises[0]);
    expect(queue).toHaveLength(1);
    expect(queue[0].overallPosition).toBe(1);
    expect(queue[0].overallSize).toBe(1);
  });
});

describe('search & filters', () => {
  const exercises = [
    makeExercise('e-1', 10, { equipment: ['Dumbbell'], targets: ['Calves'], difficulty: 'Beginner' }),
    makeExercise('e-2', 20, { equipment: ['None'], targets: ['Full Body'], difficulty: 'Advanced' }),
    makeExercise('e-3', 30, { name: 'Kettlebell swing', equipment: ['Kettlebell', 'Mat'] }),
  ];
  const categoryNames = new Map([['cat-1', 'Strength']]);

  it('matches across name, equipment, targets and description', () => {
    const filters = { query: 'dumbbell', categoryId: 'all' as const, difficulty: 'all' as const, equipment: 'all' as const };
    expect(searchExercises(exercises, categoryNames, filters).map((e) => e.id)).toEqual(['e-1']);
    expect(searchExercises(exercises, categoryNames, { ...filters, query: 'full body' })[0].id).toBe('e-2');
  });

  it('applies category, difficulty and equipment filters', () => {
    expect(
      searchExercises(exercises, categoryNames, { query: '', categoryId: 'cat-1', difficulty: 'Advanced', equipment: 'all' })[0].id,
    ).toBe('e-2');
    expect(
      searchExercises(exercises, categoryNames, { query: '', categoryId: 'all', difficulty: 'all', equipment: 'Mat' }).map((e) => e.id),
    ).toEqual(['e-3']);
  });

  it('preserves explicit library order', () => {
    const shuffled = [exercises[2], exercises[0], exercises[1]];
    expect(
      searchExercises(shuffled, categoryNames, { query: '', categoryId: 'all', difficulty: 'all', equipment: 'all' }).map((e) => e.id),
    ).toEqual(['e-1', 'e-2', 'e-3']);
  });

  it('derives distinct equipment options sorted', () => {
    expect(distinctEquipment(exercises)).toEqual(['Dumbbell', 'Kettlebell', 'Mat', 'None']);
  });
});

describe('presentation', () => {
  it('formatClock renders h:mm:ss / m:ss and guards bad input', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3599)).toBe('59:59');
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });

  it('estimateMinutes sums known durations only', () => {
    const durations = new Map([['a', 60], ['b', 120], ['c', null]]);
    expect(estimateMinutes(['a', 'b', 'c', 'd'], durations)).toBe(3);
    expect(estimateMinutes(['c', 'd'], durations)).toBeNull();
  });
});

describe('backup validation', () => {
  const validBackup = {
    format: 'workout-player-backup',
    version: 1,
    exportedAt: '2026-09-14T00:00:00.000Z',
    categories: [{ id: 'cat-1', name: 'Mobility', sortOrder: 10, createdAt: now, updatedAt: now }],
    bodyParts: [],
    workoutSections: [],
    exercises: [],
    dayPlans: [],
    dayPlanSections: [],
    dayPlanExercises: [],
    dayPlanSectionWorkouts: [],
    customWorkouts: [],
    customWorkoutExercises: [],
    favourites: [],
    playbackState: [],
    completion: [],
  };

  it('accepts a valid minimal backup', () => {
    const result = validateBackup(validBackup);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data).not.toBeNull();
  });

  it('rejects wrong format and future versions', () => {
    expect(validateBackup({ ...validBackup, format: 'other' }).ok).toBe(false);
    const future = validateBackup({ ...validBackup, version: 2 });
    expect(future.ok).toBe(false);
    expect(future.errors.join(' ')).toMatch(/version/);
  });

  it('rejects duplicate ids and dangling references', () => {
    const dup = validateBackup({
      ...validBackup,
      bodyParts: [
        { id: 'bp-1', name: 'Arms', sortOrder: 10, createdAt: now, updatedAt: now },
        { id: 'bp-1', name: 'Legs', sortOrder: 20, createdAt: now, updatedAt: now },
      ],
    });
    expect(dup.ok).toBe(false);
    expect(dup.errors.join(' ')).toMatch(/duplicate/);

    const dangling = validateBackup({
      ...validBackup,
      exercises: [makeExercise('e-1', 10)],
      dayPlans: [{ ...workoutDay, bodyPartIds: ['bp-missing'] }],
    });
    expect(dangling.ok).toBe(false);
    expect(dangling.errors.join(' ')).toMatch(/unknown body part/);
  });

  it('rejects non-object input safely', () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup('nope').ok).toBe(false);
  });
});
