import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Approval, type Employee } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { ApprovalStore } from '../src/company/approval-store.ts';
import { Approvals } from '../src/company/approvals.ts';
import { Gate } from '../src/company/gate.ts';
import { fingerprint } from '../src/company/gate-policy.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { OwnerFlags } from '../src/owner-flags.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { DATA, testContext } from './gate-helpers.ts';
import { setup } from './helpers.ts';

/** B9a K1: the approvals (store, requests, the owner's decisions), the gate's check, the tools, the owner-flag notes. */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const HOUR = 60 * 60_000;

function make(o: { enabled?: boolean } = {}) {
  let now = Date.UTC(2026, 9, 8, 9, 0);
  const clock = () => now;
  const s = setup(8, clock);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], clock);
  const store = new ApprovalStore(s.db, clock);
  const approvals = new Approvals({ store, events: s.events, notices: c.notices, roster: s.roster, tasks: c.tasks, coordinator: () => c.company.coordinator(), memory: c.memory, now: clock, defer: (fn) => fn() });
  let enabled = o.enabled ?? true;
  const gate = new Gate({ approvals, events: s.events, roster: s.roster, enabled: () => enabled, context: (e) => testContext({ deskDir: `${DATA}/desks/${e.slug}` }) });
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda, approvals, gate });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((t: McpTool) => t.name === name)!;
    return tool.run({ employee: s.roster.get(employee.id) }, args);
  };
  const coordinator = c.company.hireCoordinator();
  const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
  const ev = (type: string) => s.events.list({ limit: 5000 }).filter((e) => e.event.type === type);
  const notices = (id: string) => c.notices.pending(id);
  const ping = { tool_name: 'mcp__probe__ping', tool_input: {}, cwd: `${DATA}/desks/ada` };
  return {
    ...s, ...c, store, approvals, gate, tools, call, coordinator, ada, ev, notices, ping,
    advance: (ms: number) => void (now += ms),
    setEnabled: (v: boolean) => void (enabled = v),
  };
}

describe('the approval store (K1-2)', () => {
  it('one call, once: a second consume finds nothing; another employee’s approval never passes', async () => {
    const t = make();
    const base = { employeeId: t.ada.id, taskId: null, kind: 'publish' as const, tool: 'Bash', target: 'git push origin', fingerprint: 'f1', summary: 'yayın', scope: 'call' as const };
    const a = t.store.create(base);
    expect(a).toMatchObject({ status: 'pending', requestedAt: expect.any(Number), decidedAt: null, expiresAt: null });
    expect(t.store.consume(t.ada.id, 'f1', Date.now())).toBeNull();
    t.store.decide(a.id, { approve: true, decidedBy: OWNER, decidedVia: 'page', note: null, at: 1, expiresAt: Number.MAX_SAFE_INTEGER });
    expect(t.store.consume(t.coordinator.id, 'f1', 2)).toBeNull();
    expect(t.store.consume(t.ada.id, 'f1', 2)).toMatchObject({ id: a.id, status: 'used', usedAt: 2 });
    expect(t.store.consume(t.ada.id, 'f1', 3)).toBeNull();
    expect(t.store.get(a.id).status).toBe('used');
  });

  it('a decision is taken once; an approval runs out at its time; a task’s approvals end with it', async () => {
    const t = make();
    const base = { employeeId: t.ada.id, taskId: 't1', kind: 'browser' as const, tool: 'mcp__plugin_playwright_playwright__browser_click', target: 'browser_click', fingerprint: 'f2', summary: 'form', scope: 'task' as const };
    const a = t.store.create(base);
    expect(t.store.decide(a.id, { approve: false, decidedBy: OWNER, decidedVia: 'page', note: 'hayır', at: 5, expiresAt: null })).toMatchObject({ status: 'denied', note: 'hayır', decidedVia: 'page' });
    expect(t.store.decide(a.id, { approve: true, decidedBy: OWNER, decidedVia: 'page', note: null, at: 6, expiresAt: 100 })).toBeNull();
    const b = t.store.create(base);
    t.store.decide(b.id, { approve: true, decidedBy: OWNER, decidedVia: 'page', note: null, at: 6, expiresAt: 100 });
    expect(t.store.expireDue(99)).toEqual([]);
    expect(t.store.expireDue(100).map((x) => x.id)).toEqual([b.id]);
    const c2 = t.store.create(base);
    t.store.decide(c2.id, { approve: true, decidedBy: OWNER, decidedVia: 'page', note: null, at: 6, expiresAt: 10_000 });
    const pending = t.store.create(base);
    expect(t.store.expireTask('t1').map((x) => x.id).sort()).toEqual([c2.id, pending.id].sort());
    expect(t.store.list({ statuses: ['approved', 'pending'] })).toEqual([]);
  });
});

describe('requests, the owner’s decision, notes and the ledger (K1-3)', () => {
  it('a request waits for the owner: event, an info note to the coordinator; the owner approves: the ledger, a decision note to the asker', async () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'Duyuru' });
    t.company.start(task.id);
    const a = t.approvals.request(t.ada.id, { kind: 'publish', tool: 'Bash', target: 'git push origin', summary: 'Sürümü yayımlamam gerek' });
    expect(a).toMatchObject({ status: 'pending', taskId: task.id, scope: 'call', fingerprint: fingerprint('Bash', { kind: 'publish', target: 'git push origin' }) });
    expect(t.ev('approval.changed').map((e) => [e.employeeId, (e.event as { change: string }).change])).toEqual([[t.ada.id, 'requested']]);
    expect(t.notices(t.coordinator.id).filter((n) => n.topic === 'approval.requested')).toEqual([expect.objectContaining({ kind: 'info', text: expect.stringContaining('git push origin') })]);
    // The same request again while one waits: the same row.
    expect(t.approvals.request(t.ada.id, { kind: 'publish', tool: 'Bash', target: 'git push origin', summary: 'tekrar' }).id).toBe(a.id);
    const decided = t.approvals.decide(a.id, true, { via: 'page', note: 'tamam' });
    expect(decided).toMatchObject({ status: 'approved', decidedBy: OWNER, decidedVia: 'page', expiresAt: decided.decidedAt! + 24 * HOUR, note: 'tamam' });
    expect(t.memory.decisions({ limit: 5 })[0]).toMatchObject({ by: OWNER, title: 'Onay: yayın — git push origin', chosen: 'Onaylandı', reason: 'tamam' });
    expect(t.notices(t.ada.id).filter((n) => n.topic === 'approval.decided')).toEqual([expect.objectContaining({ kind: 'decision', text: expect.stringContaining('Aynı çağrıyı') })]);
    expect(() => t.approvals.decide(a.id, false, { via: 'page' })).toThrow(/bekleyen/);
  });

  it('a denial: the ledger says so, the asker hears the note, nothing passes', async () => {
    const t = make();
    const a = t.approvals.request(t.ada.id, { kind: 'other', tool: 'mcp__probe__ping', target: 'ping', summary: 'deneme' });
    t.approvals.decide(a.id, false, { via: 'page', note: 'gerek yok' });
    expect(t.memory.decisions({ limit: 5 })[0]).toMatchObject({ chosen: 'Reddedildi', reason: 'gerek yok' });
    expect(t.notices(t.ada.id).find((n) => n.topic === 'approval.decided')?.text).toContain('gerek yok');
    expect((await t.gate.check(t.ada.id, t.ping)).decision).toBe('deny');
  });

  it('what a request needs: a reason, a kind from the list, a task for a task’s scope', async () => {
    const t = make();
    expect(() => t.approvals.request(t.ada.id, { kind: 'publish', tool: 'Bash', target: 'git push origin', summary: ' ' })).toThrow(/summary/);
    expect(() => t.approvals.request(t.ada.id, { kind: 'yayın', tool: 'Bash', target: 'x', summary: 's' })).toThrow(/kind/);
    expect(() => t.approvals.request(t.ada.id, { kind: 'browser', tool: 'mcp__x__browser_click', target: 'browser_click', summary: 's', scope: 'task' })).toThrow(/görev/);
  });
});

describe('the gate’s check (K1-3, K1-7): gate.checked only for held calls', () => {
  it('a call the gate does not hold passes with no event (Read, Grep, an office tool, a desk write)', async () => {
    const t = make();
    for (const call of [
      { tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x' } },
      { tool_name: 'mcp__office__myTasks', tool_input: {} },
      { tool_name: 'Write', tool_input: { file_path: `${DATA}/desks/ada/a.md` }, cwd: `${DATA}/desks/ada` },
      { tool_name: 'Bash', tool_input: { command: 'pnpm test' }, cwd: `${DATA}/desks/ada` },
    ]) {
      expect((await t.gate.check(t.ada.id, call)), call.tool_name).toMatchObject({ decision: 'allow' });
    }
    expect(t.ev('gate.checked')).toEqual([]);
  });

  it('held → approvalRequest → the owner approves → the same call passes once → the next is held again', async () => {
    const t = make();
    const first = (await t.gate.check(t.ada.id, t.ping));
    expect(first).toMatchObject({ decision: 'deny', kind: 'other', target: 'ping' });
    expect(first.reason).toMatch(/OFİS KAPISI.*approvalRequest/s);
    // The tool takes the call the gate just held when no tool and target are given.
    const reply = await t.call(t.ada, 'approvalRequest', { summary: 'Deneme için ping gerekiyor' });
    const [a] = t.store.list({ statuses: ['pending'] }) as [Approval];
    expect(a).toMatchObject({ tool: 'mcp__probe__ping', target: 'ping', kind: 'other', scope: 'call' });
    expect(reply).toContain(a.id);
    t.approvals.decide(a.id, true, { via: 'page' });
    expect((await t.gate.check(t.ada.id, t.ping))).toMatchObject({ decision: 'allow', approvalId: a.id });
    expect(t.store.get(a.id).status).toBe('used');
    expect((await t.gate.check(t.ada.id, t.ping)).decision).toBe('deny');
    expect(t.ev('gate.checked').map((e) => [(e.event as { decision: string }).decision, (e.event as { approvalId: string | null }).approvalId])).toEqual([['deny', null], ['allow', a.id], ['deny', null]]);
    expect(t.ev('gate.checked')[0]).toMatchObject({ employeeId: t.ada.id, event: { tool: 'mcp__probe__ping', kind: 'other', target: 'ping' } });
    expect(t.ev('approval.changed').map((e) => (e.event as { change: string }).change)).toEqual(['requested', 'approved', 'used']);
  });

  it('one employee’s approval does not pass another’s call; an approval runs out after a day', async () => {
    const t = make();
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    const a = t.approvals.request(t.ada.id, { kind: 'other', tool: 'mcp__probe__ping', target: 'ping', summary: 's' });
    t.approvals.decide(a.id, true, { via: 'page' });
    expect((await t.gate.check(can.id, { ...t.ping, cwd: `${DATA}/desks/can` })).decision).toBe('deny');
    t.advance(24 * HOUR);
    expect((await t.gate.check(t.ada.id, t.ping)).decision).toBe('deny');
    expect(t.store.get(a.id).status).toBe('expired');
  });

  it('a task’s scope: browser actions pass while the task is open, and stop when it is done', async () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'Formu doldur' });
    t.company.start(task.id);
    const click = { tool_name: 'mcp__plugin_playwright_playwright__browser_click', tool_input: { element: 'Gönder' }, cwd: `${DATA}/desks/ada` };
    const type = { tool_name: 'mcp__plugin_playwright_playwright__browser_type', tool_input: { text: 'a' }, cwd: `${DATA}/desks/ada` };
    expect((await t.gate.check(t.ada.id, click)).decision).toBe('deny');
    const a = t.approvals.request(t.ada.id, { kind: 'browser', tool: click.tool_name, target: 'browser_click', summary: 'form', scope: 'task' });
    t.approvals.decide(a.id, true, { via: 'page' });
    for (let i = 0; i < 3; i += 1) expect((await t.gate.check(t.ada.id, click)).decision).toBe('allow');
    expect((await t.gate.check(t.ada.id, type)).decision).toBe('allow');
    expect(t.store.get(a.id).status).toBe('approved');
    t.company.finish(t.ada.id, task.id, { summary: 'bitti', outputs: [], learned: '' });
    expect(t.store.get(a.id).status).toBe('expired');
    expect((await t.gate.check(t.ada.id, click)).decision).toBe('deny');
  });

  it('a task’s approval needs its task open even before the closing is heard (a status written straight to the store)', async () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'Formu doldur' });
    t.company.start(task.id);
    const click = { tool_name: 'mcp__plugin_playwright_playwright__browser_click', tool_input: {}, cwd: `${DATA}/desks/ada` };
    const a = t.approvals.request(t.ada.id, { kind: 'browser', tool: click.tool_name, target: 'browser_click', summary: 'form', scope: 'task' });
    t.approvals.decide(a.id, true, { via: 'page' });
    expect((await t.gate.check(t.ada.id, click)).decision).toBe('allow');
    t.tasks.update(task.id, { status: 'cancelled' });
    expect(t.store.get(a.id).status).toBe('approved');
    expect((await t.gate.check(t.ada.id, click)).decision).toBe('deny');
  });

  it('review round 1 (important): a browser approval for the task never opens the office page — held per call; only a one-call approval of that very call passes it, once', async () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'Formu doldur' });
    t.company.start(task.id);
    const PW = 'mcp__plugin_playwright_playwright__';
    const click = { tool_name: `${PW}browser_click`, tool_input: { element: 'Gönder' }, cwd: `${DATA}/desks/ada` };
    const office = { tool_name: `${PW}browser_navigate`, tool_input: { url: 'http://127.0.0.1:4319/' }, cwd: `${DATA}/desks/ada` };
    const code = { tool_name: `${PW}browser_run_code_unsafe`, tool_input: { code: "fetch('/api/approvals/x/approve', { method: 'POST' })" }, cwd: `${DATA}/desks/ada` };
    const browser = t.approvals.request(t.ada.id, { kind: 'browser', tool: click.tool_name, target: 'browser_click', summary: 'form', scope: 'task' });
    t.approvals.decide(browser.id, true, { via: 'page' });
    expect((await t.gate.check(t.ada.id, click)).decision).toBe('allow');
    expect((await t.gate.check(t.ada.id, office))).toMatchObject({ decision: 'deny', kind: 'self' });
    expect((await t.gate.check(t.ada.id, code))).toMatchObject({ decision: 'deny', kind: 'self' });
    // The office itself is never asked for a task's worth.
    expect(() => t.approvals.request(t.ada.id, { kind: 'self', tool: office.tool_name, target: 'browser_navigate /', summary: 's', scope: 'task' })).toThrow(/scope/);
    const once = t.approvals.request(t.ada.id, { kind: 'self', tool: office.tool_name, target: 'browser_navigate /', summary: 'sayfaya bakmam gerek' });
    t.approvals.decide(once.id, true, { via: 'page' });
    expect((await t.gate.check(t.ada.id, office)).decision).toBe('allow');
    expect((await t.gate.check(t.ada.id, office)).decision).toBe('deny');
  });

  it('a line with two held parts passes only when both are approved, and uses both', async () => {
    const t = make();
    const call = { tool_name: 'Bash', tool_input: { command: 'git push origin main && npm publish' }, cwd: `${DATA}/desks/ada` };
    const push = t.approvals.request(t.ada.id, { kind: 'publish', tool: 'Bash', target: 'git push origin', summary: 's' });
    t.approvals.decide(push.id, true, { via: 'page' });
    expect((await t.gate.check(t.ada.id, call))).toMatchObject({ decision: 'deny', target: 'npm publish' });
    expect(t.store.get(push.id).status).toBe('approved');
    const publish = t.approvals.request(t.ada.id, { kind: 'publish', tool: 'Bash', target: 'npm publish', summary: 's' });
    t.approvals.decide(publish.id, true, { via: 'page' });
    expect((await t.gate.check(t.ada.id, call)).decision).toBe('allow');
    expect([t.store.get(push.id).status, t.store.get(publish.id).status]).toEqual(['used', 'used']);
  });

  it('the switch off (the constitution’s gateEnabled): every call passes and nothing is written', async () => {
    const t = make({ enabled: false });
    expect((await t.gate.check(t.ada.id, t.ping))).toMatchObject({ decision: 'allow' });
    expect((await t.gate.check(t.ada.id, { tool_name: 'Bash', tool_input: { command: 'git push origin main' } })).decision).toBe('allow');
    expect([t.ev('gate.checked'), t.ev('approval.changed')]).toEqual([[], []]);
    t.setEnabled(true);
    expect((await t.gate.check(t.ada.id, t.ping)).decision).toBe('deny');
  });

  it('turning the gate on is the owner’s, and on record: the constitution event says when, the coordinator hears what changed', async () => {
    const t = make();
    const before = t.events.lastSeq();
    t.budget.ownerSetConstitution({ gateEnabled: true });
    const changed = t.events.list({ after: before, limit: 100 }).filter((e) => e.event.type === 'budget.changed');
    expect(changed).toEqual([expect.objectContaining({ ts: expect.any(Number), event: expect.objectContaining({ budget: expect.objectContaining({ constitution: expect.objectContaining({ gateEnabled: true }) }) }) })]);
    expect(t.notices(t.coordinator.id).filter((n) => n.topic === 'constitution.changed').map((n) => n.text)).toEqual([expect.stringContaining('Geri alınamaz iş kapısı kapalı → açık')]);
  });

  it('a hook input it cannot read is refused (fail-closed)', async () => {
    const t = make();
    for (const bad of [null, 'x', {}, { tool_name: 3 }]) expect((await t.gate.check(t.ada.id, bad)).decision).toBe('deny');
  });
});

describe('the tools (K1-3): approvalRequest and approvalsRead', () => {
  it('approvalRequest with nothing held and no tool or target says what to do; with them it asks', async () => {
    const t = make();
    await expect(t.call(t.ada, 'approvalRequest', { summary: 's' })).rejects.toThrow(/tool|kapı/);
    const reply = await t.call(t.ada, 'approvalRequest', { kind: 'send', tool: 'mcp__claude_ai_Gmail__send_message', target: 'send_message to=a@b.co', summary: 'Müşteriye cevap' });
    expect(reply).toMatch(/taskPark/);
    expect(t.store.list({ statuses: ['pending'] })).toEqual([expect.objectContaining({ kind: 'send', target: 'send_message to=a@b.co' })]);
  });

  it('approvalsRead: one’s own; the coordinator sees everyone’s', async () => {
    const t = make();
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    t.approvals.request(t.ada.id, { kind: 'publish', tool: 'Bash', target: 'git push origin', summary: 'a' });
    t.approvals.request(can.id, { kind: 'send', tool: 'Bash', target: 'curl api.x.io', summary: 'c' });
    const mine = await t.call(t.ada, 'approvalsRead');
    expect(mine).toContain('git push origin');
    expect(mine).not.toContain('curl api.x.io');
    const all = await t.call(t.coordinator, 'approvalsRead');
    expect(all).toContain('git push origin');
    expect(all).toContain('curl api.x.io');
  });
});

describe('owner flags (K1-7): a note to the coordinator at most once an hour per request kind', () => {
  it('300 refused tries of the same kind: 300 events, one note with the count; after the hour, a new note', async () => {
    let now = 0;
    const s = setup(8, () => now);
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f, ['coder'], () => now);
    const coordinator = c.company.hireCoordinator();
    new OwnerFlags({ events: s.events, notices: c.notices, coordinator: () => c.company.coordinator(), now: () => now, defer: (fn) => fn() });
    const flag = (path: string) => s.events.append(null, { type: 'owner.request.flagged', mark: 'owner-endpoint, origin-less', outcome: 'rejected', method: 'POST', path, userAgent: 'curl/8.5.0' });
    for (let i = 0; i < 300; i += 1) flag(`/api/approvals/0000000${i % 10}-0000-4000-8000-000000000000/approve`);
    const notes = () => c.notices.pending(coordinator.id).filter((n) => n.topic === 'owner.flagged');
    expect(s.events.list({ limit: 5000 }).filter((e) => e.event.type === 'owner.request.flagged')).toHaveLength(300);
    expect(notes()).toHaveLength(1);
    expect(notes()[0]!.text).toContain('POST /api/approvals/:id/approve');
    // Another kind of request is its own window.
    flag('/api/company/pause');
    expect(notes()).toHaveLength(2);
    now += HOUR;
    flag('/api/approvals/00000000-0000-4000-8000-000000000000/approve');
    expect(notes()).toHaveLength(3);
    expect(notes()[2]!.text).toContain('299');
  });
});
