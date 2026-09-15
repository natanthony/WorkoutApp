import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useExerciseById, usePlaybackByExercise } from '../store';
import { sanitizeRestSeconds } from '../store';
import { useSession } from '../session';
import { useMediaUrl } from '../media';
import { playBeep } from '../audio';
import { completionRepo, playbackRepo } from '../persistence/repositories';
import { exerciseCompletionKey, formatClock } from '../domain';
import { ConfirmDialog, EmptyState, Icon } from '../components/common';
import type { PlaybackStatus } from '../types';

function statusText(status: PlaybackStatus): string {
  switch (status) {
    case 'loading':
      return 'Loading…';
    case 'ready':
      return 'Ready — press play';
    case 'playing':
      return 'Playing';
    case 'paused':
      return 'Paused';
    case 'ended':
      return 'Finished';
    case 'error':
      return 'This video could not be played';
    default:
      return '';
  }
}

export default function PlayerScreen() {
  const { session, setCursor, endSession } = useSession();
  const app = useApp();
  const exerciseById = useExerciseById();
  const playbackByExercise = usePlaybackByExercise();
  const navigate = useNavigate();

  const item = session ? session.queue[session.cursor] : undefined;
  const exercise = item ? exerciseById.get(item.exerciseId) : undefined;
  const mediaUrl = useMediaUrl(exercise?.mediaId ?? null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaveRef = useRef(0);
  const [status, setStatus] = useState<PlaybackStatus>('idle');
  const [muted, setMuted] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [restRemaining, setRestRemaining] = useState<number | null>(null);

  // Load media and resume the saved position whenever the queue item changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl || !exercise) return;
    let cancelled = false;
    setStatus('loading');
    setPosition(0);
    setDuration(0);
    const saved = playbackByExercise.get(exercise.id);
    video.src = mediaUrl;
    video.load();
    const onLoaded = () => {
      if (cancelled) return;
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      setDuration(d);
      if (saved && saved.positionSeconds > 3 && (d === 0 || saved.positionSeconds < d - 3)) {
        video.currentTime = saved.positionSeconds;
        setPosition(saved.positionSeconds);
      }
      video.play().then(
        () => {
          if (!cancelled) setStatus('playing');
        },
        () => {
          if (!cancelled) setStatus('ready');
        },
      );
    };
    video.addEventListener('loadedmetadata', onLoaded);
    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', onLoaded);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [mediaUrl, exercise?.id, session?.id]);

  // Apply the mute preference.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Rest countdown: tick once per second; beep and stop at zero.
  useEffect(() => {
    if (restRemaining === null) return;
    if (restRemaining <= 0) {
      playBeep(660, 300);
      setRestRemaining(null);
      return;
    }
    const id = window.setTimeout(() => setRestRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [restRemaining]);

  // Stop the rest timer when the exercise or session changes.
  useEffect(() => {
    setRestRemaining(null);
  }, [exercise?.id, session?.id]);

  // Wire playback events: progress saves, completion, auto-next.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !exercise || !session) return;

    const onTimeUpdate = () => {
      setPosition(video.currentTime);
      const now = Date.now();
      if (now - lastSaveRef.current > 5000) {
        lastSaveRef.current = now;
        const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        void playbackRepo.save(exercise.id, video.currentTime, d);
      }
    };
    const onLoadedMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
    };
    const onEnded = () => {
      const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      void playbackRepo.save(exercise.id, 0, d);
      void completionRepo.markComplete(exerciseCompletionKey(exercise.id));
      void app.refresh();
      if (app.settings.autoNext && session.cursor < session.queue.length - 1) {
        setCursor(session.cursor + 1);
      } else if (!app.settings.autoNext) {
        // Replay by default: loop the current exercise until the user
        // manually moves to the next one.
        video.currentTime = 0;
        setPosition(0);
        void video.play().catch(() => setStatus('error'));
      } else {
        setStatus('ended');
      }
    };
    const onPlay = () => setStatus('playing');
    const onPause = () => setStatus('paused');
    const onError = () => setStatus('error');

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMeta);
    video.addEventListener('ended', onEnded);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMeta);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onError);
    };
  }, [exercise, session, app, setCursor]);

  if (!session) {
    return (
      <EmptyState
        icon="play"
        title="No active workout"
        message="Start a workout from Today, the weekly plan, a custom workout or any exercise."
        action={
          <Link to="/" className="button button-primary">
            Go to Today
          </Link>
        }
      />
    );
  }

  const goTo = (index: number) => {
    if (index >= 0 && index < session.queue.length) setCursor(index);
  };

  const savePosition = () => {
    const video = videoRef.current;
    if (!video || !exercise) return;
    const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    void playbackRepo.save(exercise.id, video.currentTime, d);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => setStatus('error'));
    } else {
      video.pause();
    }
  };

  const startRest = () => {
    playBeep(880, 150); // beep when the rest starts
    setRestRemaining(sanitizeRestSeconds(app.settings.restSeconds));
  };

  const seek = (value: number) => {
    const video = videoRef.current;
    if (!video || !exercise) return;
    video.currentTime = value;
    setPosition(value);
    void playbackRepo.save(exercise.id, value, duration > 0 ? duration : null);
  };

  const completeAndNext = () => {
    if (!exercise) return;
    void completionRepo.markComplete(exerciseCompletionKey(exercise.id));
    void app.refresh();
    if (session.cursor < session.queue.length - 1) {
      savePosition();
      setCursor(session.cursor + 1);
    } else {
      setStatus('ended');
    }
  };

  const endAndNavigate = () => {
    if (session.dayKey) {
      void completionRepo.markComplete(session.dayKey).then(app.refresh);
    }
    endSession();
    setConfirmEnd(false);
    navigate('/');
  };

  return (
    <div className="stack">
      <div className="screen-header">
        <div>
          <h1>{session.title}</h1>
          <p>
            {session.subtitle ? `${session.subtitle} · ` : ''}Exercise {item?.overallPosition ?? '—'}{' '}
            of {session.queue.length}
            {item?.sectionName ? ` · ${item.sectionName}` : ''}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="button button-secondary" onClick={() => setConfirmEnd(true)}>
            <Icon name="check" size={16} /> End session
          </button>
        </div>
      </div>

      {!exercise ? (
        <EmptyState
          icon="info"
          title="Exercise not found"
          message="This exercise may have been deleted from your library."
          action={
            <button type="button" className="button button-primary" onClick={() => goTo(session.cursor + 1)}>
              Skip
            </button>
          }
        />
      ) : (
        <div className="player-layout">
          <div>
            <div className="player-stage">
              <video ref={videoRef} playsInline preload="auto" />
            </div>
            <div className="player-controls">
              <div className="controls-row">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Previous exercise"
                  disabled={session.cursor === 0}
                  onClick={() => {
                    savePosition();
                    goTo(session.cursor - 1);
                  }}
                >
                  <Icon name="skip-back" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={status === 'playing' ? 'Pause' : 'Play'}
                  onClick={togglePlay}
                >
                  {status === 'playing' ? <Icon name="pause" /> : <Icon name="play" />}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Next exercise"
                  disabled={session.cursor >= session.queue.length - 1}
                  onClick={() => {
                    savePosition();
                    goTo(session.cursor + 1);
                  }}
                >
                  <Icon name="skip-forward" />
                </button>
                <input
                  className="seek"
                  type="range"
                  min={0}
                  max={Math.max(duration, 0)}
                  step={1}
                  value={Math.min(position, duration || position)}
                  aria-label="Seek"
                  onChange={(e) => seek(Number(e.target.value))}
                />
                <span className="time">
                  {formatClock(position)} / {duration > 0 ? formatClock(duration) : '--:--'}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  aria-pressed={muted}
                  onClick={() => setMuted((m) => !m)}
                >
                  <Icon name={muted ? 'volume-x' : 'volume'} />
                </button>
              </div>
              <div className="controls-row">
                <button
                  type="button"
                  className="toggle"
                  aria-pressed={app.settings.autoNext}
                  aria-label="Auto-play the next exercise when this one finishes"
                  onClick={() => void app.setSettings({ ...app.settings, autoNext: !app.settings.autoNext })}
                >
                  <span className="toggle-knob" />
                  <span>Auto Next</span>
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={restRemaining === null ? startRest : () => setRestRemaining(null)}
                >
                  <Icon name="clock" size={15} />
                  {restRemaining === null
                    ? `Start rest (${formatClock(sanitizeRestSeconds(app.settings.restSeconds))})`
                    : `Rest ${formatClock(restRemaining)} — cancel`}
                </button>
                <span className="note">{statusText(status)}</span>
                <div className="header-actions" style={{ marginLeft: 'auto' }}>
                  <button type="button" className="button button-secondary" onClick={completeAndNext}>
                    <Icon name="check" size={15} /> Complete
                    {session.cursor < session.queue.length - 1 ? ' & next' : ' exercise'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside className="card section-block" aria-label="Workout queue">
            <h2>Queue</h2>
            <div className="queue">
              {session.queue.map((queueItem, index) => {
                const queuedExercise = exerciseById.get(queueItem.exerciseId);
                return (
                  <button
                    key={`${queueItem.exerciseId}-${index}`}
                    type="button"
                    className={`queue-item${index === session.cursor ? ' current' : ''}`}
                    onClick={() => {
                      savePosition();
                      goTo(index);
                    }}
                  >
                    <span className="queue-index">
                      {queueItem.overallPosition}/{queueItem.overallSize}
                    </span>
                    <span className="item-main">
                      <span className="item-title" style={{ fontSize: 14 }}>
                        {queuedExercise?.name ?? 'Missing exercise'}
                      </span>
                      {queueItem.sectionName ? (
                        <span className="queue-meta">
                          {queueItem.sectionName} · {queueItem.sectionPosition} of {queueItem.sectionSize}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      )}

      {confirmEnd ? (
        <ConfirmDialog
          title="End session?"
          onCancel={() => setConfirmEnd(false)}
          onConfirm={endAndNavigate}
          confirmLabel="End session"
        >
          {session.dayKey
            ? "Today's workout will be marked as complete."
            : 'Your per-exercise progress is saved automatically — you can resume any time.'}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}