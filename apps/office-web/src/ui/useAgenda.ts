import { useEffect, useRef, useState } from 'react';
import type { AgendaReport } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';

/** How long after a change the agenda is read again: one read covers a burst of events. */
const REREAD_MS = 1000;

/**
 * The agenda is derived on the server (spec §6.1): read on open, and again a second after anything that changes it
 * (`agendaRev`). Changes within that second ride on the same read, so the office is read at most once a second, and a
 * steady stream of events never postpones the read. Only the newest read is shown.
 */
export function useAgenda(): { report: AgendaReport | null; error: string | null } {
  const rev = useOffice((s) => s.agendaRev);
  const [report, setReport] = useState<AgendaReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reads = useRef(0);
  const alive = useRef(true);

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
        const read = ++reads.current;
        const current = () => alive.current && read === reads.current;
        void (async () => {
          try {
            const next = await api.agenda();
            if (!current()) return;
            setReport(next);
            setError(null);
          } catch (err) {
            if (current()) setError(err instanceof Error ? err.message : String(err));
          }
        })();
      },
      reads.current === 0 ? 0 : REREAD_MS,
    );
  }, [rev]);

  return { report, error };
}
