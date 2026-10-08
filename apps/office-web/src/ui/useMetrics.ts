import { useEffect, useRef, useState } from 'react';
import type { OfficeMetrics } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';

/** How long after a change the figures are read again: one read covers a burst of events. */
const REREAD_MS = 1000;
/** Idle hours, due times and reminders move with the clock alone: read again this often. */
const POLL_MS = 60_000;

/**
 * The top bar's figures, derived on the server: read on mount, a second after anything that changes the agenda
 * (`agendaRev`, the same burst rule as useAgenda), and every minute. Only the newest read is shown; a failed read keeps
 * the last figures (null until the first one arrives).
 */
export function useMetrics(): OfficeMetrics | null {
  const rev = useOffice((s) => s.agendaRev);
  const [metrics, setMetrics] = useState<OfficeMetrics | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reads = useRef(0);
  const alive = useRef(true);

  // Refs and the state setter only: the first render's copy serves the poll as well as any other.
  const read = () => {
    const id = ++reads.current;
    void api
      .metrics()
      .then((next) => {
        if (alive.current && id === reads.current) setMetrics(next);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    alive.current = true;
    const poll = setInterval(read, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  useEffect(() => {
    if (timer.current) return;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        read();
      },
      reads.current === 0 ? 0 : REREAD_MS,
    );
  }, [rev]);

  return metrics;
}
