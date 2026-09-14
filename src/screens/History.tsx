import { useMemo, useState } from 'react';
import { useApp, useExerciseById } from '../store';
import { WEEKDAY_NAMES } from '../domain';
import { clearStore } from '../persistence/repositories';
import { ConfirmDialog, EmptyState, Icon } from '../components/common';

export default function HistoryScreen() {
  const app = useApp();
  const exerciseById = useExerciseById();
  const [confirmClear, setConfirmClear] = useState(false);

  const entries = useMemo(
    () => [...app.completions].sort((a, b) => b.completedAt - a.completedAt),
    [app.completions],
  );

  const describe = (id: string): { title: string; sub: string } => {
    if (id.startsWith('session:')) {
      const parts = id.split(':');
      const date = parts[1] ?? '';
      const weekday = Number(parts[2]);
      return {
        title: `Workout — ${WEEKDAY_NAMES[weekday] ?? 'unknown day'}`,
        sub: date,
      };
    }
    if (id.startsWith('exercise:')) {
      const exercise = exerciseById.get(id.slice('exercise:'.length));
      return {
        title: exercise ? exercise.name : 'Deleted exercise',
        sub: 'Exercise completed',
      };
    }
    return { title: id, sub: '' };
  };

  return (
    <div className="stack">
      <div className="screen-header">
        <div>
          <h1>History</h1>
          <p>{entries.length} completion{entries.length === 1 ? '' : 's'} recorded on this device.</p>
        </div>
        {entries.length > 0 ? (
          <div className="header-actions">
            <button type="button" className="button button-secondary" onClick={() => setConfirmClear(true)}>
              <Icon name="trash" size={16} /> Clear history
            </button>
          </div>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No history yet"
          message="Finished workouts and exercises show up here."
        />
      ) : (
        <div className="list">
          {entries.map((entry) => {
            const info = describe(entry.id);
            return (
              <div key={entry.id} className="list-item">
                <div className="item-main">
                  <span className="item-title">
                    {info.title} <span className="badge-ok badge">done</span>
                  </span>
                  <div className="item-sub">
                    <span>{info.sub}</span>
                    <span>{new Date(entry.completedAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmClear ? (
        <ConfirmDialog
          title="Clear all history?"
          danger
          confirmLabel="Clear history"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            void clearStore('completions').then(app.refresh);
            setConfirmClear(false);
          }}
        >
          Completion records are removed. Exercises, plans and playback progress are untouched.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
