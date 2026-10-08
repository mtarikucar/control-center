import type { HoldingPerson, HoldingReason, Lifecycle, OfficeMetrics, StuckReason } from '@cc/shared';
import { formatPercent, formatWhenTR } from './format.ts';
import { lifecycleLabel } from './labels.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Idle this long while the team is not all busy: people are not being used. */
const IDLE_WARN_MS = 2 * HOUR;
/** The stuck tooltip names at most this many tasks. */
const STUCK_SHOWN = 10;
const REASON_LABELS: Record<StuckReason, string> = { blocked: 'engellendi', overdue: 'son tarihi geçti', stalled: 'hatırlatmaya rağmen ilerlemiyor' };
const HOLDING_LABELS: Record<HoldingReason, string> = { queued: 'sırada', scheduled: 'saatli', parked: 'park', review: 'incelemede' };
/** Why someone cannot take work right now; any other state reads as its usual label. */
const AWAY_LABELS: Partial<Record<Lifecycle, string>> = { limited: 'kota doldu', error: 'hata', stopped: 'durduruldu', in_terminal: 'terminalde' };

/** "40 dk", "6 sa", "2 gün" (rounded down). */
function idleFor(ms: number): string {
  if (ms < HOUR) return `${Math.floor(ms / MIN)} dk`;
  if (ms < 24 * HOUR) return `${Math.floor(ms / HOUR)} sa`;
  return `${Math.floor(ms / (24 * HOUR))} gün`;
}

/** "Ali — park (yarın 09:00)", "Can — incelemede". */
const holdingLine = (p: HoldingPerson, now: number) => `${p.name} — ${HOLDING_LABELS[p.why]}${p.at === null ? '' : ` (${formatWhenTR(p.at, now)})`}`;

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
  // Someone who could work and has none means the team is not all used; idle long enough is worth a look. Who holds work
  // they are not at, or cannot take work right now, is shown, not warned about.
  const idleLong = busy.idle.some((p) => generatedAt - p.since >= IDLE_WARN_MS);
  const people = [
    ...(busy.atWork.length ? [`Çalışıyor: ${busy.atWork.map((p) => p.name).join(', ')}`] : []),
    ...(busy.holding.length ? [`Elinde iş var, şu an çalışmıyor: ${busy.holding.map((p) => holdingLine(p, generatedAt)).join(', ')}`] : []),
    ...(busy.idle.length ? [busy.idle.map((p) => `${p.name} — ${idleFor(generatedAt - p.since)} boşta`).join(', ')] : []),
    ...busy.unavailable.map((p) => `${p.name} — ${AWAY_LABELS[p.state] ?? lifecycleLabel(p.state).toLocaleLowerCase('tr-TR')}`),
  ];
  const team = people.length ? people.join('\n') : 'Koordinatörden başka çalışan yok';
  const firstPass = `İlk turda geçen: ${delivered.firstPassRate === null ? 'henüz incelenen yok' : formatPercent(delivered.firstPassRate)}`;
  const stuckLines = stuck.items.slice(0, STUCK_SHOWN).map((i) => `${i.assignee}: ${i.title} — ${REASON_LABELS[i.reason]}`);
  if (stuck.items.length > STUCK_SHOWN) stuckLines.push(`… ve ${stuck.items.length - STUCK_SHOWN} iş daha`);
  return (
    <div className="metrics" role="group" aria-label="Ofisin durumu">
      <Chip label="Meşgul" value={`${busy.busy}/${busy.total}`} title={team} tone={idleLong ? 'warn' : null} onClick={onOpen} />
      <Chip label={`Teslim (${delivered.windowHours} sa)`} value={String(delivered.count)} title={firstPass} onClick={onOpen} />
      <Chip label="Takılan" value={String(stuck.count)} title={stuckLines.length ? stuckLines.join('\n') : 'Takılan iş yok'} tone={stuck.count > 0 ? 'bad' : null} onClick={onOpen} />
    </div>
  );
}
