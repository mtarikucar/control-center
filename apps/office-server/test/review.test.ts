import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Task } from '@cc/shared';
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
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'yazar' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'editör' });
  const plan = c.company.propose(coordinator.id, { title: 'Metin', goal: 'g', approach: 'a', method: METHOD });
  c.company.approve(plan.id);
  const task = c.company.createTask(coordinator.id, { assignee: ada.id, title: 'Tanıtım metni', done: ['iki cümle', 'marka dili'], planId: plan.id, reviewer: can.id, difficulty: 'hard' });
  const handIn = (summary = 'yazdım') => c.company.finish(ada.id, task.id, { summary, outputs: [], learned: 'kısa yaz', evidence: ['metin.md iki cümle', 'el kitabına baktım'] });
  const reviewOf = (): Task => c.tasks.list({ assignee: can.id }).filter((t) => t.kind === 'review').at(-1)!;
  return { ...s, ...c, coordinator, ada, can, plan, task, handIn, reviewOf };
}

const topics = (t: ReturnType<typeof make>, id: string) => t.notices.pending(id).map((n) => n.topic);

describe('the review gate (spec §5.2)', () => {
  it('a hand-in with a reviewer goes to review, and the reviewer gets a review task with the items and the evidence', () => {
    const t = make();
    const inReview = t.handIn();
    expect(inReview).toMatchObject({ status: 'review', round: 1, finishedAt: null });
    expect(inReview.result?.evidence).toHaveLength(2);
    const review = t.reviewOf();
    expect(review).toMatchObject({ kind: 'review', reviewOf: t.task.id, assignee: t.can.id, planId: t.plan.id, status: 'waiting', difficulty: 'hard', priority: t.task.priority });
    expect(review.title).toBe('İnceleme: Tanıtım metni (tur 1)');
    expect(review.description).toContain('1. iki cümle\n   Kanıt: metin.md iki cümle');
    expect(review.description).toContain('yazdım');
    expect(t.plans.get(t.plan.id).status).toBe('approved');
    expect(topics(t, t.coordinator.id)).not.toContain('task.finished');
  });

  it('approve closes the task: requester and coordinator hear, the doer hears it passed with the minor notes, the plan can finish', () => {
    const t = make();
    t.handIn();
    const closed = t.company.reviewDecide(t.can.id, t.reviewOf().id, { decision: 'approve', findings: [{ severity: 'minor', text: 'virgül' }] });
    expect(closed).toMatchObject({ id: t.task.id, status: 'done' });
    expect(t.tasks.get(t.reviewOf().id)).toMatchObject({ status: 'done', result: { review: { decision: 'approve', findings: [{ severity: 'minor', text: 'virgül' }] } } });
    expect(t.notices.pending(t.ada.id).find((n) => n.topic === 'review.approved')?.text).toContain('virgül');
    expect(t.plans.get(t.plan.id).status).toBe('done');
  });

  it('changes sends the task back to the doer; the next hand-in opens round 2; from round 3 the coordinator must decide', () => {
    const t = make();
    t.handIn();
    const back = t.company.reviewDecide(t.can.id, t.reviewOf().id, { decision: 'changes', findings: [{ severity: 'minor', text: 'ton' }, { severity: 'important', text: 'üç cümle olmuş' }] });
    expect(back).toMatchObject({ status: 'waiting', round: 1, startedAt: null });
    expect(t.tasks.latestReview(t.task.id)?.result?.review?.findings.map((f) => f.severity)).toEqual(['important', 'minor']);
    expect(topics(t, t.coordinator.id)).toContain('review.changes');
    expect(t.handIn('düzelttim').round).toBe(2);
    expect(t.reviewOf().title).toBe('İnceleme: Tanıtım metni (tur 2)');
    t.company.reviewDecide(t.can.id, t.reviewOf().id, { decision: 'changes', findings: [{ severity: 'critical', text: 'yanlış ürün adı' }] });
    expect(topics(t, t.coordinator.id)).not.toContain('review.stuck');
    t.handIn('yine düzelttim');
    t.company.reviewDecide(t.can.id, t.reviewOf().id, { decision: 'changes', findings: [{ severity: 'important', text: 'hâlâ uzun' }] });
    const stuck = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'review.stuck');
    expect(stuck?.kind).toBe('decision');
    expect(stuck?.text).toMatch(/3 turdur/);
  });

  it('refuses a decision that does not match its findings, and malformed findings', () => {
    const t = make();
    t.handIn();
    const id = t.reviewOf().id;
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'approve', findings: [{ severity: 'important', text: 'eksik' }] })).toThrow(/onaylanamaz/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'changes', findings: [{ severity: 'minor', text: 'ton' }] })).toThrow(/en az bir kritik ya da önemli/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'changes' })).toThrow(/en az bir kritik ya da önemli/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'maybe' })).toThrow(/approve ya da changes/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'changes', findings: ['eksik'] })).toThrow(/önem derecesi/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'changes', findings: [{ severity: 'blocker', text: 'x' }] })).toThrow(/önem derecesi/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'changes', findings: 'eksik' })).toThrow(/liste/);
    expect(t.tasks.get(t.task.id).status).toBe('review');
  });

  it('only the reviewer or the coordinator decides; never the doer, never twice; taskFinish cannot close a review', () => {
    const t = make();
    t.handIn();
    const id = t.reviewOf().id;
    expect(() => t.company.reviewDecide(t.ada.id, id, { decision: 'approve' })).toThrow(/sana verilmedi|Kendi işini/);
    expect(() => t.company.finish(t.can.id, id, { summary: 'onay', outputs: [], learned: '' })).toThrow(/reviewDecide/);
    expect(() => t.company.reviewDecide(t.can.id, t.task.id, { decision: 'approve' })).toThrow(/inceleme görevi değil/);
    expect(() => t.company.finish(t.ada.id, t.task.id, { summary: 'yine', outputs: [], learned: '', evidence: ['a', 'b'] })).toThrow(/incelemede/);
    t.company.reviewDecide(t.coordinator.id, id, { decision: 'approve' });
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'approve' })).toThrow(/zaten karara/);
  });

  it('the coordinator cannot review its own task, even as coordinator', () => {
    const t = make();
    const own = t.company.createTask(OWNER, { assignee: t.coordinator.id, title: 'Koordinatörün işi', reviewer: t.can.id });
    t.company.finish(t.coordinator.id, own.id, { summary: 'yaptım', outputs: [], learned: '' });
    const review = t.tasks.list({ assignee: t.can.id }).find((x) => x.reviewOf === own.id)!;
    expect(() => t.company.reviewDecide(t.coordinator.id, review.id, { decision: 'approve' })).toThrow(/Kendi işini/);
  });

  it('the doer is never the reviewer: refused at create, at pass, and when assigning either way', () => {
    const t = make();
    expect(() => t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'X', reviewer: t.ada.id })).toThrow(/kendi işinin inceleyicisi/);
    expect(() => t.company.createTask(t.ada.id, { assignee: t.can.id, title: 'Pas', reviewer: t.can.id })).toThrow(/kendi işinin inceleyicisi/);
    const passed = t.company.createTask(t.ada.id, { assignee: t.can.id, title: 'Pas', reviewer: t.ada.id });
    expect(passed.reviewer).toBe(t.ada.id);
    expect(() => t.company.assign(t.coordinator.id, passed.id, t.ada.id)).toThrow(/inceleyicisi ona verilemez/);
    t.handIn();
    const review = t.reviewOf();
    expect(() => t.company.assign(t.coordinator.id, review.id, t.ada.id)).toThrow(/kendi işinin inceleyicisi/);
    expect(() => t.company.assign(t.coordinator.id, t.task.id, t.can.id)).toThrow(/incelemede/);
  });

  it('moving a review task to someone else makes them the reviewer of the later rounds', () => {
    const t = make();
    const ece = t.company.hire(t.coordinator.id, { name: 'Ece', role: 'editör' });
    t.handIn();
    t.company.assign(t.coordinator.id, t.reviewOf().id, ece.id);
    expect(t.tasks.get(t.task.id).reviewer).toBe(ece.id);
    const review = t.tasks.list({ assignee: ece.id }).find((x) => x.kind === 'review')!;
    t.company.reviewDecide(ece.id, review.id, { decision: 'changes', findings: [{ severity: 'important', text: 'eksik' }] });
    t.handIn('düzelttim');
    expect(t.tasks.list({ assignee: ece.id }).filter((x) => x.kind === 'review')).toHaveLength(2);
  });

  it('a let-go reviewer: the coordinator reviews; with no one who may review, the task closes as before', async () => {
    const t = make();
    // Opened while Can was still here: the coordinator's own task, reviewed by Can.
    const lonely = t.company.createTask(OWNER, { assignee: t.coordinator.id, title: 'Tek başına', reviewer: t.can.id });
    t.roster.update(t.can.id, { lifecycle: 'archived' });
    t.handIn();
    const review = t.tasks.list({ assignee: t.coordinator.id }).find((x) => x.kind === 'review');
    expect(review?.reviewOf).toBe(t.task.id);
    expect(() => t.company.createTask(OWNER, { assignee: t.ada.id, title: 'Yeni', reviewer: t.can.id })).toThrow(/işten çıkarıldı/);
    expect(t.company.finish(t.coordinator.id, lonely.id, { summary: 'bitti', outputs: [], learned: '' }).status).toBe('done');
  });

  it('changes on a let-go doer’s task tells the coordinator to hand it to someone else', () => {
    const t = make();
    t.handIn();
    t.roster.update(t.ada.id, { lifecycle: 'archived' });
    t.company.reviewDecide(t.can.id, t.reviewOf().id, { decision: 'changes', findings: [{ severity: 'important', text: 'eksik' }] });
    const orphaned = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'task.orphaned');
    expect(orphaned?.text).toMatch(/taskAssign/);
  });

  it('the coordinator handing in for the doer still goes to review; a task without a reviewer closes as before', () => {
    const t = make();
    expect(t.company.finish(t.coordinator.id, t.task.id, { summary: 'onun yerine', outputs: [], learned: '', evidence: ['a', 'b'] }).status).toBe('review');
    const plain = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'Düz iş' });
    expect(t.company.finish(t.ada.id, plain.id, { summary: 'bitti', outputs: [], learned: '' }).status).toBe('done');
  });

  it('the doer cannot mark a task in review blocked or unblocked: only the reviewer’s decision moves it', () => {
    const t = make();
    t.handIn();
    expect(() => t.company.update(t.ada.id, t.task.id, { blocked: true, note: 'bekliyorum' })).toThrow(/incelemede/);
    expect(t.tasks.get(t.task.id).status).toBe('review');
  });

  it('final review: the coordinator as reviewer sends back a let-go doer’s task — it still hears it must hand the task to someone else', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Koordinatör inceler', reviewer: t.coordinator.id });
    t.company.finish(t.ada.id, task.id, { summary: 'yaptım', outputs: [], learned: '' });
    t.roster.update(t.ada.id, { lifecycle: 'archived' });
    const review = t.tasks.list({ assignee: t.coordinator.id }).find((x) => x.reviewOf === task.id)!;
    t.company.reviewDecide(t.coordinator.id, review.id, { decision: 'changes', findings: [{ severity: 'important', text: 'eksik' }] });
    const orphaned = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'task.orphaned');
    expect(orphaned?.text).toMatch(/taskAssign/);
    expect(orphaned?.text).toContain('Koordinatör inceler');
  });

  it('final review: letting go someone with a task in review names that task to the coordinator', () => {
    const t = make();
    t.handIn();
    t.company.releaseTasksOf(t.ada.id);
    const orphaned = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'task.orphaned');
    expect(orphaned?.text).toContain('Tanıtım metni');
    expect(orphaned?.text).toMatch(/[iİ]ncelemede/);
    expect(t.tasks.get(t.task.id).status).toBe('review');
  });
});
