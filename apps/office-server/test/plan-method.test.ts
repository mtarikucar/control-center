import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
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
  return { ...s, ...c, coordinator };
}

const DRAFT = { title: 'Tanıtım metni', goal: 'Kısa bir tanıtım', approach: 'Yazar yazar, editör inceler' };

describe('a plan says how the work is done (spec §5.1)', () => {
  it('refuses a plan without a method and says what to add', () => {
    const t = make();
    expect(() => t.company.propose(t.coordinator.id, DRAFT)).toThrow(/methodRead/);
    expect(t.plans.list()).toHaveLength(0);
  });

  it('refuses a malformed method in Turkish and stores nothing', () => {
    const t = make();
    const bad: Array<[unknown, RegExp]> = [
      ['yaz ve kontrol et', /nesne/],
      [{ ...METHOD, workType: 'poetry' }, /İş türü/],
      [{ ...METHOD, stages: [METHOD.stages[0]] }, /en az iki aşama/],
      [{ ...METHOD, stages: ['taslak', 'editör'] }, /aşama bir nesne/],
      [{ ...METHOD, stages: [{ name: 'Taslak', role: '' }, METHOD.stages[1]] }, /rolü boş olamaz/],
      [{ ...METHOD, stages: [{ name: 'Taslak', role: 'yazar', review: 'evet' }, METHOD.stages[1]] }, /review alanı true ya da false/],
      [{ ...METHOD, checks: [] }, /kalite kontrolü/],
      [{ ...METHOD, checks: 'marka' }, /liste/],
    ];
    for (const [method, error] of bad) expect(() => t.company.propose(t.coordinator.id, { ...DRAFT, method }), String(error)).toThrow(error);
    expect(t.plans.list()).toHaveLength(0);
  });

  it('keeps the method on the card; a revision keeps it unless it gives a new one; a declined revision restores it', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, method: METHOD });
    expect(t.plans.get(plan.id).method).toEqual(METHOD);
    t.company.approve(plan.id);
    const kept = t.company.revise(t.coordinator.id, plan.id, { days: 2 });
    expect(kept.method).toEqual(METHOD);
    const other = { workType: 'research' as const, stages: [{ name: 'Topla', role: 'araştırmacı', review: false }, { name: 'Kontrol', role: 'editör', review: true }], checks: ['kaynaklı'] };
    const changed = t.company.revise(t.coordinator.id, plan.id, { method: other });
    expect(changed.method).toEqual(other);
    expect(t.company.decline(plan.id).method).toEqual(METHOD);
  });

  it('trims the method and treats a missing review flag as false', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, {
      ...DRAFT,
      method: { workType: 'content', stages: [{ name: ' Taslak ', role: ' yazar ' }, { name: 'Editör', role: 'editör', review: true }], checks: [' marka dili ', ''] },
    });
    expect(plan.method).toEqual({ workType: 'content', stages: [{ name: 'Taslak', role: 'yazar', review: false }, { name: 'Editör', role: 'editör', review: true }], checks: ['marka dili'] });
  });

  it('a plan from before methods still loads, is approved and revised', () => {
    const t = make();
    const old = t.plans.create({ title: 'Eski', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: t.coordinator.id });
    expect(t.company.approve(old.id).method).toBeNull();
    expect(t.company.revise(t.coordinator.id, old.id, { days: 1 }).method).toBeNull();
    expect(OWNER).toBe('owner');
  });
});
