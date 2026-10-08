import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type CycleTriggerKind, type EmployeeKind, type Lifecycle, type ModelAlias, type OfficeEvent } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { buildBoard } from '../src/company/board.ts';
import { Clock } from '../src/company/clock.ts';
import { CYCLE_WINDOW_MS, HEARTBEAT_MS, ManagementCycle } from '../src/company/cycle.ts';
import { Dispatcher, NOTICES_PREFIX, RENUDGE_MS, type DispatchEngine } from '../src/company/dispatcher.ts';
import { Pulse } from '../src/company/pulse.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

/*
 * Management cycle §3.1, §3.3, §3.6 (the board's delivery) and §5 (a restart): when the office opens a cycle, how the
 * dispatcher delivers it, and how cycleClose closes it. Driven by the test, so it is exact under any load: one simulated
 * clock for everything, the office clock's timer never fires on its own (the test runs it as time passes, every 30 s
 * like the real one would), the dispatcher's deferred work runs in `settle`, and the engine only records what it is
 * given — a turn lasts until the test ends it. People are put straight on the roster (no sessions).
 */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const T0 = new Date(2026, 9, 8, 9, 0).getTime();
const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
const NO_CHANGE = 'değişiklik yok, çünkü iş planda yürüyor';

type Started = Extract<OfficeEvent, { type: 'management.cycle.started' }>;
type CycleRecord = Extract<OfficeEvent, { type: 'management.cycle' }>;

function make(o: { autonomy?: 'free' | 'plans'; coordinator?: boolean; boardFails?: boolean; pulse?: boolean } = {}) {
  let clock = T0;
  const now = () => clock;
  const s = setup(12, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  c.budget.setConstitution({ idleSleepMinutes: 0, autonomy: o.autonomy ?? 'free' });
  const person = (name: string, p: { kind?: EmployeeKind; team?: string; title?: string } = {}) => {
    const e = s.roster.create({ name, role: 'r', title: p.title ?? '', kind: p.kind, team: p.team });
    return s.roster.update(e.id, { lifecycle: 'idle' });
  };
  const coord = o.coordinator === false ? null : person('Koordinatör', { kind: 'coordinator' });

  const deferred: Array<() => void> = [];
  /** Runs the dispatcher's deferred work until none is left. */
  const settle = () => {
    for (let round = 0; deferred.length > 0; round += 1) {
      if (round > 200) throw new Error('the office never came to rest');
      for (const fn of deferred.splice(0)) fn();
    }
  };

  // The engine: a send opens a turn (logged as the real one logs it), the test ends it.
  const inTurn = new Set<string>();
  const sent: Array<{ id: string; text: string; model?: string; role?: boolean; onLost?: () => void }> = [];
  /** The model the engine says a message runs on (none: the fake says nothing, as the tests' engines do). */
  const runsOn: { model?: ModelAlias } = {};
  const woken: string[] = [];
  const setLifecycle = (id: string, to: Lifecycle) => {
    const from = s.roster.get(id).lifecycle;
    if (from === to) return;
    s.roster.update(id, { lifecycle: to });
    s.events.append(id, { type: 'lifecycle.changed', from, to, reason: 'test' });
  };
  const engine: DispatchEngine = {
    ready: (id) => !inTurn.has(id) && s.roster.get(id).lifecycle === 'idle',
    send: (id, text, _source, opts) => {
      sent.push({ id, text, model: opts?.model, role: opts?.role, onLost: opts?.onLost });
      inTurn.add(id);
      s.events.append(id, { type: 'message.user', text, source: 'system' });
      s.events.append(id, { type: 'turn.started' });
      setLifecycle(id, 'working');
      return runsOn.model;
    },
    fire: async () => undefined,
    sleep: async () => undefined,
    // A sleeper's session starts again: idle.
    wake: (id) => {
      woken.push(id);
      setLifecycle(id, 'idle');
    },
  };
  /** One of claude's results (more may be queued, or the engine may go on: a quota pause, a model retry). */
  const result = (id: string, costUsd: number, o: { ok?: boolean; queuedTurns?: number } = {}) =>
    void s.events.append(id, { type: 'turn.finished', ok: o.ok ?? true, subtype: o.ok === false ? 'error_during_execution' : 'success', usage: ZERO, costUsd, numTurns: 1, queuedTurns: o.queuedTurns ?? 0, sessionUsage: null, sessionCostUsd: 0 });
  /** The turn ends as the engine logs it: claude's result, then idle. */
  const endTurn = (id: string, costUsd = 0.3) => {
    s.events.append(id, { type: 'turn.finished', ok: true, subtype: 'success', usage: ZERO, costUsd, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 });
    inTurn.delete(id);
    setLifecycle(id, 'idle');
    settle();
  };

  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget, now });
  const quota = new QuotaTracker(s.db, s.events, now);
  const boardDeps = { db: s.db, events: s.events, roster: s.roster, company: c.company, tasks: c.tasks, plans: c.plans, state: c.state, agenda, budget: c.budget, proposals: c.proposals, quota };

  let office: { cycle: ManagementCycle; clock: Clock; tools: McpTool[]; stop: () => void } | null = null;
  /** The office starts: the cycle service, the dispatcher and the clock, wired as in main.ts. */
  const boot = () => {
    const officeClock = new Clock({ scheduling: c.freshScheduling(), state: c.state, events: s.events, now, timers: { set: () => 0, clear: () => undefined } });
    const cycle = new ManagementCycle({ events: s.events, state: c.state, company: c.company, roster: s.roster, tasks: c.tasks, budget: c.budget, clock: officeClock, now, board: (bo) => {
        if (o.boardFails) throw new Error('disk dolu');
        return buildBoard(boardDeps, bo);
      } });
    const dispatcher = new Dispatcher({
      events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine, budget: c.budget, now,
      defer: (fn) => void deferred.push(fn), clock: officeClock, cycle,
      // As main.ts wires it: the pulse beside the cycle.
      pulse: o.pulse ? new Pulse({ company: c.company, roster: s.roster, goals: c.goals, state: c.state, plans: c.plans, tasks: c.tasks, notices: c.notices, budget: c.budget, now }) : undefined,
    });
    const tools = officeTools({
      company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, plans: () => c.plans.list(), agenda, cycle,
      engine: { sleep: async () => undefined, wake: () => undefined, sideQuestion: async () => ({ ok: true, answer: '' }) },
    });
    const stops = [cycle.start(), dispatcher.start(), officeClock.start()];
    office = { cycle, clock: officeClock, tools, stop: () => stops.reverse().forEach((stop) => stop()) };
    cleanups.push(() => office?.stop());
    settle();
  };
  /** The office stops (its services let go of the log) and starts again on the same database. */
  const restart = (between?: () => void) => {
    office?.stop();
    between?.();
    boot();
  };
  /** Time passes; the office clock runs every 30 s, as its jobs would (or every `step`, for a long stretch). */
  const advance = (ms: number, step = 30 * SEC) => {
    const end = clock + ms;
    while (clock < end) {
      clock = Math.min(end, clock + step);
      office!.clock.runNow();
      settle();
    }
  };
  /** Someone calls an office tool, as through MCP. */
  const call = async (who: { id: string }, name: string, args: { [key: string]: unknown } = {}) => {
    const tool = office!.tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const out = await tool.run({ employee: s.roster.get(who.id) }, args);
    settle();
    return out;
  };

  const log = () => s.events.list({ limit: 5000 });
  const started = () => log().flatMap((e) => (e.event.type === 'management.cycle.started' ? [e.event as Started] : []));
  const records = () => log().flatMap((e) => (e.event.type === 'management.cycle' ? [e.event as CycleRecord] : []));
  const kinds = (i: number): CycleTriggerKind[] => started()[i]?.triggers.map((t) => t.kind) ?? [];
  const toCoordinator = () => sent.filter((m) => m.id === coord?.id);
  const boards = () => toCoordinator().filter((m) => m.text.includes('Yönetim panosu'));
  /** Closes the open cycle as the coordinator would and ends its turn. */
  const closeCycle = async (reasoning = NO_CHANGE) => {
    await call(coord!, 'cycleClose', { changes: [], reasoning });
    endTurn(coord!.id);
  };
  const task = (assignee: string, title: string, extra: { [key: string]: unknown } = {}) => c.company.createTask(coord?.id ?? OWNER, { assignee, title, ...extra });
  const finish = (by: string, id: string) => {
    const done = c.company.finish(by, id, { summary: 'tamam', outputs: [], learned: '' });
    settle();
    return done;
  };
  const goal = () => c.company.goalSet(coord!.id, { title: 'Lansman', why: 'misyon', done: ['site'] });

  return {
    ...s, ...c, coord: coord!, person, settle, result, endTurn, setLifecycle, inTurn, sent, runsOn, woken, boot, restart, advance, call, log, started, records, kinds, toCoordinator, boards, closeCycle, task, finish, goal,
    now, cycle: () => office!.cycle,
  };
}

/** Ends the coordinator's ordinary turn (no cycle open). */
const endTurnQuietly = (t: ReturnType<typeof make>) => t.endTurn(t.coord.id, 0);

describe('management cycle — triggers and the window', () => {
  it('a burst of ten deliveries inside a minute opens exactly one cycle, after the 2-minute window, with every delivery in it', async () => {
    const t = make();
    const people = ['Ada', 'Can', 'Ece', 'Efe', 'Nil'].map((n) => t.person(n));
    t.boot();
    const tasks = people.flatMap((p) => [t.task(p.id, `${p.name} 1`), t.task(p.id, `${p.name} 2`)]);
    t.settle();
    expect(t.started()).toHaveLength(0);
    const first = t.now();
    for (const x of tasks) {
      t.finish(x.assignee, x.id);
      t.advance(5 * SEC);
    }
    expect(t.now() - first).toBeLessThan(MIN);
    // Not before the window is over, then once.
    t.advance(first + CYCLE_WINDOW_MS - SEC - t.now());
    expect(t.started()).toHaveLength(0);
    t.advance(30 * SEC);
    expect(t.started()).toHaveLength(1);
    expect(t.boards()).toHaveLength(1);
    expect(t.kinds(0).filter((k) => k === 'delivery')).toHaveLength(10);
    // Each one left their person with nothing: “Biri boşa çıktı”.
    expect(t.started()[0]!.triggers.filter((x) => x.kind === 'idle').map((x) => x.note).sort()).toEqual(['Ada', 'Can', 'Ece', 'Efe', 'Nil']);
    expect(t.started()[0]!.since).toBe(0);
    await t.closeCycle();
    t.advance(30 * MIN);
    expect(t.started()).toHaveLength(1);
  });

  it('nothing the coordinator itself does during a cycle — tasks, a plan revision, a park, a reassignment, a goal — opens another', async () => {
    const t = make({ autonomy: 'free' });
    const ada = t.person('Ada');
    const can = t.person('Can');
    const ece = t.person('Ece');
    const g = t.goal();
    const plan = t.company.propose(t.coord.id, { method: METHOD, title: 'Site', goal: 'g', approach: 'a', goalId: g.id });
    t.boot();
    expect(t.started()).toHaveLength(1);
    expect(t.kinds(0)).toEqual(['start']);
    await t.call(t.coord, 'taskCreate', { assignee: ada.id, title: 'Tasarım', planId: plan.id });
    await t.call(t.coord, 'taskCreate', { assignee: can.id, title: 'Kod', planId: plan.id });
    await t.call(t.coord, 'taskCreate', { assignee: ece.id, title: 'Sonra', planId: plan.id, startAfter: '+3h' });
    await t.call(t.coord, 'planRevise', { planId: plan.id, approach: 'iki kişi paralel', streams: [{ id: 'web', title: 'Web', owner: 'Ada' }] });
    const kod = t.tasks.list({ assignee: can.id }).find((x) => x.title === 'Kod')!;
    expect(kod.status).toBe('in_progress');
    await t.call(t.coord, 'taskPark', { taskId: kod.id, until: '+1h', reason: 'API bekleniyor' });
    // Ece's only task goes to Can: Ece is left with no work, by the coordinator's own hand.
    const sonra = t.tasks.list({ assignee: ece.id }).find((x) => x.title === 'Sonra')!;
    await t.call(t.coord, 'taskAssign', { taskId: sonra.id, assignee: can.id });
    expect(t.tasks.list({ assignee: ece.id })).toEqual([]);
    await t.call(t.coord, 'goalSet', { title: 'İkinci hedef', why: 'misyon', done: ['tamam'] });
    await t.closeCycle();
    t.advance(20 * MIN);
    expect(t.started()).toHaveLength(1);
  });

  it('the coordinator’s own review decision is its own: the hand-in it approves and the person it frees open no cycle', async () => {
    const t = make();
    const ada = t.person('Ada');
    const work = t.task(ada.id, 'Metin', { reviewer: t.coord.id });
    t.boot();
    await t.closeCycle();
    t.finish(ada.id, work.id);
    // The review task goes to the coordinator as its own task (a turn of its own); it decides there.
    const review = t.tasks.list({ assignee: t.coord.id }).find((x) => x.kind === 'review')!;
    expect(t.toCoordinator().at(-1)!.text).toContain(`Görev no: ${review.id}`);
    await t.call(t.coord, 'reviewDecide', { taskId: review.id, decision: 'approve', findings: [] });
    expect(t.tasks.get(work.id).status).toBe('done');
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(1);
    // When that turn ends, Ada's hand-in (not the approval, nor Ada left free by it) opens the next cycle.
    t.endTurn(t.coord.id);
    expect(t.started()).toHaveLength(2);
    expect(t.started()[1]!.triggers.map((x) => [x.kind, x.note])).toEqual([['delivery', '“Metin” (Ada)']]);
    await t.closeCycle();
    t.advance(20 * MIN);
    expect(t.started()).toHaveLength(2);
  });

  it('triggers that come while a cycle turn runs are kept for the next one, which opens when the turn ends', async () => {
    const t = make();
    const ada = t.person('Ada');
    const x = t.task(ada.id, 'Yaz');
    t.boot();
    expect(t.started()).toHaveLength(1);
    t.finish(ada.id, x.id);
    t.advance(10 * MIN);
    // The coordinator is still in the cycle's turn: nothing new reaches it.
    expect(t.started()).toHaveLength(1);
    await t.closeCycle();
    expect(t.started()).toHaveLength(2);
    expect(t.kinds(1)).toContain('delivery');
    expect(t.started()[1]!.since).toBe(T0);
  });

  it('a paused company opens no cycle, whatever happens; resuming opens exactly one, with what waited', async () => {
    const t = make();
    const ada = t.person('Ada');
    const x = t.task(ada.id, 'Yaz');
    t.boot();
    await t.closeCycle();
    t.company.pause();
    t.finish(ada.id, x.id);
    t.advance(60 * MIN);
    expect(t.started()).toHaveLength(1);
    expect(t.cycle().due()).toBe(false);
    t.company.resume();
    t.settle();
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(2);
    expect(t.kinds(1)).toEqual(expect.arrayContaining(['delivery', 'constraint']));
    expect(t.started()[1]!.triggers.find((x) => x.kind === 'constraint')?.note).toBe('sahibi şirketi sürdürdü');
    await t.closeCycle();
    t.advance(30 * MIN);
    expect(t.started()).toHaveLength(2);
  });

  it('in the owner’s reserve there is no heartbeat, but a delivery still opens a cycle', async () => {
    const t = make();
    const ada = t.person('Ada');
    t.goal();
    const x = t.task(ada.id, 'Yaz');
    t.boot();
    await t.closeCycle();
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.9, resetsAt: T0 + 10 * 60 * MIN }, sevenDay: null, updatedAt: T0 });
    t.budget.checkReserve();
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    // The reserve itself is a constraint that changed.
    expect(t.started()).toHaveLength(2);
    expect(t.started()[1]!.triggers.find((x) => x.kind === 'constraint')?.note).toBe('sahibinin kota payı devreye girdi');
    await t.closeCycle();
    t.advance(HEARTBEAT_MS + 10 * MIN);
    expect(t.started()).toHaveLength(2);
    t.finish(ada.id, x.id);
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(3);
    expect(t.kinds(2)).toContain('delivery');
  });

  it('the heartbeat: 45 minutes after the last cycle while work is open, and never without open work', async () => {
    const t = make();
    t.goal();
    t.boot();
    await t.closeCycle();
    t.advance(HEARTBEAT_MS - MIN);
    expect(t.started()).toHaveLength(1);
    t.advance(MIN + 30 * SEC);
    expect(t.started()).toHaveLength(2);
    expect(t.kinds(1)).toEqual(['heartbeat']);
    await t.closeCycle();

    const quiet = make();
    quiet.boot();
    quiet.advance(2 * HEARTBEAT_MS);
    expect(quiet.started()).toHaveLength(0);
    // Work appears (the coordinator opens a goal itself): the heartbeat counts from then, not from the office's start.
    quiet.goal();
    quiet.advance(HEARTBEAT_MS - MIN);
    expect(quiet.started()).toHaveLength(0);
    quiet.advance(MIN + 30 * SEC);
    expect(quiet.started()).toHaveLength(1);
    expect(quiet.kinds(0)).toEqual(['heartbeat']);
  });

  it('without a coordinator nothing opens', () => {
    const t = make({ coordinator: false });
    const ada = t.person('Ada');
    const x = t.task(ada.id, 'Yaz');
    t.boot();
    t.finish(ada.id, x.id);
    t.advance(HEARTBEAT_MS + 10 * MIN);
    expect(t.started()).toHaveLength(0);
  });
});

describe('management cycle — what opens one (§3.1)', () => {
  /** An office whose start cycle is closed: what comes next is the test's. */
  async function office(o: { autonomy?: 'free' | 'plans' } = {}) {
    const t = make(o);
    const ada = t.person('Ada', { team: 'İçerik' });
    const can = t.person('Can', { team: 'İçerik' });
    return { t, ada, can };
  }
  const opened = async (t: ReturnType<typeof make>) => {
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    return t.started().at(-1)?.triggers ?? [];
  };

  it('a review decision', async () => {
    const { t, ada, can } = await office();
    const x = t.task(ada.id, 'Metin', { reviewer: can.id });
    t.boot();
    await t.closeCycle();
    t.finish(ada.id, x.id);
    await opened(t);
    await t.closeCycle();
    const review = t.tasks.list({ assignee: can.id }).find((r) => r.kind === 'review')!;
    t.company.reviewDecide(can.id, review.id, { decision: 'changes', findings: [{ severity: 'important', text: 'eksik' }] });
    const triggers = await opened(t);
    expect(t.started()).toHaveLength(3);
    expect(triggers.find((x) => x.kind === 'review')?.note).toBe('“Metin”: değişiklik istendi (Can)');
  });

  it('someone left with no work: a lead moves Ada’s only task to Can', async () => {
    const { t, ada, can } = await office();
    const lale = t.person('Lale', { kind: 'lead', team: 'İçerik' });
    const x = t.task(ada.id, 'Çeviri', { startAfter: '+2h' });
    t.boot();
    await t.closeCycle();
    t.company.assign(lale.id, x.id, can.id);
    const triggers = await opened(t);
    expect(t.started()).toHaveLength(2);
    expect(triggers.map((x) => [x.kind, x.note])).toEqual([['idle', 'Ada']]);
  });

  it('a plan’s or a goal’s status: the owner approves a plan, a plan finishes, the owner stops a goal', async () => {
    const { t, ada } = await office({ autonomy: 'plans' });
    const g = t.goal();
    const plan = t.company.propose(t.coord.id, { method: METHOD, title: 'Site', goal: 'g', approach: 'a', goalId: g.id });
    t.boot();
    await t.closeCycle();
    t.company.approve(plan.id);
    expect((await opened(t)).find((x) => x.kind === 'plan')?.note).toBe('“Site” planı onaylandı');
    const x = t.task(ada.id, 'Sayfa', { planId: plan.id });
    await t.closeCycle();
    t.finish(ada.id, x.id);
    expect((await opened(t)).map((x) => x.kind)).toEqual(expect.arrayContaining(['delivery', 'plan']));
    expect(t.started().at(-1)!.triggers.find((x) => x.kind === 'plan')?.note).toBe('“Site” planı bitti');
    await t.closeCycle();
    t.company.stopGoal(g.id);
    expect((await opened(t)).find((x) => x.kind === 'goal')?.note).toBe('“Lansman” hedefi sahibince durduruldu');
    expect(t.started()).toHaveLength(4);
  });

  it('a constraint: the owner changes the constitution (a spend recorded is not one, nor the same rules in an older office’s shape)', async () => {
    const { t, ada } = await office();
    t.goal();
    t.boot();
    await t.closeCycle();
    t.budget.recordSpend(ada.id, { service: 'alan adı', usd: 12, purpose: 'site' });
    const summary = t.budget.summary();
    const old = { ...summary, constitution: { ...summary.constitution, coordinatorModels: { owner: 'sonnet', decision: 'sonnet', digest: 'haiku' } } };
    t.events.append(null, { type: 'budget.changed', budget: old as unknown as typeof summary });
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(1);
    t.budget.ownerSetConstitution({ tasksPerDay: 7 });
    const triggers = await opened(t);
    expect(t.started()).toHaveLength(2);
    expect(triggers.map((x) => x.kind)).toEqual(['constraint']);
    expect(triggers[0]!.note).toMatch(/^anayasa: /);
  });

  it('a stall: blocked, past its due date, and still open after the office’s reminder', async () => {
    const { t, ada, can } = await office();
    t.boot();
    // The start: nothing was open, so no cycle yet.
    expect(t.started()).toHaveLength(0);
    const x = t.task(ada.id, 'Çiz');
    t.settle();
    t.company.update(ada.id, x.id, { blocked: true, note: 'erişim yok' });
    expect((await opened(t)).find((y) => y.kind === 'stuck')?.note).toBe('“Çiz” takıldı (Ada)');
    await t.closeCycle();
    t.task(ada.id, 'Rapor', { dueAt: '+10m' });
    t.advance(10 * MIN);
    expect((await opened(t)).find((y) => y.kind === 'stuck')?.note).toBe('“Rapor” son tarihi geçti (Ada)');
    await t.closeCycle();
    // Can gets a task, ends the turn without handing in, is reminded, and is still at it after RENUDGE_MS.
    t.task(can.id, 'Ölçüm');
    t.settle();
    t.endTurn(can.id);
    t.endTurn(can.id);
    t.advance(RENUDGE_MS);
    t.endTurn(can.id);
    const triggers = await opened(t);
    expect(triggers.find((y) => y.kind === 'stuck')?.note).toBe('“Ölçüm” hatırlatmaya rağmen ilerlemiyor (Can)');
  });

  it('the owner’s message opens none (it goes to the coordinator directly)', async () => {
    const { t } = await office();
    t.goal();
    t.boot();
    await t.closeCycle();
    t.events.append(t.coord.id, { type: 'message.user', text: 'Durum ne?', source: 'owner' });
    t.advance(10 * MIN);
    expect(t.started()).toHaveLength(1);
  });
});

describe('management cycle — the delivery (§3.6) and cycleClose (§3.3)', () => {
  it('one message: the board, then the pending decisions; the information is marked delivered; decisions wait for a cycle on its way', async () => {
    const t = make({ autonomy: 'plans' });
    const ada = t.person('Ada');
    const plan = t.company.propose(t.coord.id, { method: METHOD, title: 'Site', goal: 'g', approach: 'a' });
    const x = t.task(ada.id, 'Yaz');
    t.boot();
    await t.closeCycle();
    const before = t.toCoordinator().length;
    t.advance(30 * SEC);
    t.finish(ada.id, x.id);
    t.company.approve(plan.id);
    t.settle();
    // The approval is a decision, but a cycle is on its way: it waits for it (at most the window).
    t.advance(CYCLE_WINDOW_MS - 30 * SEC);
    expect(t.toCoordinator()).toHaveLength(before);
    expect(t.notices.pending(t.coord.id).map((n) => n.topic)).toEqual(['task.finished', 'plan.approved']);
    t.advance(MIN);
    expect(t.toCoordinator()).toHaveLength(before + 1);
    const message = t.toCoordinator().at(-1)!;
    expect(message.text).toMatch(/^Yönetim panosu · /);
    expect(message.text).toContain(`${NOTICES_PREFIX}\n- Plan onaylandı: “Site” (sürüm 1). Görevleri aç ve dağıt.`);
    expect(message.text.indexOf(NOTICES_PREFIX)).toBeGreaterThan(message.text.indexOf('## 7. Açık kararlar'));
    // The hand-in is on the board, not as a notice.
    expect(message.text).toContain('Teslim: “Yaz” — Ada → bitti');
    expect(message.text).not.toContain('Görev bitti:');
    expect(message.text).toContain('cycleClose');
    // No active goal: the board says kickoff, so the cycle goes on the project-start model, as a role hint.
    expect(message).toMatchObject({ model: 'fable', role: true });
    expect(t.notices.pending(t.coord.id)).toEqual([]);
  });

  it('a decision with no cycle on its way goes at once, as before; information alone opens no turn', async () => {
    const t = make();
    const ada = t.person('Ada');
    t.boot();
    t.notices.add(t.coord.id, 'task.finished', 'Görev bitti: “Eski” (Ada): tamam');
    t.advance(5 * MIN);
    expect(t.toCoordinator()).toHaveLength(0);
    t.company.openProposal(ada.id, { kind: 'idea', title: 'Altyazı', text: 't' });
    t.advance(30 * SEC);
    expect(t.toCoordinator()).toHaveLength(1);
    expect(t.toCoordinator()[0]!.text).toMatch(/^Ofisten notlar:\n- Ada bir .+ açtı: “Altyazı”/);
    expect(t.toCoordinator()[0]!.text).not.toContain('Eski');
    // An ordinary turn: the routine model, as a role hint.
    expect(t.toCoordinator()[0]).toMatchObject({ model: 'sonnet', role: true });
    expect(t.started()).toHaveLength(0);
  });

  it('models by turn type (§3.5): a cycle whose board says kickoff runs on fable, any other cycle on opus, every other coordinator turn on sonnet — role hints; the record says the model', async () => {
    const t = make();
    const ada = t.person('Ada');
    const g = t.goal();
    // The office starts with an active goal and no plan for it: a project start.
    t.boot();
    expect(t.boards()).toHaveLength(1);
    expect(t.boards()[0]).toMatchObject({ model: 'fable', role: true });
    await t.closeCycle();
    expect(t.records().at(-1)).toMatchObject({ closed: true, model: 'fable' });
    // The plan runs: the next cycle re-plans on opus.
    const plan = t.company.propose(t.coord.id, { method: METHOD, title: 'Site', goal: 'g', approach: 'a', goalId: g.id });
    expect(t.plans.get(plan.id).status).toBe('approved');
    const x = t.task(ada.id, 'Yaz', { planId: plan.id });
    t.task(ada.id, 'Düzelt', { planId: plan.id });
    t.settle();
    t.finish(ada.id, x.id);
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.boards()).toHaveLength(2);
    expect(t.boards()[1]).toMatchObject({ model: 'opus', role: true });
    await t.closeCycle();
    expect(t.records().at(-1)).toMatchObject({ closed: true, model: 'opus' });
    // A colleague's proposal with no cycle on its way: an ordinary turn on sonnet.
    t.company.openProposal(ada.id, { kind: 'idea', title: 'Altyazı', text: 't' });
    t.advance(30 * SEC);
    expect(t.toCoordinator().at(-1)).toMatchObject({ model: 'sonnet', role: true });
    expect(t.toCoordinator().at(-1)!.text).toMatch(/^Ofisten notlar:/);
    endTurnQuietly(t);
    // The models are the owner's, in the constitution; the change is a constraint, so a cycle comes first — on the new cycle model.
    t.budget.ownerSetConstitution({ coordinatorModels: { cycle: 'fable', routine: 'haiku' } });
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.boards()).toHaveLength(3);
    expect(t.boards()[2]).toMatchObject({ model: 'fable', role: true });
    await t.closeCycle();
    t.company.openProposal(ada.id, { kind: 'idea', title: 'Kapak', text: 't' });
    t.advance(30 * SEC);
    expect(t.toCoordinator().at(-1)).toMatchObject({ model: 'haiku', role: true });
  });

  it('the record carries the model the cycle ran on: the engine’s word (a weaker model waits for the cache pause), and the one it went on on when the new model failed', async () => {
    const t = make();
    const ada = t.person('Ada');
    const g = t.goal();
    t.company.propose(t.coord.id, { method: METHOD, title: 'Site', goal: 'g', approach: 'a', goalId: g.id });
    t.task(ada.id, 'Yaz');
    // The session was on fable a minute ago: the engine keeps it there, though the cycle asks for opus.
    t.runsOn.model = 'fable';
    t.boot();
    expect(t.boards()[0]).toMatchObject({ model: 'opus', role: true });
    await t.closeCycle();
    expect(t.records().at(-1)).toMatchObject({ model: 'fable' });
    // The engine moves the session to opus for the next one, and the account cannot use it: it goes on on sonnet.
    t.runsOn.model = 'opus';
    t.advance(HEARTBEAT_MS);
    expect(t.boards()).toHaveLength(2);
    t.events.append(t.coord.id, { type: 'model.switch.failed', from: 'sonnet', to: 'opus', reason: 'model yok' });
    t.settle();
    await t.closeCycle();
    expect(t.records().at(-1)).toMatchObject({ closed: true, model: 'sonnet' });
  });

  it('cycleClose closes the cycle once, recorded when its turn ends with the turn’s cost; with no change it wants “değişiklik yok, çünkü …” and a reason', async () => {
    const t = make();
    const ada = t.person('Ada');
    t.task(ada.id, 'Yaz');
    t.boot();
    const close = (args: { [key: string]: unknown }) => t.call(t.coord, 'cycleClose', args);
    // The phrase alone is no reason.
    for (const reasoning of ['her şey yolunda', 'değişiklik yok', 'Değişiklik yok, çünkü', 'değişiklik yok, çünkü …']) {
      await expect(close({ changes: [], reasoning })).rejects.toThrow('gerekçeyi “değişiklik yok, çünkü …” diye yaz');
    }
    // A result came before the close, with more queued: the same turn goes on.
    t.result(t.coord.id, 0.2, { queuedTurns: 1 });
    expect(await close({ changes: ['Ada’nın işi ikiye bölündü', 'Can işe alındı'], reasoning: 'zincir tek kişideydi', next: 'Can’ın ilk teslimi' })).toBe('Yönetim turu kapandı: 2 değişiklik kaydedildi.');
    await expect(close({ changes: [], reasoning: NO_CHANGE })).rejects.toThrow('zaten kapandı');
    expect(t.records()).toEqual([]);
    t.endTurn(t.coord.id, 0.5);
    await expect(close({ changes: [], reasoning: NO_CHANGE })).rejects.toThrow('Açık bir yönetim turu yok');
    expect(t.records()).toEqual([
      { type: 'management.cycle', closed: true, startedAt: T0, endedAt: T0, triggers: [{ kind: 'start', at: T0, note: '', seq: null }], changes: ['Ada’nın işi ikiye bölündü', 'Can işe alındı'], reasoning: 'zincir tek kişideydi', next: 'Can’ın ilk teslimi', costUsd: 0.7, model: 'fable' },
    ]);
    expect(t.started()).toEqual([{ type: 'management.cycle.started', triggers: [{ kind: 'start', at: T0, note: '', seq: null }], since: 0, unclosedWarning: false }]);
  });

  it('a cycle turn that ends without cycleClose is logged not closed once, with its cost; the next board warns; no cycle comes from it', async () => {
    const t = make();
    const ada = t.person('Ada');
    const x = t.task(ada.id, 'Yaz');
    t.boot();
    t.endTurn(t.coord.id, 0.42);
    expect(t.records()).toEqual([{ type: 'management.cycle', closed: false, startedAt: T0, endedAt: T0, triggers: [{ kind: 'start', at: T0, note: '', seq: null }], changes: [], reasoning: '', next: null, costUsd: 0.42, model: 'fable' }]);
    t.advance(30 * MIN);
    expect(t.started()).toHaveLength(1);
    t.finish(ada.id, x.id);
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(2);
    expect(t.started()[1]!.unclosedWarning).toBe(true);
    expect(t.boards()[1]!.text).toMatch(/^UYARI: Önceki tur cycleClose ile kapanmadı\./);
    await t.closeCycle();
    expect(t.records().map((r) => r.closed)).toEqual([false, true]);
    const y = t.task(ada.id, 'Düzelt');
    t.settle();
    t.finish(ada.id, y.id);
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(3);
    expect(t.started()[2]!.unclosedWarning).toBe(false);
    expect(t.boards()[2]!.text).toMatch(/^Yönetim panosu/);
  });
});

describe('management cycle — the dispatcher’s edges', () => {
  it('a board lost on the way (no session could read it): its notices and its triggers wait again, and the next idle moment brings them', async () => {
    const t = make();
    const ada = t.person('Ada');
    const x = t.task(ada.id, 'Yaz');
    t.boot();
    await t.closeCycle();
    t.advance(30 * SEC);
    t.finish(ada.id, x.id);
    t.notices.add(t.coord.id, 'task.blocked', 'Can “Çiz” görevinde takıldı.');
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(2);
    const lost = t.toCoordinator().at(-1)!;
    // The session died before reading it: the engine says so, and the coordinator is idle again.
    lost.onLost!();
    t.inTurn.delete(t.coord.id);
    t.setLifecycle(t.coord.id, 'idle');
    t.settle();
    const again = t.toCoordinator().at(-1)!;
    expect(again).not.toBe(lost);
    expect(t.started()).toHaveLength(3);
    expect(t.kinds(2)).toEqual(t.kinds(1));
    // The board covers the same stretch as the lost one did (from the cycle before it), and the decision rides again.
    expect(t.started()[2]!.since).toBe(t.started()[1]!.since);
    expect(again.text).toContain('Can “Çiz” görevinde takıldı.');
    expect(t.notices.pending(t.coord.id)).toEqual([]);
  });

  it('a lost board leaves no cycle going on: the log has none open, and a management.cycle.lost event says which board and why — once', async () => {
    const t = make();
    const ada = t.person('Ada');
    const x = t.task(ada.id, 'Yaz');
    t.boot();
    await t.closeCycle();
    t.advance(30 * SEC);
    t.finish(ada.id, x.id);
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(2);
    const open = t.cycle().log().open!;
    expect(open).not.toBeNull();
    const board = t.toCoordinator().at(-1)!;
    board.onLost!();
    expect(t.cycle().log().open).toBeNull();
    const lostEvents = () => t.log().filter((e) => e.event.type === 'management.cycle.lost');
    expect(lostEvents().map((e) => [e.employeeId, e.event])).toEqual([[t.coord.id, { type: 'management.cycle.lost', startedAt: open.startedAt, reason: expect.stringContaining('ulaşmadı') }]]);
    // A lost board is no cycle: nothing is recorded from it, and the engine saying so again logs nothing more.
    board.onLost!();
    expect(lostEvents()).toHaveLength(1);
    expect(t.records()).toHaveLength(1);
  });

  it('a board that cannot be built never stops the office: the cycle still opens, says so, and the error is logged', async () => {
    const t = make({ boardFails: true });
    const ada = t.person('Ada');
    t.task(ada.id, 'Yaz');
    t.boot();
    expect(t.started()).toHaveLength(1);
    const text = t.boards()[0]!.text;
    expect(text).toMatch(/^Yönetim panosu hazırlanamadı \(disk dolu\)/);
    expect(text).toContain('cycleClose');
    expect(t.log().filter((e) => e.event.type === 'error').map((e) => (e.event as { message: string }).message)).toEqual(['Yönetim panosu hazırlanamadı: disk dolu']);
  });

  it('a crash, a quota pause or a model retry in the middle of the cycle’s turn does not end it: cycleClose still closes it, nothing is logged not closed', async () => {
    const t = make();
    const ada = t.person('Ada');
    t.task(ada.id, 'Yaz');
    t.boot();
    const id = t.coord.id;
    // A crash: the session starts again (idle) and the engine sends the work again at once.
    t.events.append(id, { type: 'error', message: 'claude süreci beklenmedik şekilde kapandı (kod 1, sinyal -).' });
    t.setLifecycle(id, 'idle');
    t.events.append(id, { type: 'turn.started' });
    t.setLifecycle(id, 'working');
    // The quota runs out: the result is refused, the engine waits for the window and goes on.
    t.result(id, 0.1, { ok: false });
    t.setLifecycle(id, 'limited');
    t.advance(10 * MIN);
    t.events.append(id, { type: 'turn.started' });
    t.setLifecycle(id, 'working');
    // A model the account cannot use: the engine runs the turn again on the model it had.
    t.result(id, 0.05, { ok: false });
    t.events.append(id, { type: 'model.switch.failed', from: 'sonnet', to: 'opus', reason: 'model yok' });
    t.setLifecycle(id, 'idle');
    t.events.append(id, { type: 'turn.started' });
    t.setLifecycle(id, 'working');
    t.settle();
    expect(t.records()).toEqual([]);
    expect(await t.call(t.coord, 'cycleClose', { changes: [], reasoning: NO_CHANGE })).toBe('Yönetim turu kapandı: değişiklik yok, gerekçe kaydedildi.');
    t.endTurn(id, 0.25);
    expect(t.records().map((r) => [r.closed, r.costUsd])).toEqual([[true, 0.4]]);
    expect(t.started()).toHaveLength(1);
  });

  it('the turn’s own death ends the cycle not closed, once: the session failing for good', async () => {
    const t = make();
    const ada = t.person('Ada');
    t.task(ada.id, 'Yaz');
    t.boot();
    t.setLifecycle(t.coord.id, 'error');
    expect(t.records().map((r) => r.closed)).toEqual([false]);
    t.advance(10 * MIN);
    expect(t.records()).toHaveLength(1);
  });

  it('information the board does not show (the owner’s agenda changes) comes with the board as notes; what it shows is only marked delivered', async () => {
    const t = make();
    const ada = t.person('Ada');
    const can = t.person('Can');
    const x = t.task(ada.id, 'Yaz');
    const y = t.task(can.id, 'Çiz');
    t.boot();
    await t.closeCycle();
    t.advance(30 * SEC);
    t.company.parkTask(OWNER, y.id, '+2h', 'müşteri bekleniyor');
    t.finish(ada.id, x.id);
    expect(t.notices.pending(t.coord.id).map((n) => n.topic)).toEqual(['agenda.owner_changed', 'task.finished']);
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    const message = t.boards().at(-1)!.text;
    expect(message).toContain(`${NOTICES_PREFIX}\n- Sahibi “Çiz” görevini`);
    expect(message).toContain('müşteri bekleniyor');
    expect(message).not.toContain('Görev bitti:');
    expect(t.notices.pending(t.coord.id)).toEqual([]);
  });

  it('a sleeping coordinator wakes for a due cycle, never for its information alone', async () => {
    const t = make();
    const ada = t.person('Ada');
    const x = t.task(ada.id, 'Yaz');
    t.boot();
    await t.closeCycle();
    t.setLifecycle(t.coord.id, 'sleeping');
    t.notices.add(t.coord.id, 'role.changed', 'Can artık İçerik ekibinin lideri.');
    t.advance(5 * MIN);
    expect(t.woken).toEqual([]);
    t.finish(ada.id, x.id);
    t.advance(CYCLE_WINDOW_MS - 30 * SEC);
    expect(t.woken).toEqual([]);
    t.advance(MIN);
    expect(t.woken).toEqual([t.coord.id]);
    expect(t.started()).toHaveLength(2);
  });
});

describe('management cycle — a restart (§5)', () => {
  it('the office starts with open work: one cycle in the first minute, its board since the last cycle; nothing more', async () => {
    const t = make();
    const ada = t.person('Ada');
    t.task(ada.id, 'Yaz');
    t.boot();
    await t.closeCycle();
    t.advance(10 * MIN);
    t.restart();
    t.advance(30 * SEC);
    expect(t.started()).toHaveLength(2);
    expect(t.kinds(1)).toEqual(['start']);
    expect(t.started()[1]!.since).toBe(T0);
    await t.closeCycle();
    t.advance(30 * MIN);
    expect(t.started()).toHaveLength(2);
  });

  it('triggers waiting at the restart are neither lost nor doubled: one cycle carries them and the start', async () => {
    const t = make();
    const ada = t.person('Ada');
    const x = t.task(ada.id, 'Yaz');
    t.task(ada.id, 'Sonra');
    t.boot();
    await t.closeCycle();
    t.finish(ada.id, x.id);
    t.advance(MIN);
    t.restart();
    t.advance(30 * SEC);
    expect(t.started()).toHaveLength(2);
    expect(t.kinds(1)).toEqual(expect.arrayContaining(['delivery', 'start']));
    await t.closeCycle();
    t.advance(30 * MIN);
    expect(t.started()).toHaveLength(2);
  });

  it('a cycle left open by the stopped office is logged not closed, and the restart’s board warns', async () => {
    const t = make();
    const ada = t.person('Ada');
    t.task(ada.id, 'Yaz');
    t.boot();
    // The office stops in the middle of the cycle's turn; it comes back with the coordinator interrupted (engine.recover).
    t.restart(() => {
      t.inTurn.delete(t.coord.id);
      t.setLifecycle(t.coord.id, 'interrupted');
    });
    expect(t.records().map((r) => r.closed)).toEqual([false]);
    t.advance(30 * SEC);
    expect(t.started()).toHaveLength(1);
    // The owner lets it go on: the restart's cycle comes, warning.
    t.setLifecycle(t.coord.id, 'idle');
    t.settle();
    expect(t.started()).toHaveLength(2);
    expect(t.started()[1]!.unclosedWarning).toBe(true);
    expect(t.records()).toHaveLength(1);
  });

  it('a cycle the stopped office left open ends, in its record, at the coordinator’s last work in it — not at the restart; with no work after the board its end is not known', async () => {
    const t = make();
    const ada = t.person('Ada');
    t.task(ada.id, 'Yaz');
    t.boot();
    t.advance(4 * MIN);
    t.result(t.coord.id, 0.1, { queuedTurns: 1 });
    const lastWork = t.now();
    // The office is down for hours; it comes back with the coordinator interrupted (engine.recover logs that at the restart).
    t.advance(3 * HOUR, 5 * MIN);
    const stop = () => t.restart(() => {
      t.inTurn.delete(t.coord.id);
      t.setLifecycle(t.coord.id, 'interrupted');
    });
    stop();
    expect(t.records().map((r) => [r.closed, r.startedAt, r.endedAt])).toEqual([[false, T0, lastWork]]);
    // The restart's cycle: the board goes out and the office stops again before the coordinator does anything.
    t.setLifecycle(t.coord.id, 'idle');
    t.settle();
    expect(t.started()).toHaveLength(2);
    t.advance(HOUR, 5 * MIN);
    stop();
    expect(t.records()[1]).toMatchObject({ closed: false, endedAt: null });
  });

  it('a cycle closed but still in its turn when the office stops is recorded at the restart: closed, with the cost known', async () => {
    const t = make();
    const ada = t.person('Ada');
    t.task(ada.id, 'Yaz');
    t.boot();
    t.result(t.coord.id, 0.2, { queuedTurns: 1 });
    await t.call(t.coord, 'cycleClose', { changes: ['Can işe alınacak'], reasoning: 'tek geliştirici yetmiyor' });
    expect(t.records()).toEqual([]);
    t.restart(() => {
      t.inTurn.delete(t.coord.id);
      t.setLifecycle(t.coord.id, 'interrupted');
    });
    expect(t.records().map((r) => [r.closed, r.changes, r.costUsd])).toEqual([[true, ['Can işe alınacak'], 0.2]]);
    t.setLifecycle(t.coord.id, 'idle');
    t.settle();
    // The restart's cycle: no warning, the previous one was closed.
    expect(t.started()).toHaveLength(2);
    expect(t.started()[1]!.unclosedWarning).toBe(false);
  });

  it('without open work the office starts quietly', () => {
    const t = make();
    t.boot();
    t.advance(5 * MIN);
    t.restart();
    t.advance(5 * MIN);
    expect(t.started()).toHaveLength(0);
  });
});

describe('management cycle — the idle heartbeat: no goal and no work', () => {
  it('an idle office gets a cycle every pulseHours (6 by default), never before; its board says there is no goal and no work', async () => {
    const t = make();
    t.boot();
    t.advance(6 * HOUR - MIN);
    expect(t.started()).toHaveLength(0);
    t.advance(MIN + 30 * SEC);
    expect(t.started()).toHaveLength(1);
    expect(t.kinds(0)).toEqual(['heartbeat']);
    expect(t.boards()[0]!.text).toContain('- Aktif hedef yok ve açık iş yok: ');
    await t.closeCycle();
    // The next one pulseHours after that cycle.
    t.advance(6 * HOUR - MIN);
    expect(t.started()).toHaveLength(1);
    t.advance(MIN + 30 * SEC);
    expect(t.started()).toHaveLength(2);
    expect(t.kinds(1)).toEqual(['heartbeat']);
  });

  it('pulseHours 0: no idle heartbeat at all', () => {
    const t = make();
    t.budget.setConstitution({ pulseHours: 0 });
    t.boot();
    t.advance(13 * HOUR);
    expect(t.started()).toHaveLength(0);
  });

  it('none while the coordinator rests (restUntil); one when the rest ends, once; then every pulseHours again', async () => {
    const t = make();
    t.boot();
    t.advance(MIN);
    await t.call(t.coord, 'restUntil', { hours: 10, reason: 'Sahibinin cevabı bekleniyor' });
    // Past pulseHours, but resting.
    t.advance(10 * HOUR - MIN);
    expect(t.started()).toHaveLength(0);
    t.advance(MIN + CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(1);
    expect(t.kinds(0)).toEqual(['rest']);
    expect(t.boards()[0]!.text).toContain('- Aktif hedef yok ve açık iş yok: ');
    await t.closeCycle();
    // The same rest ends once; the idle heartbeat counts from the cycle it brought.
    t.advance(6 * HOUR - 5 * MIN);
    expect(t.started()).toHaveLength(1);
    t.advance(5 * MIN);
    expect(t.started()).toHaveLength(2);
    expect(t.kinds(1)).toEqual(['heartbeat']);
  });

  it('the rules hold: paused, nothing (the rest’s end waits for the resume); in the owner’s reserve, no idle heartbeat', async () => {
    const t = make();
    t.boot();
    t.company.restUntil(t.coord.id, 2, 'bekleniyor');
    t.company.pause();
    t.advance(7 * HOUR);
    expect(t.started()).toHaveLength(0);
    t.company.resume();
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(1);
    expect(t.kinds(0)).toEqual(['rest', 'constraint']);
    await t.closeCycle();
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.9, resetsAt: t.now() + 20 * HOUR }, sevenDay: null, updatedAt: t.now() });
    t.budget.checkReserve();
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.started()).toHaveLength(2);
    await t.closeCycle();
    t.advance(7 * HOUR);
    expect(t.started()).toHaveLength(2);
  });
});

describe('management cycle — the pulse’s facts are the board’s (§3.6)', () => {
  /** Every notice the pulse ever left, delivered or not. */
  const pulseNotices = (t: ReturnType<typeof make>) => t.db.prepare("SELECT topic FROM notices WHERE topic LIKE 'pulse.%'").all();

  it('with a cycle wired the pulse leaves no notice — a goal with no running plan, an approved plan with no task, someone idle for hours, no goal and no work — and the board says each', async () => {
    const t = make({ pulse: true });
    t.person('Ada', { title: 'Geliştirici' });
    const g = t.goal();
    t.boot();
    // The office starts with work open (an active goal): its board has the goal without a plan.
    expect(t.boards()).toHaveLength(1);
    expect(t.boards()[0]!.text).toContain('- Hedef “Lansman”: süren planı yok — planPropose ile goalId vererek başlat ya da goalSet ile kapat');
    await t.closeCycle();
    // The coordinator starts a plan and opens no task: the heartbeat's board says so.
    await t.call(t.coord, 'planPropose', { title: 'Site', goal: 'g', approach: 'a', method: METHOD, goalId: g.id });
    t.advance(HEARTBEAT_MS);
    expect(t.boards()).toHaveLength(2);
    expect(t.boards()[1]!.text).toContain('  ! onaylı ama hiç görevi açılmadı (onay 45 dk önce) — görevlerini taskCreate ile aç ya da yerine yeni plan öner');
    await t.closeCycle();
    // Ada has had no work for longer than idleCapacityHours (2): marked on the board, with her title.
    t.advance(HEARTBEAT_MS);
    await t.closeCycle();
    t.advance(HEARTBEAT_MS);
    expect(t.boards()).toHaveLength(4);
    expect(t.boards()[3]!.text).toContain('- Boşta (1): Ada (Geliştirici) — 2 sa 15 dk (uzun süredir)');
    await t.closeCycle();
    // The owner stops the goal: no goal and no work, on the board of the cycle that follows.
    t.company.stopGoal(g.id);
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    expect(t.boards()).toHaveLength(5);
    expect(t.boards()[4]!.text).toContain('- Aktif hedef yok ve açık iş yok: şirket özetindeki misyona ve vizyona bakıp sıradaki hedefi aç (goalSet: neden ve ölçülebilir bitti tanımıyla)');
    await t.closeCycle();
    // Hours on (past pulseHours): no work, so the idle heartbeat brings the board, never a notice from the pulse.
    t.advance(7 * HOUR);
    expect(t.boards()).toHaveLength(6);
    expect(t.kinds(5)).toEqual(['heartbeat']);
    expect(t.boards()[5]!.text).toContain('- Aktif hedef yok ve açık iş yok: ');
    await t.closeCycle();
    expect(pulseNotices(t)).toEqual([]);
    for (const m of t.toCoordinator()) expect(m.text).not.toMatch(/Boşta kapasite|hedefinin süren planı yok|Aktif hedef yok ve açık iş yok\. /);
  });

  it('the tick’s other work goes on with a cycle wired: the daily report reminder still comes (digest off)', async () => {
    const t = make({ pulse: true });
    // No idle heartbeat in the way: the day is only the reminder.
    t.budget.setConstitution({ pulseHours: 0 });
    const ada = t.person('Ada');
    const x = t.task(ada.id, 'Yaz');
    t.boot();
    await t.closeCycle();
    t.advance(MIN);
    t.finish(ada.id, x.id);
    t.advance(CYCLE_WINDOW_MS + 30 * SEC);
    await t.closeCycle();
    // A day after the coordinator's hire, with work done since: the reminder (the clock runs every 10 minutes here).
    t.advance(24 * 60 * MIN, 10 * MIN);
    expect(t.toCoordinator().filter((m) => m.text.includes('Günlük özet zamanı'))).toHaveLength(1);
    expect(pulseNotices(t)).toEqual([]);
  });
});

describe('management cycle — no service, no change', () => {
  it('a dispatcher with the pulse and without a cycle service is as before: the pulse’s notice goes to the coordinator', () => {
    const t = make();
    t.goal();
    const deferred: Array<() => void> = [];
    const sent: string[] = [];
    const engine: DispatchEngine = { ready: () => true, send: (_id, text) => void sent.push(text), fire: async () => undefined, sleep: async () => undefined, wake: () => undefined };
    const pulse = new Pulse({ company: t.company, roster: t.roster, goals: t.goals, state: t.state, plans: t.plans, tasks: t.tasks, notices: t.notices, budget: t.budget, now: t.now });
    const stop = new Dispatcher({ events: t.events, roster: t.roster, tasks: t.tasks, notices: t.notices, plans: t.plans, company: t.company, engine, budget: t.budget, pulse, now: t.now, defer: (fn) => void deferred.push(fn), tickMs: 3_600_000 }).start();
    cleanups.push(stop);
    for (const fn of deferred.splice(0)) fn();
    expect(sent).toEqual([
      'Ofisten notlar:\n- “Lansman” hedefinin süren planı yok. Sıradaki planı planPropose ile goalId vererek başlat ya da hedefe ulaşıldıysa / vazgeçtiysen goalSet ile kapat (status: done ya da dropped).',
    ]);
  });

  it('a dispatcher without a cycle service is as before: the coordinator’s information goes at once (digest off)', () => {
    const t = make();
    const deferred: Array<() => void> = [];
    const sent: string[] = [];
    const engine: DispatchEngine = { ready: () => true, send: (_id, text) => void sent.push(text), fire: async () => undefined, sleep: async () => undefined, wake: () => undefined };
    t.notices.add(t.coord.id, 'task.finished', 'Görev bitti: “Yaz” (Ada): tamam');
    const stop = new Dispatcher({ events: t.events, roster: t.roster, tasks: t.tasks, notices: t.notices, plans: t.plans, company: t.company, engine, budget: t.budget, now: t.now, defer: (fn) => void deferred.push(fn), tickMs: 3_600_000 }).start();
    cleanups.push(stop);
    for (const fn of deferred.splice(0)) fn();
    expect(sent).toEqual(['Ofisten notlar:\n- Görev bitti: “Yaz” (Ada): tamam']);
    expect(t.started()).toHaveLength(0);
  });
});
