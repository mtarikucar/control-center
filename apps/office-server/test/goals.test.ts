import { afterEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../src/errors.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(autonomy?: 'free' | 'plans') {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f);
  if (autonomy) c.budget.setConstitution({ autonomy });
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  return { ...s, ...c, coordinator, ada };
}

const GOAL = { title: 'İlk müşteriler', why: 'Misyon: küçük işletmelere ulaşmak', done: ['10 görüşme', '2 ödeme yapan müşteri'] };

describe('goals (spec §6.1)', () => {
  it('the coordinator sets a goal with why and a definition of done; the screen hears', () => {
    const t = make();
    const goal = t.company.goalSet(t.coordinator.id, GOAL);
    expect(goal).toMatchObject({ ...GOAL, status: 'active', createdBy: t.coordinator.id });
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'goal.changed' && e.event.change === 'set' && e.event.goal.id === goal.id)).toBe(true);
    expect(t.company.goals().map((g) => g.id)).toEqual([goal.id]);
  });

  it('refuses a goal without why or done items, malformed input, and anyone but the coordinator', () => {
    const t = make();
    expect(() => t.company.goalSet(t.coordinator.id, { ...GOAL, why: ' ' })).toThrow(/Neden/);
    expect(() => t.company.goalSet(t.coordinator.id, { ...GOAL, done: [] })).toThrow(/bitti tanımı/);
    expect(() => t.company.goalSet(t.coordinator.id, { ...GOAL, done: 'iki müşteri' as unknown as string[] })).toThrow(/liste/);
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: 'yok', status: 'done' })).toThrow(/Hedef bulunamadı/);
    expect(() => t.company.goalSet(t.ada.id, GOAL)).toThrow(/koordinatör/);
    expect(t.goals.list()).toHaveLength(0);
  });

  it('keeps at most the constitution’s number of active goals; closing one makes room; reopening counts again', () => {
    const t = make();
    t.budget.setConstitution({ activeGoals: 3 });
    const ids = [1, 2, 3].map((n) => t.company.goalSet(t.coordinator.id, { ...GOAL, title: `Hedef ${n}` }).id);
    expect(() => t.company.goalSet(t.coordinator.id, { ...GOAL, title: 'Hedef 4' })).toThrow(/En fazla 3 aktif hedef/);
    const closed = t.company.goalSet(t.coordinator.id, { goalId: ids[0], status: 'done', note: 'ulaşıldı' });
    expect(closed).toMatchObject({ status: 'done', note: 'ulaşıldı' });
    expect(closed.closedAt).not.toBeNull();
    t.company.goalSet(t.coordinator.id, { ...GOAL, title: 'Hedef 4' });
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: ids[0], status: 'active' })).toThrow(/En fazla 3 aktif hedef/);
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: ids[1], status: 'bekliyor' })).toThrow(/active, done ya da dropped/);
  });

  it('a plan may serve an active goal; not a closed one or one that does not exist', () => {
    const t = make();
    const goal = t.company.goalSet(t.coordinator.id, GOAL);
    const plan = t.company.propose(t.coordinator.id, { title: 'Görüşmeler', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id });
    expect(plan.goalId).toBe(goal.id);
    t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'dropped' });
    expect(() => t.company.propose(t.coordinator.id, { title: 'P2', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id })).toThrow(/aktif değil/);
    expect(() => t.company.propose(t.coordinator.id, { title: 'P3', goal: 'g', approach: 'a', method: METHOD, goalId: 'yok' })).toThrow(/Hedef bulunamadı/);
  });
});

describe('closing a goal settles its plans (management cycle §3.4)', () => {
  type T = ReturnType<typeof make>;
  const plan = (t: T, title: string, goalId: string, streams?: unknown[]) => t.company.propose(t.coordinator.id, { title, goal: 'g', approach: 'a', method: METHOD, goalId, streams });
  const work = (t: T, assignee: string, title: string, planId: string, streamId?: string) => t.company.createTask(t.coordinator.id, { assignee, title, planId, streamId });
  const finish = (t: T, who: string, id: string) => {
    t.company.start(id);
    t.company.finish(who, id, { summary: 'tamam', outputs: [], learned: '' });
  };
  const lastSeq = (t: T) => t.events.list({ tail: true, limit: 1 })[0]!.seq;
  /** The goal and plan changes logged after `seq`: [type, change, title]. */
  const changesAfter = (t: T, seq: number) =>
    t.events.list({ after: seq, limit: 1000 }).flatMap((e) =>
      e.event.type === 'plan.changed' ? [['plan', e.event.change, e.event.plan.title]] : e.event.type === 'goal.changed' ? [['goal', e.event.change, e.event.goal.title]] : [],
    );
  const retroNotices = (t: T) => t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'plan.retro').length;

  it('a reached goal: its plan with a stream that never had a task (the coordinator did that part itself) is done with it, no longer running; a plan still waiting for the owner is stopped; the screen hears each, no retro notice; reopening the goal reopens no plan', () => {
    const t = make('free');
    const can = t.company.hire(t.coordinator.id, { name: 'Can', role: 'r' });
    const goal = t.company.goalSet(t.coordinator.id, GOAL);
    const tool = plan(t, 'Araç', goal.id, [
      { id: 'temel', title: 'Temel', owner: t.coordinator.id },
      { id: 'cekirdek', title: 'Çekirdek', owner: 'Ada', dependsOn: ['temel'] },
      { id: 'arayuz', title: 'Arayüz', owner: 'Can', dependsOn: ['temel'] },
      { id: 'butun', title: 'Bütün', owner: 'Ada', dependsOn: ['cekirdek', 'arayuz'] },
    ]);
    for (const [who, stream] of [[t.ada.id, 'cekirdek'], [can.id, 'arayuz'], [t.ada.id, 'butun']] as const) finish(t, who, work(t, who, stream, tool.id, stream).id);
    t.budget.setConstitution({ autonomy: 'plans' });
    const waiting = plan(t, 'Sonraki', goal.id);
    // Every task closed, but one stream never had one: the plan runs on, as the trial found.
    expect(t.plans.get(tool.id).status).toBe('approved');
    expect(waiting.status).toBe('draft');
    expect(t.company.hasRunningPlan()).toBe(true);
    const seq = lastSeq(t);
    const before = retroNotices(t);
    const closed = t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'done', note: 'ulaşıldı' });
    expect(closed).toMatchObject({ status: 'done', note: 'ulaşıldı' });
    expect(t.plans.get(tool.id).status).toBe('done');
    expect(t.plans.get(waiting.id).status).toBe('stopped');
    expect(t.company.hasRunningPlan()).toBe(false);
    expect(changesAfter(t, seq)).toEqual([['goal', 'closed', GOAL.title], ['plan', 'done', 'Araç'], ['plan', 'stopped', 'Sonraki']]);
    // The coordinator closes the goal itself: no notice telling it to assess the plan.
    expect(retroNotices(t)).toBe(before);
    t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'active' });
    expect(t.plans.get(tool.id).status).toBe('done');
    expect(t.plans.get(waiting.id).status).toBe('stopped');
  });

  it('a goal whose plans still hold open work is not closed: the refusal names each plan and what is open and says what to do; nothing changes', () => {
    const t = make('free');
    const goal = t.company.goalSet(t.coordinator.id, GOAL);
    const site = plan(t, 'Site', goal.id);
    const upkeep = plan(t, 'Bakım', goal.id);
    plan(t, 'Boş', goal.id);
    const running = work(t, t.ada.id, 'Sayfalar', site.id);
    t.company.start(running.id);
    work(t, t.ada.id, 'Formlar', site.id);
    t.company.createSchedule(t.coordinator.id, { title: 'Ölçüm', assignee: t.ada.id, cron: '0 9 * * *', planId: upkeep.id });
    const seq = lastSeq(t);
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'done', note: 'ulaşıldı' })).toThrow(
      new ConflictError(
        '“İlk müşteriler” hedefi kapanmadı: “Site” planında 2 açık görev, “Bakım” planında 1 açık rutin var. Önce açık görevleri bitir (taskFinish) ya da vazgeçiyorsan sahibinden planı durdurmasını iste (reportToOwner); rutini scheduleUpdate ile durdur (status: stopped). Ya da hedefi şimdilik açık tut.',
      ),
    );
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'dropped' })).toThrow(/hedefi kapanmadı: “Site” planında 2 açık görev/);
    expect(t.goals.get(goal.id)).toMatchObject({ status: 'active', note: null, closedAt: null });
    expect(t.plans.list().map((p) => p.status)).toEqual(['approved', 'approved', 'approved']);
    expect(t.tasks.get(running.id).status).toBe('in_progress');
    expect(t.events.list({ after: seq, limit: 100 })).toEqual([]);
  });

  it('a live routine is open work too, paused as well as active; once stopped (its plan finishes with it) the goal closes', () => {
    const t = make('free');
    const goal = t.company.goalSet(t.coordinator.id, GOAL);
    const upkeep = plan(t, 'Bakım', goal.id);
    const routine = t.company.createSchedule(t.coordinator.id, { title: 'Ölçüm', assignee: t.ada.id, cron: '0 9 * * *', planId: upkeep.id });
    t.company.updateSchedule(t.coordinator.id, routine.id, { status: 'paused' });
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'done' })).toThrow(/“Bakım” planında 1 açık rutin var\. Önce rutini scheduleUpdate ile durdur \(status: stopped\)\. Ya da/);
    t.company.updateSchedule(t.coordinator.id, routine.id, { status: 'stopped' });
    expect(t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'done' }).status).toBe('done');
    expect(t.plans.get(upkeep.id).status).toBe('done');
  });

  it('a revision waiting for the owner still holds its plan’s open work: refused the same; once the work is closed the plan stops with the goal, the revision with it', () => {
    const t = make('plans');
    const goal = t.company.goalSet(t.coordinator.id, GOAL);
    const site = plan(t, 'Site', goal.id);
    t.company.approve(site.id);
    const task = work(t, t.ada.id, 'Sayfalar', site.id);
    t.company.revise(t.coordinator.id, site.id, { days: 3 });
    expect(t.plans.get(site.id).status).toBe('draft');
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'done' })).toThrow(/“Site” planında 1 açık görev var/);
    finish(t, t.ada.id, task.id);
    t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'done' });
    expect(t.plans.get(site.id).status).toBe('stopped');
    expect(t.plans.approvedSnapshot(site.id)).toBeNull();
  });

  it('a dropped goal: its running plan is stopped, one waiting for the owner too; the screen hears each', () => {
    const t = make('free');
    const goal = t.company.goalSet(t.coordinator.id, GOAL);
    const site = plan(t, 'Site', goal.id);
    finish(t, t.ada.id, work(t, t.ada.id, 'Taslak', site.id).id);
    // Its only task closed: the plan is done already, and stays so.
    expect(t.plans.get(site.id).status).toBe('done');
    const blog = plan(t, 'Blog', goal.id, [{ id: 'yazi', title: 'Yazılar', owner: 'Ada' }]);
    t.budget.setConstitution({ autonomy: 'plans' });
    const ads = plan(t, 'Reklam', goal.id);
    const other = t.company.goalSet(t.coordinator.id, { ...GOAL, title: 'Başka' });
    const elsewhere = plan(t, 'Başka plan', other.id);
    const seq = lastSeq(t);
    t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'dropped', note: 'vazgeçildi' });
    expect([site, blog, ads, elsewhere].map((p) => t.plans.get(p.id).status)).toEqual(['done', 'stopped', 'stopped', 'draft']);
    expect(changesAfter(t, seq)).toEqual([['goal', 'closed', GOAL.title], ['plan', 'stopped', 'Blog'], ['plan', 'stopped', 'Reklam']]);
  });
});
