import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type StoredEvent } from '@cc/shared';
import { Company } from '../src/company/company.ts';
import { Dispatcher, NOTICES_PREFIX, NUDGE_PREFIX } from '../src/company/dispatcher.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, until, waitFor } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  const tasks = new TaskStore(s.db);
  const plans = new PlanStore(s.db);
  const notices = new NoticeStore(s.db);
  const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => ['coder'] });
  const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks, notices, plans, company, engine: f.engine });
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
    const plan = t.company.propose(c.id, { title: 'Video', goal: 'g', approach: 'a' });
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

  it('final review: tells the coordinator once when someone stalls after the reminder', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    t.company.createTask(c.id, { assignee: ada.id, title: 'Uzun iş' });
    const escalations = () => systemMessages(t.events.list({ limit: 5000 }), c.id).filter((m) => m.includes('teslim etmedi'));
    await until(() => escalations().length > 0, 8000);
    await sleep(800);
    expect(escalations()).toHaveLength(1);
    expect(escalations()[0]).toContain('Uzun iş');
  });
});

describe('Dispatcher — hand-over and the brief', () => {
  function makeFull() {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const stop = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine }).start();
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
});
