/**
 * What a notice is about, and whether its reader must act on it now.
 * - decision: the reader decides or does something now. It opens a turn as soon as they are free and wakes a sleeper.
 * - info: for the record only. It rides along on the reader's next turn, or comes in one digest turn at the
 *   constitution's digest hours. It never opens a turn by itself otherwise, never wakes anyone, and waits during the
 *   owner's reserve.
 * When in doubt, decision.
 */
export const NOTICE_TOPICS = {
  'plan.approved': 'decision',
  'plan.declined': 'decision',
  'plan.revision_declined': 'decision',
  'plan.done': 'info',
  /** A plan has no open task left: assess it (planRetro), write the lessons, report, go on (spec §5.4). */
  'plan.retro': 'decision',
  'task.blocked': 'decision',
  /** Still open after the office's reminder: the queue behind it is stuck. */
  'task.stalled': 'decision',
  /** A started (or blocked) task went to someone else: its holder must stop working on it. */
  'task.taken': 'decision',
  /** A task that never started went to someone else. */
  'task.moved': 'info',
  'task.finished': 'info',
  /** A task the requester passed is done while their own task is blocked: they can go on. */
  'task.awaited': 'decision',
  /** Someone was let go; their open tasks wait for a new assignee. */
  'task.orphaned': 'decision',
  'employee.leaving': 'decision',
  'proposal.opened': 'decision',
  'proposal.escalated': 'decision',
  'proposal.rerouted': 'decision',
  'proposal.decided': 'decision',
  'proposal.owner_decided': 'decision',
  /** A purchase went to the owner; the coordinator only hears of it. */
  'proposal.to_owner': 'info',
  /** You are the coordinator now: take over. */
  'role.coordinator': 'decision',
  'role.changed': 'info',
  'reserve.changed': 'decision',
  /** The monthly cap or a plan's budget was exceeded: the coordinator brings it to the owner. */
  'spend.over': 'decision',
  /** Someone hit the pass chain or the daily task limit and was told to leave the work to the coordinator. */
  'limit.chain': 'decision',
  'limit.tasks_per_day': 'decision',
  /** The owner reverted a decision: do what follows from it. */
  'decision.reverted': 'decision',
  /** Your hand-in passed its review. */
  'review.approved': 'info',
  /** A reviewer sent a task back with findings (the coordinator hears). */
  'review.changes': 'info',
  /** A task was sent back for the third time or more: the coordinator changes the approach or brings it to the owner. */
  'review.stuck': 'decision',
  /** Digest off: the daily report reminder as a notice of its own (with the digest on it is a line of the digest). */
  'report.reminder': 'decision',
} as const satisfies Record<string, NoticeKind>;

export type NoticeKind = 'decision' | 'info';
export type NoticeTopic = keyof typeof NOTICE_TOPICS;

export interface Notice {
  id: number;
  kind: NoticeKind;
  /** A topic from NOTICE_TOPICS; '' for notices written before topics existed (they count as decisions). */
  topic: string;
  text: string;
  createdAt: number;
}

/** The latest of these local hours at or before `now` (yesterday's when today's is still ahead); 0 for none. */
export function lastDigestSlot(now: number, hours: readonly number[]): number {
  let latest = 0;
  for (const hour of hours) {
    const d = new Date(now);
    d.setHours(hour, 0, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    latest = Math.max(latest, d.getTime());
  }
  return latest;
}

export const DIGEST_HEADING = '## Ofisten özet';
export const REPORT_LINE = 'Günlük rapor zamanı: son rapordan beri ne bitti, ne sürüyor, ne takıldı, ne harcandı — reportToOwner ile sahibine kısaca raporla.';
const COORDINATOR_HINT =
  'Özet turunda beklenen yalnız kayıt: gerekiyorsa briefUpdate (şirket özeti), employeeNote (çalışan dosyası), rapor zamanıysa reportToOwner; yeni iş açma.';
const MEMBER_HINT = 'Bu özet bilgi içindir; bir şey yapman gerekmiyor.';
/** Lines shown per group; the rest are counted. */
const GROUP_LINES = 8;
const LINE_CHARS = 160;

const GROUPS: Array<{ title: string; topics: readonly string[] }> = [
  { title: 'Teslimler', topics: ['task.finished', 'task.awaited'] },
  { title: 'İncelemeler', topics: ['review.approved', 'review.changes'] },
  { title: 'Plan durumu', topics: ['plan.done'] },
  { title: 'Görevler', topics: ['task.moved'] },
  { title: 'Öneriler', topics: ['proposal.to_owner'] },
  { title: 'Rol/lider değişiklikleri', topics: ['role.changed'] },
];

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const pad = (n: number) => String(n).padStart(2, '0');
const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function span(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to);
  if (from === to) return time(a);
  if (a.toDateString() === b.toDateString()) return `${time(a)}–${time(b)}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]} ${time(a)} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${time(b)}`;
}

function oneLine(text: string): string {
  // Under "Teslimler" the notice's own "Görev bitti:" says nothing new.
  const line = text.replace(/\s+/g, ' ').trim().replace(/^Görev bitti: /, '');
  return line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS - 1)}…` : line;
}

/**
 * The digest the office writes itself (no model): information grouped by topic, its count and time span in the heading.
 * `alone`: the turn is only this digest, so it ends with what such a turn is for (not under a decision or a task).
 */
export function digestText(notices: readonly Notice[], o: { coordinator: boolean; report: boolean; alone: boolean }): string {
  const lines: string[] = [];
  if (notices.length === 0) lines.push(`${DIGEST_HEADING} — yeni not yok`);
  else {
    const times = notices.map((n) => n.createdAt);
    lines.push(`${DIGEST_HEADING} — ${notices.length} not, ${span(Math.min(...times), Math.max(...times))}`);
  }
  const known = new Set(GROUPS.flatMap((g) => g.topics));
  const groups = [...GROUPS, { title: 'Diğer', topics: [] as readonly string[] }];
  for (const g of groups) {
    const items = notices.filter((n) => (g.topics.length ? g.topics.includes(n.topic) : !known.has(n.topic)));
    if (items.length === 0) continue;
    lines.push('', `${g.title} (${items.length}):`, ...items.slice(0, GROUP_LINES).map((n) => `- ${oneLine(n.text)}`));
    if (items.length > GROUP_LINES) lines.push(`- +${items.length - GROUP_LINES} daha`);
  }
  if (o.report) lines.push('', REPORT_LINE);
  if (o.alone) lines.push('', o.coordinator ? COORDINATOR_HINT : MEMBER_HINT);
  return lines.join('\n');
}
