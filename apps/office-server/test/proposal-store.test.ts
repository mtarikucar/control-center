import { describe, expect, it } from 'vitest';
import { migrateUp, openDb } from '../src/db.ts';
import { ProposalStore } from '../src/company/proposal-store.ts';
import { PlanStore } from '../src/company/store.ts';

function stores() {
  const db = openDb(':memory:');
  migrateUp(db);
  let t = 1_000;
  const now = () => (t += 10);
  return { proposals: new ProposalStore(db, now), plans: new PlanStore(db, now) };
}

describe('ProposalStore', () => {
  it('opens proposals, lists them newest first by status and decider, and records the decision', () => {
    const { proposals } = stores();
    const a = proposals.create({ by: 'e1', kind: 'idea', title: 'Blog', text: 'haftalık', usd: null, planId: null, status: 'open', routedTo: 'c' });
    const b = proposals.create({ by: 'e2', kind: 'purchase', title: 'Telefon hattı', text: 'müşteriler arıyor', usd: 10, planId: 'p1', status: 'owner', routedTo: null });
    expect(proposals.get(a.id)).toEqual({ ...a, decidedBy: null, note: null, decidedAt: null });
    expect(proposals.list().map((p) => p.id)).toEqual([b.id, a.id]);
    expect(proposals.list({ statuses: ['owner'] }).map((p) => p.title)).toEqual(['Telefon hattı']);
    expect(proposals.list({ routedTo: 'c' }).map((p) => p.id)).toEqual([a.id]);
    expect(proposals.update(a.id, { status: 'accepted', decidedBy: 'c', note: 'iyi fikir', decidedAt: 5 })).toMatchObject({ status: 'accepted', note: 'iyi fikir' });
    expect(() => proposals.get('nope')).toThrow(/Öneri bulunamadı/);
  });
});

describe('PlanStore — approved snapshots', () => {
  it('keeps the approved version while a revision waits, restores it, or forgets it', () => {
    const { plans } = stores();
    const p = plans.create({ title: 'Eski', goal: 'g', approach: 'a', people: '', steps: ['bir'], quotaPct: null, usd: 10, days: null, risks: '', proposedBy: 'c' });
    plans.update(p.id, { status: 'approved', approvedAt: 7 });
    expect(plans.approvedSnapshot(p.id)).toBeNull();
    plans.saveApproved(p.id);
    plans.update(p.id, { title: 'Yeni', usd: 50, version: 2, status: 'draft', approvedAt: null });
    expect(plans.approvedSnapshot(p.id)).toMatchObject({ title: 'Eski', status: 'approved', version: 1 });
    expect(plans.restoreApproved(p.id)).toMatchObject({ title: 'Eski', usd: 10, status: 'approved', version: 1, approvedAt: 7 });
    expect(plans.approvedSnapshot(p.id)).toBeNull();
    plans.saveApproved(p.id);
    plans.clearApproved(p.id);
    expect(plans.approvedSnapshot(p.id)).toBeNull();
    expect(() => plans.restoreApproved(p.id)).toThrow(/onaylı sürümü yok/);
  });
});
