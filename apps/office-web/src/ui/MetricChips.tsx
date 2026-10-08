import type { OfficeMetrics, StuckReason } from '@cc/shared';
import { formatPercent } from './format.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Idle this long while the team is not all busy: people are not being used. */
const IDLE_WARN_MS = 2 * HOUR;
/** The stuck tooltip names at most this many tasks. */
const STUCK_SHOWN = 10;
const REASON_LABELS: Record<StuckReason, string> = { blocked: 'engellendi', overdue: 'son tarihi geçti', stalled: 'hatırlatmaya rağmen ilerlemiyor' };

/** "40 dk", "6 sa", "2 gün" (rounded down). */
function idleFor(ms: number): string {
  if (ms < HOUR) return `${Math.floor(ms / MIN)} dk`;
  if (ms < 24 * HOUR) return `${Math.floor(ms / HOUR)} sa`;
  return `${Math.floor(ms / (24 * HOUR))} gün`;
}

function Chip({ label, value, title, tone, onClick }: { label: string; value: string; title: string; tone?: 'warn' | 'bad' | null; onClick: () => void }) {
  return (
    <button type="button" className={tone ? `metric ${tone}` : 'metric'} title={title} onClick={onClick}>
      <span className="metric-label">{label}</span>{' '}
      <span className="metric-value">{value}</span>
    </button>
  );
}

/** The office at a glance (busy, delivered in the last day, stuck), each explained in its tooltip; a click opens the agenda. */
export function MetricChips({ metrics, onOpen }: { metrics: OfficeMetrics; onOpen: () => void }) {
  const { busy, delivered, stuck, generatedAt } = metrics;
  // Someone idle means the team is not all busy; idle long enough is worth a look.
  const idleLong = busy.idle.some((p) => generatedAt - p.since >= IDLE_WARN_MS);
  const idle = busy.idle.length
    ? busy.idle.map((p) => `${p.name} — ${idleFor(generatedAt - p.since)} boşta`).join(', ')
    : busy.total > 0
      ? 'Herkes meşgul'
      : 'Koordinatörden başka çalışan yok';
  const firstPass = `İlk turda geçen: ${delivered.firstPassRate === null ? 'henüz incelenen yok' : formatPercent(delivered.firstPassRate)}`;
  const stuckLines = stuck.items.slice(0, STUCK_SHOWN).map((i) => `${i.assignee}: ${i.title} — ${REASON_LABELS[i.reason]}`);
  if (stuck.items.length > STUCK_SHOWN) stuckLines.push(`… ve ${stuck.items.length - STUCK_SHOWN} iş daha`);
  return (
    <div className="metrics" role="group" aria-label="Ofisin durumu">
      <Chip label="Meşgul" value={`${busy.busy}/${busy.total}`} title={idle} tone={idleLong ? 'warn' : null} onClick={onOpen} />
      <Chip label={`Teslim (${delivered.windowHours} sa)`} value={String(delivered.count)} title={firstPass} onClick={onOpen} />
      <Chip label="Takılan" value={String(stuck.count)} title={stuckLines.length ? stuckLines.join('\n') : 'Takılan iş yok'} tone={stuck.count > 0 ? 'bad' : null} onClick={onOpen} />
    </div>
  );
}
