import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useApp } from '../store';
import type { AppSettings } from '../store';
import { REST_SECONDS_MAX, REST_SECONDS_MIN, sanitizeRestSeconds } from '../store';
import { downloadBackup, exportBackup, restoreBackup, validateBackup } from '../backup';
import {
  bodyPartRepo,
  categoryRepo,
  clearStore,
  mediaRepo,
} from '../persistence/repositories';
import { STORE_NAMES, seedIfEmpty } from '../persistence/db';
import type { ID } from '../types';
import { ConfirmDialog, Icon } from '../components/common';
import CloudSyncSection from '../components/CloudSync';

function ManageRecords({
  title,
  note,
  items,
  usage,
  onAdd,
  onRemove,
}: {
  title: string;
  note: string;
  items: { id: ID; name: string }[];
  usage: Map<ID, number>;
  onAdd: (name: string) => Promise<void>;
  onRemove: (id: ID) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setError(null);
    try {
      await onAdd(draft);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add');
    }
  };
  return (
    <div className="section-block">
      <div className="row-between">
        <h3>{title}</h3>
      </div>
      <p className="note">{note}</p>
      <div className="inline-form">
        <input
          value={draft}
          placeholder={`New ${title.toLowerCase()} name…`}
          aria-label={`New ${title.toLowerCase()} name`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
        />
        <button type="button" className="button button-secondary" onClick={() => void add()}>
          <Icon name="plus" size={15} /> Add
        </button>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <div className="chip-list">
        {items.map((item) => {
          const used = usage.get(item.id) ?? 0;
          return (
            <span key={item.id} className="chip chip-active">
              {item.name}
              {used > 0 ? <span className="note">({used} in use)</span> : null}
              <button
                type="button"
                className="icon-button"
                style={{ width: 22, height: 22 }}
                aria-label={`Delete ${item.name}`}
                disabled={used > 0}
                title={used > 0 ? 'Still in use — remove it from workouts first' : `Delete ${item.name}`}
                onClick={() => void onRemove(item.id)}
              >
                <Icon name="x" size={13} />
              </button>
            </span>
          );
        })}
        {items.length === 0 ? <p className="note">None yet.</p> : null}
      </div>
    </div>
  );
}

export default function SettingsScreen() {
  const app = useApp();
  const { settings, setSettings } = app;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [missingMedia, setMissingMedia] = useState<string[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [mediaCount, setMediaCount] = useState(0);

  const refreshStats = () => {
    void mediaRepo.estimateUsage().then(setUsage);
    void mediaRepo.list().then((list) => setMediaCount(list.length));
  };

  useEffect(refreshStats, [app.exercises.length]);

  const categoryUsage = useMemo(() => {
    const map = new Map<ID, number>();
    for (const e of app.exercises) map.set(e.categoryId, (map.get(e.categoryId) ?? 0) + 1);
    return map;
  }, [app.exercises]);

  const bodyPartUsage = useMemo(() => {
    const map = new Map<ID, number>();
    for (const day of app.dayPlans) {
      for (const id of day.bodyPartIds) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [app.dayPlans]);

  const update = (patch: Partial<AppSettings>) => setSettings({ ...settings, ...patch });

  const doExport = async () => {
    setBusy(true);
    setErrors([]);
    try {
      downloadBackup(await exportBackup());
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Export failed']);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setErrors([]);
    setWarnings([]);
    setMissingMedia([]);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const validation = validateBackup(parsed);
      if (!validation.ok || !validation.data) {
        setErrors(validation.errors);
        setWarnings(validation.warnings);
        return;
      }
      setWarnings(validation.warnings);
      const result = await restoreBackup(validation.data);
      setMissingMedia(result.missingMedia);
      await app.refresh();
      refreshStats();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Import failed']);
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    try {
      for (const store of STORE_NAMES) await clearStore(store);
      await seedIfEmpty();
      await app.refresh();
      refreshStats();
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  };

  return (
    <div className="stack">
      <div className="screen-header">
        <div>
          <h1>Settings</h1>
          <p>Everything is stored locally in this browser — nothing leaves your device.</p>
        </div>
      </div>

      <section className="card section-block" aria-label="Playback and appearance">
        <h2>Playback & appearance</h2>
        <div className="settings-row">
          <div>
            <h3>Auto-advance</h3>
            <span className="note">Play the next exercise automatically when one finishes.</span>
          </div>
          <button
            type="button"
            className="toggle"
            aria-pressed={settings.autoNext}
            aria-label="Toggle auto-advance"
            onClick={() => update({ autoNext: !settings.autoNext })}
          />
        </div>
        <div className="settings-row">
          <div>
            <h3>Rest timer</h3>
            <span className="note">Length of the rest countdown started from the player screen.</span>
          </div>
          <div className="inline-form">
            <input
              type="number"
              min={REST_SECONDS_MIN}
              max={REST_SECONDS_MAX}
              step={5}
              value={settings.restSeconds}
              aria-label="Rest timer length in seconds"
              onChange={(e) => update({ restSeconds: sanitizeRestSeconds(Number(e.target.value)) })}
            />
            <span className="note">sec</span>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <h3>Theme</h3>
            <span className="note">Dark matches the app icon colours.</span>
          </div>
          <div className="segmented" role="group" aria-label="Theme">
            <button
              type="button"
              className={settings.theme === 'dark' ? 'active' : ''}
              onClick={() => update({ theme: 'dark' })}
            >
              Dark
            </button>
            <button
              type="button"
              className={settings.theme === 'light' ? 'active' : ''}
              onClick={() => update({ theme: 'light' })}
            >
              Light
            </button>
          </div>
        </div>
      </section>

      <section className="card section-block" aria-label="Library structure">
        <h2>Library structure</h2>
        <ManageRecords
          title="Categories"
          note="Groups your exercises in the library. A category in use cannot be deleted."
          items={app.categories}
          usage={categoryUsage}
          onAdd={(name) => categoryRepo.create(name).then(app.refresh)}
          onRemove={(id) => categoryRepo.remove(id).then(app.refresh)}
        />
        <ManageRecords
          title="Body parts"
          note="Used as day-plan focus labels."
          items={app.bodyParts}
          usage={bodyPartUsage}
          onAdd={(name) => bodyPartRepo.create(name).then(app.refresh)}
          onRemove={(id) => bodyPartRepo.remove(id).then(app.refresh)}
        />
      </section>

      <section className="card section-block" aria-label="Backup">
        <h2>Backup</h2>
        <p className="note">
          Backups include your library, plans and progress as JSON — video files stay on this
          device, so after restoring elsewhere you may need to re-import videos.
        </p>
        <div className="header-actions">
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => void doExport()}>
            <Icon name="download" size={16} /> Export backup
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={16} /> Import backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void doImport(e)} />
        </div>
        {errors.length > 0 ? (
          <div className="field-error" role="alert">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        ) : null}
        {warnings.length > 0 ? (
          <div className="note">
            {warnings.map((warning) => (
              <p key={warning}>Warning: {warning}</p>
            ))}
          </div>
        ) : null}
        {missingMedia.length > 0 ? (
          <p className="note">
            Restored {missingMedia.length} exercise{missingMedia.length === 1 ? '' : 's'} whose
            videos are not on this device — re-import them from the exercise page.
          </p>
        ) : null}
      </section>

      <section className="card section-block" aria-label="Storage">
        <h2>Storage</h2>
        <div className="stat-grid">
          <div className="stat">
            <b>{app.exercises.length}</b>
            <span>exercises</span>
          </div>
          <div className="stat">
            <b>{mediaCount}</b>
            <span>media files</span>
          </div>
          <div className="stat">
            <b>{app.completions.length}</b>
            <span>completions</span>
          </div>
          <div className="stat">
            <b>
              {usage ? `${(usage.usage / 1024 / 1024).toFixed(0)} MB` : '—'}
              {usage && usage.quota > 0 ? ` / ${(usage.quota / 1024 / 1024 / 1024).toFixed(1)} GB` : ''}
            </b>
            <span>storage used</span>
          </div>
        </div>
      </section>

      <CloudSyncSection />

      <section className="card section-block" aria-label="Danger zone">
        <h2>Danger zone</h2>
        <div className="row-between">
          <div>
            <h3>Reset all data</h3>
            <span className="note">Deletes everything on this device and re-seeds the defaults.</span>
          </div>
          <button type="button" className="button button-danger" onClick={() => setConfirmReset(true)}>
            <Icon name="trash" size={16} /> Reset
          </button>
        </div>
      </section>

      {confirmReset ? (
        <ConfirmDialog
          title="Reset all data?"
          danger
          busy={busy}
          confirmLabel="Delete everything"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => void doReset()}
        >
          This permanently deletes all exercises, videos, plans, custom workouts and history stored
          in this browser. Export a backup first if you need one.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
