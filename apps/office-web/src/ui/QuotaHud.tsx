import type { QuotaState, QuotaWindow } from '@cc/shared';
import { formatPercent, formatReset } from './format.ts';

function Meter({ label, window, now }: { label: string; window: QuotaWindow | null; now: number }) {
  // Past its reset the window starts over; the last reading would overstate it until claude reports again.
  const reset = window !== null && window.resetsAt <= now;
  const value = window && !reset ? Math.min(1, Math.max(0, window.utilization)) : 0;
  const when = window ? (reset ? 'yenilendi' : formatReset(window.resetsAt, now)) : null;
  return (
    <div className="meter" title={when ? `Sıfırlanma: ${when}` : 'Henüz okunmadı'}>
      <span className="meter-label">{label}</span>
      <span className="meter-track" aria-hidden="true">
        <span className={`meter-fill ${value >= 0.8 ? 'hot' : ''}`} style={{ width: `${value * 100}%` }} />
      </span>
      <span className="meter-value">{window ? formatPercent(value) : '—'}</span>
      {when && <span className="meter-reset">{when}</span>}
    </div>
  );
}

export function QuotaHud({ quota, now, label }: { quota: QuotaState | null; now: number; label?: string }) {
  return (
    <div className="quota" aria-label={label ? `${label} abonelik kotası` : 'Abonelik kotası'}>
      {label && <span className="meter-label">{label}</span>}
      <Meter label="5 saat" window={quota?.fiveHour ?? null} now={now} />
      <Meter label="7 gün" window={quota?.sevenDay ?? null} now={now} />
    </div>
  );
}
