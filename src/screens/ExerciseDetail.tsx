import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useApp,
  useCategoryNames,
  useFavouriteIds,
  usePlaybackByExercise,
} from '../store';
import { useSession } from '../session';
import { useMediaUrl } from '../media';
import { exerciseRepo, favouriteRepo } from '../persistence/repositories';
import type { ExerciseDependents } from '../persistence/repositories';
import { doseLabel, exerciseDose, formatClock, singleExerciseQueue } from '../domain';
import type { ExerciseDose } from '../domain';
import { ConfirmDialog, EmptyState, Icon } from '../components/common';
import { ExerciseDoseEditor } from '../components/exercise';
import { ExerciseFormModal } from '../components/ExerciseForm';

export default function ExerciseDetailScreen() {
  const { id } = useParams();
  const app = useApp();
  const navigate = useNavigate();
  const { startSession } = useSession();
  const categoryNames = useCategoryNames();
  const favouriteIds = useFavouriteIds();
  const playbackByExercise = usePlaybackByExercise();
  const [editing, setEditing] = useState(false);
  const [dependents, setDependents] = useState<ExerciseDependents | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [doseError, setDoseError] = useState<string | null>(null);
  const [savingDose, setSavingDose] = useState(false);

  const exercise = id ? app.exercises.find((e) => e.id === id) : undefined;
  const videoUrl = useMediaUrl(exercise?.mediaId ?? null);
  const resume = exercise ? playbackByExercise.get(exercise.id) : undefined;

  if (!exercise) {
    return (
      <EmptyState
        icon="info"
        title="Exercise not found"
        message="It may have been deleted."
        action={
          <Link to="/library" className="button button-primary">
            Back to library
          </Link>
        }
      />
    );
  }

  const isFavourite = favouriteIds.has(exercise.id);
  const dose = exerciseDose(exercise);
  const doseText = doseLabel(exercise);

  // Exercise type (timed / sets & reps) saves immediately on change.
  const saveDose = async (next: ExerciseDose) => {
    setDoseError(null);
    setSavingDose(true);
    try {
      await exerciseRepo.update(exercise.id, next);
      await app.refresh();
    } catch (e) {
      setDoseError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingDose(false);
    }
  };

  const play = () => {
    startSession({
      source: 'single',
      title: exercise.name,
      subtitle: null,
      dayKey: null,
      queue: singleExerciseQueue(exercise),
    });
    navigate('/play');
  };

  const confirmDelete = async () => {
    setDependents(await exerciseRepo.findDependents(exercise.id));
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await exerciseRepo.removeWithDependents(exercise.id);
      await app.refresh();
      navigate('/library');
    } finally {
      setDeleting(false);
      setDependents(null);
    }
  };

  return (
    <div className="stack">
      <div className="screen-header">
        <div>
          <h1>{exercise.name}</h1>
          <p>
            <span className="badge badge-muted">{categoryNames.get(exercise.categoryId) ?? 'Unknown category'}</span>{' '}
            {exercise.difficulty ? <span className="badge">{exercise.difficulty}</span> : null}
            {doseText ? <span className="badge">{doseText}</span> : null}
            {resume && resume.positionSeconds > 5 ? (
              <span className="badge badge-ok">Resume at {formatClock(resume.positionSeconds)}</span>
            ) : null}
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className={`icon-button${isFavourite ? ' active' : ''}`}
            aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={isFavourite}
            onClick={() => void favouriteRepo.set(exercise.id, !isFavourite).then(app.refresh)}
          >
            <Icon name="star" size={18} />
          </button>
          <button type="button" className="button button-secondary" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} /> Edit
          </button>
          <button type="button" className="button button-danger" onClick={() => void confirmDelete()}>
            <Icon name="trash" size={16} /> Delete
          </button>
          <button type="button" className="button button-primary" onClick={play}>
            <Icon name="play" size={16} /> Play
          </button>
        </div>
      </div>

      <section className="card section-block" aria-label="Video">
        <h2>Video</h2>
        {videoUrl ? (
          <video className="player-stage" style={{ width: '100%' }} controls playsInline src={videoUrl} />
        ) : (
          <p className="note">
            The video file for this exercise is not on this device. It may need to be re-imported
            after a backup restore.
          </p>
        )}
      </section>

      <section className="card section-block" aria-label="Exercise type">
        <h2>Exercise type</h2>
        <ExerciseDoseEditor
          value={dose}
          onChange={(next) => void saveDose(next)}
          disabled={savingDose}
        />
        {doseError ? (
          <span className="field-error" role="alert">
            {doseError}
          </span>
        ) : null}
      </section>

      {exercise.description ? (
        <section className="card" aria-label="Description">
          <h2>Description</h2>
          <p>{exercise.description}</p>
        </section>
      ) : null}

      <div className="grid-2">
        <section className="card section-block" aria-label="Equipment">
          <h2>Equipment</h2>
          {exercise.equipment.length > 0 ? (
            <div className="chip-list">
              {exercise.equipment.map((item) => (
                <span key={item} className="chip chip-active">
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="note">No equipment recorded.</p>
          )}
        </section>
        <section className="card section-block" aria-label="Targets">
          <h2>Targets</h2>
          {exercise.targets.length > 0 ? (
            <div className="chip-list">
              {exercise.targets.map((item) => (
                <span key={item} className="chip chip-active">
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="note">No targets recorded.</p>
          )}
        </section>
      </div>

      {editing ? (
        <ExerciseFormModal
          initial={exercise}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}

      {dependents ? (
        <ConfirmDialog
          title={`Delete ${exercise.name}?`}
          danger
          busy={deleting}
          confirmLabel="Delete exercise"
          onCancel={() => setDependents(null)}
          onConfirm={() => void doDelete()}
        >
          <p>This permanently deletes the exercise and its video from this device.</p>
          <ul style={{ marginBottom: 0 }}>
            <li>
              Referenced in {dependents.dayPlanRefs} planned day item
              {dependents.dayPlanRefs === 1 ? '' : 's'}
            </li>
            <li>
              Referenced in {dependents.customWorkoutRefs} custom workout item
              {dependents.customWorkoutRefs === 1 ? '' : 's'}
            </li>
            {dependents.isFavourite ? <li>It is in your favourites</li> : null}
            {dependents.hasPlaybackState ? <li>It has saved playback progress</li> : null}
          </ul>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
