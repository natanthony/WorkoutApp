/**
 * Active workout session — Document 2 §8 "Active workout session".
 * The session snapshots the generated queue and cursor at start and is the
 * sole authority for Previous/Next. Plan or custom-workout edits never
 * mutate an active session; the next started session uses the new data.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { QueueItem } from './types';
import { newId } from './persistence/repositories';

export interface WorkoutSession {
  id: string;
  source: 'plan' | 'custom' | 'single';
  title: string;
  subtitle: string | null;
  /** Completion key for plan sessions, e.g. `session:2026-09-14:0`. */
  dayKey: string | null;
  /** Snapshot of the queue generated at session start. */
  queue: QueueItem[];
  cursor: number;
  startedAt: number;
}

interface SessionContextValue {
  session: WorkoutSession | null;
  startSession: (init: Omit<WorkoutSession, 'id' | 'cursor' | 'startedAt'>) => void;
  setCursor: (cursor: number) => void;
  endSession: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<WorkoutSession | null>(null);

  const startSession = useCallback(
    (init: Omit<WorkoutSession, 'id' | 'cursor' | 'startedAt'>) => {
      if (init.queue.length === 0) return;
      setSession({
        ...init,
        id: newId(),
        cursor: 0,
        startedAt: Date.now(),
      });
    },
    [],
  );

  const setCursor = useCallback((cursor: number) => {
    setSession((current) => {
      if (!current) return current;
      if (cursor < 0 || cursor >= current.queue.length) return current;
      return { ...current, cursor };
    });
  }, []);

  const endSession = useCallback(() => setSession(null), []);

  const value = useMemo(
    () => ({ session, startSession, setCursor, endSession }),
    [session, startSession, setCursor, endSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
