import type { ManagementLog } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { useLiveRead } from './useLiveRead.ts';

/** The management log (management cycle §3.3), read from the server on open and again a second after a cycle starts or is recorded (`managementRev`). */
export function useManagement(): { log: ManagementLog | null; error: string | null } {
  const rev = useOffice((s) => s.managementRev);
  const { data, error } = useLiveRead(rev, () => api.management());
  return { log: data, error };
}
