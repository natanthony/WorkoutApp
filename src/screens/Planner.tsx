import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useCategoryNames, useExerciseById, useFavouriteIds } from '../store';
import { useSession } from '../session';
import {
  WEEKDAY_NAMES,
  generatePlanQueue,
  moveId,
  sessionCompletionKey,
  sortByOrder,
  todayWeekday,
} from '../domain';
import type { DayPlan, DayPlanSection, ID, QueueItem, Weekday } from '../types';
import { ConfirmDialog, EmptyState, Icon, ReorderList } from '../components/common';
import { ExerciseThumb } from '../components/exercise';
import { favouriteRepo, planRepo } from '../persistence/repositories';

function SectionCard({
  section,
  name,
  dayPlan,
}: {
  section: DayPlanSection;
  name: string;
  dayPlan: DayPlan;
}) {
  const app = useApp();
  const exerciseById = useExerciseById();
  const categoryNames = useCategoryNames();
  const favouriteIds = useFavouriteIds();
  const [pick, setPick] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const workoutId = section.customWorkoutId ?? null;

  // A section that embeds a saved workout is a live reference: its rows come
  // from the workout's own items, rendered read-only (single source of truth).
  const workoutItems = useMemo(
    () =>
      workoutId == null
        ? []
        : sortByOrder(app.customWorkoutExercises.filter((i) => i.customWorkoutId === workoutId)),
    [app.customWorkoutExercises, workoutId],
  );

  const items = useMemo(() => {
    if (workoutId != null) {
      return workoutItems.map((i, idx) => ({
        id: i.id,
        dayPlanSectionId: section.id,
        exerciseId: i.exerciseId,
        sortOrder: idx + 1,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      }));
    }
    return sortByOrder(
      app.dayPlanExercises.filter((item) => item.dayPlanSectionId === section.id),
    );
  }, [workoutId, workoutItems, app.dayPlanExercises, section.id]);

  const inSection = new Set(items.map((i) => i.exerciseId));
  const candidates = app.exercises.filter((e) => !inSection.has(e.id));

  void dayPlan;

  const renderExerciseRow = (item: (typeof items)[number], readOnly: boolean) => {
    const exercise = exerciseById.get(item.exerciseId);
    if (!exercise) {
      return (
        <div className="list-item" key={item.id}>
          <div className="item-main">
            <span className="item-title">Missing exercise</span>
          </div>
        </div>
      );
    }
    return (
      <div className="list-item" key={item.id}>
        <ExerciseThumb exercise={exercise} />
        <div className="item-main">
          <span className="item-title">{exercise.name}</span>
          <div className="item-sub">
            <span>{categoryNames.get(exercise.categoryId) ?? ''}</span>
          </div>
        </div>
        {readOnly ? null : (
          <div className="item-actions">
            <button
              type="button"
              className={`icon-button${favouriteIds.has(exercise.id) ? ' active' : ''}`}
              aria-label={`Unfavourite ${exercise.name}`}
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
              aria-label={`Remove ${exercise.name} from section`}
              onClick={() =>
                void planRepo.removeExerciseFromSection(item.id).then(app.refresh)
              }
            >
              <Icon name="x" size={17} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="card-title">
        <h3>
          {name}{' '}
          {workoutId != null ? <span className="badge">Workout</span> : null}{' '}
          <span className="badge badge-muted">{items.length}</span>
        </h3>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove section ${name}`}
          onClick={() => setConfirmRemove(true)}
        >
          <Icon name="trash" size={17} />
        </button>
      </div>

      {workoutId != null ? (
        <p className="note">
          Playlist from the Workouts page — edit it there; changes appear here automatically.
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="note">
          {workoutId != null ? 'This workout has no exercises yet.' : 'No exercises yet — add one below.'}
        </p>
      ) : workoutId != null ? (
        <div className="list">{items.map((item) => renderExerciseRow(item, true))}</div>
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
            void planRepo.reorderSectionExercises(section.id, ids).then(app.refresh);
          }}
          renderItem={(item) => renderExerciseRow(item, false)}
        />
      )}

      {workoutId == null ? (
        <div className="inline-form">
          <select
            aria-label="Add exercise to section"
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
              void planRepo.addExerciseToSection(section.id, pick).then(app.refresh);
              setPick('');
            }}
          >
            <Icon name="plus" size={15} /> Add
          </button>
        </div>
      ) : null}

      {confirmRemove ? (
        <ConfirmDialog
          title={`Remove ${name}?`}
          danger
          confirmLabel="Remove section"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            void planRepo.removeSection(section.id).then(app.refresh);
            setConfirmRemove(false);
          }}
        >
          The section and its {items.length} exercise reference
          {items.length === 1 ? '' : 's'} will be removed from this day. The exercises themselves
          stay in your library.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

export default function PlannerScreen() {
  const app = useApp();
  const navigate = useNavigate();
  const { startSession } = useSession();
  const [selected, setSelected] = useState<Weekday>(todayWeekday());
  const [pickSection, setPickSection] = useState('');

  const dayPlan = app.dayPlans.find((d) => d.weekday === selected);
  const sections = useMemo(
    () =>
      dayPlan
        ? sortByOrder(app.dayPlanSections.filter((s) => s.dayPlanId === dayPlan.id))
        : [],
    [dayPlan, app.dayPlanSections],
  );

  const sectionName = (s: DayPlanSection): string => {
    if (s.customWorkoutId != null) {
      return (
        app.customWorkouts.find((w) => w.id === s.customWorkoutId)?.name ?? 'Unknown workout'
      );
    }
    return (
      app.workoutSections.find((w) => w.id === s.workoutSectionId)?.name ?? 'Unknown section'
    );
  };

  const generated = useMemo<{ queue: QueueItem[] | null; error: string | null }>(() => {
    if (!dayPlan || dayPlan.isRestDay) return { queue: null, error: null };
    try {
      return {
        queue: generatePlanQueue({
          dayPlan,
          sections: app.dayPlanSections,
          sectionExercises: app.dayPlanExercises,
          workoutSections: app.workoutSections,
          exercises: app.exercises,
          customWorkouts: app.customWorkouts,
          customWorkoutExercises: app.customWorkoutExercises,
        }),
        error: null,
      };
    } catch (e) {
      return {
        queue: null,
        error: e instanceof Error ? e.message : 'This plan has broken references',
      };
    }
  }, [dayPlan, app.dayPlanSections, app.dayPlanExercises, app.workoutSections, app.exercises, app.customWorkouts, app.customWorkoutExercises]);

  const exerciseCounts = useMemo(() => {
    const counts = new Map<ID, number>();
    for (const day of app.dayPlans) {
      if (day.isRestDay) {
        counts.set(day.id, 0);
        continue;
      }
      try {
        counts.set(
          day.id,
          generatePlanQueue({
            dayPlan: day,
            sections: app.dayPlanSections,
            sectionExercises: app.dayPlanExercises,
            workoutSections: app.workoutSections,
            exercises: app.exercises,
            customWorkouts: app.customWorkouts,
            customWorkoutExercises: app.customWorkoutExercises,
          }).length,
        );
      } catch {
        counts.set(day.id, 0);
      }
    }
    return counts;
  }, [app.dayPlans, app.dayPlanSections, app.dayPlanExercises, app.workoutSections, app.exercises, app.customWorkouts, app.customWorkoutExercises]);

  if (!dayPlan) {
    return <EmptyState icon="calendar" title="No plan found" message="Something went wrong loading the weekly plan." />;
  }

  const startWorkout = () => {
    if (!generated.queue || generated.queue.length === 0) return;
    startSession({
      source: 'plan',
      title: `${WEEKDAY_NAMES[selected]} workout`,
      subtitle: `${generated.queue.length} exercises`,
      dayKey: sessionCompletionKey(new Date(), selected),
      queue: generated.queue,
    });
    navigate('/play');
  };

  const toggleBodyPart = (id: ID) => {
    const next = dayPlan.bodyPartIds.includes(id)
      ? dayPlan.bodyPartIds.filter((b) => b !== id)
      : [...dayPlan.bodyPartIds, id];
    void planRepo.saveDayState(dayPlan.id, { bodyPartIds: next }).then(app.refresh);
  };

  return (
    <div className="stack">
      <div className="screen-header">
        <div>
          <h1>Weekly plan</h1>
          <p>Build each day from sections; playback follows this exact order.</p>
        </div>
        {generated.queue && generated.queue.length > 0 ? (
          <div className="header-actions">
            <button type="button" className="button button-primary" onClick={startWorkout}>
              <Icon name="play" size={16} /> Start this workout
            </button>
          </div>
        ) : null}
      </div>

      <div className="week-grid" role="tablist" aria-label="Days of the week">
        {app.dayPlans.map((day) => (
          <button
            key={day.id}
            type="button"
            role="tab"
            aria-selected={day.weekday === selected}
            className={`day-card${day.weekday === selected ? ' selected' : ''}${
              day.weekday === todayWeekday() ? ' today' : ''
            }`}
            onClick={() => setSelected(day.weekday)}
          >
            <span className="day-name">{WEEKDAY_NAMES[day.weekday]}</span>
            <span className="day-meta">
              {day.isRestDay ? (
                <span>Rest day</span>
              ) : (
                <span>
                  {app.dayPlanSections.filter((s) => s.dayPlanId === day.id).length} sections ·{' '}
                  {exerciseCounts.get(day.id) ?? 0} exercises
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      <section className="card section-block" aria-label={`${WEEKDAY_NAMES[selected]} settings`}>
        <div className="settings-row">
          <div>
            <h3>Rest day</h3>
            <span className="note">Rest days have no workout content.</span>
          </div>
          <button
            type="button"
            className="toggle"
            aria-pressed={dayPlan.isRestDay}
            aria-label="Toggle rest day"
            onClick={() =>
              void planRepo
                .saveDayState(dayPlan.id, { isRestDay: !dayPlan.isRestDay })
                .then(app.refresh)
            }
          />
        </div>
        <div className="section-block">
          <div className="row-between">
            <h3>Focus body parts</h3>
          </div>
          <div className="chip-list">
            {app.bodyParts.map((part) => (
              <button
                key={part.id}
                type="button"
                className={`chip${dayPlan.bodyPartIds.includes(part.id) ? ' chip-active' : ''}`}
                aria-pressed={dayPlan.bodyPartIds.includes(part.id)}
                onClick={() => toggleBodyPart(part.id)}
              >
                {part.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {dayPlan.isRestDay ? (
        <EmptyState
          icon="check"
          title={`${WEEKDAY_NAMES[selected]} is a rest day`}
          message="Flip the toggle above to plan a workout for this day."
        />
      ) : (
        <div className="stack">
          {generated.error ? <p className="field-error">{generated.error}</p> : null}

          <ReorderList
            items={sections}
            getKey={(s) => s.id}
            onReorder={(from, to) => {
              const ids = moveId(
                sections.map((s) => s.id),
                from,
                to,
              );
              void planRepo.reorderSections(dayPlan.id, ids).then(app.refresh);
            }}
            renderItem={(section) => (
              <SectionCard section={section} name={sectionName(section)} dayPlan={dayPlan} />
            )}
          />

          <div className="card">
            <div className="inline-form">
              <select
                aria-label="Add section"
                value={pickSection}
                onChange={(e) => setPickSection(e.target.value)}
              >
                <option value="">Choose a section or workout…</option>
                {app.workoutSections.length > 0 ? (
                  <optgroup label="Sections">
                    {app.workoutSections.map((ws) => (
                      <option key={ws.id} value={`ws:${ws.id}`}>
                        {ws.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {app.customWorkouts.length > 0 ? (
                  <optgroup label="Workouts">
                    {app.customWorkouts.map((w) => (
                      <option key={w.id} value={`wo:${w.id}`}>
                        {w.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <button
                type="button"
                className="button button-secondary"
                disabled={!pickSection}
                onClick={() => {
                  const sep = pickSection.indexOf(':');
                  const kind = pickSection.slice(0, sep);
                  const id = pickSection.slice(sep + 1);
                  void (kind === 'wo'
                    ? planRepo.addWorkout(dayPlan.id, id)
                    : planRepo.addSection(dayPlan.id, id)
                  ).then(app.refresh);
                  setPickSection('');
                }}
              >
                <Icon name="plus" size={15} /> Add section
              </button>
            </div>
            {app.workoutSections.length === 0 && app.customWorkouts.length === 0 ? (
              <p className="note">
                Nothing to add yet — create sections in Settings or workouts on the Workouts page.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
