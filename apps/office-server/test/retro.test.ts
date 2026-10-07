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
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  const plan = c.company.propose(coordinator.id, { title: 'Tanıtım', goal: 'g', approach: 'a', method: { ...METHOD, workType: 'content' } });
  c.company.approve(plan.id);
  return { ...s, ...c, coordinator, ada, plan };
}

const RETRO = { wentWell: 'Editör erken baktı', stuck: 'Brief geç geldi', change: 'Brief’i plan onayında iste' };

describe('a plan ends with a retro (spec §5.4)', () => {
  it('when the last task closes the coordinator gets a decision to assess, report and go on', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Metin', planId: t.plan.id });
    t.company.finish(t.ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '' });
    const notice = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'plan.retro');
    expect(notice?.kind).toBe('decision');
    expect(notice?.text).toContain('planRetro');
    expect(notice?.text).toContain('playbookUpdate');
    expect(t.notices.pending(t.coordinator.id).some((n) => n.topic === 'plan.done')).toBe(false);
  });

  it('writes the retro as a note tagged retro and the work type, and a method suggestion as its own note', () => {
    const t = make();
    t.plans.update(t.plan.id, { status: 'done' });
    const { retro, suggestion } = t.company.retro(t.coordinator.id, t.plan.id, { ...RETRO, methodSuggestion: 'İçerikte brief aşaması plan onayından önce gelsin' });
    expect(retro.tags).toEqual(['retro', 'content']);
    expect(retro.source).toBe(`plan:${t.plan.id}`);
    expect(retro.text).toContain('## Ne iyi gitti\n\nEditör erken baktı');
    expect(retro.text).toContain('## Bir dahaki sefere\n\nBrief’i plan onayında iste');
    expect(suggestion?.tags).toEqual(['yöntem-önerisi', 'content']);
    expect(t.memory.notes('brief').length).toBeGreaterThan(0);
    expect(t.company.retro(t.coordinator.id, t.plan.id, RETRO).suggestion).toBeNull();
  });

  it('refuses a retro of a plan that never started, by anyone but the coordinator, or with an empty part', () => {
    const t = make();
    const draft = t.company.propose(t.coordinator.id, { title: 'Taslak', goal: 'g', approach: 'a', method: METHOD });
    expect(() => t.company.retro(t.coordinator.id, draft.id, RETRO)).toThrow(/başlamadı/);
    expect(() => t.company.retro(t.ada.id, t.plan.id, RETRO)).toThrow(/koordinatör/);
    expect(() => t.company.retro(t.coordinator.id, t.plan.id, { ...RETRO, change: ' ' })).toThrow(/boş olamaz/);
    expect(OWNER).toBe('owner');
  });
});
