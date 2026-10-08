import type { DatabaseSync } from 'node:sqlite';
import { OWNER, normalizeConstitution, STREAM_TO_HIRE, STUCK_REASONS, reviewTally, type Employee, type GoalChange, type Lifecycle, type OfficeEventType, type OnboardingRound, type Plan, type PlanChange, type PlanStreamView, type Proposal, type StoredEvent, type StreamStatus, type Task, type TaskStatus } from '@cc/shared';
import type { EventStore } from '../event-store.ts';
import type { QuotaTracker } from '../quota.ts';
import type { Roster } from '../roster.ts';
import type { Agenda } from './agenda.ts';
import { UNAVAILABLE } from './availability.ts';
import { constitutionChanges, type Budget } from './budget.ts';
import { PROPOSAL_TR, type Company } from './company.ts';
import type { CompanyStateStore } from './goal-store.ts';
import { officeMetrics } from './office-metrics.ts';
import type { ProposalStore } from './proposal-store.ts';
import { EMPTY_PLAN_GRACE_MS } from './pulse.ts';
import { OPEN_STATUSES, type PlanStore, type TaskStore } from './store.ts';
import { MAX_STREAMS } from './streams.ts';
import { formatStamp, formatWhen } from './time.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** What the board reads: the office's services, never written to. */
export interface BoardDeps {
  /** For the office metrics. */
  db: DatabaseSync;
  events: Pick<EventStore, 'since' | 'lastAt'>;
  roster: Roster;
  company: Company;
  tasks: TaskStore;
  plans: PlanStore;
  state: CompanyStateStore;
  agenda: Pick<Agenda, 'report'>;
  budget: Pick<Budget, 'summary' | 'spending'>;
  /** Proposals (absent in offices without them). */
  proposals?: Pick<ProposalStore, 'list'>;
  /** The office's Claude use (absent: the last day's use is not shown). */
  quota?: Pick<QuotaTracker, 'officeSince'>;
}

export interface BoardOptions {
  /** When the previous cycle started: “Ne değişti” covers what was logged after it (0: the first cycle). */
  since: number;
  now: number;
  /** The previous cycle ended without cycleClose: one warning line at the very top. */
  unclosedWarning?: boolean;
}

export interface Board {
  text: string;
  /** No active goal, or an active goal without a running plan (spec §3.5: the kickoff model). */
  kickoff: boolean;
}

const UNCLOSED = 'UYARI: Önceki tur cycleClose ile kapanmadı. Bu turu cycleClose ile kapat; değişiklik yoksa nedenini yaz (“değişiklik yok, çünkü …”).';
/** No active goal (the pulse's “no goal” notice, management cycle §3.6): `idle` — no open task and no running plan either. */
const noGoal = (idle: boolean) =>
  `Aktif hedef yok${idle ? ' ve açık iş yok' : ''}: şirket özetindeki misyona ve vizyona bakıp sıradaki hedefi aç (goalSet: neden ve ölçülebilir bitti tanımıyla) ve ilk planını hemen başlat (planPropose, goalId ile).`;
const NO_PLAN = 'süren planı yok — planPropose ile goalId vererek başlat ya da goalSet ile kapat';

/**
 * How much each list may show. The board stays short (spec §3.2: 2–4 thousand characters): every list is capped and
 * the rest counted; a board still over BUDGET is drawn again with the next, tighter limits.
 */
interface Limits {
  /** Lines in one list (deliveries, risks, plans waiting for the owner). */
  lines: number;
  /** Short items on one line (names). */
  names: number;
  /** Long items on one line (what someone is at, proposals). */
  details: number;
  /** A plan's streams shown (a plan has at most 12). */
  streams: number;
  /** Comparison lines under one plan. */
  flags: number;
  /** Plans shown with their streams; later ones with their heading only. */
  blocks: number;
  titleChars: number;
  noteChars: number;
  /** The owner's newest messages shown, and how much of each. */
  messages: number;
  messageChars: number;
}
const LIMITS: readonly Limits[] = [
  { lines: 8, names: 8, details: 5, streams: MAX_STREAMS, flags: 8, blocks: 4, titleChars: 48, noteChars: 80, messages: 3, messageChars: 120 },
  { lines: 4, names: 4, details: 3, streams: 4, flags: 3, blocks: 3, titleChars: 32, noteChars: 40, messages: 1, messageChars: 80 },
  { lines: 3, names: 3, details: 2, streams: 3, flags: 2, blocks: 2, titleChars: 24, noteChars: 30, messages: 1, messageChars: 60 },
];
/** Characters a board should stay under (the spec's 4 000, with a little room). */
const BUDGET = 3900;
/** Goal and plan headings in section 2. */
const ENTRIES = 10;
/** What “Ne değişti” reads from the log; over this many, the newest. */
const LOG_LIMIT = 2000;
const CHANGE_TYPES: OfficeEventType[] = ['task.changed', 'plan.changed', 'goal.changed', 'message.user', 'company.paused', 'budget.changed', 'employee.hired', 'employee.fired'];
/**
 * The notice topics whose news the board itself reports (hand-ins and review decisions, due dates passed, a plan done,
 * proposals waiting for the owner): the coordinator does not need them as notes beside it. Any other information
 * (the owner's agenda changes, a task moved, a role) comes with the board as a note.
 */
export const BOARD_COVERS: ReadonlySet<string> = new Set(['task.finished', 'review.approved', 'review.changes', 'task.overdue', 'plan.done', 'proposal.to_owner']);
/** How much of a job title the idle list shows. */
const ROLE_CHARS = 24;
/** A due date this close is a risk. */
const DUE_SOON_MS = DAY;

const PLAN_TR: Record<PlanChange, string> = {
  proposed: 'önerildi', revised: 'revize edildi', approved: 'onaylandı', declined: 'onaylanmadı', done: 'bitti', reopened: 'yeniden açıldı',
  kept: 'revizyonu onaylanmadı, onaylı haliyle sürüyor', stopped: 'sahibince durduruldu',
};
const GOAL_TR: Record<Exclude<GoalChange, 'closed'>, string> = { set: 'açıldı', updated: 'güncellendi', stopped: 'sahibince durduruldu' };
const STREAM_TR: Record<StreamStatus, string> = { planned: 'planlı', active: 'sürüyor', blocked: 'takıldı', done: 'bitti' };
/** Why someone cannot take work now. */
const UNAVAILABLE_TR: Partial<Record<Lifecycle, string>> = { limited: 'limit doldu', error: 'oturum hatası', stopped: 'durduruldu', in_terminal: 'sahibinin terminalinde' };
/** The agenda entry that says why someone holds work they are not at (office metrics' HoldingReason). */
const HOLDING_ENTRY = { review: 'review_wait', parked: 'parked', scheduled: 'not_before', queued: 'queued' } as const;

const running = (p: Plan) => p.status === 'draft' || p.status === 'approved';
const money = (n: number) => `$${(Math.round(n * 100) / 100).toString()}`;
const toHire = (owner: string) => owner.startsWith(`${STREAM_TO_HIRE}:`);

/** One line, at most `max` characters (an ellipsis marks the cut). */
function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

/** At most `max` items; the rest counted as one more: “… ve 12 kişi daha”. */
function cap(items: string[], max: number, noun: string): string[] {
  return items.length <= max ? items : [...items.slice(0, max), `… ve ${items.length - max} ${noun} daha`];
}

/** "45 dk", "2 sa 10 dk", "3 gün" — how long, never negative. */
function span(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MIN));
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)} gün`;
  return `${hours} sa${minutes % 60 ? ` ${minutes % 60} dk` : ''}`;
}

/** "2 000" — thousands apart, as the board writes counts. */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** "1,5" — days with one decimal, Turkish style. */
const days = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',');

/** The streams each stream waits for, all the way back (a plan's streams have no cycle; a broken one is cut). */
function ancestry(streams: readonly PlanStreamView[]): (id: string) => Set<string> {
  const deps = new Map(streams.map((x) => [x.id, x.dependsOn]));
  const memo = new Map<string, Set<string>>();
  const of = (id: string, path: ReadonlySet<string> = new Set()): Set<string> => {
    const known = memo.get(id);
    if (known) return known;
    const all = new Set<string>();
    for (const dep of deps.get(id) ?? []) {
      if (path.has(dep) || dep === id) continue;
      all.add(dep);
      for (const x of of(dep, new Set([...path, id]))) all.add(x);
    }
    memo.set(id, all);
    return all;
  };
  return of;
}

/**
 * The coordinator's management board (spec 2026-10-08-management-cycle-design §3.2): the whole office as one Turkish
 * text in seven sections, always in the same order (an empty one says “yok”), every list capped and the rest counted.
 * Built from the office's services — the agenda, the office metrics, goals, plans, the budget, the event log — it calls
 * no model and writes nothing.
 */
export function buildBoard(d: BoardDeps, o: BoardOptions): Board {
  const now = o.now;
  const people = d.roster.list({ includeArchived: true });
  const byId = new Map(people.map((e) => [e.id, e]));
  const coordinator = people.find((e) => e.kind === 'coordinator' && e.lifecycle !== 'archived') ?? null;
  const team = people.filter((e) => e.lifecycle !== 'archived' && e.kind !== 'coordinator');
  const goals = d.company.goals().filter((g) => g.status === 'active');
  const live = d.plans.list(1000).filter(running).sort((a, b) => a.createdAt - b.createdAt);
  const summary = d.budget.summary();
  const open = d.tasks.list({ statuses: OPEN_STATUSES, limit: 100_000 });
  const openById = new Map(open.map((t) => [t.id, t]));
  const metrics = officeMetrics({ db: d.db, roster: d.roster, tasks: d.tasks, state: d.state }, now);
  const idleSince = new Map(metrics.busy.idle.map((p) => [p.id, p.since]));
  const agendaOf = new Map(d.agenda.report(now).employees.map((a) => [a.id, a]));
  /** The agenda's estimated end of each open task in progress or queued. */
  const ends = new Map<string, number>();
  for (const a of agendaOf.values()) for (const x of a.entries) if (x.taskId && x.until !== null) ends.set(x.taskId, x.until);
  // One more than the cap: a full read says the log was cut.
  const read = d.events.since(o.since, CHANGE_TYPES, LOG_LIMIT + 1);
  const cut = read.length > LOG_LIMIT;
  const log = cut ? read.slice(1) : read;

  const when = (ms: number) => formatWhen(ms, now).replace(/^bugün /, '');
  const ago = (ms: number) => `${span(now - ms)} önce`;
  const nameOf = (id: string) => (id === OWNER ? 'sahibi' : (byId.get(id)?.name ?? id));
  const taskOf = (id: string): Task | null => {
    try {
      return d.tasks.get(id);
    } catch {
      return null;
    }
  };

  /** Hired and never given work: idle since the hire. */
  const neverWorked = (p: { id: string; since: number }) => p.since === byId.get(p.id)?.createdAt;
  const idleMarks = (p: { id: string; since: number }, longIdle: number): string => {
    const marks = [neverWorked(p) && p.since > o.since ? 'yeni' : null, longIdle > 0 && now - p.since >= longIdle ? 'uzun süredir' : null].filter(Boolean);
    return marks.length ? ` (${marks.join(', ')})` : '';
  };

  /** Tasks blocked now that moved into blocked since the last cycle (a note on one already blocked is not a move). */
  const intoBlocked = (): Set<string> => {
    const moved = new Set<string>();
    const last = new Map<string, TaskStatus | null>();
    for (const { event: e } of log) {
      if (e.type !== 'task.changed') continue;
      const id = e.task.id;
      if (e.task.status === 'blocked' && openById.get(id)?.status === 'blocked' && !moved.has(id)) {
        let before = last.get(id);
        if (before === undefined) {
          const prev = d.events.lastAt('task.changed', o.since, { taskId: id });
          before = prev?.event.type === 'task.changed' ? prev.event.task.status : null;
        }
        if (before !== 'blocked') moved.add(id);
      }
      last.set(id, e.task.status);
    }
    return moved;
  };

  const kickoff = goals.length === 0 || goals.some((g) => !live.some((p) => p.goalId === g.id));
  // Each plan's tasks and streams, read once however often the board is drawn.
  const planData = new Map(live.map((p) => [p.id, { tasks: d.tasks.list({ planId: p.id, limit: 100_000 }), streams: d.company.planStreams(p.id) }]));
  const header = `Yönetim panosu · ${formatStamp(now)} · ${o.since > 0 ? `son tur ${when(o.since)} (${ago(o.since)})` : 'ilk tur'}`;

  /** The board drawn with these limits. */
  const render = (L: Limits): string => {
    const title = (x: { title: string }) => `“${clip(x.title, L.titleChars)}”`;

    // ── 1. what changed since the last cycle ──────────────────────────────────

    /** Each task handed in, decided or finished since: its latest state. */
    const deliveries = (): string[] => {
      const last = new Map<string, { task: Task; state: string }>();
      const put = (task: Task, state: string) => {
        last.delete(task.id);
        last.set(task.id, { task, state });
      };
      for (const { event: e } of log) {
        if (e.type !== 'task.changed') continue;
        const t = e.task;
        if (e.change === 'reviewed' && t.kind === 'review' && t.reviewOf) {
          const of = last.get(t.reviewOf)?.task ?? taskOf(t.reviewOf);
          if (!of) continue;
          const outcome = t.result?.review;
          const tally = outcome ? reviewTally(outcome.findings) : '';
          put(of, outcome?.decision === 'changes' ? `değişiklik istendi (${nameOf(t.assignee)}${tally ? `: ${tally}` : ''})` : `onaylandı (${nameOf(t.assignee)})`);
        } else if (t.kind !== 'review' && e.change === 'in_review') put(t, `incelemede (${t.reviewer ? nameOf(t.reviewer) : 'inceleyici'})`);
        else if (t.kind !== 'review' && e.change === 'finished') {
          const before = last.get(t.id)?.state;
          put(t, before?.startsWith('onaylandı') ? before : 'bitti');
        }
      }
      return cap([...last.values()].map(({ task, state }) => `Teslim: ${title(task)} — ${nameOf(task.assignee)} → ${state}`), L.lines, 'teslim').map((l) => `- ${l}`);
    };

    /** Open work that got stuck since: blocked in the window, past its due date in it, or reminded in it and not at it. */
    const newStalls = (): string[] => {
      const blocked = intoBlocked();
      const items = metrics.stuck.items.flatMap((s) => {
        const t = openById.get(s.taskId);
        if (!t) return [];
        if (s.reason === 'blocked' && blocked.has(t.id)) return [`${title(t)} (${s.assignee}, takıldı${t.note ? `: ${clip(t.note, L.noteChars)}` : ''})`];
        if (s.reason === 'overdue' && (t.dueAt ?? 0) > o.since) return [`${title(t)} (${s.assignee}, son tarih geçti ${when(t.dueAt!)})`];
        if (s.reason === 'stalled' && (t.nudgedAt ?? 0) > o.since) return [`${title(t)} (${s.assignee}, hatırlatmaya rağmen ilerlemiyor)`];
        return [];
      });
      return items.length ? [`- Yeni takılmalar: ${cap(items, L.details, 'iş').join('; ')}`] : [];
    };

    const newlyIdle = (): string[] => {
      const names = metrics.busy.idle.filter((p) => p.since > o.since && !neverWorked(p)).map((p) => p.name);
      return names.length ? [`- Boşa çıktı: ${cap(names, L.names, 'kişi').join(', ')}`] : [];
    };

    const teamChanges = (): string[] => {
      const items = log.flatMap(({ event: e, employeeId }) =>
        e.type === 'employee.hired' ? [`${e.name} işe alındı`] : e.type === 'employee.fired' && employeeId ? [`${nameOf(employeeId)} ayrıldı`] : [],
      );
      return items.length ? [`- Ekip: ${cap(items, L.names, 'değişiklik').join('; ')}`] : [];
    };

    /** The net change since the last cycle: the constitution against its last snapshot before it, the owner's share, a pause. */
    const constraints = (): string[] => {
      const items: string[] = [];
      if (log.some(({ event: e }) => e.type === 'budget.changed')) {
        const base = d.events.lastAt('budget.changed', o.since);
        const was = base?.event.type === 'budget.changed' ? base.event.budget : null;
        // The snapshot may be an older office's: read as today's constitution, or its old keys look like a change.
        items.push(...constitutionChanges(normalizeConstitution(was?.constitution), summary.constitution));
        if ((was?.reserve.active ?? false) !== summary.reserve.active) items.push(summary.reserve.active ? 'sahibinin kota payı devreye girdi' : 'sahibinin kota payı serbest kaldı');
      }
      if (log.some(({ event: e }) => e.type === 'company.paused')) {
        const base = d.events.lastAt('company.paused', o.since);
        const was = base?.event.type === 'company.paused' ? base.event.paused : false;
        const is = d.company.paused();
        if (was !== is) items.push(is ? 'sahibi şirketi duraklattı' : 'sahibi şirketi sürdürdü');
      }
      return items.length ? [`- Kısıt: ${items.join('; ')}`] : [];
    };

    const planMoves = (): string[] => {
      const last = new Map<string, string>();
      const put = (key: string, text: string) => {
        last.delete(key);
        last.set(key, text);
      };
      // The goal whose closing the plan changes right after it come from: the coordinator's goalSet closes the goal's
      // plans in the same call, so a plan stopped there went with its goal, not by the owner's hand.
      let closing: string | null = null;
      for (const { event: e } of log) {
        if (e.type === 'plan.changed') {
          const withGoal = e.change === 'stopped' && closing !== null && e.plan.goalId === closing;
          put(`plan:${e.plan.id}`, `${title(e.plan)} planı ${withGoal ? 'hedefiyle durdu' : PLAN_TR[e.change]}`);
          if (e.plan.goalId !== closing) closing = null;
          continue;
        }
        closing = e.type === 'goal.changed' && e.change === 'closed' ? e.goal.id : null;
        if (e.type === 'goal.changed') put(`goal:${e.goal.id}`, `${title(e.goal)} hedefi ${e.change === 'closed' ? (e.goal.status === 'done' ? 'tamamlandı' : 'bırakıldı') : GOAL_TR[e.change]}`);
      }
      return last.size ? [`- Plan ve hedef: ${cap([...last.values()], L.names, 'değişiklik').join('; ')}`] : [];
    };

    const ownerMessages = (): string[] => {
      const said = log.filter((x): x is StoredEvent & { event: { type: 'message.user'; text: string } } => x.event.type === 'message.user' && x.event.source === 'owner' && coordinator !== null && x.employeeId === coordinator.id);
      if (said.length === 0) return [];
      const shown = said.slice(-L.messages).map((x) => `${when(x.ts)} “${clip(x.event.text, L.messageChars)}”`).join('; ');
      return [said.length === 1 ? `- Sahibinin mesajı: ${shown}` : `- Sahibinin mesajları (${said.length}${said.length > L.messages ? `, son ${L.messages}` : ''}): ${shown}`];
    };

    const streamsDone = (): string[] => {
      const items = live.flatMap((p) => {
        const { tasks, streams } = planData.get(p.id)!;
        // Done, and its last task closed since the last cycle: said once.
        return streams.filter((x) => x.status === 'done' && Math.max(0, ...tasks.filter((t) => t.streamId === x.id).map((t) => t.finishedAt ?? 0)) > o.since).map((x) => `${x.id} (plan ${title(p)})`);
      });
      return items.length ? [`- Akış bitti: ${cap(items, L.names, 'akış').join('; ')}`] : [];
    };

    const changed = (): string[] => [...(cut ? [`- (günlüğün yalnız son ${thousands(LOG_LIMIT)} olayı okundu)`] : []), ...deliveries(), ...streamsDone(), ...newStalls(), ...newlyIdle(), ...teamChanges(), ...constraints(), ...planMoves(), ...ownerMessages()];

    // ── 2. goals and plans ────────────────────────────────────────────────────

    const planState = (p: Plan) => (p.status === 'draft' ? 'sahibinin onayında' : 'sürüyor');

    /** Work tasks (reviews and cancelled ones left out): done of all. */
    const work = (tasks: readonly Task[]): string => {
      const counted = tasks.filter((t) => t.kind !== 'review' && t.status !== 'cancelled');
      return counted.length ? `${counted.filter((t) => t.status === 'done').length}/${counted.length} iş` : 'görevi yok';
    };

    /**
     * Where the plan's structure and the office disagree (spec §3.4), the most actionable first so a cap keeps them: an
     * approved plan that never got a task, a stream with no usable owner (to hire, let go, cannot take work), then one
     * whose owner is idle, then the next stream's missing tasks and a plan whose streams are all done, then streams
     * piled on one person.
     */
    const comparisons = (p: Plan, streams: readonly PlanStreamView[], tasks: readonly Task[]): string[] => {
      const flags: Array<{ rank: number; text: string }> = [];
      // Approved and never a single task after the grace: the plan stalled (the pulse's “goal idle”, §3.6).
      const approvedAt = p.approvedAt ?? p.updatedAt;
      if (p.status === 'approved' && tasks.length === 0 && now - approvedAt >= EMPTY_PLAN_GRACE_MS) {
        flags.push({ rank: 0, text: `onaylı ama hiç görevi açılmadı (onay ${ago(approvedAt)}) — görevlerini taskCreate ile aç ya da yerine yeni plan öner` });
      }
      const status = new Map(streams.map((x) => [x.id, x.status]));
      const hasWork = (id: string) => tasks.some((t) => t.streamId === id && t.kind !== 'review' && t.status !== 'cancelled');
      for (const x of streams) {
        if (x.status === 'done') continue;
        const owner = toHire(x.owner) ? undefined : byId.get(x.owner);
        // Why no one can carry it: as a flag, and short for inside a line.
        const lacking: [string, string] | null = toHire(x.owner)
          ? [`sahibi yok (${x.owner})`, `sahibi yok, ${x.owner}`]
          : !owner
            ? [`sahibi bulunamadı (${x.owner})`, 'sahibi bulunamadı']
            : owner.lifecycle === 'archived'
              ? [`sahibi ${owner.name} işten ayrıldı`, `sahibi ${owner.name} ayrıldı`]
              : UNAVAILABLE.includes(owner.lifecycle)
                ? [`sahibi ${owner.name} iş alamıyor (${UNAVAILABLE_TR[owner.lifecycle] ?? owner.lifecycle})`, `sahibi ${owner.name} iş alamıyor`]
                : null;
        const idle = owner && !lacking && idleSince.has(owner.id) ? span(now - idleSince.get(owner.id)!) : null;
        const ready = p.status === 'approved' && x.status === 'planned' && x.dependsOn.every((dep) => status.get(dep) === 'done');
        if (ready && x.dependsOn.length > 0 && !hasWork(x.id)) {
          const who = lacking ? lacking[1] : idle ? `sahibi ${owner!.name} boşta, ${idle}` : `sahibi ${owner!.name}`;
          flags.push({ rank: lacking ? 0 : idle ? 1 : 2, text: `${x.id}: önündeki ${x.dependsOn.join(', ')} bitti, görevi yok (${who}) — görev aç ya da akışı kaldır` });
        } else if (lacking) flags.push({ rank: 0, text: `${x.id}: ${lacking[0]}` });
        else if (idle && (x.status === 'active' || x.status === 'blocked')) flags.push({ rank: 1, text: `${x.id}: sahibi ${owner!.name} boşta (${idle})` });
        else if (idle && ready) flags.push({ rank: 1, text: `${x.id}: başlayabilir, sahibi ${owner!.name} boşta (${idle})` });
      }
      if (streams.length > 0 && streams.every((x) => x.status === 'done')) {
        const left = tasks.filter((t) => OPEN_STATUSES.includes(t.status)).length;
        flags.push({ rank: 2, text: `bütün akışlar bitti, plan sürüyor — ${left ? `${left} açık iş akışsız` : 'açık rutin var'}` });
      }
      const ancestors = ancestry(streams);
      const byOwner = new Map<string, PlanStreamView[]>();
      for (const x of streams) if (x.status !== 'done' && byId.has(x.owner)) byOwner.set(x.owner, [...(byOwner.get(x.owner) ?? []), x]);
      for (const [owner, own] of byOwner) {
        if (own.length < 2) continue;
        const linked = own.filter((a) => own.some((b) => a !== b && (ancestors(a.id).has(b.id) || ancestors(b.id).has(a.id))));
        // More ancestors comes later: a topological order of the linked ones.
        const order = [...linked].sort((a, b) => ancestors(a.id).size - ancestors(b.id).size);
        const how = linked.length ? `bağımlı: ${order.map((x) => x.id).join(' → ')}` : 'paralel yürüyemez';
        flags.push({ rank: 3, text: `tek kişide ${own.length} açık akış (${nameOf(owner)}): ${own.map((x) => x.id).join(', ')} — ${how}` });
      }
      // A stable sort: the plan's own order within a rank.
      return flags.sort((a, b) => a.rank - b.rank).map((f) => f.text);
    };

    /** A plan's heading (after `lead`), then — when `detail` — its streams and the comparisons. */
    const planBlock = (lead: string, p: Plan, detail: boolean): string[] => {
      const { tasks, streams } = planData.get(p.id)!;
      const done = work(tasks);
      const lines = [`- ${lead} ${title(p)} (${planState(p)}; ${done}${done === 'görevi yok' ? '' : ' bitti'})`];
      if (!detail) return lines;
      const owner = (who: string) => (toHire(who) ? who : nameOf(who));
      const streamLines = streams.map((x) => `${x.id} (${owner(x.owner)}): ${STREAM_TR[x.status]}, ${work(tasks.filter((t) => t.streamId === x.id))}${x.dependsOn.length ? `, önce ${x.dependsOn.join(', ')}` : ''}`);
      lines.push(...cap(streamLines, L.streams, 'akış').map((l) => `  · ${l}`));
      lines.push(...cap(comparisons(p, streams, tasks), L.flags, 'uyarı').map((l) => `  ! ${l}`));
      return lines;
    };

    /** No active goal: whether any work is open, and the coordinator's rest (restUntil) while it lasts. */
    const noGoalLine = (): string => {
      const idle = open.length === 0 && live.length === 0;
      const until = d.state.restUntil();
      if (until <= now) return noGoal(idle);
      const why = d.state.get('restReason');
      return `Aktif hedef yok${idle ? ' ve açık iş yok' : ''}; dinlenme kararın sürüyor (bitiş ${when(until)})${why ? `: “${clip(why, L.noteChars)}”` : ''}. Değerli bir iş çıkarsa hedefi aç (goalSet); yeni hedef dinlenmeyi bitirir.`;
    };

    const goalsAndPlans = (): string[] => {
      const entries: Array<{ plan: Plan | null; lead: string }> = [];
      for (const g of goals) {
        const own = live.filter((p) => p.goalId === g.id);
        if (own.length === 0) entries.push({ plan: null, lead: `Hedef ${title(g)}: ${NO_PLAN}` });
        for (const p of own) entries.push({ plan: p, lead: `Hedef ${title(g)} → plan` });
      }
      for (const p of live.filter((x) => !x.goalId || !goals.some((g) => g.id === x.goalId))) entries.push({ plan: p, lead: 'Hedefsiz plan' });
      const lines = goals.length === 0 ? [`- ${noGoalLine()}`] : [];
      let blocks = 0;
      for (const { plan, lead } of entries.slice(0, ENTRIES)) {
        if (!plan) lines.push(`- ${lead}`);
        else lines.push(...planBlock(lead, plan, (blocks += 1) <= L.blocks));
      }
      if (entries.length > ENTRIES) lines.push(`- … ve ${entries.length - ENTRIES} hedef ya da plan daha (goalsRead)`);
      return lines;
    };

    // ── 3. people ─────────────────────────────────────────────────────────────

    const atWork = (id: string): string => {
      const entries = agendaOf.get(id)?.entries ?? [];
      const queued = entries.filter((x) => x.kind === 'queued');
      const doing = entries
        .filter((x) => x.kind === 'now')
        .map((x) => `“${clip(x.title, L.titleChars)}” ${x.at === null ? '' : `${when(x.at)} → `}~${when(x.until ?? now)}${x.note ? ` (${x.note.split(' · ').join(', ')})` : ''}`)
        .join(' + ');
      const last = queued.at(-1)?.until;
      return `${nameOf(id)} — ${doing || 'iş başında'}${queued.length ? `, sırada ${queued.length}${last ? ` → ~${when(last)}` : ''}` : ''}`;
    };

    const holding = (id: string, why: keyof typeof HOLDING_ENTRY): string => {
      const x = (agendaOf.get(id)?.entries ?? []).find((e) => e.kind === HOLDING_ENTRY[why]);
      const what = x ? `“${clip(x.title, L.titleChars)}”` : 'iş';
      if (why === 'review') {
        const t = x?.taskId ? openById.get(x.taskId) : undefined;
        const reviewer = open.find((r) => r.kind === 'review' && r.reviewOf === t?.id)?.assignee ?? t?.reviewer;
        return `${nameOf(id)} — ${what} incelemede${reviewer ? ` (${nameOf(reviewer)})` : ''}`;
      }
      if (why === 'parked') return `${nameOf(id)} — ${what} ertelendi${x?.at ? `, dönüş ${when(x.at)}` : ''}`;
      if (why === 'scheduled') return `${nameOf(id)} — ${what} başlangıç ${x?.at ? when(x.at) : '—'}`;
      // The agenda's note names the task it waits for: “X” bitince.
      const note = x?.note?.replace(/“([^”]*)”/g, (_, t: string) => `“${clip(t, L.titleChars)}”`);
      return `${nameOf(id)} — sırada ${what}${note ? ` (${note})` : ''}`;
    };

    const unavailable = (e: Employee): string => {
      const why = e.lifecycle === 'limited' && e.limitResetsAt ? `limit doldu, açılış ${when(e.limitResetsAt)}` : (UNAVAILABLE_TR[e.lifecycle] ?? e.lifecycle);
      const held = open.filter((t) => t.assignee === e.id).length;
      return `${e.name} — ${why}${held ? `, elinde ${held} iş` : ''}`;
    };

    const staffTitle = (): string => {
      const b = metrics.busy;
      return team.length === 0 ? 'İnsanlar' : `İnsanlar (${b.total} kişi: ${b.atWork.length} işte, ${b.holding.length} elinde iş, ${b.idle.length} boşta, ${b.unavailable.length} iş alamıyor)`;
    };

    const staff = (): string[] => {
      if (team.length === 0) return ['- yok: ekipte koordinatörden başka kimse yok'];
      const b = metrics.busy;
      const longIdle = summary.constitution.idleCapacityHours * HOUR;
      const group = (label: string, items: string[], max: number) => (items.length ? [`- ${label} (${items.length}): ${cap(items, max, 'kişi').join('; ')}`] : []);
      return [
        ...group('Boşta', b.idle.map((p) => `${p.name}${p.title ? ` (${clip(p.title, ROLE_CHARS)})` : ''} — ${span(now - p.since)}${idleMarks(p, longIdle)}`), L.names),
        ...group('İş alamıyor', b.unavailable.map((p) => unavailable(byId.get(p.id)!)), L.names),
        ...group('Elinde iş, başında değil', b.holding.map((p) => holding(p.id, p.why)), L.details),
        ...group('İşte', b.atWork.map((p) => atWork(p.id)), L.details),
      ];
    };

    // ── 4. chains and the critical path ───────────────────────────────────────

    const chains = (): string[] => {
      /** Its dependencies still open. */
      const deps = (t: Task) => t.dependsOn.filter((id) => id !== t.id && openById.has(id));
      const awaited = new Set(open.flatMap(deps));
      const chained = open.filter((t) => deps(t).length > 0 || awaited.has(t.id));
      if (chained.length === 0) return [];
      const waiting = chained.filter((t) => deps(t).length > 0).length;
      // The longest run of open tasks ending at each, itself included; a ring counts each of its tasks once.
      const depth = new Map<string, number>();
      const visiting = new Set<string>();
      const depthOf = (t: Task): number => {
        const known = depth.get(t.id);
        if (known !== undefined) return known;
        if (visiting.has(t.id)) return 0;
        visiting.add(t.id);
        const below = Math.max(0, ...deps(t).map((id) => depthOf(openById.get(id)!)));
        visiting.delete(t.id);
        depth.set(t.id, below + 1);
        return below + 1;
      };
      const end = (t: Task) => ends.get(t.id) ?? Number.NEGATIVE_INFINITY;
      const deepest = (ts: Task[]) => [...ts].sort((a, b) => depthOf(b) - depthOf(a) || end(b) - end(a))[0];
      const before = (t: Task) => deepest(deps(t).map((id) => openById.get(id)!));
      const path = [deepest(chained)!];
      for (let next = before(path[0]!); next && !path.includes(next); next = before(next)) path.unshift(next);
      const per = new Map<string, number>();
      for (const t of chained) per.set(t.assignee, (per.get(t.assignee) ?? 0) + 1);
      const who = [...per].sort((a, b) => b[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(b[0]), 'tr', { numeric: true })).map(([id, n]) => `${nameOf(id)} (${n})`);
      const step = (t: Task) => `${title(t)} (${nameOf(t.assignee)})`;
      const shown = path.length > 5 ? [...path.slice(0, 2).map(step), `… ${path.length - 4} iş …`, ...path.slice(-2).map(step)] : path.map(step);
      const last = ends.get(path.at(-1)!.id);
      const lines = [`- Zincirli açık iş: ${chained.length} (bağımlılık bekleyen ${waiting})`, `- Kimde: ${cap(who, L.names, 'kişi').join(', ')}`];
      if (path.length > 1) lines.push(`- En uzun yol (${path.length} iş${last !== undefined ? `, tahmini bitiş ~${when(last)}` : ''}): ${shown.join(' → ')}`);
      return lines;
    };

    // ── 5. risks ──────────────────────────────────────────────────────────────

    const risks = (): string[] => {
      const seen = new Set<string>();
      const items: Array<{ kind: string; text: string }> = [];
      // The metrics' order of reasons (blocked, overdue, stalled); within one, the longest late or reminded first.
      const stuck = metrics.stuck.items.map((s, i) => ({ s, i, t: openById.get(s.taskId) }));
      const at = (x: (typeof stuck)[number]) => (x.s.reason === 'overdue' ? (x.t?.dueAt ?? 0) : x.s.reason === 'stalled' ? (x.t?.nudgedAt ?? 0) : x.i);
      stuck.sort((a, b) => STUCK_REASONS.indexOf(a.s.reason) - STUCK_REASONS.indexOf(b.s.reason) || at(a) - at(b));
      for (const { s, t } of stuck) {
        if (!t) continue;
        seen.add(t.id);
        if (s.reason === 'blocked') items.push({ kind: 'takılı', text: `Takıldı: ${title(t)} (${s.assignee})${t.note ? `: ${clip(t.note, L.noteChars)}` : ''}` });
        else if (s.reason === 'overdue') items.push({ kind: 'gecikmiş', text: `Son tarihi geçti: ${title(t)} (${s.assignee}), ${when(t.dueAt!)}` });
        else items.push({ kind: 'ilerlemeyen', text: `Hatırlatmaya rağmen ilerlemiyor: ${title(t)} (${s.assignee})${t.nudgedAt ? `, hatırlatma ${when(t.nudgedAt)}` : ''}` });
      }
      const soon = open.filter((t) => !seen.has(t.id) && t.dueAt != null && t.dueAt > now && t.dueAt <= now + DUE_SOON_MS).sort((a, b) => a.dueAt! - b.dueAt!);
      for (const t of soon) {
        seen.add(t.id);
        const until = ends.get(t.id);
        const late = until !== undefined && until > t.dueAt! ? ` — tahmini bitiş ~${when(until)}, yetişmiyor` : '';
        items.push({ kind: 'yaklaşan', text: `Son tarih yaklaşıyor: ${title(t)} (${nameOf(t.assignee)}), ${when(t.dueAt!)}${late}` });
      }
      for (const t of open.filter((x) => !seen.has(x.id) && x.status === 'review')) {
        const review = open.find((r) => r.kind === 'review' && r.reviewOf === t.id);
        const reviewer = review?.assignee ?? t.reviewer;
        items.push({ kind: 'incelemede', text: `İncelemede: ${title(t)} (${nameOf(t.assignee)} → ${reviewer ? nameOf(reviewer) : 'inceleyici'})${review ? `, ${span(now - review.createdAt)}` : ''}` });
      }
      const shown = items.slice(0, L.lines).map((i) => `- ${i.text}`);
      const hidden = items.slice(L.lines);
      if (hidden.length === 0) return shown;
      const kinds = [...new Set(hidden.map((h) => h.kind))].map((k) => `${hidden.filter((h) => h.kind === k).length} ${k}`);
      return [...shown, `- … ve ${hidden.length} risk daha: ${kinds.join(', ')}`];
    };

    // ── 6. resources ──────────────────────────────────────────────────────────

    const resources = (): string[] => {
      const r = summary.reserve;
      const c = summary.constitution;
      const pct = (p: number | null) => (p === null ? '—' : `%${p}`);
      const quota = r.fiveHourPct === null && r.sevenDayPct === null ? 'henüz okunmadı' : `5 saat ${pct(r.fiveHourPct)}, 7 gün ${pct(r.sevenDayPct)}`;
      const lines = [`- Kota: ${quota}; ofisin sınırı %${r.limitPct} (sahibinin payı %${c.ownerReservePct})${r.active ? '; PAY DEVREDE: yalnız öncelik 1 işler başlıyor' : ''}`];
      const used = d.quota?.officeSince(now - DAY);
      const spent = d.budget.spending().filter((s) => s.ts >= now - DAY).reduce((n, s) => n + s.usd, 0);
      const claude = used ? `Claude ~${money(used.costUsd)} (${used.turns} tur); ` : '';
      lines.push(`- Son 24 saat: ${claude}kayıtlı harcama ${money(spent)}; bu ay ${money(summary.month.usd)}${c.monthlyUsdCap !== null ? ` / sınır ${money(c.monthlyUsdCap)}` : ''}`);
      // Running plans with an estimate or some use, against it.
      const use = (p: Plan) => summary.plans[p.id] ?? { spentUsd: 0, claudeUsd: 0 };
      const worth = live.filter((p) => p.status === 'approved' && (p.usd !== null || p.days !== null || p.quotaPct !== null || use(p).spentUsd > 0 || use(p).claudeUsd > 0));
      const planLine = (p: Plan): string => {
        const b = use(p);
        const elapsed = (now - (p.approvedAt ?? p.createdAt)) / DAY;
        const usd = `harcama ${money(b.spentUsd)}${p.usd !== null ? ` / tahmin ${money(p.usd)}${b.spentUsd > p.usd ? ' (aşıldı)' : ''}` : ''}`;
        const time = p.days !== null ? `${days(elapsed)} / ${days(p.days)} gün${elapsed > p.days ? ' (aşıldı)' : ''}` : `${days(elapsed)} gün`;
        return `Plan ${title(p)}: Claude ~${money(b.claudeUsd)}; ${usd}; ${time}${p.quotaPct !== null ? `; tahmini kota %${p.quotaPct}` : ''}`;
      };
      lines.push(...cap(worth.map(planLine), L.details, 'plan').map((l) => `- ${l}`));
      return lines;
    };

    // ── 7. open decisions ─────────────────────────────────────────────────────

    const decisions = (): string[] => {
      const lines: string[] = [];
      const drafts = live.filter((x) => x.status === 'draft').sort((a, b) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt);
      const draftLines = drafts.map((p) => `Sahibinin onayında: plan ${title(p)}${p.version > 1 ? ' revizyonu' : ''} (sürüm ${p.version}, ${ago(p.updatedAt)})`);
      lines.push(...cap(draftLines, L.lines, 'plan').map((l) => `- ${l}`));
      const proposal = (p: Proposal) => `${PROPOSAL_TR[p.kind]} ${title(p)} (${p.usd !== null ? `${money(p.usd)}, ` : ''}${nameOf(p.by)}, ${ago(p.ts)})`;
      // Oldest first (proposals.list is newest first).
      const owner = [...(d.proposals?.list({ statuses: ['owner'] }) ?? [])].reverse();
      const mine = [...(d.proposals?.list({ statuses: ['open'] }) ?? [])].reverse().filter((p) => p.routedTo === null || p.routedTo === coordinator?.id);
      if (owner.length) lines.push(`- Sahibinde (${owner.length}): ${cap(owner.map(proposal), L.details, 'öneri').join('; ')}`);
      if (mine.length) lines.push(`- Sende (${mine.length}): ${cap(mine.map(proposal), L.details, 'öneri').join('; ')}`);
      let asked: OnboardingRound | undefined;
      try {
        const view = d.company.onboarding();
        if (view.onboarding?.status === 'active') asked = view.onboarding.rounds.at(-1);
      } catch {
        // An office without a profile or an onboarding store has nothing to ask.
      }
      if (asked && !asked.replied) lines.push(`- Onboarding: sahibine ${asked.questions.length} soru soruldu (${when(asked.askedAt)}), cevap bekleniyor`);
      return lines;
    };

    const sections: Array<[string, string[]]> = [
      ['Ne değişti (son turdan beri)', changed()],
      ['Hedefler ve planlar', goalsAndPlans()],
      [staffTitle(), staff()],
      ['Zincirler ve kritik yol', chains()],
      ['Riskler', risks()],
      ['Kaynak', resources()],
      ['Açık kararlar', decisions()],
    ];
    const blocks = [header, ...sections.map(([heading, body], i) => `## ${i + 1}. ${heading}\n${body.length ? body.join('\n') : '- yok'}`)];
    return (o.unclosedWarning ? [UNCLOSED, ...blocks] : blocks).join('\n\n');
  };

  let text = '';
  for (const limits of LIMITS) {
    text = render(limits);
    if (text.length <= BUDGET) break;
  }
  return { text, kickoff };
}
