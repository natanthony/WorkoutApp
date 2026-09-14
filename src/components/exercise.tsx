import { Link } from 'react-router-dom';
import { useMediaUrl } from '../media';
import type { Exercise } from '../types';
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
