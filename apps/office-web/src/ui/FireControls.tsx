import { useState } from 'react';
import type { Employee } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';

/** "İşten çıkar": by default the employee first hands over what they know (spec §3.4); "Hemen çıkar" skips it. */
export function FireControls({ employee }: { employee: Employee }) {
  const select = useOffice((s) => s.select);
  const leaving = useOffice((s) =>
    Object.values(s.tasks).some((t) => t.kind === 'handover' && t.assignee === employee.id && (t.status === 'waiting' || t.status === 'in_progress' || t.status === 'blocked')),
  );
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (now: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.fire(employee.id, now);
      setAsking(false);
      if (out === null) select(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const failure = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );
  if (leaving) {
    return (
      <div className="leaving" role="status">
        <span>Devir yapıyor; teslim edince işten çıkarılacak.</span>
        <button type="button" className="danger" disabled={busy} onClick={() => void act(true)}>
          Hemen çıkar
        </button>
        {failure}
      </div>
    );
  }
  return (
    <>
      <button type="button" className="danger" disabled={busy} onClick={() => setAsking(true)}>
        İşten çıkar
      </button>
      {asking && (
        <div className="fire-ask" role="dialog" aria-label={`${employee.name} işten çıkarılsın mı?`}>
          <p>
            {employee.name} işten çıkarılsın mı? Önce bildiklerini şirkete devretmesi önerilir: öğrendiklerini notlara yazar, açık
            işleri koordinatöre döner.
          </p>
          <div className="row end">
            <button type="button" onClick={() => setAsking(false)}>
              Vazgeç
            </button>
            <button type="button" className="danger" disabled={busy} onClick={() => void act(true)}>
              Hemen çıkar
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void act(false)}>
              Devir yaptır, sonra çıkar
            </button>
          </div>
        </div>
      )}
      {failure}
    </>
  );
}
