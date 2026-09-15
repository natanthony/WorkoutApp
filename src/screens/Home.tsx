import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useCategoryNames, useExerciseById, useFavouriteIds } from '../store';
import { useSession } from '../session';
import {
  WEEKDAY_NAMES,
  estimateMinutes,
  formatClock,
  generatePlanQueue,
  sessionCompletionKey,
  singleExerciseQueue,
  todayWeekday,
} from '../domain';
import { EmptyState, Icon } from '../components/common';
import { ExerciseRow } from '../components/exercise';
import { favouriteRepo } from '../persistence/repositories';

export default function HomeScreen() {
  const app = useApp();
  const navigate = useNavigate();
  const { startSession } = useSession();
  const exerciseById = useExerciseById();
  const categoryNames = useCategoryNames();
  const favouriteIds = useFavouriteIds();
  const weekday = todayWeekday();
  const todayPlan = app.dayPlans.find((d) => d.weekday === weekday);
  const [error, setError] = useState<string | null>(null);

  const todayKey = sessionCompletionKey(new Date(), weekday);
  const todayDone = app.completions.some((c) => c.id === todayKey);

  const queue = useMemo(() => {
    if (!todayPlan || todayPlan.isRestDay) return [];
    try {
      return generatePlanQueue({
        dayPlan: todayPlan,
        sections: app.dayPlanSections,
        sectionExercises: app.dayPlanExercises,
        workoutSections: app.workoutSections,
        exercises: app.exercises,
        customWorkouts: app.customWorkouts,
        customWorkoutExercises: app.customWorkoutExercises,
      });
    } catch {
      return [];
    }
  }, [todayPlan, app.dayPlanSections, app.dayPlanExercises, app.workoutSections, app.exercises, app.customWorkouts, app.customWorkoutExercises]);

  const durationMap = useMemo(
    () => new Map(app.playbackStates.map((p) => [p.exerciseId, p.durationSeconds])),
    [app.playbackStates],
  );
  const estimated = estimateMinutes(
    queue.map((q) => q.exerciseId),
    durationMap,
  );

  const inProgress = useMemo(
    () =>
      app.playbackStates
        .filter((p) => p.positionSeconds > 5 && exerciseById.has(p.exerciseId))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5),
    [app.playbackStates, exerciseById],
  );

  const startToday = () => {
    if (!todayPlan || queue.length === 0) return;
    try {
      startSession({
        source: 'plan',
        title: `Today's workout`,
        subtitle: WEEKDAY_NAMES[weekday],
        dayKey: sessionCompletionKey(new Date(), weekday),
        queue,
      });
      navigate('/play');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the workout');
    }
  };

  const playSingle = (exerciseId: string) => {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) return;
    startSession({
      source: 'single',
      title: exercise.name,
      subtitle: null,
      dayKey: null,
      queue: singleExerciseQueue(exercise),
    });
    navigate('/play');
  };

  return (
    <div className="stack">
      <div className="screen-header">
        <div>
          <h1>Today — {WEEKDAY_NAMES[weekday]}</h1>
          <p>
            {todayDone
              ? 'Workout complete. Nice work!'
              : todayPlan?.isRestDay
                ? 'Rest day. Plan something for tomorrow?'
                : `${queue.length} exercise${queue.length === 1 ? '' : 's'}${estimated ? ` · about ${estimated} min` : ''}`}
          </p>
        </div>
        <div className="header-actions">
          {todayPlan && !todayPlan.isRestDay && queue.length > 0 ? (
            <button type="button" className="button button-primary" onClick={startToday}>
              <Icon name="play" size={16} /> Start workout
            </button>
          ) : null}
          <Link to="/plan" className="button button-secondary">
            <Icon name="edit" size={16} /> Edit plan
          </Link>
        </div>
      </div>

      {error ? <p className="field-error">{error}</p> : null}

      <section className="card section-block" aria-label="This week">
        <div className="card-title">
          <h2>This week</h2>
        </div>
        <div className="week-grid">
          {app.dayPlans.map((day) => (
            <Link
              key={day.id}
              to="/plan"
              className={`day-card${day.weekday === weekday ? ' today selected' : ''}`}
            >
              <span className="day-name">
                {WEEKDAY_NAMES[day.weekday]}
                {day.weekday === weekday && todayDone ? <span className="dot" aria-label="Completed" /> : null}
              </span>
              <span className="day-meta">
                {day.isRestDay ? (
                  <span>Rest day</span>
                ) : (
                  <span>
                    {app.dayPlanSections.filter((s) => s.dayPlanId === day.id).length} section
                    {app.dayPlanSections.filter((s) => s.dayPlanId === day.id).length === 1 ? '' : 's'}
                  </span>
                )}
                {day.bodyPartIds.length > 0 ? (
                  <span>
                    {day.bodyPartIds
                      .map((id) => app.bodyParts.find((b) => b.id === id)?.name ?? '?')
                      .join(', ')}
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card section-block" aria-label="Continue where you left off">
        <div className="card-title">
          <h2>Continue where you left off</h2>
        </div>
        {inProgress.length === 0 ? (
          <EmptyState
            icon="resume"
            title="Nothing in progress"
            message="Start any exercise or workout and your position is remembered automatically."
          />
        ) : (
          <div className="list">
            {inProgress.map((state) => {
              const exercise = exerciseById.get(state.exerciseId)!;
              return (
                <ExerciseRow
                  key={state.exerciseId}
                  exercise={exercise}
                  categoryName={categoryNames.get(exercise.categoryId) ?? ''}
                  isFavourite={favouriteIds.has(exercise.id)}
                  detailTo={`/exercises/${exercise.id}`}
                  sub={`Resume at ${formatClock(state.positionSeconds)}`}
                  onToggleFavourite={() => {
                    void favouriteRepo.set(exercise.id, !favouriteIds.has(exercise.id)).then(app.refresh);
                  }}
                  onPlay={() => playSingle(exercise.id)}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
