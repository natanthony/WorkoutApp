/**
 * Media layer — Document 2 §10/§11.
 * Import pipeline writes the video to durable IndexedDB storage FIRST;
 * the Exercise record is only created afterwards by the caller, so a
 * failed media write never leaves a dangling exercise (§10.3 rollback).
 * Object URLs are runtime-only handles, never persisted (§10.2).
 */
import { useEffect, useState } from 'react';
import type { MediaRecord } from './types';
import { mediaRepo, newId } from './persistence/repositories';

export class MediaImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaImportError';
  }
}

const THUMBNAIL_WIDTH = 480;

/**
 * Import a user-selected video file into durable local storage.
 * `onProgress` receives 0–100; large copies are yielded so the UI updates.
 */
export async function importVideoFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<MediaRecord> {
  if (!file.type.startsWith('video/')) {
    throw new MediaImportError('Only video files can be imported.');
  }
  if (file.size === 0) {
    throw new MediaImportError('The selected file is empty.');
  }
  const record: MediaRecord = {
    id: newId(),
    mediaType: 'video',
    mimeType: file.type || 'video/mp4',
    sizeBytes: file.size,
    createdAt: Date.now(),
  };
  onProgress?.(15);
  // File is already a Blob; persist it durably. Yield to the event loop so
  // progress UI can render before/after the write.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await mediaRepo.put(record, file);
  onProgress?.(85);
  await new Promise((resolve) => setTimeout(resolve, 0));
  onProgress?.(100);
  return record;
}

export async function importThumbnailBlob(blob: Blob): Promise<MediaRecord> {
  const record: MediaRecord = {
    id: newId(),
    mediaType: 'thumbnail',
    mimeType: blob.type || 'image/jpeg',
    sizeBytes: blob.size,
    createdAt: Date.now(),
  };
  await mediaRepo.put(record, blob);
  return record;
}

/**
 * Best-effort thumbnail generation from the first frames of a video file.
 * Returns null on any failure — a valid exercise without a thumbnail is
 * always acceptable (Document 2 §11). Never fabricates a thumbnail path.
 */
export function generateThumbnail(videoFile: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const url = URL.createObjectURL(videoFile);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const timeout = window.setTimeout(() => finish(null), 8000);
    video.onerror = () => {
      window.clearTimeout(timeout);
      finish(null);
    };
    video.onloadeddata = () => {
      try {
        // Seek a little in so the frame is not black.
        video.currentTime = Math.min(0.5, (video.duration || 1) / 4);
      } catch {
        window.clearTimeout(timeout);
        finish(null);
      }
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = THUMBNAIL_WIDTH / Math.max(1, video.videoWidth);
        canvas.width = THUMBNAIL_WIDTH;
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          window.clearTimeout(timeout);
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            window.clearTimeout(timeout);
            finish(blob);
          },
          'image/jpeg',
          0.72,
        );
      } catch {
        window.clearTimeout(timeout);
        finish(null);
      }
    };
    video.src = url;
  });
}

/**
 * Resolve a stable media ID to a runtime object URL. The URL is created
 * on demand and revoked when the media changes or the component unmounts.
 * Never store the returned URL anywhere persistent.
 */
export function useMediaUrl(mediaId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!mediaId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    mediaRepo
      .getBlob(mediaId)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setUrl(null);
          return;
        }
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [mediaId]);
  return url;
}

/** True when the referenced media exists locally; drives recovery UI. */
export async function mediaExists(mediaId: string | null): Promise<boolean> {
  if (!mediaId) return false;
  return mediaRepo.exists(mediaId);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
