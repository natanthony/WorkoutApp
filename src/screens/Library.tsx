import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useCategoryNames, useFavouriteIds } from '../store';
import { useSession } from '../session';
import {
EMPTY_FILTERS,
distinctEquipment,
moveId,
searchExercises,
singleExerciseQueue,
} from '../domain';
import type { SearchFilters } from '../domain';
import { EmptyState, Icon, ReorderList, SearchBar } from '../components/common';
import { ExerciseRow } from '../components/exercise';
import { ExerciseFormModal } from '../components/ExerciseForm';
import { BulkImportModal } from '../components/BulkImport';
import { exerciseRepo, favouriteRepo } from '../persistence/repositories';
import { DIFFICULTIES } from '../types';

export default function LibraryScreen() {
const app = useApp();
const navigate = useNavigate();
const { startSession } = useSession();
const categoryNames = useCategoryNames();
const favouriteIds = useFavouriteIds();
const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
const [adding, setAdding] = useState(false);
const [bulkImporting, setBulkImporting] = useState(false);
const [reordering, setReordering] = useState(false);

const results = useMemo(
  () => searchExercises(app.exercises, categoryNames, filters),
  [app.exercises, categoryNames, filters],
);
const equipmentOptions = useMemo(() => distinctEquipment(app.exercises), [app.exercises]);

const playSingle = (exerciseId: string) => {
  const exercise = app.exercises.find((e) => e.id === exerciseId);
  if (!exercise) return;
  startSession({
    source: 'single',
    title: exercise.name,
    subtitle: null,
    dayKey: null,
    queue: singleExerciseQueue(exercise),
  });
  navigate('/play');
};

const toggleFavourite = (exerciseId: string) => {
  void favouriteRepo.set(exerciseId, !favouriteIds.has(exerciseId)).then(app.refresh);
};

const reorder = (from: number, to: number) => {
  const ids = moveId(
    app.exercises.map((e) => e.id),
    from,
    to,
  );
  void exerciseRepo.reorder(ids).then(app.refresh);
};

return (
  <div className="stack">
    <div className="screen-header">
      <div>
        <h1>Exercise library</h1>
        <p>{app.exercises.length} exercise{app.exercises.length === 1 ? '' : 's'} · stored locally on this device</p>
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setReordering((r) => !r)}
        >
          <Icon name="menu" size={16} /> {reordering ? 'Done reordering' : 'Reorder'}
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setBulkImporting(true)}
        >
          <Icon name="upload" size={16} /> Bulk import
        </button>
        <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> Add exercise
        </button>
      </div>
    </div>

    <div className="toolbar">
      <SearchBar value={filters.query} onChange={(query) => setFilters({ ...filters, query })} placeholder="Search name, equipment, targets…" />
      <div className="filter-row">
        <select
          aria-label="Filter by category"
          value={filters.categoryId}
          onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
        >
          <option value="all">All categories</option>
          {app.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by difficulty"
          value={filters.difficulty}
          onChange={(e) => setFilters({ ...filters, difficulty: e.target.value as SearchFilters['difficulty'] })}
        >
          <option value="all">All levels</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by equipment"
          value={filters.equipment}
          onChange={(e) => setFilters({ ...filters, equipment: e.target.value })}
        >
          <option value="all">All equipment</option>
          {equipmentOptions.map((eq) => (
            <option key={eq} value={eq}>
              {eq}
            </option>
          ))}
        </select>
      </div>
    </div>

    {app.exercises.length === 0 ? (
      <EmptyState
        icon="dumbbell"
        title="Your library is empty"
        message="Import your first exercise video to get started. Everything stays on this device."
        action={
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add exercise
          </button>
        }
      />
    ) : reordering ? (
      <div className="card">
        <ReorderList
          items={app.exercises}
          getKey={(e) => e.id}
          onReorder={reorder}
          renderItem={(exercise) => (
            <div className="list-item">
              <div className="item-main">
                <span className="item-title">{exercise.name}</span>
                <div className="item-sub">
                  <span>{categoryNames.get(exercise.categoryId) ?? ''}</span>
                </div>
              </div>
            </div>
          )}
        />
      </div>
    ) : results.length === 0 ? (
      <EmptyState icon="search" title="No matches" message="Try a different search or clear the filters." />
    ) : (
      <div className="list">
        {results.map((exercise) => (
          <ExerciseRow
            key={exercise.id}
            exercise={exercise}
            categoryName={categoryNames.get(exercise.categoryId) ?? ''}
            isFavourite={favouriteIds.has(exercise.id)}
            detailTo={`/exercises/${exercise.id}`}
            onToggleFavourite={() => toggleFavourite(exercise.id)}
            onPlay={() => playSingle(exercise.id)}
          />
        ))}
      </div>
    )}

    {adding ? (
      <ExerciseFormModal
        onClose={() => setAdding(false)}
        onSaved={() => setAdding(false)}
      />
    ) : null}
    {bulkImporting ? <BulkImportModal onClose={() => setBulkImporting(false)} /> : null}
  </div>
);
}