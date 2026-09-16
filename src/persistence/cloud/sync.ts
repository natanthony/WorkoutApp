/**
 * Cloud sync engine — last-write-wins merge against Neon.
 *
 * - Item rows (categories … media metadata) sync through `app_items`
 *   keyed by (user_id, kind, id), newest `updatedAt` wins.
 * - Video/thumbnail binaries sync through `app_blobs` keyed by media id.
 * - Deletions do NOT propagate automatically in v1: when a row is
 *   deleted on one device, other devices keep their copy. Use
 *   `replaceCloud` or `replaceDevice` in Settings to force one side
 *   to match the other.
 */
import { STORE_NAMES, deleteRecord, getAll, putMany } from '../db';
import type { StoreName } from '../db';
import { mediaRepo } from '../repositories';
import { cloudSql, lit } from './api';
import type { CloudSession } from './auth';

const ITEM_KINDS = STORE_NAMES.filter((name) => name !== 'mediaBlobs') as StoreName[];
const BATCH = 40;

// Video payloads must travel in pieces: the proxy rejects any request or
// response over ~64 MB, and a single video can be far larger than that.
const BLOB_PART_CHARS = 6_000_000; // ~6 MB of base64 per network request
const BLOB_PART_FETCH = 6; // parts per download request (~36 MB response)

function splitBlobParts(base64: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < base64.length; i += BLOB_PART_CHARS) {
    parts.push(base64.slice(i, i + BLOB_PART_CHARS));
  }
  return parts;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function ensureBlobPartsTable(): Promise<void> {
  await cloudSql(
    'CREATE TABLE IF NOT EXISTS app_blob_parts (user_id text NOT NULL, media_id text NOT NULL, part int NOT NULL, data text NOT NULL, PRIMARY KEY (user_id, media_id, part))',
  );
}

type LocalRecord = Record<string, unknown> & { id: string };

interface RemoteItem {
  kind: string;
  id: string;
  updated_at: number | string;
  deleted: boolean;
  data: LocalRecord;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  uploadedMedia: number;
  downloadedMedia: number;
}

/** Not every record type has updatedAt (media, completions) — fall back gracefully. */
function recordTime(item: Record<string, unknown>): number {
  for (const key of ['updatedAt', 'createdAt', 'completedAt']) {
    const value = item[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return Date.now();
}

async function pushItems(session: CloudSession, force: boolean): Promise<number> {
  const remote = (await cloudSql(
    `SELECT kind, id, updated_at FROM app_items WHERE user_id = ${lit(session.userId)}`,
  )) as unknown as Pick<RemoteItem, 'kind' | 'id' | 'updated_at'>[];
  const remoteTimes = new Map(remote.map((r) => [`${r.kind}:${r.id}`, Number(r.updated_at)]));
  const statements: string[] = [];
  let pushed = 0;
  for (const kind of ITEM_KINDS) {
    const local = (await getAll<LocalRecord>(kind)) as LocalRecord[];
    for (const item of local) {
      if (!item || !item.id) continue; // skip corrupt records from legacy migrations
      const time = recordTime(item);
      const remoteTime = remoteTimes.get(`${kind}:${item.id}`);
      if (force || remoteTime === undefined || remoteTime < time) {
        statements.push(
          `(${lit(session.userId)}, ${lit(kind)}, ${lit(item.id)}, ${time}, FALSE, ${lit(JSON.stringify(item))}::jsonb)`,
        );
        pushed += 1;
      }
    }
  }
  for (let i = 0; i < statements.length; i += BATCH) {
    await cloudSql(
      `INSERT INTO app_items (user_id, kind, id, updated_at, deleted, data) VALUES ${statements
        .slice(i, i + BATCH)
        .join(', ')} ON CONFLICT (user_id, kind, id) DO UPDATE SET updated_at = EXCLUDED.updated_at, deleted = EXCLUDED.deleted, data = EXCLUDED.data`,
    );
  }
  return pushed;
}

async function pullItems(session: CloudSession, force: boolean): Promise<number> {
  const remote = (await cloudSql(
    `SELECT kind, id, updated_at, deleted, data FROM app_items WHERE user_id = ${lit(session.userId)}`,
  )) as unknown as RemoteItem[];
  const local = new Map<StoreName, Map<string, number>>();
  for (const kind of ITEM_KINDS) {
    const rows = (await getAll<LocalRecord>(kind)) as LocalRecord[];
    local.set(kind, new Map(rows.map((r) => [r.id, recordTime(r)])));
  }
  const toPut = new Map<StoreName, LocalRecord[]>();
  const toDelete: { kind: StoreName; id: string }[] = [];
  let pulled = 0;
  for (const row of remote) {
    const kind = row.kind as StoreName;
    if (!ITEM_KINDS.includes(kind)) continue;
    const localTime = local.get(kind)?.get(row.id);
    if (row.deleted) {
      if (localTime !== undefined) {
        toDelete.push({ kind, id: row.id });
        pulled += 1;
      }
    } else if (force || localTime === undefined || localTime < Number(row.updated_at)) {
      const list = toPut.get(kind) ?? [];
      list.push(row.data);
      toPut.set(kind, list);
      pulled += 1;
    }
  }
  for (const [kind, rows] of toPut) if (rows.length > 0) await putMany(kind, rows);
  for (const target of toDelete) await deleteRecord(target.kind, target.id);
  return pulled;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** The Data API returns bytea as a hex string, usually prefixed with \x. */
function hexToBlob(hex: string, mimeType: string): Blob {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return new Blob([bytes], { type: mimeType });
}

async function pushBlobs(session: CloudSession, force: boolean): Promise<number> {
  await ensureBlobPartsTable();
  const [legacy, parts] = await Promise.all([
    cloudSql(`SELECT media_id FROM app_blobs WHERE user_id = ${lit(session.userId)}`),
    cloudSql(
      `SELECT media_id FROM app_blob_parts WHERE user_id = ${lit(session.userId)} GROUP BY media_id`,
    ),
  ]);
  const remoteIds = new Set([
    ...((legacy as unknown as { media_id: string }[]).map((r) => r.media_id)),
    ...((parts as unknown as { media_id: string }[]).map((r) => r.media_id)),
  ]);
  let uploaded = 0;
  for (const record of await mediaRepo.list()) {
    if (!record.id) continue; // skip corrupt records from legacy migrations
    if (!force && remoteIds.has(record.id)) continue;
    const blob = await mediaRepo.getBlob(record.id);
    if (!blob) continue;
    const base64 = await blobToBase64(blob);
    const pieces = splitBlobParts(base64);
    await cloudSql(
      `DELETE FROM app_blob_parts WHERE user_id = ${lit(session.userId)} AND media_id = ${lit(record.id)}`,
    );
    await cloudSql(
      `DELETE FROM app_blobs WHERE user_id = ${lit(session.userId)} AND media_id = ${lit(record.id)}`,
    );
    for (let part = 0; part < pieces.length; part += 1) {
      await cloudSql(
        `INSERT INTO app_blob_parts (user_id, media_id, part, data) VALUES (${lit(session.userId)}, ${lit(record.id)}, ${part}, ${lit(pieces[part])})`,
      );
    }
    uploaded += 1;
  }
  return uploaded;
}

async function pullBlobs(session: CloudSession): Promise<number> {
  const media = await mediaRepo.list();
  const missing = new Set<string>();
  for (const record of media) {
    if (!record.id) continue;
    if (!(await mediaRepo.getBlob(record.id))) missing.add(record.id);
  }
  if (missing.size === 0) return 0;
  const partIds = new Set(
    (
      (await cloudSql(
        `SELECT media_id FROM app_blob_parts WHERE user_id = ${lit(session.userId)} GROUP BY media_id`,
      )) as unknown as { media_id: string }[]
    ).map((r) => r.media_id),
  );
  let downloaded = 0;
  for (const mediaId of missing) {
    const record = await mediaRepo.getRecord(mediaId);
    if (!record) continue;
    if (partIds.has(mediaId)) {
      let base64 = '';
      for (let start = 0; ; start += BLOB_PART_FETCH) {
        const rows = (await cloudSql(
          `SELECT data FROM app_blob_parts WHERE user_id = ${lit(session.userId)} AND media_id = ${lit(mediaId)} AND part >= ${start} AND part < ${start + BLOB_PART_FETCH} ORDER BY part`,
        )) as unknown as { data: string }[];
        if (rows.length === 0) break;
        for (const row of rows) base64 += row.data;
        if (rows.length < BLOB_PART_FETCH) break;
      }
      await mediaRepo.put(record, base64ToBlob(base64, record.mimeType));
      downloaded += 1;
      continue;
    }
    const rows = (await cloudSql(
      `SELECT blob FROM app_blobs WHERE user_id = ${lit(session.userId)} AND media_id = ${lit(mediaId)}`,
    )) as unknown as { blob: string | null }[];
    if (rows[0]?.blob) {
      await mediaRepo.put(record, hexToBlob(rows[0].blob, record.mimeType));
      downloaded += 1;
    }
  }
  return downloaded;
}

/** Two-way merge: push newer local rows, pull newer/deleted cloud rows, sync blobs both ways. */
export async function syncNow(session: CloudSession): Promise<SyncResult> {
  return {
    pushed: await pushItems(session, false),
    pulled: await pullItems(session, false),
    uploadedMedia: await pushBlobs(session, false),
    downloadedMedia: await pullBlobs(session),
  };
}

/** Overwrite the cloud library with this device's contents. */
export async function replaceCloud(session: CloudSession): Promise<SyncResult> {
  return {
    pushed: await pushItems(session, true),
    pulled: 0,
    uploadedMedia: await pushBlobs(session, true),
    downloadedMedia: 0,
  };
}

/** Overwrite this device with the cloud library. */
export async function replaceDevice(session: CloudSession): Promise<SyncResult> {
  return {
    pushed: 0,
    pulled: await pullItems(session, true),
    uploadedMedia: 0,
    downloadedMedia: await pullBlobs(session),
  };
}
