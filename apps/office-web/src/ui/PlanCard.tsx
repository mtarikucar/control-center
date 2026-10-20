import { useEffect, useMemo, useState } from 'react';
import { STREAM_TO_HIRE, WORK_TYPE_LABELS, ownerDepartment, type Plan, type PlanStreamView, type StreamNote } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { PLAN_STATUS_LABELS, STREAM_STATUS_LABELS } from './labels.ts';
import { streamViews } from './streams.ts';

function estimates(p: Plan): string | null {
  const parts = [p.quotaPct !== null ? `kota %${p.quotaPct}` : null, p.usd !== null ? `$${p.usd}` : null, p.days !== null ? `${p.days} gün` : null].filter(Boolean);
  return parts.length ? `Tahmin: ${parts.join(' · ')}` : null;
}

type Notes = Array<{ streamId: string; plan: StreamNote | null; report: StreamNote | null }>;

/** A plan's streams (management cycle §3.4): who carries each — a person, a role to hire or a department — what it waits for, its status, and a department's latest plan and report (spec departments §8). */
function PlanStreams({ planId, streams }: { planId: string; streams: PlanStreamView[] }) {
  const views = useOffice((s) => s.views);
  const departments = useOffice((s) => s.departments);
  const rev = useOffice((s) => s.streamNotesRev);
  const [notes, setNotes] = useState<Notes>([]);
  const byDepartment = streams.some((x) => ownerDepartment(x.owner) !== null);
  useEffect(() => {
    if (!byDepartment) return;
    let live = true;
    api.streamNotes(planId).then((n) => live && setNotes(n), () => undefined);
    return () => {
      live = false;
    };
  }, [planId, byDepartment, rev]);
  const titles = new Map(streams.map((x) => [x.id, x.title]));
  const owner = (o: string) => {
    if (o.startsWith(`${STREAM_TO_HIRE}:`)) return o;
    const dep = ownerDepartment(o);
    return dep ? `${departments?.[dep]?.name ?? 'Departman'} departmanı` : (views[o]?.employee.name ?? '—');
  };
  return (
    <section className="plan-streams" aria-label="Akışlar">
      <h4>Akışlar</h4>
      <ul>
        {streams.map((x) => {
          const n = notes.find((y) => y.streamId === x.id);
          return (
            <li key={x.id} className={`plan-stream ${x.status}`}>
              <span className="plan-stream-title">{x.title}</span>
              <span className={`badge stream-${x.status}`}>{STREAM_STATUS_LABELS[x.status]}</span>
              <span className="muted plan-stream-meta">
                {owner(x.owner)}
                {x.dependsOn.length > 0 ? ` · önce: ${x.dependsOn.map((d) => titles.get(d) ?? d).join(', ')}` : ''}
              </span>
              {(n?.plan || n?.report) && (
                <details className="plan-stream-notes">
                  <summary>Akış notları</summary>
                  {n.plan && <p className="plan-stream-note">Akış planı: {n.plan.text}</p>}
                  {n.report && (
                    <p className="plan-stream-note">
                      Rapor: {n.report.text}
                      {n.report.evidence.length > 0 ? ` (kanıt: ${n.report.evidence.join('; ')})` : ''}
                    </p>
                  )}
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * A plan the coordinator proposed, as it stands now; the owner approves or declines the latest version here. The card is
 * short: the steps (what will be done) under the title; goal, approach, method and streams folded under “Ayrıntı”.
 */
export function PlanCard({ plan }: { plan: Plan }) {
  const runtime = useOffice((s) => s.runtime);
  const live = useOffice((s) => s.plans[plan.id]) ?? plan;
  const spent = useOffice((s) => s.budget?.plans[plan.id]);
  const tasks = useOffice((s) => s.tasks);
  const streams = useMemo(() => streamViews(live, tasks), [live, tasks]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The owner's direction on a draft: a change request keeps the plan a draft and goes to the one who proposed it (the
  // coordinator revises it into a new version); a note with an approval follows the approval.
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const tell = async (text: string) => {
    await api.send(live.proposedBy, text);
    setNote('');
    setSent(true);
  };
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
      {live.steps.length > 0 && (
        <ol className="plan-steps" aria-label="Yapılacaklar">
          {live.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      {guess && <p className="muted">{guess}</p>}
      <details className="plan-details">
        <summary>Ayrıntı</summary>
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
        {streams.length > 0 && <PlanStreams planId={live.id} streams={streams} />}
      </details>
      {(live.status === 'approved' || live.status === 'done') && spent && (
        <p className={`muted${live.usd !== null && spent.spentUsd > live.usd ? ' over' : ''}`}>
          {`Harcanan: $${spent.spentUsd}${live.usd !== null ? ` / $${live.usd}` : ''} · Claude ~$${spent.claudeUsd}${runtime?.costAvailable === false ? ' + Codex maliyeti bilinmiyor' : ''}`}
        </p>
      )}
      {live.status === 'draft' && (
        <>
          <textarea
            className="plan-note"
            aria-label="Koordinatöre not"
            rows={2}
            value={note}
            placeholder="Koordinatöre not: yön ver, değişiklik iste ya da onayla ve ekle…"
            onChange={(ev) => setNote(ev.target.value)}
          />
          {sent && <p className="muted">Koordinatöre iletildi; planı düzeltince yeni sürüm burada görünür.</p>}
          <div className="row end">
            <button type="button" disabled={busy} onClick={() => void act(() => api.declinePlan(live.id))}>
              Vazgeç
            </button>
            <button type="button" disabled={busy || !note.trim()} onClick={() => void act(() => tell(`“${live.title}” planı (sürüm ${live.version}) için değişiklik istiyorum; onaylamadan önce planRevise ile düzelt: ${note.trim()}`))}>
              Değişiklik iste
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api.approvePlan(live.id);
                  if (note.trim()) await tell(`“${live.title}” planını onayladım. Not: ${note.trim()}`);
                })
              }
            >
              Onayla
            </button>
          </div>
        </>
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
