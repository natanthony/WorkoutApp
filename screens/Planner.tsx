import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store';
import { useSession } from '../session';
import {
  WEEKDAY_NAMES,
  generatePlanQueue,
  moveId,
  sessionCompletionKey,
  sortByOrder,
  todayWeekday,
} from '../domain';
import type { DayPlanSection, ID, QueueItem, Weekday } from '../types';
import { ConfirmDialog, EmptyState, Icon, ReorderList } from '../components/common';
import { planRepo } from '../persistence/repositories';

function SectionCard({ section }: { section: DayPlanSection }) {
  const app = useApp();
  const [pick, setPick] = useState('');
  const [rename, setRename] = useState(section.name);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Workouts inside this section, in playback order.
  const links = useMemo(
    () =>
      sortByOrder(
        app.dayPlanSectionWorkouts.filter((l) => l.dayPlanSectionId === section.id),
      ),
    [app.dayPlanSectionWorkouts, section.id],
  );

  const workoutById = useMemo(
    () => new Map(app.customWorkouts.map((w) => [w.id, w])),
    [app.customWorkouts],
  );

  const videoCountByWorkout = useMemo(() => {
    const map = new Map<ID, number>();
    for (const item of app.customWorkoutExercises) {
      map.set(item.customWorkoutId, (map.get(item.customWorkoutId) ?? 0) + 1);
    }
    return map;
  }, [app.customWorkoutExercises]);

  const videoCount = links.reduce(
    (sum, l) => sum + (videoCountByWorkout.get(l.customWorkoutId) ?? 0),
    0,
  );

  const inSection = new Set(links.map((l) => l.customWorkoutId));
  const candidates = app.customWorkouts.filter((w) => !inSection.has(w.id));

  return (
    <div className="card">
      <div className="card-title">
        <h3>
          {section.name} <span className="badge badge-muted">{videoCount}</span>
        </h3>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove section ${section.name}`}
          onClick={() => setConfirmRemove(true)}
        >
          <Icon name="trash" size={17} />
        </button>
      </div>

      <div className="inline-form">
        <input
          aria-label="Section name"
          value={rename}
          onChange={(e) => setRename(e.target.value)}
        />
        <button
          type="button"
          className="button button-secondary"
          disabled={!rename.trim() || rename.trim() === section.name}
          onClick={() => void planRepo.renameSection(section.id, rename).then(app.refresh)}
        >
          Rename
        </button>
      </div>

      {links.length === 0 ? (
        <p className="note">No workouts yet — add one below.</p>
      ) : (
        <ReorderList
          items={links}
          getKey={(l) => l.id}
          onReorder={(from, to) => {
            const ids = moveId(
              links.map((l) => l.id),
              from,
              to,
            );
            void planRepo.reorderSectionWorkouts(section.id, ids).then(app.refresh);
          }}
          renderItem={(link) => {
            const workout = workoutById.get(link.customWorkoutId);
            if (!workout) {
              return (
                <div className="list-item">
                  <div className="item-main">
                    <span className="item-title">Missing workout</span>
                  </div>
                </div>
              );
            }
            return (
              <div className="list-item">
                <div className="item-main">
                  <span className="item-title">{workout.name}</span>
                  <div className="item-sub">
                    <span>{videoCountByWorkout.get(workout.id) ?? 0} videos</span>
                  </div>
                </div>
                <div className="item-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${workout.name} from section`}
                    onClick={() =>
                      void planRepo.removeWorkoutFromSection(link.id).then(app.refresh)
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
          aria-label="Add workout to section"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">Choose a workout…</option>
          {candidates.map((workout) => (
            <option key={workout.id} value={workout.id}>
              {workout.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button button-secondary"
          disabled={!pick}
          onClick={() => {
            void planRepo.addWorkoutToSection(section.id, pick).then(app.refresh);
            setPick('');
          }}
        >
          <Icon name="plus" size={15} /> Add
        </button>
      </div>

      {confirmRemove ? (
        <ConfirmDialog
          title={`Remove ${section.name}?`}
          danger
          confirmLabel="Remove section"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            void planRepo.removeSection(section.id).then(app.refresh);
            setConfirmRemove(false);
          }}
        >
          The section and its {links.length} workout reference
          {links.length === 1 ? '' : 's'} will be removed from this day. The workouts themselves
          stay on the Workouts page.
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
  const [newSection, setNewSection] = useState('');

  const dayPlan = app.dayPlans.find((d) => d.weekday === selected);
  const sections = useMemo(
    () =>
      dayPlan
        ? sortByOrder(app.dayPlanSections.filter((s) => s.dayPlanId === dayPlan.id))
        : [],
    [dayPlan, app.dayPlanSections],
  );

  const generated = useMemo<{ queue: QueueItem[] | null; error: string | null }>(() => {
    if (!dayPlan || dayPlan.isRestDay) return { queue: null, error: null };
    try {
      return {
        queue: generatePlanQueue({
          dayPlan,
          sections: app.dayPlanSections,
          sectionWorkouts: app.dayPlanSectionWorkouts,
          customWorkouts: app.customWorkouts,
          customWorkoutExercises: app.customWorkoutExercises,
          exercises: app.exercises,
        }),
        error: null,
      };
    } catch (e) {
      return {
        queue: null,
        error: e instanceof Error ? e.message : 'This plan has broken references',
      };
    }
  }, [dayPlan, app.dayPlanSections, app.dayPlanSectionWorkouts, app.customWorkouts, app.customWorkoutExercises, app.exercises]);

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
            sectionWorkouts: app.dayPlanSectionWorkouts,
            customWorkouts: app.customWorkouts,
            customWorkoutExercises: app.customWorkoutExercises,
            exercises: app.exercises,
          }).length,
        );
      } catch {
        counts.set(day.id, 0);
      }
    }
    return counts;
  }, [app.dayPlans, app.dayPlanSections, app.dayPlanSectionWorkouts, app.customWorkouts, app.customWorkoutExercises, app.exercises]);

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
          <p>Build each day from sections of workouts; playback follows this exact order.</p>
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
            renderItem={(section) => <SectionCard section={section} />}
          />

          <div className="card">
            <div className="inline-form">
              <input
                aria-label="New section name"
                placeholder="New section name…"
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
              />
              <button
                type="button"
                className="button button-secondary"
                disabled={!newSection.trim()}
                onClick={() => {
                  void planRepo.addSection(dayPlan.id, newSection).then(app.refresh);
                  setNewSection('');
                }}
              >
                <Icon name="plus" size={15} /> Add section
              </button>
            </div>
            {app.customWorkouts.length === 0 ? (
              <p className="note">
                No workouts exist yet — create some on the Workouts page first.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
