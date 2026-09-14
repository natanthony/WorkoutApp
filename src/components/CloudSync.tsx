import { useState } from 'react';
import { useApp } from '../store';
import { cloudEnroll, cloudLink, cloudLogout, cloudSession } from '../persistence/cloud/auth';
import { replaceCloud, replaceDevice, syncNow } from '../persistence/cloud/sync';
import type { SyncResult } from '../persistence/cloud/sync';
import { Icon } from './common';

function describe(result: SyncResult): string {
  const parts: string[] = [];
  if (result.pushed) parts.push(`${result.pushed} up`);
  if (result.pulled) parts.push(`${result.pulled} down`);
  if (result.uploadedMedia) parts.push(`${result.uploadedMedia} video${result.uploadedMedia === 1 ? '' : 's'} up`);
  if (result.downloadedMedia) parts.push(`${result.downloadedMedia} video${result.downloadedMedia === 1 ? '' : 's'} down`);
  return parts.length > 0 ? `Synced: ${parts.join(', ')}.` : 'Everything is already up to date.';
}

export default function CloudSyncSection() {
  const app = useApp();
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = cloudSession();

  const run = (task: () => Promise<string>, refresh = true) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    task()
      .then(setMessage)
      .catch((e) => setError(e instanceof Error ? e.message : 'Cloud sync failed'))
      .finally(() => {
        setBusy(false);
        if (refresh) void app.refresh();
      });
  };

  if (!session) {
    return (
      <section className="card section-block" aria-label="Cloud sync">
        <h2>Cloud sync</h2>
        <p className="note">
          Sync your library, plans and videos to the cloud so any device can use them. You create
          one passcode — it <strong>is</strong> your account. Type it on another device to link it.
          Pick something long and unguessable.
        </p>
        <div className="inline-form">
          <input
            type="password"
            value={passcode}
            placeholder="Choose a passcode (8+ characters)"
            aria-label="Cloud passcode"
            autoComplete="off"
            onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                run(() => cloudEnroll(passcode).then(() => 'Cloud library created. Syncing…').then(async (m) => { await syncNow(cloudSession()!); return m; }));
              }
            }}
          />
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || passcode.length < 8}
            onClick={() =>
              run(() =>
                cloudEnroll(passcode)
                  .then(async () => describe(await syncNow(cloudSession()!))),
              )
            }
          >
            <Icon name="plus" size={16} /> Create cloud library
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || passcode.length < 8}
            onClick={() =>
              run(() =>
                cloudLink(passcode)
                  .then(async () => describe(await syncNow(cloudSession()!))),
              )
            }
          >
            <Icon name="upload" size={16} /> Link this device
          </button>
        </div>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        {message ? <p className="note">{message}</p> : null}
      </section>
    );
  }

  return (
    <section className="card section-block" aria-label="Cloud sync">
      <h2>Cloud sync</h2>
      <p className="note">
        This device is linked to your cloud library. The app keeps working offline — tap Sync now
        when you are back online to merge changes.
      </p>
      <div className="header-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => run(() => syncNow(session).then(describe))}
        >
          <Icon name="refresh" size={16} /> Sync now
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Overwrite the cloud library with everything on THIS device?')) {
              run(() => replaceCloud(session).then(describe));
            }
          }}
        >
          This device → cloud
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Replace everything on THIS device with the cloud library?')) {
              run(() => replaceDevice(session).then(describe));
            }
          }}
        >
          Cloud → this device
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => run(async () => { cloudLogout(); return 'This device was unlinked. Nothing was deleted from the cloud.'; }, false)}
        >
          Unlink
        </button>
      </div>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {message ? <p className="note">{message}</p> : null}
    </section>
  );
}
