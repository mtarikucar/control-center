import { useState } from 'react';
import type { Proposal } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { PROPOSAL_KIND_LABELS, PROPOSAL_STATUS_LABELS } from './labels.ts';

/** A need, idea, objection or purchase someone raised, as it stands now; the owner settles what waits for them. */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const live = useOffice((s) => s.proposals[proposal.id]) ?? proposal;
  const views = useOffice((s) => s.views);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: string | null) => (id === null ? '—' : id === 'owner' ? 'sahibi' : (views[id]?.employee.name ?? '—'));
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
    <section className={`proposal-card ${live.kind}`} aria-label={`${PROPOSAL_KIND_LABELS[live.kind]}: ${live.title}`}>
      <header className="row">
        <span className="badge">{PROPOSAL_KIND_LABELS[live.kind]}</span>
        <strong>{live.title}</strong>
        <span className={`badge proposal-${live.status}`}>{PROPOSAL_STATUS_LABELS[live.status]}</span>
      </header>
      <p className="prose">{live.text}</p>
      <p className="muted">
        {nameOf(live.by)}
        {live.usd !== null ? ` · $${live.usd}` : ''}
        {live.status === 'open' && live.routedTo ? ` · karar: ${nameOf(live.routedTo)}` : ''}
      </p>
      {live.note && <p className="muted">Not: {live.note}</p>}
      {live.status === 'owner' && (
        <div className="row end">
          <button type="button" disabled={busy} onClick={() => void act(() => api.rejectProposal(live.id))}>
            Reddet
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void act(() => api.approveProposal(live.id))}>
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
