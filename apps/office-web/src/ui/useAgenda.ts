import type { AgendaReport } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { useLiveRead } from './useLiveRead.ts';

/** The agenda is derived on the server (spec §6.1): read on open, and again a second after anything that changes it (`agendaRev`). */
export function useAgenda(): { report: AgendaReport | null; error: string | null } {
  const rev = useOffice((s) => s.agendaRev);
  const { data, error } = useLiveRead(rev, () => api.agenda());
  return { report: data, error };
}
