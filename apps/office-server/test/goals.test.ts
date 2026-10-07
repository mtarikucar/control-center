import { afterEach, describe, expect, it } from 'vitest';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f);
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
