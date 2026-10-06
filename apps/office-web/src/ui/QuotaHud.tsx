import type { QuotaState, QuotaWindow } from '@cc/shared';
import { formatPercent, formatReset } from './format.ts';

function Meter({ label, window, now }: { label: string; window: QuotaWindow | null; now: number }) {
  const value = window ? Math.min(1, Math.max(0, window.utilization)) : 0;
  return (
    <div className="meter" title={window ? `Sıfırlanma: ${formatReset(window.resetsAt, now)}` : 'Henüz okunmadı'}>
      <span className="meter-label">{label}</span>
      <span className="meter-track" aria-hidden="true">
        <span className={`meter-fill ${value >= 0.8 ? 'hot' : ''}`} style={{ width: `${value * 100}%` }} />
      </span>
      <span className="meter-value">{window ? formatPercent(window.utilization) : '—'}</span>
      {window && <span className="meter-reset">{formatReset(window.resetsAt, now)}</span>}
    </div>
  );
}

export function QuotaHud({ quota, now }: { quota: QuotaState | null; now: number }) {
  return (
    <div className="quota" aria-label="Abonelik kotası">
      <Meter label="5 saat" window={quota?.fiveHour ?? null} now={now} />
      <Meter label="7 gün" window={quota?.sevenDay ?? null} now={now} />
    </div>
  );
}
