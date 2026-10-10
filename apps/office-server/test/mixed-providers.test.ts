import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Budget } from '../src/company/budget.ts';
import { ConstitutionStore, SpendStore } from '../src/company/budget-store.ts';
import { Dispatcher } from '../src/company/dispatcher.ts';
import { migrateDown, migrateUp, openDb } from '../src/db.ts';
import { MIGRATIONS } from '../src/migrations.ts';
import { Roster } from '../src/roster.ts';
import { QuotaTracker } from '../src/quota.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { codexSession } from '../src/codex/process.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, until, waitFor } from './helpers.ts';

const fakeCodex = fileURLToPath(new URL('./fake-codex.mjs', import.meta.url));
const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });
function make() {
  const s = setup(), log = join(s.dataDir, 'codex-rpc.jsonl');
  const f = fakeEngine(s, { env: { FAKE_CODEX_LOG: log }, engine: { codexCommand: [process.execPath, fakeCodex] } });
  const c = companyFor(s, f);
  cleanup.push(s.cleanup, () => s.db.close(), f.cleanup);
  return { ...s, ...f, ...c, log };
}
async function turn(t: ReturnType<typeof make>, id: string, text: string) {
  const after = t.events.lastSeq(); t.engine.send(id, text);
  const finished = await waitFor(t.events, s => s.employeeId === id && s.event.type === 'turn.finished', { after });
  await until(() => t.roster.get(id).lifecycle === 'idle');
  return finished.event;
}

describe('Claude and Codex in the same office', () => {
  it('migrates an existing Claude employee without changing the session and round-trips the schema', () => {
    const db = openDb(':memory:'); cleanup.push(() => db.close());
    migrateUp(db, MIGRATIONS.filter(m => m.version <= 22));
    const roster = new Roster(db, 8), e = roster.create({ name: 'Eski koordinatör', role: 'r', kind: 'coordinator' });
    roster.update(e.id, { sessionStarted: true });
    migrateUp(db);
    expect(roster.get(e.id)).toMatchObject({ provider: 'claude', sessionId: e.sessionId, sessionStarted: true });
    expect(roster.changeProvider(e.id, 'codex').sessionStarted).toBe(false);
    expect(roster.changeProvider(e.id, 'claude').sessionStarted).toBe(true);
    roster.changeProvider(e.id, 'codex');
    migrateDown(db, 22);
    expect(roster.get(e.id)).toMatchObject({ sessionId: e.sessionId, sessionStarted: true });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'quota_by_provider'").get()).toBeUndefined();
  });

  it('lets the Claude coordinator hire a Codex worker through the office tool, dispatch work and approve its hand-in', async () => {
    const t = make(), coordinator = t.company.hireCoordinator('sonnet', 'claude');
    const tools = officeTools({ ...t, characters: () => ['coder', 'manager'], plans: () => t.plans.list(), agenda: { text: () => '' } });
    const call = (name: string, args: Record<string, unknown>) => tools.find(x => x.name === name)!.run({ employee: t.roster.get(coordinator.id) }, args);
    await call('hire', { name: 'Codex geliştirici', role: 'Kod yaz ve kanıtla', model: 'sonnet', provider: 'codex' });
    const worker = t.roster.list().find(e => e.name === 'Codex geliştirici')!;
    expect(worker.provider).toBe('codex'); expect(t.roster.get(coordinator.id).provider).toBe('claude');
    expect(await call('officeStatus', {})).toContain('codex');
    t.budget.setConstitution({ autonomy: 'free' });
    const task = t.company.createTask(coordinator.id, { assignee: worker.id, title: 'Kodex işi', done: ['İş tamamlandı'], reviewer: coordinator.id });
    await waitFor(t.events, s => s.employeeId === worker.id && s.event.type === 'session.started');
    const dispatcher = new Dispatcher({ ...t });
    const after = t.events.lastSeq(); dispatcher.sweep();
    await waitFor(t.events, s => s.employeeId === worker.id && s.event.type === 'turn.finished', { after });
    expect(t.tasks.get(task.id).status).toBe('in_progress');
    t.company.finish(worker.id, task.id, { summary: 'Bitti', evidence: ['İş tamamlandı: kontrol edildi'], outputs: [], learned: '' });
    const review = t.tasks.list().find(x => x.reviewOf === task.id)!;
    t.company.start(review.id);
    t.company.reviewDecide(coordinator.id, review.id, { decision: 'approve', findings: [] });
    expect(t.tasks.get(task.id).status).toBe('done');
  });

  it('switches one coordinator between runtimes, resumes each native history, and shares a handoff without resetting tasks', async () => {
    const t = make(), e = t.company.hireCoordinator('sonnet', 'claude');
    await turn(t, e.id, 'ilk Claude mesajı');
    await t.engine.switchProvider(e.id, 'codex');
    expect(await turn(t, e.id, 'Codex bir')).toMatchObject({ provider: 'codex', usage: { inputTokens: 10, outputTokens: 3 } });
    const cwd = join(t.dataDir, 'desks', e.slug), thread = codexSession(cwd);
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toContain('ilk Claude mesajı');
    await t.engine.switchProvider(e.id, 'claude');
    await turn(t, e.id, 'ikinci Claude mesajı');
    expect((await readArgv(t.argvLog, 2)).at(-1)!.args).toContain('--resume');
    expect(t.roster.get(e.id).sessionId).toBe(e.sessionId);
    await t.engine.switchProvider(e.id, 'codex');
    expect(await turn(t, e.id, 'Codex iki')).toMatchObject({ provider: 'codex', usage: { inputTokens: 10, outputTokens: 3 } });
    expect(codexSession(cwd)).toBe(thread);
    expect(t.company.coordinator()!.id).toBe(e.id);
    expect(readFileSync(join(cwd, 'provider-handoff.md'), 'utf8')).toContain('ikinci Claude mesajı');
  });

  it('refuses a provider change during active work and preserves the running task', async () => {
    const t = make(), e = t.engine.hire({ name: 'Ada', role: 'r', provider: 'codex' });
    t.engine.send(e.id, 'SLOW');
    await until(() => existsSync(t.log) && readFileSync(t.log, 'utf8').includes('turn/start'));
    await expect(t.engine.switchProvider(e.id, 'claude')).rejects.toThrow(/önce çalışanı durdur/);
    expect(t.roster.get(e.id).provider).toBe('codex');
    await t.engine.stop(e.id);
    expect((await t.engine.switchProvider(e.id, 'claude')).lifecycle).toBe('stopped');
  });

  it('keeps account quotas independent and applies the reserve to the relevant provider', () => {
    const t = make(), quota = new QuotaTracker(t.db, t.events);
    const reset = Date.now() + 3600000;
    t.events.append(null, { type: 'quota.updated', status: 'allowed', fiveHour: { utilization: 0.9, resetsAt: reset }, sevenDay: null, limitResetsAt: null });
    t.events.append(null, { provider: 'codex', type: 'quota.updated', status: 'allowed', fiveHour: { utilization: 0.1, resetsAt: reset }, sevenDay: null, limitResetsAt: null });
    const budget = new Budget({ ...t, constitution: new ConstitutionStore(t.db), spend: new SpendStore(t.db), quota, deskCount: 8 });
    budget.setConstitution({ ownerReservePct: 20 });
    expect(quota.state('claude')!.fiveHour!.utilization).toBe(0.9);
    expect(quota.state('codex')!.fiveHour!.utilization).toBe(0.1);
    expect(budget.reserveActive('claude')).toBe(true); expect(budget.reserveActive('codex')).toBe(false);
    expect(budget.reserve().active).toBe(true);
  });
});
