import { describe, expect, it } from 'vitest';
import { migrateUp, openDb } from '../src/db.ts';
import { CompanyStateStore, GoalStore } from '../src/company/goal-store.ts';
import { PlanStore } from '../src/company/store.ts';

function stores() {
  const db = openDb(':memory:');
  migrateUp(db);
  let t = 1_000;
  const now = () => (t += 1);
  return { goals: new GoalStore(db, now), state: new CompanyStateStore(db), plans: new PlanStore(db, now) };
}

describe('GoalStore', () => {
  it('creates, reads, lists by status, updates and counts the active goals', () => {
    const { goals } = stores();
    const a = goals.create({ title: 'Lansman', why: 'Müşteri bulmak', done: ['site yayında'], createdBy: 'c' });
    expect(a).toMatchObject({ status: 'active', closedAt: null, note: null, done: ['site yayında'] });
    expect(goals.get(a.id)).toEqual(a);
    const b = goals.create({ title: 'Destek', why: 'Memnuniyet', done: ['yanıt < 1 gün'], createdBy: 'c' });
    expect(goals.activeCount()).toBe(2);
    const closed = goals.update(b.id, { status: 'done', closedAt: 5000, note: 'bitti' });
    expect(closed).toMatchObject({ status: 'done', closedAt: 5000, note: 'bitti' });
    expect(goals.activeCount()).toBe(1);
    expect(goals.list({ statuses: ['active'] }).map((g) => g.id)).toEqual([a.id]);
    expect(goals.list().map((g) => g.id)).toEqual([a.id, b.id]);
    expect(() => goals.get('yok')).toThrow(/Hedef bulunamadı/);
  });

  it('keeps a goal’s KPIs; a goal created without them has none, and an update without them keeps them', () => {
    const { goals } = stores();
    const kpi = { name: 'Onay', target: 70, direction: 'atLeast' as const, unit: '%', source: 'manual' as const, metric: null, cadence: 'weekly' as const };
    const a = goals.create({ title: 'Lansman', why: 'w', done: ['d'], createdBy: 'c' });
    expect(a.kpis).toEqual([]);
    expect(goals.update(a.id, { kpis: [kpi] }).kpis).toEqual([kpi]);
    expect(goals.update(a.id, { note: 'n' }).kpis).toEqual([kpi]);
    expect(goals.get(a.id).kpis).toEqual([kpi]);
    expect(goals.create({ title: 'B', why: 'w', done: ['d'], kpis: [kpi], createdBy: 'c' }).kpis).toEqual([kpi]);
  });
});

describe('CompanyStateStore', () => {
  it('keeps the pause, the rest and any marker; null removes a key', () => {
    const { state } = stores();
    expect(state.paused()).toBe(false);
    state.setPaused(true);
    expect(state.paused()).toBe(true);
    expect(state.restUntil()).toBe(0);
    state.setRest(9000, 'değerli iş yok');
    expect(state.restUntil()).toBe(9000);
    expect(state.get('restReason')).toBe('değerli iş yok');
    state.set('pulse.goal.g1', 'none');
    expect(state.get('pulse.goal.g1')).toBe('none');
    state.set('pulse.goal.g1', null);
    expect(state.get('pulse.goal.g1')).toBeNull();
  });
});

describe('PlanStore — goal and who started it (v9)', () => {
  it('stores a plan’s goal and who approved it; an old plan has neither', () => {
    const { plans } = stores();
    const p = plans.create({ title: 'P', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: 'c', goalId: 'g1' });
    expect(plans.get(p.id)).toMatchObject({ goalId: 'g1', approvedBy: null });
    plans.update(p.id, { status: 'approved', approvedBy: 'coordinator' });
    expect(plans.get(p.id)).toMatchObject({ status: 'approved', approvedBy: 'coordinator', goalId: 'g1' });
    const old = plans.create({ title: 'Eski', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: 'c' });
    expect(plans.get(old.id)).toMatchObject({ goalId: null, approvedBy: null });
  });
});
