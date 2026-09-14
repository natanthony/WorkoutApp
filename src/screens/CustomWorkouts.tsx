import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useCategoryNames, useExerciseById, useFavouriteIds } from '../store';
import { useSession } from '../session';
import { generateCustomQueue, moveId, sortByOrder } from '../domain';
import type { CustomWorkout } from '../types';
import { ConfirmDialog, EmptyState, Icon, ReorderList } from '../components/common';
import { ExerciseThumb } from '../components/exercise';
import { customWorkoutRepo, favouriteRepo } from '../persistence/repositories';

export default function CustomWorkoutsScreen() {
  const app = useApp();
  const navigate = useNavigate();
  const { startSession } = useSession();
  const exerciseById = useExerciseById();
  const categoryNames = useCategoryNames();
  const favouriteIds = useFavouriteIds();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [rename, setRename] = useState('');
  const [pick, setPick] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<CustomWorkout | null>(null);

  const selected = app.customWorkouts.find((w) => w.id === selectedId) ?? null;

  const items = useMemo(
    () =>
      selected
        ? sortByOrder(
            app.customWorkoutExercises.filter((i) => i.customWorkoutId === selected.id),
          )
        : [],
    [selected, app.customWorkoutExercises],
  );

  const inWorkout = new Set(items.map((i) => i.exerciseId));
  const candidates = app.exercises.filter((e) => !inWorkout.has(e.id));

  const createWorkout = () => {
    const name = newName.trim();
    if (!name) return;
    void customWorkoutRepo.create(name).then(async (workout) => {
      setNewName('');
      await app.refresh();
      setSelectedId(workout.id);
      setRename(workout.name);
    });
  };

  const startWorkout = () => {
    if (!selected || items.length === 0) return;
    startSession({
      source: 'custom',
      title: selected.name,
      subtitle: `${items.length} exercises`,
      dayKey: null,
      queue: generateCustomQueue(items, app.exercises),
    });
    navigate('/play');
  };

  return (
    <div className="stack">
      <div className="screen-header">
        <div>
          <h1>Custom workouts</h1>
          <p>Hand-picked sequences you can save and replay any time.</p>
        </div>
        {selected && items.length > 0 ? (
          <div className="header-actions">
            <button type="button" className="button button-primary" onClick={startWorkout}>
              <Icon name="play" size={16} /> Start workout
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid-2">
        <section className="card section-block" aria-label="Workout list">
          <h2>Your workouts</h2>
          <div className="inline-form">
            <input
              value={newName}
              placeholder="New workout name…"
              aria-label="New workout name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  createWorkout();
                }
              }}
            />
            <button type="button" className="button button-secondary" onClick={createWorkout}>
              <Icon name="plus" size={15} /> Create
            </button>
          </div>
          {app.customWorkouts.length === 0 ? (
            <EmptyState
              icon="dumbbell"
              title="No custom workouts yet"
              message="Create one above, then add exercises from your library."
            />
          ) : (
            <div className="list">
              {app.customWorkouts.map((workout) => {
                const count = app.customWorkoutExercises.filter(
                  (i) => i.customWorkoutId === workout.id,
                ).length;
                return (
                  <button
                    key={workout.id}
                    type="button"
                    className={`list-item${selectedId === workout.id ? '' : ''}`}
                    style={
                      selectedId === workout.id
                        ? { borderColor: 'var(--accent)' }
                        : undefined
                    }
                    onClick={() => {
                      setSelectedId(workout.id);
                      setRename(workout.name);
                      setPick('');
                    }}
                  >
                    <div className="item-main">
                      <span className="item-title">{workout.name}</span>
                      <div className="item-sub">
                        <span>
                          {count} exercise{count === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                    <Icon name="chevron-right" size={17} />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="card section-block" aria-label="Workout editor">
          {!selected ? (
            <EmptyState
              icon="edit"
              title="Select a workout"
              message="Choose a workout on the left to edit its exercises."
            />
          ) : (
            <>
              <div className="card-title">
                <h2>{selected.name}</h2>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Delete ${selected.name}`}
                  onClick={() => setConfirmDelete(selected)}
                >
                  <Icon name="trash" size={17} />
                </button>
              </div>
              <div className="inline-form">
                <input
                  value={rename}
                  aria-label="Rename workout"
                  onChange={(e) => setRename(e.target.value)}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!rename.trim() || rename.trim() === selected.name}
                  onClick={() => {
                    void customWorkoutRepo.rename(selected.id, rename).then(app.refresh);
                  }}
                >
                  Rename
                </button>
              </div>

              {items.length === 0 ? (
                <p className="note">No exercises yet — add your first below.</p>
              ) : (
                <ReorderList
                  items={items}
                  getKey={(item) => item.id}
                  onReorder={(from, to) => {
                    const ids = moveId(
                      items.map((i) => i.id),
                      from,
                      to,
                    );
                    void customWorkoutRepo.reorder(selected.id, ids).then(app.refresh);
                  }}
                  renderItem={(item) => {
                    const exercise = exerciseById.get(item.exerciseId);
                    if (!exercise) {
                      return (
                        <div className="list-item">
                          <div className="item-main">
                            <span className="item-title">Missing exercise</span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="list-item">
                        <ExerciseThumb exercise={exercise} />
                        <div className="item-main">
                          <span className="item-title">{exercise.name}</span>
                          <div className="item-sub">
                            <span>{categoryNames.get(exercise.categoryId) ?? ''}</span>
                          </div>
                        </div>
                        <div className="item-actions">
                          <button
                            type="button"
                            className={`icon-button${favouriteIds.has(exercise.id) ? ' active' : ''}`}
                            aria-label="Toggle favourite"
                            onClick={() =>
                              void favouriteRepo
                                .set(exercise.id, !favouriteIds.has(exercise.id))
                                .then(app.refresh)
                            }
                          >
                            <Icon name="star" size={17} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remove ${exercise.name}`}
                            onClick={() =>
                              void customWorkoutRepo.removeExercise(item.id).then(app.refresh)
                            }
                          >
                            <Icon name="x" size={17} />
                          </button>
                        </div>
                      </div>
                    );
                  }}
                />
              )}

              <div className="inline-form">
                <select
                  aria-label="Add exercise to workout"
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                >
                  <option value="">Choose an exercise…</option>
                  {candidates.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!pick}
                  onClick={() => {
                    void customWorkoutRepo.addExercise(selected.id, pick).then(app.refresh);
                    setPick('');
                  }}
                >
                  <Icon name="plus" size={15} /> Add
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Delete ${confirmDelete.name}?`}
          danger
          confirmLabel="Delete workout"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            void customWorkoutRepo.remove(target.id).then(async () => {
              if (selectedId === target.id) setSelectedId(null);
              await app.refresh();
            });
            setConfirmDelete(null);
          }}
        >
          This removes the workout and its exercise references. The exercises themselves stay in
          your library.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
