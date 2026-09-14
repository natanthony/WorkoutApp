/**
 * Reusable components — Document 2 §16 contracts.
 * Components receive data + emit intents; persistence lives in the
 * application/repository layers. No object URLs are stored here.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/* --------------------------------- Icons --------------------------------- */

const ICON_PATHS: Record<string, ReactNode> = {
  play: <polygon points="7 4 20 12 7 20" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" />
    </>
  ),
  'skip-back': (
    <>
      <polygon points="19 20 9 12 19 4" fill="currentColor" stroke="none" />
      <line x1="5" y1="4" x2="5" y2="20" />
    </>
  ),
  'skip-forward': (
    <>
      <polygon points="5 4 15 12 5 20" fill="currentColor" stroke="none" />
      <line x1="19" y1="4" x2="19" y2="20" />
    </>
  ),
  star: (
    <polygon
      points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"
      fill="currentColor"
      stroke="none"
    />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </>
  ),
  settings: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="9" cy="7" r="2.5" fill="currentColor" stroke="none" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="15" cy="17" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  x: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  check: <polyline points="4 12.5 9.5 18 20 6.5" />,
  'chevron-up': <polyline points="6 15 12 9 18 15" />,
  'chevron-down': <polyline points="6 9 12 15 18 9" />,
  'chevron-right': <polyline points="9 6 15 12 9 18" />,
  trash: (
    <>
      <polyline points="4 7 20 7" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </>
  ),
  heart: (
    <path
      d="M12 20.5C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 11.7Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <polyline points="6 10 12 4 18 10" />
      <path d="M4 20h16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <polyline points="6 10 12 16 18 10" />
      <path d="M4 20h16" />
    </>
  ),
  resume: (
    <>
      <polyline points="4 10 4 4 10 4" />
      <polyline points="20 14 20 20 14 20" />
      <path d="M4 14a8 8 0 0 1 14.9-3" />
      <polyline points="19 4 19 8 15 8" />
    </>
  ),
  maximize: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </>
  ),
  volume: (
    <>
      <polygon points="4 9 8 9 13 4 13 20 8 15 4 15" fill="currentColor" stroke="none" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    </>
  ),
  'volume-x': (
    <>
      <polygon points="4 9 8 9 13 4 13 20 8 15 4 15" fill="currentColor" stroke="none" />
      <line x1="17" y1="9" x2="22" y2="15" />
      <line x1="22" y1="9" x2="17" y2="15" />
    </>
  ),
  dumbbell: (
    <>
      <line x1="6.5" y1="6.5" x2="17.5" y2="17.5" />
      <line x1="17.5" y1="6.5" x2="6.5" y2="17.5" />
      <path d="M2.5 9.5l2-2M4.5 11.5l3-3M19.5 12.5l3-3M21.5 14.5l2-2" />
    </>
  ),
  flag: (
    <>
      <line x1="5" y1="21" x2="5" y2="4" />
      <path d="M5 4h13l-2.5 4L18 12H5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.5" r="0.5" fill="currentColor" />
    </>
  ),
  menu: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

/* --------------------------------- Modal --------------------------------- */

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && panel) {
        const elements = Array.from(
          panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => !el.hasAttribute('disabled'));
        if (elements.length === 0) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      (restoreRef.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ----------------------------- ConfirmDialog ----------------------------- */

export function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="confirm-body">{children}</div>
      <div className="dialog-actions">
        <button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`button ${danger ? 'button-danger' : 'button-primary'}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------ Empty/Error ------------------------------ */

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: string;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ? (
        <div className="empty-icon">
          <Icon name={icon} size={36} />
        </div>
      ) : null}
      <h3>{title}</h3>
      {message ? <p>{message}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <div className="empty-icon">
        <Icon name="info" size={36} />
      </div>
      <h3>{title}</h3>
      {message ? <p>{message}</p> : null}
      {onRetry ? (
        <button type="button" className="button button-primary" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------- ReorderList ------------------------------ */

export function ReorderList<T>({
  items,
  getKey,
  renderItem,
  onReorder,
}: {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  onReorder: (from: number, to: number) => void;
}) {
  return (
    <ul className="reorder-list">
      {items.map((item, index) => (
        <li key={getKey(item)} className="reorder-item">
          <div className="reorder-content">{renderItem(item, index)}</div>
          <div className="reorder-controls">
            <button
              type="button"
              className="icon-button"
              aria-label={`Move item ${index + 1} up`}
              disabled={index === 0}
              onClick={() => onReorder(index, index - 1)}
            >
              <Icon name="chevron-up" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Move item ${index + 1} down`}
              disabled={index === items.length - 1}
              onClick={() => onReorder(index, index + 1)}
            >
              <Icon name="chevron-down" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------- SearchBar ------------------------------- */

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-bar">
      <Icon name="search" size={18} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button type="button" className="icon-button" aria-label="Clear search" onClick={() => onChange('')}>
          <Icon name="x" size={16} />
        </button>
      ) : null}
    </div>
  );
}

/* --------------------------------- Fields --------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
      {!error && hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/* -------------------------------- ChipSelect ------------------------------ */

export function ChipSelect({
  values,
  onChange,
  suggestions,
  placeholder = 'Add value',
}: {
  values: string[];
  onChange: (values: string[]) => void;
  suggestions: readonly string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    if (!values.includes(value)) onChange([...values, value]);
    setDraft('');
  };
  const available = suggestions.filter((suggestion) => !values.includes(suggestion));
  return (
    <div className="chip-select">
      <div className="chip-list">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className="chip chip-active"
            aria-label={`Remove ${value}`}
            onClick={() => onChange(values.filter((v) => v !== value))}
          >
            {value} <Icon name="x" size={13} />
          </button>
        ))}
      </div>
      <div className="chip-input-row">
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          aria-label={placeholder}
          list={`chips-${placeholder.replace(/\s+/g, '-').toLowerCase()}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add(draft);
            }
          }}
        />
        <button type="button" className="button button-secondary" onClick={() => add(draft)}>
          Add
        </button>
      </div>
      <datalist id={`chips-${placeholder.replace(/\s+/g, '-').toLowerCase()}`}>
        {available.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      {available.length > 0 ? (
        <div className="chip-suggestions">
          {available.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="chip"
              onClick={() => add(suggestion)}
            >
              <Icon name="plus" size={12} /> {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ ImportProgress ---------------------------- */

export function ImportProgress({ percent }: { percent: number | null }) {
  return (
    <div className="import-progress" role="status">
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: percent === null ? '40%' : `${percent}%` }}
        />
      </div>
      <span>{percent === null ? 'Importing…' : `Importing ${percent}%`}</span>
    </div>
  );
}
