import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION } from '@cc/shared';
import { migrateUp, openDb } from '../src/db.ts';
import { ConstitutionStore, SpendStore } from '../src/company/budget-store.ts';
import { TaskStore } from '../src/company/store.ts';

function stores() {
  const db = openDb(':memory:');
  migrateUp(db);
  let t = 1_000;
  const now = () => (t += 10);
  return { constitution: new ConstitutionStore(db), spend: new SpendStore(db, now), tasks: new TaskStore(db, now) };
}

describe('ConstitutionStore', () => {
  it('starts from the defaults and keeps what the owner changed', () => {
    const { constitution } = stores();
    expect(constitution.get()).toEqual(DEFAULT_CONSTITUTION);
    expect(constitution.set({ ownerReservePct: 40, monthlyUsdCap: 50 })).toEqual({ ...DEFAULT_CONSTITUTION, ownerReservePct: 40, monthlyUsdCap: 50 });
    expect(constitution.set({ monthlyUsdCap: null }).monthlyUsdCap).toBeNull();
    expect(constitution.get().ownerReservePct).toBe(40);
  });
});

describe('SpendStore', () => {
  it('records spending newest first and totals it by plan and since a time', () => {
    const { spend } = stores();
    const a = spend.create({ by: 'e1', service: 'ElevenLabs', usd: 5, purpose: 'ses', planId: 'p1' });
    spend.create({ by: 'e1', service: 'Canva', usd: 12.5, purpose: 'görsel', planId: 'p1' });
    spend.create({ by: 'e2', service: 'Alan adı', usd: 10, purpose: 'site', planId: null });
    expect(spend.list().map((s) => s.service)).toEqual(['Alan adı', 'Canva', 'ElevenLabs']);
    expect(spend.list({ planId: 'p1' })).toHaveLength(2);
    expect(spend.total()).toBe(27.5);
    expect(spend.total({ planId: 'p1' })).toBe(17.5);
    expect(spend.total({ since: a.ts + 1 })).toBe(22.5);
    expect(spend.byPlan()).toEqual({ p1: 17.5 });
  });
});

describe('TaskStore — Claude usage', () => {
  it('adds each turn to the task and sums it per plan', () => {
    const { tasks } = stores();
    const base = { title: 'x', description: '', done: [], requester: 'owner', assignee: 'e1', priority: 3, dependsOn: [], chainDepth: 0 };
    const a = tasks.create({ ...base, planId: 'p1' });
    const b = tasks.create({ ...base, planId: 'p1' });
    const c = tasks.create({ ...base, planId: null });
    tasks.charge(a.id, 0.25, 1000);
    tasks.charge(a.id, 0.25, 500);
    tasks.charge(b.id, 0.1, 10);
    tasks.charge(c.id, 9, 9);
    expect(tasks.costByPlan()).toEqual({ p1: 0.6 });
  });
});
