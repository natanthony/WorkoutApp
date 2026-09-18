import { Link } from 'react-router-dom';
import { useMediaUrl } from '../media';
import type { Exercise, ExerciseKind } from '../types';
import type { ExerciseDose } from '../domain';
import { Icon } from './common';

export function ExerciseThumb({ exercise }: { exercise: Exercise }) {
  const url = useMediaUrl(exercise.thumbnailMediaId);
  if (url) return <img className="thumb" src={url} alt="" />;
  return (
    <div className="thumb thumb-placeholder" aria-hidden="true">
      <Icon name="play" size={18} />
    </div>
  );
}

export function ExerciseRow({
  exercise,
  categoryName,
  isFavourite,
  detailTo,
  sub,
  onToggleFavourite,
  onPlay,
}: {
  exercise: Exercise;
  categoryName: string;
  isFavourite: boolean;
  detailTo: string;
  sub?: string | null;
  onToggleFavourite: () => void;
  onPlay: () => void;
}) {
  return (
    <div className="list-item">
      <Link to={detailTo} className="thumb-btn" aria-label={`Open ${exercise.name}`}>
        <ExerciseThumb exercise={exercise} />
      </Link>
      <div className="item-main">
        <Link to={detailTo} className="item-title-link">
          <span className="item-title">
            {exercise.name}
            <span className="badge badge-muted">{categoryName}</span>
            {exercise.difficulty ? <span className="badge">{exercise.difficulty}</span> : null}
          </span>
        </Link>
        <div className="item-sub">
          {sub ? <span>{sub}</span> : null}
          {exercise.targets.length > 0 ? <span>Targets: {exercise.targets.join(', ')}</span> : null}
          {exercise.equipment.length > 0 ? <span>Equipment: {exercise.equipment.join(', ')}</span> : null}
        </div>
      </div>
      <div className="item-actions">
        <button
          type="button"
          className={`icon-button${isFavourite ? ' active' : ''}`}
          aria-label={isFavourite ? `Unfavourite ${exercise.name}` : `Favourite ${exercise.name}`}
          aria-pressed={isFavourite}
          onClick={onToggleFavourite}
        >
          <Icon name="star" size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Play ${exercise.name}`}
          onClick={onPlay}
        >
          <Icon name="play" size={18} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------- Exercise dose editor ------------------------- */
/**
 * Timed vs Sets & Reps toggle with its inputs. Controlled component: the
 * parent owns the value and decides when to persist (form submit on the
 * exercise form, immediate save on the detail page).
 */
export function ExerciseDoseEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ExerciseDose;
  onChange: (value: ExerciseDose) => void;
  disabled?: boolean;
}) {
  const setKind = (kind: ExerciseKind) => {
    if (kind === 'timed') {
      onChange({
        kind,
        durationSeconds: value.durationSeconds ?? 30,
        sets: null,
        reps: null,
      });
    } else {
      onChange({
        kind,
        durationSeconds: null,
        sets: value.sets ?? 2,
        reps: value.reps ?? 10,
      });
    }
  };

  const numberValue = (n: number | null) => (n === null ? '' : String(n));
  const parseNumber = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <div className="dose-editor">
      <div className="segmented" role="group" aria-label="Exercise type">
        <button
          type="button"
          className={value.kind === 'timed' ? 'active' : ''}
          aria-pressed={value.kind === 'timed'}
          onClick={() => setKind('timed')}
          disabled={disabled}
        >
          <Icon name="clock" size={14} /> Timed
        </button>
        <button
          type="button"
          className={value.kind === 'sets-reps' ? 'active' : ''}
          aria-pressed={value.kind === 'sets-reps'}
          onClick={() => setKind('sets-reps')}
          disabled={disabled}
        >
          <Icon name="dumbbell" size={14} /> Sets &amp; Reps
        </button>
      </div>

      {value.kind === 'timed' ? (
        <div className="dose-row">
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            aria-label="Duration in seconds"
            value={numberValue(value.durationSeconds)}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, durationSeconds: parseNumber(e.target.value) })
            }
          />
          <span>seconds</span>
        </div>
      ) : null}

      {value.kind === 'sets-reps' ? (
        <div className="dose-row">
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            aria-label="Number of sets"
            value={numberValue(value.sets)}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, sets: parseNumber(e.target.value) })}
          />
          <span>sets of</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            aria-label="Reps per set"
            value={numberValue(value.reps)}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, reps: parseNumber(e.target.value) })}
          />
          <span>reps</span>
        </div>
      ) : null}

      {value.kind === null ? (
        <p className="note">Choose whether this exercise is timed or counted in sets &amp; reps.</p>
      ) : null}
    </div>
  );
}
