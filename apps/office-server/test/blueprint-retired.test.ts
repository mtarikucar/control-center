import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlueprintStore } from '../src/company/blueprint-store.ts';
import { Blueprints } from '../src/company/blueprint.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

/** A role template that still declares a capability the vocabulary no longer has (a company one, retired). */
vi.mock('../src/company/role-templates.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/company/role-templates.ts')>();
  return {
    ...real,
    roleTemplate: (id: string) => {
      const t = real.roleTemplate(id);
      return id === 'icerik-yazari' ? { ...t, capabilities: [...t.capabilities, 'sms.send'] } : t;
    },
  };
});

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe('a blueprint’s preview with a capability the vocabulary no longer has (final review minor 2)', () => {
  it('names it as not in the vocabulary — among what goes outward, the careful side — instead of failing', () => {
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f, ['coder']);
    const blueprints = new Blueprints({ company: c.company, roster: s.roster, tasks: c.tasks, plans: c.plans, schedules: c.schedules, memory: c.memory, store: new BlueprintStore(s.db), constitution: () => c.budget.constitution() });
    const coordinator = c.company.hireCoordinator();
    const write = (section: string, fields: Record<string, unknown>) => c.company.profileUpdate(coordinator.id, { section, fields, assumed: false });
    write('identity', { name: 'Kıvılcım İçerik', sector: 'dijital içerik ajansı' });
    write('offer', { products: ['içerik'] });
    write('customers', { segments: ['KOBİ'], channels: ['tavsiye'] });
    write('goals', { goals: ['Takvim zamanında'] });
    write('success', { done: ['Raporlar zamanında'] });
    write('tools', { email: ['Gmail'] });
    write('constraints', { budget: 'aylık 100 USD', other: ['yayın kararı kurucuda'] });
    const { plan } = blueprints.propose(coordinator.id, {
      title: 'Kurulum', summary: 'Bir yazar.', brief: '# Kıvılcım', roles: [{ key: 'yazar', name: 'Ece', template: 'icerik-yazari' }],
      playbook: [], goals: [], routines: [], tasks: [], estimates: { quotaPct: 1, usd: 0, days: 1 }, risks: 'yok',
    });
    expect(plan.risks).toMatch(/Dışa dönük yetenekler \(B9’a kadar yalnız metinle korunur\): .*sms\.send \(Ece, sözlükte yok\)/);
  });
});
