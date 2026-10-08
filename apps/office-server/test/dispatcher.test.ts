import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type StoredEvent } from '@cc/shared';
import { Clock } from '../src/company/clock.ts';
import { Company } from '../src/company/company.ts';
import { Dispatcher, ESCALATE_MS, NOTICES_PREFIX, NUDGE_PREFIX, RENUDGE_MS, type DispatchEngine } from '../src/company/dispatcher.ts';
import { Pulse } from '../src/company/pulse.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import { companyFor, METHOD, PLANS_ONLY } from './company-helpers.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, tempDir, until, waitFor } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** `now` (optional) is the dispatcher's clock, ticking every 50 ms. */
function make(now?: () => number) {
  const s = setup();
  const f = fakeEngine(s);
  const tasks = new TaskStore(s.db);
  const plans = new PlanStore(s.db);
  const notices = new NoticeStore(s.db);
  const company = new Company({ constitution: PLANS_ONLY, roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => ['coder'] });
  const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks, notices, plans, company, engine: f.engine, ...(now ? { now, tickMs: 50 } : {}) });
  const stop = dispatcher.start();
  cleanups.push(stop, f.cleanup, s.cleanup);
  return { ...s, engine: f.engine, tasks, plans, notices, company };
}

const systemMessages = (events: StoredEvent[], id: string) =>
  events.filter((e) => e.employeeId === id && e.event.type === 'message.user' && e.event.source === 'system').map((e) => (e.event as { text: string }).text);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Dispatcher', () => {
  it('hands the next task to an idle employee as a system message and marks it in progress', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'README yaz', done: ['README.md var'], priority: 2 });
    const msg = await waitFor(t.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('README yaz'));
    const text = (msg.event as { text: string }).text;
    expect(text).toContain(task.id);
    expect(text).toContain('README.md var');
    expect(text).toContain('taskFinish');
    expect(text).toContain('evidence');
    expect(t.tasks.get(task.id).status).toBe('in_progress');
  });

  it('review focus: an employee who stops without handing in gets exactly one reminder', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Uzun iş' });
    await until(() => systemMessages(t.events.list({ limit: 5000 }), ada.id).some((m) => m.startsWith(NUDGE_PREFIX)), 8000);
    await sleep(800);
    const messages = systemMessages(t.events.list({ limit: 5000 }), ada.id);
    expect(messages.filter((m) => m.startsWith(NUDGE_PREFIX))).toHaveLength(1);
    expect(messages).toHaveLength(2);
    expect(t.tasks.get(task.id)).toMatchObject({ status: 'in_progress', nudged: true });
  });

  it('review focus: two tasks at once never put two in progress; the second comes when the first is handed in', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const first = t.company.createTask(OWNER, { assignee: ada.id, title: 'Birinci' });
    const second = t.company.createTask(OWNER, { assignee: ada.id, title: 'İkinci' });
    await until(() => t.tasks.get(first.id).status === 'in_progress');
    await sleep(800);
    expect(t.tasks.list({ assignee: ada.id, statuses: ['in_progress'] })).toHaveLength(1);
    t.company.finish(ada.id, first.id, { summary: 'bitti', outputs: [], learned: '' });
    await until(() => t.tasks.get(second.id).status === 'in_progress', 8000);
    expect(t.tasks.list({ assignee: ada.id, statuses: ['in_progress'] }).map((x) => x.id)).toEqual([second.id]);
  });

  it('brings notices to an idle coordinator: the owner approved the plan', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { method: METHOD, title: 'Video', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    const msg = await waitFor(t.events, (e) => e.employeeId === c.id && e.event.type === 'message.user' && e.event.text.startsWith(NOTICES_PREFIX));
    expect((msg.event as { text: string }).text).toContain('Plan onaylandı');
    expect(t.notices.pending(c.id)).toEqual([]);
  });

  it('does not wake someone the owner stopped; the task waits', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await t.engine.stop(ada.id);
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Bekleyen' });
    await sleep(500);
    expect(t.tasks.get(task.id).status).toBe('waiting');
    expect(systemMessages(t.events.list({ limit: 5000 }), ada.id)).toEqual([]);
  });

  it('final review: tells the coordinator once when someone stalls after the reminder (with the second reminder)', async () => {
    let clock = Date.now();
    const t = make(() => clock);
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    t.company.createTask(c.id, { assignee: ada.id, title: 'Uzun iş' });
    const escalations = () => systemMessages(t.events.list({ limit: 5000 }), c.id).filter((m) => m.includes('teslim etmedi'));
    await until(() => systemMessages(t.events.list({ limit: 5000 }), ada.id).some((m) => m.startsWith(NUDGE_PREFIX)), 8000);
    clock += RENUDGE_MS;
    await until(() => escalations().length > 0, 8000);
    await sleep(800);
    expect(escalations()).toHaveLength(1);
    expect(escalations()[0]).toContain('Uzun iş');
  });
});

describe('Dispatcher — stall recovery', () => {
  const MIN = 60_000;
  /**
   * Driven by the test, so it is exact under any load: the dispatcher's clock is moved by hand, its tick is called
   * directly and its deferred work runs in `settle`; the engine only records what it is given, and everyone is idle
   * again at once (a doer who answers without handing in). People are hired on the fake engine only to be on the roster.
   */
  function makeDriven() {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    let clock = Date.now();
    const sent: Array<{ id: string; text: string }> = [];
    const engine: DispatchEngine = {
      ready: () => true,
      send: (id, text) => void sent.push({ id, text }),
      fire: async () => undefined,
      sleep: async () => undefined,
      wake: () => undefined,
    };
    const deferred: Array<() => void> = [];
    const dispatcher = new Dispatcher({
      events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine,
      now: () => clock, defer: (fn) => void deferred.push(fn), tickMs: 3_600_000,
    });
    cleanups.push(dispatcher.start(), f.cleanup, s.cleanup);
    /** Runs the dispatcher's deferred work until none is left. */
    const settle = () => {
      for (let round = 0; deferred.length > 0; round += 1) {
        if (round > 100) throw new Error('the dispatcher never came to rest');
        for (const fn of deferred.splice(0)) fn();
      }
    };
    /** Time passes and the office's tick runs (the real one, every 60 s, sweeps everyone). */
    const tickAfter = (ms: number) => {
      clock += ms;
      dispatcher.tick();
      settle();
    };
    const received = (id: string) => sent.filter((m) => m.id === id).map((m) => m.text);
    // A reminder may ride on a turn with notices: any paragraph that is one counts.
    const reminders = (id: string) => received(id).flatMap((m) => m.split('\n\n').filter((p) => p.startsWith(NUDGE_PREFIX)));
    const stalled = () => s.db.prepare("SELECT text FROM notices WHERE topic = 'task.stalled' ORDER BY id").all().map((r) => (r as { text: string }).text);
    return { ...s, ...c, now: () => clock, settle, tickAfter, received, reminders, stalled };
  }

  it('A1: an unanswered reminder comes again after 30 minutes, not before, and the coordinator hears with it', () => {
    const t = makeDriven();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(coord.id, { assignee: ada.id, title: 'Pilot' });
    t.settle();
    expect(t.received(ada.id)[0]).toContain('## Görev: Pilot');
    expect(t.reminders(ada.id)).toHaveLength(1);
    expect(t.reminders(ada.id)[0]).toContain('hâlâ açık görünüyor');
    expect(t.tasks.get(task.id)).toMatchObject({ status: 'in_progress', nudged: true, nudgedAt: t.now() });
    t.tickAfter(RENUDGE_MS - MIN);
    expect(t.reminders(ada.id)).toHaveLength(1);
    expect(t.stalled()).toEqual([]);
    t.tickAfter(MIN);
    expect(t.reminders(ada.id)).toHaveLength(2);
    expect(t.reminders(ada.id)[1]).toBe(
      `${NUDGE_PREFIX} “Pilot” görevi (no ${task.id}) hâlâ sende ve bir süredir ilerlemiyor. Uyutulduysan ya da ofis yeniden başladıysa arka planda çalışan işin durmuş olabilir: kaldığın yerden devam et. Bir şey bekliyorsan görevi \`taskPark\` ile park et; bitirdiysen \`taskFinish\` ile teslim et; takıldıysan \`taskUpdate\` ile yaz.`,
    );
    expect(t.tasks.get(task.id).nudgedAt).toBe(t.now());
    expect(t.stalled()).toHaveLength(1);
    expect(t.stalled()[0]).toContain('“Pilot”');
    expect(t.received(coord.id).some((m) => m.includes('Pilot') && m.includes('teslim etmedi'))).toBe(true);
    // Nothing more at the same moment: the next reminder is 30 minutes away.
    t.tickAfter(0);
    expect(t.reminders(ada.id)).toHaveLength(2);
    expect(t.stalled()).toHaveLength(1);
  });

  it('A2: the coordinator hears about the same stalled task again only after 2 hours, and never about its own task', () => {
    const t = makeDriven();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    t.company.createTask(coord.id, { assignee: ada.id, title: 'Pilot' });
    t.company.createTask(coord.id, { assignee: coord.id, title: 'Kendi işim' });
    t.settle();
    expect([t.reminders(ada.id).length, t.reminders(coord.id).length]).toEqual([1, 1]);
    const told: number[] = [];
    for (let n = 2; n <= 6; n += 1) {
      t.tickAfter(RENUDGE_MS);
      expect([t.reminders(ada.id).length, t.reminders(coord.id).length]).toEqual([n, n]);
      told.push(t.stalled().length);
    }
    // Told with the second reminder (30 min); at 60, 90 and 120 min that is under ESCALATE_MS ago; at 150 min, again.
    expect(ESCALATE_MS).toBe(4 * RENUDGE_MS);
    expect(told).toEqual([1, 1, 1, 1, 2]);
    expect(t.stalled().every((x) => x.includes('“Pilot”'))).toBe(true);
    expect(t.received(coord.id).some((m) => m.includes('Kendi işim') && m.includes('teslim etmedi'))).toBe(false);
  });

  it('A1: a task reminded before the time was kept (an office from before v11) is reminded again at once', () => {
    const t = makeDriven();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(coord.id, { assignee: ada.id, title: 'Pilot' });
    t.company.start(task.id);
    t.tasks.update(task.id, { nudged: true });
    t.settle();
    expect(t.reminders(ada.id)).toHaveLength(1);
    expect(t.reminders(ada.id)[0]).toContain('hâlâ sende');
    expect(t.tasks.get(task.id).nudgedAt).toBe(t.now());
    expect(t.stalled()).toHaveLength(1);
  });

  it('A3: a review is reminded again to decide, with reviewDecide', () => {
    const t = makeDriven();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Metin', reviewer: can.id });
    t.settle();
    expect(t.tasks.get(task.id).status).toBe('in_progress');
    t.company.finish(ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '' });
    t.settle();
    expect(t.reminders(can.id)).toHaveLength(1);
    t.tickAfter(RENUDGE_MS);
    expect(t.reminders(can.id)).toHaveLength(2);
    expect(t.reminders(can.id)[1]).toContain('hâlâ sende');
    expect(t.reminders(can.id)[1]).toContain('reviewDecide');
    expect(t.reminders(can.id)[1]).not.toContain('taskFinish');
  });
});

describe('Dispatcher — hand-over and the brief', () => {
  function makeFull(now?: () => number) {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const stop = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, ...(now ? { now, tickMs: 50 } : {}) }).start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    return { ...s, ...c, engine: f.engine };
  }

  it('hands the hand-over over first even with a task open, then lets the person go and returns their work', async () => {
    const t = makeFull();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    const work = t.company.createTask(coord.id, { assignee: ada.id, title: 'Uzun iş' });
    await until(() => t.tasks.get(work.id).status === 'in_progress');
    const handover = t.company.beginHandover(ada.id);
    await until(() => systemMessages(t.events.list({ limit: 5000 }), ada.id).some((m) => m.includes('Devir: işten ayrılıyorsun')), 8000);
    expect(t.tasks.get(handover.id).status).toBe('in_progress');
    t.company.finish(ada.id, handover.id, { summary: 'Bildiklerimi yazdım.', outputs: [], learned: 'Müşteri sabah arar.' });
    await until(() => t.roster.get(ada.id).lifecycle === 'archived', 8000);
    await until(() => t.tasks.get(work.id).status === 'waiting');
    await until(() => systemMessages(t.events.list({ limit: 5000 }), coord.id).some((m) => m.includes('Uzun iş') && m.includes('işten çıkarıldı')), 8000);
    expect(t.memory.notes('müşteri')).toHaveLength(1);
  });

  it('review focus: a stopped employee’s hand-over waits until they run again', async () => {
    const t = makeFull();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await t.engine.stop(ada.id);
    const handover = t.company.beginHandover(ada.id);
    await sleep(400);
    expect(t.tasks.get(handover.id).status).toBe('waiting');
    expect(t.roster.get(ada.id).lifecycle).toBe('stopped');
  });

  it('tells the employee once that the brief changed since their previous task', async () => {
    const t = makeFull();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    const delivered = (title: string) => systemMessages(t.events.list({ limit: 5000 }), ada.id).find((m) => m.includes(`## Görev: ${title}`));
    const run = async (title: string) => {
      const task = t.company.createTask(coord.id, { assignee: ada.id, title });
      await until(() => delivered(title) !== undefined, 8000);
      t.company.finish(ada.id, task.id, { summary: 'tamam', outputs: [], learned: '' });
      return delivered(title)!;
    };
    expect(await run('bir')).not.toContain('Şirket özeti değişti');
    await sleep(20);
    t.company.updateBrief(coord.id, '# Özet\n\nYeni kural: her iş testli teslim edilir.\n');
    await sleep(20);
    expect(await run('iki')).toContain('Şirket özeti değişti');
    expect(await run('üç')).not.toContain('Şirket özeti değişti');
  });


  it('important: a blocked hand-over still means leaving: no new work, one reminder, then the coordinator hears (no taskAssign)', async () => {
    let clock = Date.now();
    const t = makeFull(() => clock);
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    const handover = t.company.beginHandover(ada.id);
    await until(() => t.tasks.get(handover.id).status === 'in_progress', 8000);
    t.company.update(ada.id, handover.id, { blocked: true, note: 'ne yazacağımı bilmiyorum' });
    const work = t.company.createTask(coord.id, { assignee: ada.id, title: 'Yeni iş' });
    const escalated = () => systemMessages(t.events.list({ limit: 5000 }), coord.id).find((m) => m.includes('devir görevini'));
    await until(() => systemMessages(t.events.list({ limit: 5000 }), ada.id).some((m) => m.startsWith(NUDGE_PREFIX)), 8000);
    clock += RENUDGE_MS;
    await until(() => escalated() !== undefined, 8000);
    // A hand-over cannot be parked: its second reminder (logged before the coordinator was told) does not offer it.
    const reminders = systemMessages(t.events.list({ limit: 5000 }), ada.id).flatMap((m) => m.split('\n\n').filter((p) => p.startsWith(NUDGE_PREFIX)));
    expect(reminders).toHaveLength(2);
    expect(reminders[1]).toContain('hâlâ sende');
    expect(reminders[1]).not.toContain('taskPark');
    expect(escalated()).toContain('Hemen çıkar');
    expect(escalated()).not.toContain('taskAssign ile başkasına ver');
    await sleep(500);
    expect(t.tasks.get(work.id).status).toBe('waiting');
    expect(systemMessages(t.events.list({ limit: 5000 }), ada.id).some((m) => m.includes('Yeni iş'))).toBe(false);
  });
});

describe('Dispatcher — reserve and sleep', () => {
  function makeBudgeted(o: { idleSleepMinutes?: number } = {}) {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    if (o.idleSleepMinutes !== undefined) c.budget.setConstitution({ idleSleepMinutes: o.idleSleepMinutes });
    let clock = Date.now();
    const stop = new Dispatcher({
      events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine,
      budget: c.budget, now: () => clock, tickMs: 50,
    }).start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    return { ...s, ...c, engine: f.engine, advance: (ms: number) => (clock += ms) };
  }
  const high = () => ({ status: 'allowed', fiveHour: { utilization: 0.9, resetsAt: Date.now() + 3_600_000 }, sevenDay: null, updatedAt: Date.now() });

  it('review focus: in the reserve only priority 1 starts, idle members sleep, and everything resumes when it ends', async () => {
    const t = makeBudgeted();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(ada.id));
    t.setQuota(high());
    t.budget.checkReserve();
    const routine = t.company.createTask(coord.id, { assignee: ada.id, title: 'Rutin', priority: 3 });
    await until(() => t.roster.get(ada.id).lifecycle === 'sleeping', 8000);
    expect(t.tasks.get(routine.id).status).toBe('waiting');
    expect(t.roster.get(coord.id).lifecycle).not.toBe('sleeping');
    const urgent = t.company.createTask(coord.id, { assignee: ada.id, title: 'Acil', priority: 1 });
    await until(() => t.tasks.get(urgent.id).status === 'in_progress', 8000);
    t.company.finish(ada.id, urgent.id, { summary: 'tamam', outputs: [], learned: '' });
    t.setQuota(null);
    await until(() => t.tasks.get(routine.id).status === 'in_progress', 8000);
  });

  it('review focus: someone idle with nothing to do sleeps after the constitution’s minutes, and a task wakes them', async () => {
    const t = makeBudgeted({ idleSleepMinutes: 1 });
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(ada.id));
    await sleep(200);
    expect(t.roster.get(ada.id).lifecycle).toBe('idle');
    t.advance(61_000);
    await until(() => t.roster.get(ada.id).lifecycle === 'sleeping', 8000);
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Uyanınca' });
    await until(() => t.tasks.get(task.id).status === 'in_progress', 8000);
    expect(systemMessages(t.events.list({ limit: 5000 }), ada.id).some((m) => m.includes('## Görev: Uyanınca'))).toBe(true);
  });

  it('a sleeping coordinator wakes for its notices; a sleeping member waits for real work', async () => {
    const t = makeBudgeted();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(ada.id) && t.engine.ready(coord.id));
    await t.engine.sleep(coord.id);
    await t.engine.sleep(ada.id);
    // As on main (only the topic is new); a decision, so not even a decision wakes a member.
    t.notices.add(ada.id, 'proposal.decided', 'Bilgi: toplantı yok.');
    const plan = t.company.propose(coord.id, { method: METHOD, title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    await until(() => systemMessages(t.events.list({ limit: 5000 }), coord.id).some((m) => m.includes('Plan onaylandı')), 8000);
    await sleep(300);
    expect(t.roster.get(ada.id).lifecycle).toBe('sleeping');
  });

  it('does not wake someone the owner stopped, even with work', async () => {
    const t = makeBudgeted();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await t.engine.stop(ada.id);
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'x' });
    await sleep(300);
    expect(t.roster.get(ada.id).lifecycle).toBe('stopped');
    expect(t.tasks.get(task.id).status).toBe('waiting');
  });

  it('reminds the coordinator once a day to report when something happened', async () => {
    const t = makeBudgeted();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    const reminders = () => systemMessages(t.events.list({ limit: 5000 }), coord.id).filter((m) => m.includes('Günlük özet zamanı'));
    t.advance(25 * 3_600_000);
    await sleep(300);
    expect(reminders()).toHaveLength(0);
    const task = t.company.createTask(coord.id, { assignee: ada.id, title: 'iş' });
    await until(() => t.tasks.get(task.id).status === 'in_progress', 8000);
    await until(() => reminders().length === 1, 8000);
    await sleep(300);
    expect(reminders()).toHaveLength(1);
    t.advance(25 * 3_600_000);
    await until(() => reminders().length === 2, 8000);
  });

  it('important: a sleeping lead wakes for a proposal to decide', async () => {
    const t = makeBudgeted();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r', team: 'İçerik' });
    const can = t.company.hire(coord.id, { name: 'Can', role: 'r', team: 'İçerik' });
    t.company.appointLead(coord.id, ada.id, { team: 'İçerik' });
    await until(() => t.engine.ready(ada.id), 8000);
    await t.engine.sleep(ada.id);
    t.company.openProposal(can.id, { kind: 'idea', title: 'Altyazı', text: 't' });
    await until(() => systemMessages(t.events.list({ limit: 5000 }), ada.id).some((m) => m.includes('Altyazı')), 8000);
  });
});

describe('Dispatcher — notice kinds and the digest', () => {
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
  /** Everything on one simulated clock: digest hours are local wall-clock hours. */
  function makeDigest(o: { unavailable?: string } = {}) {
    let clock = at(7, 10);
    const now = () => clock;
    const s = setup(8, now);
    const failFlag = join(tempDir('fake-claude-fail-'), 'fail');
    const f = fakeEngine(s, { env: { FAKE_CLAUDE_FAIL_FLAG: failFlag, FAKE_CLAUDE_UNAVAILABLE_MODELS: o.unavailable ?? '' }, engine: { now, modelPolicyEnabled: () => c.budget.constitution().modelPolicyEnabled } });
    const c = companyFor(s, f, undefined, now);
    // These tests are about the economy plan's features: all three switched on (they are off by default).
    c.budget.setConstitution({ idleSleepMinutes: 0, digestEnabled: true, modelPolicyEnabled: true, difficultyModelsEnabled: true });
    const run = () =>
      new Dispatcher({
        events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine,
        budget: c.budget, now, tickMs: 50,
      }).start();
    let stop = run();
    cleanups.push(() => stop(), f.cleanup, s.cleanup);
    return {
      ...s, ...c, engine: f.engine, argvLog: f.argvLog, setClock: (t: number) => (clock = t), turns: (id: string) => systemMessages(s.events.list({ limit: 5000 }), id),
      failNextStarts: (n: number) => writeFileSync(failFlag, String(n)),
      /** The office restarts: a new dispatcher over the same database. */
      restart: () => {
        stop();
        stop = run();
      },
    };
  }

  it('important: information alone opens no turn; a decision does, and the information rides on it as the digest', async () => {
    const t = makeDigest();
    const coord = t.company.hireCoordinator();
    await until(() => t.engine.ready(coord.id));
    t.notices.add(coord.id, 'task.finished', '“Yaz” (Ada): Yazıldı.\nAyrıntı ikinci satırda.');
    t.notices.add(coord.id, 'role.changed', 'Can artık İçerik ekibinin lideri.');
    await sleep(400);
    expect(t.turns(coord.id)).toEqual([]);
    const plan = t.company.propose(coord.id, { method: METHOD, title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    await until(() => t.turns(coord.id).length === 1, 8000);
    await sleep(300);
    const turns = t.turns(coord.id);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatch(/^Ofisten notlar:\n- Plan onaylandı/);
    expect(turns[0]).toContain('## Ofisten özet — 2 not, 10:00');
    expect(turns[0]).toContain('Teslimler (1):\n- “Yaz” (Ada): Yazıldı. Ayrıntı ikinci satırda.');
    expect(turns[0]).toContain('Rol/lider değişiklikleri (1):\n- Can artık İçerik ekibinin lideri.');
    // Under "open the tasks" the digest does not say "open no work".
    expect(turns[0]).not.toContain('Özet turunda beklenen yalnız kayıt');
    expect(t.notices.pending(coord.id)).toEqual([]);
  });

  it('important: information comes alone only at a digest hour it lived through, in one turn; an empty digest is skipped', async () => {
    const t = makeDigest();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(ada.id));
    t.notices.add(ada.id, 'role.changed', 'Can artık İçerik ekibinin lideri.');
    t.setClock(at(7, 12, 30));
    t.notices.add(ada.id, 'task.moved', '“Çeviri” görevi (no x) Can adlı çalışana verildi.');
    t.setClock(at(7, 16, 59));
    await sleep(300);
    expect(t.turns(ada.id)).toEqual([]);
    t.setClock(at(7, 17));
    await until(() => t.turns(ada.id).length === 1, 8000);
    t.setClock(at(7, 17, 30));
    t.notices.add(ada.id, 'role.changed', 'Ece işe alındı.');
    t.setClock(at(7, 23));
    await sleep(300);
    expect(t.turns(ada.id)).toHaveLength(1);
    expect(t.turns(ada.id)[0]).toMatch(/^## Ofisten özet — 2 not, 10:00–12:30\n/);
    expect(t.turns(ada.id)[0]).toContain('Görevler (1):');
    expect(t.turns(ada.id)[0]).toContain('Bu özet bilgi içindir');
    t.setClock(at(8, 9));
    await until(() => t.turns(ada.id).length === 2, 8000);
    expect(t.turns(ada.id)[1]).toMatch(/^## Ofisten özet — 1 not, 17:30\n/);
    t.setClock(at(8, 17));
    await sleep(300);
    t.setClock(at(9, 9));
    await sleep(300);
    expect(t.turns(ada.id)).toHaveLength(2);
  });

  it('review focus: the daily report reminder comes with the last digest hour, only when tasks moved since the last report', async () => {
    const t = makeDigest();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(coord.id) && t.engine.ready(ada.id));
    await t.engine.stop(ada.id);
    const task = t.company.createTask(coord.id, { assignee: ada.id, title: 'Yaz' });
    t.company.start(task.id);
    t.setClock(at(7, 11));
    t.company.finish(ada.id, task.id, { summary: 'Yazıldı.', outputs: [], learned: '' });
    t.setClock(at(7, 16, 59));
    await sleep(300);
    expect(t.turns(coord.id)).toEqual([]);
    t.setClock(at(7, 17));
    await until(() => t.turns(coord.id).length === 1, 8000);
    expect(t.turns(coord.id)[0]).toContain('Teslimler (1):\n- “Yaz” (Ada): Yazıldı.');
    expect(t.turns(coord.id)[0]).toContain('Günlük rapor zamanı');
    expect(t.turns(coord.id)[0]).toContain('Özet turunda beklenen yalnız kayıt');
    t.company.report(coord.id, 'Yaz bitti.');
    t.setClock(at(8, 9));
    await sleep(300);
    t.setClock(at(8, 17));
    await sleep(300);
    expect(t.turns(coord.id)).toHaveLength(1);
    t.setClock(at(8, 18));
    t.company.createTask(coord.id, { assignee: ada.id, title: 'Düzelt' });
    t.setClock(at(9, 9));
    await sleep(300);
    expect(t.turns(coord.id)).toHaveLength(1);
    t.setClock(at(9, 17));
    await until(() => t.turns(coord.id).length === 2, 8000);
    expect(t.turns(coord.id)[1]).toMatch(/^## Ofisten özet — yeni not yok\n/);
    expect(t.turns(coord.id)[1]).toContain('Günlük rapor zamanı');
    await sleep(300);
    expect(t.turns(coord.id)).toHaveLength(2);
  });

  it('R10: notices never wake a member, a decision wakes the coordinator, and with the digest on information wakes no one', async () => {
    const t = makeDigest();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(coord.id) && t.engine.ready(ada.id));
    await t.engine.sleep(coord.id);
    await t.engine.sleep(ada.id);
    t.notices.add(coord.id, 'task.finished', 'Görev bitti: “Yaz” (Ada): Yazıldı.');
    t.notices.add(ada.id, 'proposal.decided', '“Altyazı” önerin kabul edildi.');
    t.setClock(at(7, 17));
    await sleep(400);
    expect([t.roster.get(coord.id).lifecycle, t.roster.get(ada.id).lifecycle]).toEqual(['sleeping', 'sleeping']);
    t.notices.add(coord.id, 'task.blocked', 'Ada “Çiz” görevinde takıldı.');
    await until(() => t.turns(coord.id).length === 1, 8000);
    expect(t.turns(coord.id)[0]).toMatch(/^Ofisten notlar:\n- Ada “Çiz” görevinde takıldı\./);
    expect(t.turns(coord.id)[0]).toContain('“Yaz” (Ada): Yazıldı.');
    // The member's decision waits for their next waking (spec §3.4, as on main).
    await sleep(300);
    expect(t.roster.get(ada.id).lifecycle).toBe('sleeping');
    const task = t.company.createTask(coord.id, { assignee: ada.id, title: 'Çeviri' });
    await until(() => t.tasks.get(task.id).status === 'in_progress', 8000);
    expect(t.turns(ada.id)[0]).toMatch(/^Ofisten notlar:\n- “Altyazı” önerin kabul edildi\./);
  });

  it('review focus: in the owner’s reserve information opens no turn, even at a digest hour; it waits for the next turn', async () => {
    const t = makeDigest();
    const coord = t.company.hireCoordinator();
    await until(() => t.engine.ready(coord.id));
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.9, resetsAt: at(7, 20) }, sevenDay: null, updatedAt: at(7, 10) });
    t.budget.checkReserve();
    await until(() => t.turns(coord.id).length === 1, 8000);
    expect(t.turns(coord.id)[0]).toContain('kota payı devrede');
    t.notices.add(coord.id, 'task.finished', '“Yaz” (Ada): Yazıldı.');
    t.setClock(at(7, 17));
    await sleep(400);
    expect(t.turns(coord.id)).toHaveLength(1);
    t.setQuota(null);
    t.budget.checkReserve();
    await until(() => t.turns(coord.id).length === 2, 8000);
    expect(t.turns(coord.id)[1]).toContain('serbest kaldı');
    expect(t.turns(coord.id)[1]).toContain('Teslimler (1)');
  });

  it('important: the coordinator’s decisions go on its decision model, a digest alone on its digest model; a task starts on its difficulty’s', async () => {
    const t = makeDigest();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(coord.id) && t.engine.ready(ada.id));
    const plan = t.company.propose(coord.id, { method: METHOD, title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    await until(() => t.turns(coord.id).length === 1 && t.engine.ready(coord.id), 8000);
    t.notices.add(coord.id, 'task.finished', '“Yaz” (Ada): Yazıldı.');
    t.setClock(at(7, 17));
    await until(() => t.turns(coord.id).length === 2 && t.engine.ready(coord.id), 8000);
    t.company.createTask(coord.id, { assignee: ada.id, title: 'Mimari', difficulty: 'hard' });
    await until(() => t.turns(ada.id).some((m) => m.includes('## Görev: Mimari')), 8000);
    expect(t.turns(ada.id).find((m) => m.includes('## Görev: Mimari'))).toContain('Zorluk: zor · Model: opus');
    const argv = await readArgv(t.argvLog, 5);
    const models = (who: string) => argv.filter((a) => a.cwd.includes(who)).map((a) => a.args[a.args.indexOf('--model') + 1]);
    expect(models('koordinator')).toEqual(['fable', 'sonnet', 'haiku']);
    expect(models('ada')).toEqual(['sonnet', 'opus']);
    // In the middle of the task (the office's reminder about it) the model stays.
    t.notices.add(ada.id, 'proposal.decided', '“Altyazı” önerin kabul edildi.');
    await until(() => t.turns(ada.id).some((m) => m.startsWith(NUDGE_PREFIX) || m.includes('Altyazı')), 8000);
    await until(() => t.engine.ready(ada.id), 8000);
    expect((await readArgv(t.argvLog, 5)).filter((a) => a.cwd.includes('ada')).map((a) => a.args[a.args.indexOf('--model') + 1])).toEqual(['sonnet', 'opus']);
  });

  it('review focus: the report reminder is not repeated for the same digest hour after a restart', async () => {
    const t = makeDigest();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(coord.id) && t.engine.ready(ada.id));
    await t.engine.stop(ada.id);
    t.company.createTask(coord.id, { assignee: ada.id, title: 'Yaz' });
    t.setClock(at(7, 17));
    await until(() => t.turns(coord.id).some((m) => m.includes('Günlük rapor zamanı')), 8000);
    t.restart();
    t.setClock(at(7, 17, 30));
    await sleep(400);
    expect(t.turns(coord.id).filter((m) => m.includes('Günlük rapor zamanı'))).toHaveLength(1);
    t.setClock(at(8, 17));
    await until(() => t.turns(coord.id).filter((m) => m.includes('Günlük rapor zamanı')).length === 2, 8000);
  });

  it('review focus: a sleeping member waits for their notices, in the reserve too; urgent work still wakes them', async () => {
    const t = makeDigest();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(coord.id) && t.engine.ready(ada.id));
    await t.engine.sleep(coord.id);
    await t.engine.sleep(ada.id);
    t.notices.add(ada.id, 'task.taken', '“Çeviri” görevi (no x) Can adlı çalışana verildi; üzerinde çalışmayı bırak.');
    await sleep(300);
    expect(t.roster.get(ada.id).lifecycle).toBe('sleeping');
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.9, resetsAt: at(7, 20) }, sevenDay: null, updatedAt: at(7, 10) });
    t.budget.checkReserve();
    t.notices.add(ada.id, 'proposal.decided', '“Altyazı” önerin kabul edildi.');
    await until(() => t.turns(coord.id).some((m) => m.includes('kota payı devrede')), 8000);
    await sleep(300);
    expect(t.roster.get(ada.id).lifecycle).toBe('sleeping');
    const urgent = t.company.createTask(coord.id, { assignee: ada.id, title: 'Acil', priority: 1 });
    await until(() => t.tasks.get(urgent.id).status === 'in_progress', 8000);
    expect(t.turns(ada.id)[0]).toContain('önerin kabul edildi');
  });

  it('critical: a task’s model is for that task: one without a difficulty runs on the employee’s own model, which only setModel changes', async () => {
    const t = makeDigest();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r', model: 'opus' });
    await until(() => t.engine.ready(ada.id));
    const run = async (title: string, difficulty?: 'easy') => {
      const task = t.company.createTask(coord.id, { assignee: ada.id, title, difficulty });
      await until(() => t.turns(ada.id).some((m) => m.includes(`## Görev: ${title}`)), 8000);
      t.company.finish(ada.id, task.id, { summary: 'tamam', outputs: [], learned: '' });
      await until(() => t.engine.ready(ada.id), 8000);
    };
    await run('Kolay iş', 'easy');
    expect(t.roster.get(ada.id).model).toBe('opus');
    await run('Zorluksuz iş');
    t.company.setModel(coord.id, ada.id, 'sonnet');
    await run('Yine zorluksuz');
    const models = (await readArgv(t.argvLog, 5)).filter((a) => a.cwd.includes('ada') && !a.args.includes('json')).map((a) => a.args[a.args.indexOf('--model') + 1]);
    expect(models).toEqual(['opus', 'haiku', 'opus', 'sonnet']);
  });

  it('critical: a delivery lost because no session would start puts the task and its notices back; they come again on resume', async () => {
    const t = makeDigest();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(ada.id));
    // A whole turn first: the session's process has surely started before the next starts are made to fail.
    t.engine.send(ada.id, 'merhaba', 'system');
    await until(() => t.events.list({ employeeId: ada.id, limit: 500 }).some((e) => e.event.type === 'turn.finished') && t.engine.ready(ada.id), 8000);
    t.failNextStarts(2);
    t.notices.add(ada.id, 'proposal.decided', '“Altyazı” önerin kabul edildi.');
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Mimari', difficulty: 'hard' });
    await until(() => t.roster.get(ada.id).lifecycle === 'error', 8000);
    await until(() => t.tasks.get(task.id).status === 'waiting', 8000);
    expect(t.notices.pending(ada.id).map((n) => n.topic)).toEqual(['proposal.decided']);
    t.engine.resume(ada.id);
    await until(() => t.tasks.get(task.id).status === 'in_progress' && t.engine.ready(ada.id), 8000);
    const deliveries = t.turns(ada.id).filter((m) => m.includes('## Görev: Mimari'));
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toContain('önerin kabul edildi');
    expect(t.notices.pending(ada.id)).toEqual([]);
  });

  it('R7: with the digest switched off, information goes at once like a decision (as before the economy plan)', async () => {
    const t = makeDigest();
    t.budget.setConstitution({ digestEnabled: false });
    const coord = t.company.hireCoordinator();
    await until(() => t.engine.ready(coord.id));
    t.notices.add(coord.id, 'task.finished', '“Yaz” (Ada): Yazıldı.');
    await until(() => t.turns(coord.id).length === 1, 8000);
    expect(t.turns(coord.id)[0]).toBe('Ofisten notlar:\n- “Yaz” (Ada): Yazıldı.');
    await until(() => t.engine.ready(coord.id), 8000);
    await t.engine.sleep(coord.id);
    t.notices.add(coord.id, 'role.changed', 'Can artık İçerik ekibinin lideri.');
    await until(() => t.turns(coord.id).length === 2, 8000);
    t.budget.setConstitution({ digestEnabled: true });
    await until(() => t.engine.ready(coord.id), 8000);
    t.notices.add(coord.id, 'task.finished', '“Çiz” (Can): Çizildi.');
    await sleep(400);
    expect(t.turns(coord.id)).toHaveLength(2);
  });

  it('R7: with difficulty models switched off a task starts on its assignee’s own model; the difficulty is kept', async () => {
    const t = makeDigest();
    t.budget.setConstitution({ difficultyModelsEnabled: false });
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r', model: 'opus' });
    await until(() => t.engine.ready(ada.id));
    const task = t.company.createTask(coord.id, { assignee: ada.id, title: 'Kolay iş', difficulty: 'easy' });
    await until(() => t.turns(ada.id).some((m) => m.includes('## Görev: Kolay iş')), 8000);
    // Off is as on main: no difficulty line in the task message; the difficulty is kept.
    expect(t.turns(ada.id)[0]).not.toContain('Zorluk');
    expect(t.tasks.get(task.id).difficulty).toBe('easy');
    await until(() => t.engine.ready(ada.id), 8000);
    const models = (await readArgv(t.argvLog, 2)).filter((a) => a.cwd.includes('ada')).map((a) => a.args[a.args.indexOf('--model') + 1]);
    expect(models).toEqual(['opus']);
  });

  it('R13: a task whose model the account cannot use is not lost: it runs on the old model with its notices, and the switch failure is in the log', async () => {
    const t = makeDigest({ unavailable: 'opus' });
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(ada.id) && t.engine.ready(coord.id));
    t.notices.add(ada.id, 'proposal.decided', '“Altyazı” önerin kabul edildi.');
    const task = t.company.createTask(coord.id, { assignee: ada.id, title: 'Mimari', difficulty: 'hard' });
    const said = () => t.events.list({ employeeId: ada.id, limit: 5000 }).flatMap((e) => (e.event.type === 'message.assistant' ? [e.event.text] : []));
    await until(() => said().some((x) => x.startsWith('echo: ') && x.includes('## Görev: Mimari')), 8000);
    expect(said().find((x) => x.startsWith('echo: '))).toContain('önerin kabul edildi');
    expect(t.events.list({ employeeId: ada.id, limit: 5000 }).find((e) => e.event.type === 'model.switch.failed')?.event).toMatchObject({ from: 'sonnet', to: 'opus' });
    expect(t.tasks.get(task.id).status).toBe('in_progress');
    expect(t.notices.pending(ada.id)).toEqual([]);
    const models = (await readArgv(t.argvLog, 4)).filter((a) => a.cwd.includes('ada')).map((a) => a.args[a.args.indexOf('--model') + 1]);
    expect(models).toEqual(['sonnet', 'opus', 'sonnet']);
  });
});

describe('Dispatcher — reviews', () => {
  it('delivers a review task with reviewDecide instructions; a sent-back task comes back with the findings', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Metin', done: ['iki cümle'], reviewer: can.id });
    await waitFor(t.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('İnceleyen: Can'));
    t.company.finish(ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '', evidence: ['metin.md'] });
    const reviewMsg = await waitFor(t.events, (e) => e.employeeId === can.id && e.event.type === 'message.user' && e.event.text.includes('İnceleme: Metin'));
    const text = (reviewMsg.event as { text: string }).text;
    expect(text).toContain('reviewDecide');
    expect(text).not.toContain('`taskFinish` ile teslim et');
    const review = t.tasks.list({ assignee: can.id }).find((x) => x.kind === 'review')!;
    t.company.reviewDecide(can.id, review.id, { decision: 'changes', findings: [{ severity: 'important', text: 'üç cümle olmuş' }] });
    const back = await waitFor(t.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('değişiklik istendi'));
    expect((back.event as { text: string }).text).toContain('[önemli] üç cümle olmuş');
  });

  it('reminds a reviewer to decide with reviewDecide', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Metin', reviewer: can.id });
    await until(() => t.tasks.get(task.id).status === 'in_progress', 8000);
    t.company.finish(ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '' });
    await until(() => systemMessages(t.events.list({ limit: 5000 }), can.id).some((m) => m.startsWith(NUDGE_PREFIX)), 8000);
    expect(systemMessages(t.events.list({ limit: 5000 }), can.id).find((m) => m.startsWith(NUDGE_PREFIX))).toContain('reviewDecide');
  });
});

describe('Dispatcher — a paused company', () => {
  it('hands out nothing while paused — no task, no notice, no wake — and delivers what waited, once, on resume', async () => {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget });
    const stop = dispatcher.start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await until(() => f.engine.ready(ada.id), 8000);
    c.company.pause();
    const task = c.company.createTask(OWNER, { assignee: ada.id, title: 'Duraklatılmışken' });
    await sleep(600);
    expect(c.tasks.get(task.id).status).toBe('waiting');
    expect(systemMessages(s.events.list({ limit: 5000 }), ada.id)).toHaveLength(0);
    c.company.resume();
    await waitFor(s.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('Duraklatılmışken'));
    await sleep(300);
    // One delivery (a later reminder about the open task may follow; it is not a second delivery).
    expect(systemMessages(s.events.list({ limit: 5000 }), ada.id).filter((m) => m.startsWith('## Görev: Duraklatılmışken'))).toHaveLength(1);
  });

  it('runs the pulse on its tick: a goal with no plan reaches the coordinator as a decision', async () => {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const coordinator = c.company.hireCoordinator('sonnet');
    c.company.goalSet(coordinator.id, { title: 'Lansman', why: 'misyon', done: ['site'] });
    const pulse = new Pulse({ company: c.company, roster: s.roster, goals: c.goals, state: c.state, plans: c.plans, tasks: c.tasks, notices: c.notices, budget: c.budget });
    const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget, pulse, tickMs: 200 });
    const stop = dispatcher.start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    const msg = await waitFor(s.events, (e) => e.employeeId === coordinator.id && e.event.type === 'message.user' && e.event.text.includes('Lansman'));
    expect((msg.event as { text: string }).text).toContain('goalSet');
  });
});

describe('Dispatcher — time', () => {
  it('does not hand out a task before its start time; a parked task frees the slot and the next task is delivered', async () => {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget });
    const stop = dispatcher.start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const timed = c.company.createTask(OWNER, { assignee: ada.id, title: 'Saatli iş', startAfter: '+1d' });
    const first = c.company.createTask(OWNER, { assignee: ada.id, title: 'İlk iş' });
    await waitFor(s.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('İlk iş'));
    expect(c.tasks.get(timed.id).status).toBe('waiting');
    const second = c.company.createTask(OWNER, { assignee: ada.id, title: 'İkinci iş' });
    c.company.parkTask(ada.id, first.id, '+2h', 'pencere');
    await waitFor(s.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('İkinci iş'));
    expect(c.tasks.get(second.id).status).toBe('in_progress');
    expect(c.tasks.get(first.id).status).toBe('parked');
    const text = (s.events.list({ limit: 5000 }).findLast((e) => e.employeeId === ada.id && e.event.type === 'message.user')!.event as { text: string }).text;
    expect(text).not.toContain('Son tarih');
  });

  it('names the due date and the start time in the delivery when they are set', async () => {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const stop = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget }).start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
    c.company.createTask(OWNER, { assignee: ada.id, title: 'Tarihli', dueAt: '+2d' });
    const msg = await waitFor(s.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('Tarihli'));
    expect((msg.event as { text: string }).text).toMatch(/Son tarih: .*\d\d:\d\d/);
  });

  it('with a clock, the dispatcher’s tick is a clock job and a park return sweeps: a sleeping employee is woken when their task comes back', async () => {
    let now = Date.now();
    const s = setup(8, () => now);
    const f = fakeEngine(s, { engine: { now: () => now } });
    const c = companyFor(s, f, undefined, () => now);
    // Typed by assertion: a plain annotation would narrow it to null here (the timer sets it inside a closure).
    let pending = null as (() => void) | null;
    const timers = { set: (fn: () => void) => ((pending = fn), 1), clear: () => void (pending = null) };
    const clock = new Clock({ scheduling: c.scheduling, state: c.state, events: s.events, now: () => now, timers });
    // The tick's first step is the reserve check: counting it shows when the clock ran the tick.
    let ticks = 0;
    const checkReserve = c.budget.checkReserve.bind(c.budget);
    c.budget.checkReserve = () => {
      ticks += 1;
      checkReserve();
    };
    const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget, clock, now: () => now });
    cleanups.push(dispatcher.start(), clock.start(), f.cleanup, s.cleanup);
    expect(ticks).toBe(1);
    const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await until(() => f.engine.ready(ada.id), 8000);
    const task = c.company.createTask(OWNER, { assignee: ada.id, title: 'Parklı' });
    await until(() => c.tasks.get(task.id).status === 'in_progress', 8000);
    c.company.parkTask(ada.id, task.id, '+1h', 'bekle');
    // The engine puts only an idle employee to sleep: the delivery's turn ends first.
    await until(() => f.engine.ready(ada.id), 8000);
    await f.engine.sleep(ada.id);
    expect(s.roster.get(ada.id).lifecycle).toBe('sleeping');
    now += 61 * 60_000;
    pending?.(); // the clock's timer fires
    expect(ticks).toBe(2);
    await until(() => s.roster.get(ada.id).lifecycle !== 'sleeping', 8000);
    await until(() => c.tasks.get(task.id).status === 'in_progress', 8000);
  });

  it('a job that held someone past the cap reaches the coordinator as a decision: who, which job, the process lives, tasks go to them', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.events.append(c.id, { type: 'background.overdue', jobs: ['kendi işi'], limitMs: 2 * 60 * 60_000 });
    t.events.append(ada.id, { type: 'background.overdue', jobs: ['pnpm dev', 'mutasyon koşusu'], limitMs: 2 * 60 * 60_000 });
    await until(() => systemMessages(t.events.list({ limit: 5000 }), c.id).some((m) => m.includes('pnpm dev')), 8000);
    const told = systemMessages(t.events.list({ limit: 5000 }), c.id).find((m) => m.includes('pnpm dev'))!;
    expect(told).toContain(NOTICES_PREFIX);
    expect(told).toContain('Ada adlı çalışanın arka plan işi (pnpm dev, mutasyon koşusu) 2 saattir tek başına sürüyor.');
    expect(told).toContain('Süreç öldürülmedi');
    expect(told).toContain('Ada yeniden görev alabilir');
    // Its own job is not a matter for the coordinator to decide about.
    expect(systemMessages(t.events.list({ limit: 5000 }), c.id).some((m) => m.includes('kendi işi'))).toBe(false);
  });
});

