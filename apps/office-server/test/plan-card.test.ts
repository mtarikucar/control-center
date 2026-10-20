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
  return { ...s, ...c, coordinator };
}

const DRAFT = { method: METHOD, title: 'Tanıtım', goal: 'Ürünü tanıtmak', approach: 'Yazar yazar, editör inceler.' };

describe('the plan card is short: the owner reads only what will be done', () => {
  it('refuses a long goal, approach, people or risks text, and says the limit', () => {
    const t = make();
    const c = t.coordinator.id;
    expect(() => t.company.propose(c, { ...DRAFT, goal: 'g'.repeat(301) })).toThrow(/Hedef en fazla 300 karakter/);
    expect(() => t.company.propose(c, { ...DRAFT, approach: 'a'.repeat(401) })).toThrow(/Yaklaşım en fazla 400 karakter/);
    expect(() => t.company.propose(c, { ...DRAFT, people: 'p'.repeat(201) })).toThrow(/Kimler en fazla 200 karakter/);
    expect(() => t.company.propose(c, { ...DRAFT, risks: 'r'.repeat(301) })).toThrow(/Riskler en fazla 300 karakter/);
    expect(t.plans.list()).toHaveLength(0);
  });

  it('keeps the steps short sentences: at most 20, each at most 120 characters', () => {
    const t = make();
    const c = t.coordinator.id;
    expect(() => t.company.propose(c, { ...DRAFT, steps: ['s'.repeat(121)] })).toThrow(/Görev taslağı maddeleri en fazla 120 karakter/);
    expect(() => t.company.propose(c, { ...DRAFT, steps: Array.from({ length: 21 }, (_, i) => `iş ${i}`) })).toThrow(/Görev taslağı en fazla 20 madde/);
    const plan = t.company.propose(c, { ...DRAFT, steps: ['Takvimi kur.', 'Sekiz gönderi yaz.'] });
    expect(plan.steps).toEqual(['Takvimi kur.', 'Sekiz gönderi yaz.']);
  });

  it('a revision checks only the fields it brings: a plan written before the limits keeps its long text unless that text is given anew', () => {
    const t = make();
    const c = t.coordinator.id;
    const plan = t.company.propose(c, { ...DRAFT, steps: ['Takvimi kur.'] });
    // As an older office left it: longer than today's limit.
    t.plans.update(plan.id, { approach: 'a'.repeat(600) });
    const revised = t.company.revise(c, plan.id, { steps: ['Takvimi kur.', 'Gönderileri yaz.'] });
    expect(revised.approach).toBe('a'.repeat(600));
    expect(revised.steps).toEqual(['Takvimi kur.', 'Gönderileri yaz.']);
    expect(() => t.company.revise(c, plan.id, { approach: 'a'.repeat(401) })).toThrow(/Yaklaşım en fazla 400 karakter/);
  });
});
