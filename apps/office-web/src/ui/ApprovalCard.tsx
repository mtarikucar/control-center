import { useState } from 'react';
import { APPROVAL_KIND_LABELS, APPROVAL_STATUS_LABELS, GATE_LIMIT_TEXT, type Approval } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';

/** A call the gate held (B9a), as it stands now: who asks, with which tool, on what target and why; the owner decides. */
export function ApprovalCard({ approval }: { approval: Approval }) {
  const live = useOffice((s) => s.approvals[approval.id]) ?? approval;
  const views = useOffice((s) => s.views);
  const task = useOffice((s) => (live.taskId ? s.tasks[live.taskId] : undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`proposal-card approval ${live.kind}`} aria-label={`Onay: ${APPROVAL_KIND_LABELS[live.kind]} ${live.target}`}>
      <header className="row">
        <span className="badge">{APPROVAL_KIND_LABELS[live.kind]}</span>
        <code>{live.target}</code>
        <span className={`badge approval-${live.status}`}>{APPROVAL_STATUS_LABELS[live.status]}</span>
      </header>
      <p className="prose">{live.summary}</p>
      <p className="muted">
        {views[live.employeeId]?.employee.name ?? '—'} · araç: {live.tool}
        {task ? ` · görev: ${task.title}` : ''} · {live.scope === 'task' ? 'görev boyunca' : 'tek çağrı'}
      </p>
      {live.note && <p className="muted">Not: {live.note}</p>}
      {live.status === 'pending' && (
        <div className="row end">
          <button type="button" disabled={busy} onClick={() => void act(() => api.denyApproval(live.id))}>
            Reddet
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void act(() => api.approveApproval(live.id))}>
            Onayla
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The owner's approvals: what waits for them first, then the last decided; what the gate can and cannot do. */
export function ApprovalsTab() {
  const approvals = useOffice((s) => s.approvals);
  const enabled = useOffice((s) => s.budget?.constitution.gateEnabled ?? false);
  const all = Object.values(approvals).sort((a, b) => b.requestedAt - a.requestedAt);
  const waiting = all.filter((a) => a.status === 'pending');
  const decided = all.filter((a) => a.status !== 'pending').slice(0, 20);
  const section = (label: string, items: Approval[]) =>
    items.length > 0 && (
      <section aria-label={label} className="proposal-list">
        <h3>{label}</h3>
        {items.map((a) => (
          <ApprovalCard key={a.id} approval={a} />
        ))}
      </section>
    );
  return (
    <div className="proposals">
      {!enabled && <p className="muted">Kapı kapalı: araç çağrıları onay beklemeden geçiyor. Anayasa sekmesinden açabilirsin.</p>}
      <p className="muted">{GATE_LIMIT_TEXT}</p>
      {all.length === 0 && <p className="muted">Henüz onay isteği yok. Kapıya takılan bir çağrı için çalışan buradan onay ister.</p>}
      {section('Senin onayını bekleyenler', waiting)}
      {section('Karara bağlananlar', decided)}
    </div>
  );
}
