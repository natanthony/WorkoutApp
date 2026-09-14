import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { useApp } from '../store';
import { generateThumbnail, importThumbnailBlob, importVideoFile } from '../media';
import { exerciseRepo } from '../persistence/repositories';
import type { ExerciseInput } from '../persistence/repositories';
import { DIFFICULTIES } from '../types';
import type { Difficulty, Exercise } from '../types';
import { EQUIPMENT_SUGGESTIONS, TARGET_SUGGESTIONS } from '../domain';
import { ChipSelect, Field, ImportProgress, Modal } from './common';

export function ExerciseFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Exercise;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { categories, refresh } = useApp();
  const [name, setName] = useState(initial?.name ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? (categories[0]?.id ?? ''));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>(initial?.difficulty ?? '');
  const [equipment, setEquipment] = useState<string[]>(initial?.equipment ?? []);
  const [targets, setTargets] = useState<string[]>(initial?.targets ?? []);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Exercise name is required');
      return;
    }
    if (!categoryId) {
      setError('Choose a category');
      return;
    }
    setBusy(true);
    try {
      const payload: ExerciseInput = {
        name,
        categoryId,
        description,
        difficulty: difficulty === '' ? null : difficulty,
        equipment,
        targets,
        mediaId: initial?.mediaId ?? null,
        thumbnailMediaId: initial?.thumbnailMediaId ?? null,
      };
      if (initial) {
        await exerciseRepo.update(initial.id, payload);
      } else {
        if (!file) throw new Error('Choose a video file to import');
        setProgress(0);
        const media = await importVideoFile(file, setProgress);
        const thumbBlob = await generateThumbnail(file);
        const thumb = thumbBlob ? await importThumbnailBlob(thumbBlob) : null;
        await exerciseRepo.create({
          ...payload,
          mediaId: media.id,
          thumbnailMediaId: thumb ? thumb.id : null,
        });
      }
      await refresh();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Modal title={initial ? 'Edit exercise' : 'Add exercise'} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Name" error={error}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Goblet squat" />
        </Field>
        <div className="form-grid">
          <Field label="Category">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Difficulty">
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}
            >
              <option value="">Not set</option>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Description">
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Form cues, reps guidance, links…"
          />
        </Field>
        <Field label="Equipment">
          <ChipSelect values={equipment} onChange={setEquipment} suggestions={EQUIPMENT_SUGGESTIONS} placeholder="Add equipment" />
        </Field>
        <Field label="Targets">
          <ChipSelect values={targets} onChange={setTargets} suggestions={TARGET_SUGGESTIONS} placeholder="Add target" />
        </Field>
        {initial ? null : (
          <Field label="Video file" hint="The video is stored locally on this device. A thumbnail is generated automatically.">
            <input type="file" accept="video/*" onChange={pickFile} />
          </Field>
        )}
        {progress !== null ? <ImportProgress percent={progress} /> : null}
        <div className="dialog-actions" style={{ marginTop: 18 }}>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Add exercise'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
