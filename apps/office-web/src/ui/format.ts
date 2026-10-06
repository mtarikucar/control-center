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
