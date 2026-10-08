import { useMemo, useState } from 'react';
import { STREAM_TO_HIRE, WORK_TYPE_LABELS, type Plan, type PlanStreamView } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { PLAN_STATUS_LABELS, STREAM_STATUS_LABELS } from './labels.ts';
import { streamViews } from './streams.ts';

function estimates(p: Plan): string | null {
  const parts = [p.quotaPct !== null ? `kota %${p.quotaPct}` : null, p.usd !== null ? `$${p.usd}` : null, p.days !== null ? `${p.days} gün` : null].filter(Boolean);
  return parts.length ? `Tahmin: ${parts.join(' · ')}` : null;
}

/** A plan's streams (management cycle §3.4): who carries each, what it waits for, and the status its tasks give it. */
function PlanStreams({ streams }: { streams: PlanStreamView[] }) {
  const views = useOffice((s) => s.views);
  const titles = new Map(streams.map((x) => [x.id, x.title]));
  const owner = (o: string) => (o.startsWith(`${STREAM_TO_HIRE}:`) ? o : (views[o]?.employee.name ?? '—'));
  return (
    <section className="plan-streams" aria-label="Akışlar">
      <h4>Akışlar</h4>
      <ul>
        {streams.map((x) => (
          <li key={x.id} className={`plan-stream ${x.status}`}>
            <span className="plan-stream-title">{x.title}</span>
            <span className={`badge stream-${x.status}`}>{STREAM_STATUS_LABELS[x.status]}</span>
            <span className="muted plan-stream-meta">
              {owner(x.owner)}
              {x.dependsOn.length > 0 ? ` · önce: ${x.dependsOn.map((d) => titles.get(d) ?? d).join(', ')}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A plan the coordinator proposed, as it stands now; the owner approves or declines the latest version here. */
export function PlanCard({ plan }: { plan: Plan }) {
  const live = useOffice((s) => s.plans[plan.id]) ?? plan;
  const spent = useOffice((s) => s.budget?.plans[plan.id]);
  const tasks = useOffice((s) => s.tasks);
  const streams = useMemo(() => streamViews(live, tasks), [live, tasks]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (live.version > plan.version) {
    return (
      <div className="note">
        Plan “{plan.title}” sürüm {plan.version} — yerine sürüm {live.version} geldi.
      </div>
    );
  }
  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const guess = estimates(live);
  return (
    <section className="plan-card" aria-label={`Plan: ${live.title}`}>
      <header className="row">
        <strong>{live.title}</strong>
        <span className={`badge plan-${live.status}`}>{PLAN_STATUS_LABELS[live.status]}</span>
        {live.approvedBy === 'coordinator' && <span className="badge started-by">Koordinatör başlattı</span>}
      </header>
      <span className="muted">sürüm {live.version}</span>
      <dl>
        <dt>Hedef</dt>
        <dd>{live.goal}</dd>
        <dt>Yaklaşım</dt>
        <dd>{live.approach}</dd>
        {live.people && (
          <>
            <dt>Kimler</dt>
            <dd>{live.people}</dd>
          </>
        )}
        {live.risks && (
          <>
            <dt>Riskler</dt>
            <dd>{live.risks}</dd>
          </>
        )}
      </dl>
      {live.method && (
        <section className="plan-method" aria-label="Nasıl yapılacak">
          <h4>Nasıl yapılacak · {WORK_TYPE_LABELS[live.method.workType]}</h4>
          <ol>
            {live.method.stages.map((st, i) => (
              <li key={i}>
                {st.name} — {st.role}
                {st.review ? ' · incelemeli' : ''}
              </li>
            ))}
          </ol>
          {live.method.checks.length > 0 && (
            <>
              <strong>Kalite kontrolleri</strong>
              <ul>
                {live.method.checks.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {streams.length > 0 && <PlanStreams streams={streams} />}
      {live.steps.length > 0 && (
        <ol>
          {live.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      {guess && <p className="muted">{guess}</p>}
      {(live.status === 'approved' || live.status === 'done') && spent && (
        <p className={`muted${live.usd !== null && spent.spentUsd > live.usd ? ' over' : ''}`}>
          {`Harcanan: $${spent.spentUsd}${live.usd !== null ? ` / $${live.usd}` : ''} · Claude ~$${spent.claudeUsd}`}
        </p>
      )}
      {live.status === 'draft' && (
        <div className="row end">
          <button type="button" disabled={busy} onClick={() => void act(() => api.declinePlan(live.id))}>
            Vazgeç
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void act(() => api.approvePlan(live.id))}>
            Onayla
          </button>
        </div>
      )}
      {live.status === 'approved' && (
        <div className="row end">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`“${live.title}” planı durdurulsun mu? Açık görevleri iptal edilir.`)) void act(() => api.stopPlan(live.id));
            }}
          >
            Durdur
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
