import { useEffect, useRef, useState } from 'react';

/** How long after a change a view is read again: one read covers a burst of events. */
const REREAD_MS = 1000;

/**
 * A view derived on the server, read on mount and again a second after `rev` moves (something that changes it
 * happened). Changes within that second ride on the same read, so the server is read at most once a second, and a
 * steady stream of events never postpones the read. Only the newest read is shown; a failed one shows its error.
 */
export function useLiveRead<T>(rev: number, read: () => Promise<T>): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reads = useRef(0);
  const alive = useRef(true);
  // The newest `read` (callers pass a fresh closure each render): the timer calls whichever is current when it fires.
  const latest = useRef(read);
  latest.current = read;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  useEffect(() => {
    if (timer.current) return;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        const id = ++reads.current;
        const current = () => alive.current && id === reads.current;
        void (async () => {
          try {
            const next = await latest.current();
            if (!current()) return;
            setData(next);
            setError(null);
          } catch (err) {
            if (current()) setError(err instanceof Error ? err.message : String(err));
          }
        })();
      },
      reads.current === 0 ? 0 : REREAD_MS,
    );
  }, [rev]);

  return { data, error };
}
