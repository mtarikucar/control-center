import type { UsageTotals } from '@cc/shared';

const trNumber = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${trNumber(n / 1_000_000, 1)}M tok`;
  if (n >= 1_000) return `${trNumber(n / 1_000, 1)}k tok`;
  return `${Math.round(n)} tok`;
}

export const formatCost = (usd: number): string => `$${usd.toFixed(2)}`;
export const formatPercent = (utilization: number): string => `%${Math.round(utilization * 100)}`;
export const tokensOf = (t: UsageTotals | undefined): number => (t ? t.inputTokens + t.outputTokens : 0);

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "15:40" for today, "Per 09:05" for another day. */
export function formatReset(ms: number, now: number): string {
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? formatClock(ms) : `${DAYS[d.getDay()]} ${formatClock(ms)}`;
}

const KEY_BY_TOOL: Record<string, string> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
};

export function summarizeToolInput(name: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const record = input as Record<string, unknown>;
  const key = KEY_BY_TOOL[name];
  const preferred = key ? record[key] : undefined;
  const text = typeof preferred === 'string' ? preferred : JSON.stringify(record);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/** "6 Eki 14:05": when a memory record was written. */
export function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "bugün 14:55", "yarın 09:00", "12 Eki 14:55", "3 Oca 2027 08:30": the office's own wording (server `formatWhen`). */
export function formatWhenTR(ms: number, now: number): string {
  const d = new Date(ms);
  const n = new Date(now);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const time = formatClock(ms);
  if (sameDay(d, n)) return `bugün ${time}`;
  if (sameDay(d, new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1))) return `yarın ${time}`;
  const year = d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${time}`;
}


/** “<1 dk”, “4 dk”, “1 sa 5 dk”, “3 sa”: how long something took. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return '<1 dk';
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} sa ${rest} dk` : `${hours} sa`;
}
