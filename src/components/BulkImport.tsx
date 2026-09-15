/**
 * Bulk import — batch-import many exercise videos in one pass.
 * Each file becomes an Exercise named after its filename (details like
 * difficulty/equipment/targets are filled in later via the edit form).
 * Imports run sequentially; per-file failures are reported and skipped
 * without aborting the rest (media-first pipeline, §10.3 rollback rules).
 */
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useApp } from '../store';
import { generateThumbnail, importThumbnailBlob, importVideoFile } from '../media';
import { exerciseRepo } from '../persistence/repositories';
import { Field, Icon, Modal } from './common';

interface PendingFile {
key: string;
file: File;
name: string;
status: 'pending' | 'importing' | 'done' | 'error';
error: string | null;
}

/** "Alternating_Camels.mp4" → "Alternating Camels" */
function deriveName(filename: string): string {
return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STATUS_LABEL: Record<PendingFile['status'], string> = {
pending: 'Queued',
importing: 'Importing…',
done: 'Imported',
error: 'Failed',
};

export function BulkImportModal({ onClose }: { onClose: () => void }) {
const { categories, exercises, refresh } = useApp();
const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
const [items, setItems] = useState<PendingFile[]>([]);
const [busy, setBusy] = useState(false);

const existingNames = useMemo(
    () => new Set(exercises.map((e) => e.name.trim().toLowerCase())),
    [exercises],
);

const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // allow re-picking the same files later
    if (files.length === 0) return;
    setItems((current) => {
    const seen = new Set(current.map((i) => i.file.name));
    const additions = files
        .filter((f) => !seen.has(f.name))
        .map((file, index) => ({
        key: `${file.name}-${Date.now()}-${index}`,
        file,
        name: deriveName(file.name),
        status: 'pending' as const,
        error: null,
        }));
    return [...current, ...additions];
    });
};

const updateItem = (key: string, patch: Partial<PendingFile>) => {
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...patch } : i)));
};

const removeItem = (key: string) => {
    setItems((current) => current.filter((i) => i.key !== key));
};

const importAll = async () => {
    if (!categoryId) return;
    setBusy(true);
    // Snapshot the queue so UI edits during import don't affect the run.
    const queue = items.filter((i) => i.status === 'pending' && i.name.trim());
    for (const item of queue) {
    if (existingNames.has(item.name.trim().toLowerCase())) {
        updateItem(item.key, { status: 'error', error: 'An exercise with this name already exists' });
        continue;
    }
    updateItem(item.key, { status: 'importing', error: null });
    try {
        const media = await importVideoFile(item.file);
        const thumbBlob = await generateThumbnail(item.file);
        const thumb = thumbBlob ? await importThumbnailBlob(thumbBlob) : null;
        await exerciseRepo.create({
        name: item.name.trim(),
        categoryId,
        description: null,
        difficulty: null,
        equipment: [],
        targets: [],
        mediaId: media.id,
        thumbnailMediaId: thumb ? thumb.id : null,
        });
        existingNames.add(item.name.trim().toLowerCase());
        updateItem(item.key, { status: 'done' });
    } catch (e) {
        updateItem(item.key, {
        status: 'error',
        error: e instanceof Error ? e.message : 'Import failed',
        });
    }
    }
    await refresh();
    setBusy(false);
};

const pendingCount = items.filter((i) => i.status === 'pending').length;
const doneCount = items.filter((i) => i.status === 'done').length;
const failedCount = items.filter((i) => i.status === 'error').length;
const nameTaken = (name: string) => existingNames.has(name.trim().toLowerCase());

return (
    <Modal title="Bulk import videos" onClose={busy ? () => {} : onClose}>
    <Field
        label="Video files"
        hint="Select as many as you like. Each file becomes an exercise named after its filename — edit the details later."
    >
        <input type="file" accept="video/*" multiple onChange={pickFiles} disabled={busy} />
    </Field>

    <Field label="Category" hint="All imported exercises go into this category (you can change it per-exercise later).">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={busy}>
        {categories.map((category) => (
            <option key={category.id} value={category.id}>
            {category.name}
            </option>
        ))}
        </select>
    </Field>

    {items.length > 0 ? (
        <div className="card" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {items.map((item) => (
            <div className="list-item" key={item.key}>
            <div className="item-main">
                {item.status === 'pending' ? (
                <input
                    className="bulk-name-input"
                    value={item.name}
                    aria-label="Exercise name"
                    onChange={(e) => updateItem(item.key, { name: e.target.value })}
                    disabled={busy}
                />
                ) : (
                <span className="item-title">{item.name}</span>
                )}
                <div className="item-sub">
                <span>{item.file.name}</span>
                {item.status === 'pending' && nameTaken(item.name) ? (
                    <span className="bulk-warning">Name already exists — will be skipped</span>
                ) : null}
                {item.error ? <span className="bulk-warning">{item.error}</span> : null}
                </div>
            </div>
            <div className="item-actions">
                <span className={`bulk-status bulk-status-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                {item.status === 'pending' && !busy ? (
                <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => removeItem(item.key)}
                >
                    <Icon name="x" size={16} />
                </button>
                ) : null}
            </div>
            </div>
        ))}
        </div>
    ) : null}

    {items.length > 0 && !busy ? (
        <p className="bulk-summary">
        {pendingCount} to import · {doneCount} done{failedCount > 0 ? ` · ${failedCount} failed` : ''}
        </p>
    ) : null}

    <div className="dialog-actions" style={{ marginTop: 18 }}>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
        {doneCount > 0 ? 'Done' : 'Cancel'}
        </button>
        <button
        type="button"
        className="button button-primary"
        onClick={() => void importAll()}
        disabled={busy || pendingCount === 0 || !categoryId}
        >
        {busy ? 'Importing…' : `Import ${pendingCount > 0 ? pendingCount : ''} video${pendingCount === 1 ? '' : 's'}`}
        </button>
    </div>
    </Modal>
);
}