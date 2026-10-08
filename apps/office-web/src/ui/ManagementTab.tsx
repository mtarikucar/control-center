import { useEffect, useState } from 'react';
import { saysNoChange, type CycleCloseWords, type CycleTrigger, type ModelAlias } from '@cc/shared';
import { formatCost, formatDuration, formatWhenTR } from './format.ts';
import { modelName, triggerText } from './labels.ts';
import { useManagement } from './useManagement.ts';

/** What opened a cycle, listed in full up to this many; the rest fold away. */
const SHOWN_TRIGGERS = 4;

/** The clock, moving every `ms` while `on` (a cycle going on shows how long it has run). */
function useNow(ms: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return now;
}

/** “değişiklik yok, çünkü …” as the coordinator wrote it, in any spelling (cycleClose requires the words, by the same check). */
const noChange = (reasoning: string) => (saysNoChange(reasoning) ? reasoning : `Değişiklik yok — ${reasoning}`);

interface CycleCardProps {
  state: 'open' | 'closed' | 'unclosed';
  startedAt: number;
  /** null: not known (the office stopped before the coordinator did anything in the cycle). */
  durationMs: number | null;
  model: ModelAlias | null;
  costUsd: number | null;
  triggers: CycleTrigger[];
  words: CycleCloseWords | null;
  now: number;
}

function Triggers({ triggers }: { triggers: CycleTrigger[] }) {
  const shown = triggers.slice(0, SHOWN_TRIGGERS);
  const rest = triggers.slice(SHOWN_TRIGGERS);
  return (
    <div className="cycle-section">
      <span className="cycle-label">Açan</span>
      <ul className="cycle-triggers" aria-label="Açan olaylar">
        {shown.map((t, i) => (
          <li key={`${t.kind}:${t.seq ?? i}:${t.at}`}>{triggerText(t)}</li>
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="cycle-more">
          <summary>+{rest.length} olay daha</summary>
          <ul className="cycle-triggers">
            {rest.map((t, i) => (
              <li key={`${t.kind}:${t.seq ?? i}:${t.at}`}>{triggerText(t)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** One management cycle: when, how long, on which model, what opened it, what it decided and why, what it cost. */
function CycleCard({ state, startedAt, durationMs, model, costUsd, triggers, words, now }: CycleCardProps) {
  const when = formatWhenTR(startedAt, now);
  return (
    <article className={`cycle-card ${state}`} aria-label={`Yönetim turu ${when}`}>
      <header className="cycle-head">
        <time dateTime={new Date(startedAt).toISOString()}>{when}</time>
        <span className="muted">{durationMs === null ? 'süre bilinmiyor' : formatDuration(durationMs)}</span>
        {model && <span className="badge model">{modelName(model)}</span>}
        {state === 'open' && <span className="badge cycle-open">sürüyor</span>}
        {state === 'unclosed' && <span className="badge cycle-unclosed">kapanmadı</span>}
        {costUsd !== null && <span className="cycle-cost">{state === 'open' ? `şimdiye dek ${formatCost(costUsd)}` : formatCost(costUsd)}</span>}
      </header>
      {triggers.length > 0 && <Triggers triggers={triggers} />}
      {words &&
        (words.changes.length > 0 ? (
          <>
            <div className="cycle-section">
              <span className="cycle-label">Değişiklikler</span>
              <ul className="cycle-changes" aria-label="Değişiklikler">
                {words.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
            {words.reasoning && (
              <p className="cycle-line">
                <span className="cycle-label">Gerekçe</span> {words.reasoning}
              </p>
            )}
          </>
        ) : (
          <p className="cycle-line cycle-nochange">{noChange(words.reasoning)}</p>
        ))}
      {words?.next && (
        <p className="cycle-line">
          <span className="cycle-label">Sonraki tur</span> {words.next}
        </p>
      )}
      {state === 'unclosed' && <p className="cycle-line cycle-warn">Koordinatör bu turu cycleClose ile kapatmadan bitirdi; sonraki pano bunu hatırlatır.</p>}
      {state === 'open' && <p className="cycle-line muted">{words ? 'Kapanış yazıldı; tur bitince kaydedilir.' : 'Koordinatör panoyu okuyor; kararı tur kapanınca burada.'}</p>}
    </article>
  );
}

/** The coordinator's management log (management cycle §3.3): the cycle going on first, then the recorded ones, newest first. */
export function ManagementTab() {
  const { log, error } = useManagement();
  const tick = useNow(30_000, Boolean(log?.open));
  const now = Math.max(tick, log?.generatedAt ?? 0);
  const cycles = log?.cycles ?? [];
  const unclosed = cycles.filter((c) => !c.closed).length;
  const spent = cycles.reduce((sum, c) => sum + (c.costUsd ?? 0), 0);
  return (
    <div className="management">
      <p className="muted management-intro">
        Koordinatör işin şekli değiştiğinde, iş açıkken de en geç 45 dakikada bir yönetim panosunu okur, planı gerçekle karşılaştırır ve bir karar bırakır.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!log ? (
        !error && <p className="muted">Yükleniyor…</p>
      ) : !log.open && cycles.length === 0 ? (
        <p className="muted">Henüz yönetim turu yok. İlk tur bir teslim, bir takılma ya da boşa çıkan biriyle gelir; her tur burada görünür.</p>
      ) : (
        <>
          {cycles.length > 0 && (
            <p className="management-summary">{`Son ${cycles.length} tur · ${unclosed ? `${unclosed} kapanmadı` : 'hepsi kapandı'} · ${formatCost(spent)}`}</p>
          )}
          <div className="cycle-list">
            {log.open && (
              <CycleCard state="open" startedAt={log.open.startedAt} durationMs={now - log.open.startedAt} model={log.open.model} costUsd={log.open.costUsd} triggers={log.open.triggers} words={log.open.close} now={now} />
            )}
            {cycles.map((c) => (
              <CycleCard key={c.seq} state={c.closed ? 'closed' : 'unclosed'} startedAt={c.startedAt} durationMs={c.endedAt === null ? null : c.endedAt - c.startedAt} model={c.model} costUsd={c.costUsd} triggers={c.triggers} words={c.closed ? c : null} now={now} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
