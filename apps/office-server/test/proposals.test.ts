import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { companyFor } from './company-helpers.ts';
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
  const coord = c.company.hireCoordinator();
  const ada = c.company.hire(coord.id, { name: 'Ada', role: 'r', team: 'İçerik' });
  const can = c.company.hire(coord.id, { name: 'Can', role: 'r', team: 'İçerik' });
  return { ...s, ...c, engine: f.engine, coord, ada, can };
}

describe('Proposals', () => {
  it('goes to the coordinator, who decides it into the decision log; the proposer hears', () => {
    const t = make();
    const p = t.company.openProposal(t.ada.id, { kind: 'idea', title: 'Haftalık blog', text: 'Her pazartesi bir yazı.' });
    expect(p).toMatchObject({ status: 'open', routedTo: t.coord.id, kind: 'idea' });
    expect(t.notices.pending(t.coord.id).at(-1)?.text).toContain('Haftalık blog');
    expect(t.company.proposalsFor(t.coord.id).map((x) => x.id)).toEqual([p.id]);
    const done = t.company.decideProposal(t.coord.id, p.id, { decision: 'accept', note: 'Başla.' });
    expect(done).toMatchObject({ status: 'accepted', decidedBy: t.coord.id, note: 'Başla.' });
    expect(t.notices.pending(t.ada.id).at(-1)?.text).toMatch(/kabul edildi: Başla\./);
    expect(t.memory.decisions().map((d) => d.title)).toContain('Öneri: Haftalık blog');
  });

  it('review focus: a purchase goes straight to the owner, and only the owner settles it', () => {
    const t = make();
    const p = t.company.openProposal(t.ada.id, { kind: 'purchase', title: 'Telefon hattı', text: 'Müşteriler arıyor.', usd: 12 });
    expect(p).toMatchObject({ status: 'owner', routedTo: null, usd: 12 });
    expect(t.notices.pending(t.coord.id).at(-1)?.text).toMatch(/sahibine bir satın alma talebi açtı/);
    expect(() => t.company.decideProposal(t.coord.id, p.id, { decision: 'accept' })).toThrow(/sahibinin kararını bekliyor/);
    const approved = t.company.ownerDecideProposal(p.id, true);
    expect(approved).toMatchObject({ status: 'accepted', decidedBy: OWNER });
    expect(t.notices.pending(t.ada.id).at(-1)?.text).toMatch(/satın alımını onayladı/);
    expect(t.notices.pending(t.coord.id).at(-1)?.text).toMatch(/satın alımını onayladı/);
    expect(t.memory.decisions()[0]).toMatchObject({ by: OWNER, chosen: 'Onaylandı' });
    expect(() => t.company.ownerDecideProposal(p.id, false)).toThrow(/sahibinin kararını beklemiyor/);
  });

  it('a lead decides their team’s proposals or escalates to the coordinator, who can escalate to the owner', () => {
    const t = make();
    t.company.appointLead(t.coord.id, t.ada.id, { team: 'İçerik' });
    const p = t.company.openProposal(t.can.id, { kind: 'objection', title: 'Yanlış yoldayız', text: 'Video yerine blog.' });
    expect(p.routedTo).toBe(t.ada.id);
    const up = t.company.decideProposal(t.ada.id, p.id, { decision: 'escalate', note: 'Plan değişir.' });
    expect(up).toMatchObject({ status: 'open', routedTo: t.coord.id });
    expect(t.company.decideProposal(t.coord.id, p.id, { decision: 'escalate' })).toMatchObject({ status: 'owner', routedTo: null });
    expect(t.company.ownerDecideProposal(p.id, false, 'Videoya devam.')).toMatchObject({ status: 'declined', note: 'Videoya devam.' });
    expect(t.notices.pending(t.can.id).at(-1)?.text).toMatch(/onaylamadı: Videoya devam\./);
  });

  it('review focus: deciding someone else’s or an already decided proposal fails and changes nothing', () => {
    const t = make();
    const p = t.company.openProposal(t.ada.id, { kind: 'need', title: 'Test ortamı', text: 'Bir staging sunucusu.' });
    expect(() => t.company.decideProposal(t.can.id, p.id, { decision: 'accept' })).toThrow(/sana gelmedi/);
    expect(() => t.company.decideProposal(t.coord.id, p.id, { decision: 'maybe' })).toThrow(/accept, decline ya da escalate/);
    t.company.decideProposal(t.coord.id, p.id, { decision: 'decline', note: 'Şimdi değil.' });
    expect(() => t.company.decideProposal(t.coord.id, p.id, { decision: 'accept' })).toThrow(/artık açık değil/);
    expect(t.proposals.get(p.id).status).toBe('declined');
    expect(() => t.company.openProposal(t.ada.id, { kind: 'wish', title: 'x', text: 'y' })).toThrow(/Bilinmeyen öneri türü/);
  });
});

describe('Team leads', () => {
  it('a lead runs their own team: members report to them, new hires too; ending it undoes that', () => {
    const t = make();
    const lead = t.company.appointLead(t.coord.id, t.ada.id, { team: 'İçerik' });
    expect(lead).toMatchObject({ kind: 'lead', team: 'İçerik' });
    expect(t.roster.get(t.can.id).reportsTo).toBe(t.ada.id);
    expect(t.reloaded).toContain(t.ada.id);
    const ece = t.company.hire(t.coord.id, { name: 'Ece', role: 'r', team: 'İçerik' });
    expect(ece.reportsTo).toBe(t.ada.id);
    t.company.appointLead(t.coord.id, t.ada.id, { lead: false });
    expect(t.roster.get(t.ada.id).kind).toBe('member');
    expect(t.roster.get(t.can.id).reportsTo).toBeNull();
    expect(() => t.company.appointLead(t.coord.id, t.coord.id, { team: 'x' })).toThrow(/Koordinatör ekip lideri yapılamaz/);
    expect(() => t.company.appointLead(t.coord.id, t.can.id, { team: '' })).toThrow(/ekibi olmalı/);
    expect(() => t.company.appointLead(t.can.id, t.ada.id, { team: 'İçerik' })).toThrow(/Yalnız koordinatör/);
  });

  it('review focus: a lead assigns and reprioritizes inside their team only', () => {
    const t = make();
    const bob = t.company.hire(t.coord.id, { name: 'Bob', role: 'r', team: 'Ürün' });
    t.company.appointLead(t.coord.id, t.ada.id, { team: 'İçerik' });
    const mine = t.company.createTask(t.coord.id, { assignee: t.can.id, title: 'içerik işi' });
    const theirs = t.company.createTask(t.coord.id, { assignee: bob.id, title: 'ürün işi' });
    expect(t.company.reprioritize(t.ada.id, mine.id, 1).priority).toBe(1);
    expect(t.company.assign(t.ada.id, mine.id, t.ada.id).assignee).toBe(t.ada.id);
    expect(() => t.company.reprioritize(t.ada.id, theirs.id, 1)).toThrow(/kendi ekibindeki/);
    expect(() => t.company.assign(t.ada.id, mine.id, bob.id)).toThrow(/kendi ekibindeki/);
    expect(() => t.company.assign(t.can.id, mine.id, t.can.id)).toThrow(/Yalnız koordinatör/);
  });
});

describe('Rule B — revisions', () => {
  it('review focus: declining a revision keeps the plan on its approved version with its tasks', () => {
    const t = make();
    const plan = t.company.propose(t.coord.id, { title: 'Video', goal: 'g', approach: 'a', usd: 20 });
    t.company.approve(plan.id);
    const task = t.company.createTask(t.coord.id, { assignee: t.ada.id, title: 'senaryo', planId: plan.id });
    const revision = t.company.revise(t.coord.id, plan.id, { title: 'Video ve blog', usd: 60 });
    expect(revision).toMatchObject({ status: 'draft', version: 2 });
    expect(() => t.company.createTask(t.coord.id, { assignee: t.ada.id, title: 'blog', planId: plan.id })).toThrow(/henüz onaylanmadı/);
    const kept = t.company.decline(plan.id);
    expect(kept).toMatchObject({ status: 'approved', version: 1, title: 'Video', usd: 20 });
    expect(t.tasks.get(task.id).planId).toBe(plan.id);
    expect(t.notices.pending(t.coord.id).at(-1)?.text).toMatch(/onaylı sürümüyle/);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'plan.changed' && e.event.change === 'kept')).toBe(true);
  });

  it('approving a revision forgets the old version; declining a plan never approved still declines it', () => {
    const t = make();
    const plan = t.company.propose(t.coord.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    t.company.revise(t.coord.id, plan.id, { days: 9 });
    t.company.revise(t.coord.id, plan.id, { days: 10 });
    t.company.approve(plan.id);
    expect(t.plans.approvedSnapshot(plan.id)).toBeNull();
    const fresh = t.company.propose(t.coord.id, { title: 'Q', goal: 'g', approach: 'a' });
    expect(t.company.decline(fresh.id).status).toBe('declined');
  });
});
