import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type ClockStatus } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { Agenda } from '../src/company/agenda.ts';
import { Blueprints } from '../src/company/blueprint.ts';
import { BlueprintStore } from '../src/company/blueprint-store.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { performanceReport } from '../src/performance.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, until } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start(o: { cacheTtlMinutes?: () => number; clock?: { status(): ClockStatus } } = {}) {
  const s = setup();
  // Wired like main.ts: the engine reads the model policy switch from the constitution.
  const f = fakeEngine(s, { engine: { modelPolicyEnabled: () => c.budget.constitution().modelPolicyEnabled, ...(o.cacheTtlMinutes ? { cacheTtlMinutes: o.cacheTtlMinutes } : {}) } });
  const c = companyFor(s, f, ['coder', 'manager']);
  const quota = new QuotaTracker(s.db, s.events);
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  // Wired like main.ts: the performance report reads the same database.
  const performance = { report: (r: { days?: number } = {}) => performanceReport(s.db, { since: r.days ? Date.now() - r.days * 86_400_000 : null }) };
  const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
  const blueprints = new Blueprints({ company: c.company, roster: s.roster, tasks: c.tasks, plans: c.plans, schedules: c.schedules, memory: c.memory, store: new BlueprintStore(s.db), integrations, constitution: () => c.budget.constitution() });
  const api = createApi({ engine: f.engine, roster: s.roster, events: s.events, quota, company: { service: c.company, tasks: c.tasks, plans: c.plans, memory: c.memory, budget: c.budget, proposals: c.proposals, agenda, performance, integrations, blueprints, ...(o.clock ? { clock: o.clock } : {}) } }, { allowedOrigins: [] });
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { port, company: c.company, tasks: c.tasks, memory: c.memory, budget: c.budget, notices: c.notices, argvLog: f.argvLog, events: s.events, engine: f.engine, blueprints };
}

function call(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write(JSON.stringify(body ?? {}));
    req.end();
  });
}

describe('company API', () => {
  it('R11: the owner’s message does not move a sonnet coordinator to fable, model policy on or off; the owner can ask for fable', async () => {
    const t = await start();
    const coord = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r', model: 'haiku' });
    const turns = () => t.events.list({ limit: 5000 }).filter((e) => e.event.type === 'turn.finished').length;
    const models = async (n: number) => (await readArgv(t.argvLog, n)).map((a) => `${a.cwd.includes('koordinator') ? 'K' : 'A'}:${a.args[a.args.indexOf('--model') + 1]}`);
    expect(t.budget.constitution()).toMatchObject({ modelPolicyEnabled: false, coordinatorModels: { owner: 'sonnet' } });
    expect((await call(t.port, 'POST', `/api/employees/${coord.id}/messages`, { text: 'Bir plan öner.' })).status).toBe(202);
    await until(() => turns() === 1, 8000);
    t.budget.setConstitution({ modelPolicyEnabled: true });
    expect((await call(t.port, 'POST', `/api/employees/${coord.id}/messages`, { text: 'Biraz daha düşün.' })).status).toBe(202);
    expect((await call(t.port, 'POST', `/api/employees/${ada.id}/messages`, { text: 'Merhaba.' })).status).toBe(202);
    await until(() => turns() === 3, 8000);
    expect((await models(2)).sort()).toEqual(['A:haiku', 'K:sonnet']);
    // The owner may want fable for the coordinator: the constitution says so, and then it does.
    t.budget.setConstitution({ coordinatorModels: { owner: 'fable' } });
    expect((await call(t.port, 'POST', `/api/employees/${coord.id}/messages`, { text: 'Şimdi derin düşün.' })).status).toBe(202);
    await until(() => turns() === 4, 8000);
    expect((await models(3)).sort()).toEqual(['A:haiku', 'K:fable', 'K:sonnet']);
  });

  it('important: the owner’s message never moves a member’s session in the middle of a task; between tasks it returns them to their own model', async () => {
    // A cache that is always cold: any hint down would switch at once, so a kept model proves no hint was given.
    const t = await start({ cacheTtlMinutes: () => 0 });
    t.budget.setConstitution({ modelPolicyEnabled: true });
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r', model: 'sonnet' });
    const turns = () => t.events.list({ employeeId: ada.id, limit: 5000 }).filter((e) => e.event.type === 'turn.finished').length;
    const models = async (n: number) => (await readArgv(t.argvLog, n)).map((a) => a.args[a.args.indexOf('--model') + 1]);
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Zor iş', difficulty: 'hard' });
    t.company.start(task.id);
    t.engine.send(ada.id, 'Zor iş', 'system', { model: 'opus', taskStart: true });
    await until(() => turns() === 1, 8000);
    expect((await call(t.port, 'POST', `/api/employees/${ada.id}/messages`, { text: 'Nasıl gidiyor?' })).status).toBe(202);
    await until(() => turns() === 2, 8000);
    // Hired on sonnet, moved to opus by the task — and the owner's question kept it there.
    expect(await models(2)).toEqual(['sonnet', 'opus']);
    t.company.finish(ada.id, task.id, { summary: 'bitti', outputs: [], learned: '' });
    expect((await call(t.port, 'POST', `/api/employees/${ada.id}/messages`, { text: 'Eline sağlık.' })).status).toBe(202);
    await until(() => turns() === 3, 8000);
    expect(await models(3)).toEqual(['sonnet', 'opus', 'sonnet']);
  });

  it('hires the coordinator once from the Company view, on Fable, with the manager look', async () => {
    const t = await start();
    const hired = await call(t.port, 'POST', '/api/company/coordinator/hire');
    expect(hired.status).toBe(201);
    expect(hired.body).toMatchObject({ kind: 'coordinator', model: 'fable', characterId: 'manager' });
    expect((await call(t.port, 'POST', '/api/company/coordinator/hire')).status).toBe(409);
  });

  it('makes an employee the coordinator; the owner’s hire form hires members', async () => {
    const t = await start();
    const ada = await call(t.port, 'POST', '/api/employees', { name: 'Ada', role: 'r', kind: 'coordinator' });
    expect(ada.body.kind).toBe('member');
    const appointed = await call(t.port, 'POST', '/api/company/coordinator', { employeeId: ada.body.id });
    expect(appointed.body).toMatchObject({ id: ada.body.id, kind: 'coordinator' });
    expect((await call(t.port, 'POST', '/api/company/coordinator', { employeeId: 42 })).status).toBe(400);
  });

  it('lets the owner approve or decline plan cards, and shows plans and tasks in the snapshot', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const a = t.company.propose(c.id, { method: METHOD, title: 'A', goal: 'g', approach: 'x' });
    const b = t.company.propose(c.id, { method: METHOD, title: 'B', goal: 'g', approach: 'x' });
    expect((await call(t.port, 'POST', `/api/plans/${a.id}/approve`)).body).toMatchObject({ id: a.id, status: 'approved' });
    expect((await call(t.port, 'POST', `/api/plans/${a.id}/approve`)).status).toBe(409);
    expect((await call(t.port, 'POST', `/api/plans/${b.id}/decline`)).body.status).toBe('declined');
    expect((await call(t.port, 'POST', '/api/plans/00000000-0000-0000-0000-000000000000/approve')).status).toBe(404);
    t.company.createTask(c.id, { assignee: c.id, title: 'iş', planId: a.id });
    const office = await call(t.port, 'GET', '/api/office');
    expect(office.body.plans.map((p: { title: string }) => p.title).sort()).toEqual(['A', 'B']);
    expect(office.body.tasks.map((x: { title: string }) => x.title)).toEqual(['iş']);
  });

  it('review focus: a task waiting for its review stays on the board after a reload (the snapshot has it)', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'incelenecek', reviewer: c.id });
    t.company.finish(ada.id, task.id, { summary: 'bitti', outputs: [], learned: '' });
    const office = await call(t.port, 'GET', '/api/office');
    const shown = office.body.tasks.map((x: { title: string; status: string }) => `${x.status} ${x.title}`).sort();
    expect(shown).toEqual(['review incelenecek', 'waiting İnceleme: incelenecek (tur 1)']);
  });

  it('a parked task is still open work: the snapshot shows it on the board', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'ertelenen' });
    t.company.parkTask(ada.id, task.id, '+6h', 'pencere dolsun');
    const office = await call(t.port, 'GET', '/api/office');
    expect(office.body.tasks.map((x: { title: string; status: string }) => `${x.status} ${x.title}`)).toEqual(['parked ertelenen']);
  });

  it('shows the office clock in the snapshot when there is one (spec §5), and no clock field without it', async () => {
    const status: ClockStatus = { nextDueAt: 1, nextDueLabel: 'Parklı · Ada', lastRunAt: 2, lastJumpAt: null };
    const withClock = await start({ clock: { status: () => status } });
    expect((await call(withClock.port, 'GET', '/api/office')).body.clock).toEqual(status);
    const without = await start();
    expect('clock' in (await call(without.port, 'GET', '/api/office')).body).toBe(false);
  });

  it('final review: firing someone mid-task puts their tasks back in the queue', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'x' });
    t.company.start(task.id);
    expect((await call(t.port, 'DELETE', `/api/employees/${ada.id}?now=1`)).status).toBe(204);
    expect(t.tasks.get(task.id)).toMatchObject({ status: 'waiting', startedAt: null });
  });

  it('firing first asks for a hand-over; ?now=1 fires at once', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const asked = await call(t.port, 'DELETE', `/api/employees/${ada.id}`);
    expect(asked.status).toBe(202);
    expect(asked.body.handover).toMatchObject({ kind: 'handover', assignee: ada.id });
    expect((await call(t.port, 'DELETE', `/api/employees/${ada.id}`)).body.handover.id).toBe(asked.body.handover.id);
    expect((await call(t.port, 'DELETE', `/api/employees/${ada.id}?now=1`)).status).toBe(204);
    expect(t.tasks.get(asked.body.handover.id).status).toBe('cancelled');
    expect((await call(t.port, 'GET', `/api/employees/${ada.id}/file`)).body).toMatchObject({ employee: { lifecycle: 'archived' }, finished: 0 });
    expect(c.kind).toBe('coordinator');
  });

  it('shows the memory to the owner and lets them revert a decision once', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const d = t.memory.recordDecision(c.id, { title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe' });
    t.memory.updatePlaybook(c.id, { topic: 'Test', text: 'birim' });
    t.memory.updatePlaybook(c.id, { topic: 'Test', text: 'birim + e2e' });
    t.memory.writeNote(c.id, { title: 'Seslendirme', text: 'ElevenLabs iyi' });
    expect((await call(t.port, 'GET', '/api/memory/decisions')).body.map((x: { id: string }) => x.id)).toEqual([d.id]);
    expect((await call(t.port, 'POST', `/api/decisions/${d.id}/revert`)).status).toBe(201);
    expect((await call(t.port, 'POST', `/api/decisions/${d.id}/revert`)).status).toBe(409);
    expect((await call(t.port, 'GET', '/api/memory/playbook')).body).toMatchObject([{ topic: 'Test', version: 2 }]);
    expect((await call(t.port, 'GET', `/api/memory/playbook/history?topic=${encodeURIComponent('test')}`)).body.map((p: { version: number }) => p.version)).toEqual([2, 1]);
    expect((await call(t.port, 'GET', `/api/memory/notes?q=${encodeURIComponent('elevenlabs')}`)).body[0].note.title).toBe('Seslendirme');
    expect((await call(t.port, 'GET', '/api/memory/notes')).body).toHaveLength(1);
  });

  it('shows the owner the performance report, all time or the last days', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const task = t.company.createTask(c.id, { assignee: c.id, title: 'iş' });
    t.company.start(task.id);
    t.events.append(c.id, { type: 'turn.started' });
    t.company.finish(c.id, task.id, { summary: 'bitti', outputs: [], learned: '' });
    t.events.append(c.id, { type: 'turn.finished', ok: true, subtype: 'success', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd: 0.5, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0.5 });
    const all = (await call(t.port, 'GET', '/api/performance')).body;
    expect(all).toMatchObject({ since: null, total: { turns: 1, usd: 0.5, assignedUsd: 0.5, unassignedUsd: 0 } });
    expect(all.tasks).toEqual([expect.objectContaining({ id: task.id, status: 'done', usd: 0.5, turns: 1 })]);
    expect(all.employees).toEqual([expect.objectContaining({ id: c.id, done: 1, usd: 0.5 })]);
    expect((await call(t.port, 'GET', '/api/performance?days=7')).body.since).toBeGreaterThan(Date.now() - 8 * 86_400_000);
    expect((await call(t.port, 'GET', '/api/performance?days=0')).status).toBe(400);
  });

  it('lets the owner follow the onboarding and answer its questions directly, as their own word', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    expect((await call(t.port, 'GET', '/api/onboarding')).body).toMatchObject({ onboarding: null, complete: false });
    expect((await call(t.port, 'POST', '/api/onboarding/answers', { answers: { name: 'x' } })).status).toBe(409);
    t.company.onboardingStart(c.id, 'Mahallede ekşi maya ekmek satıyoruz.');
    t.company.onboardingNext(c.id);
    const view = (await call(t.port, 'GET', '/api/onboarding')).body;
    expect(view.onboarding).toMatchObject({ status: 'active', description: 'Mahallede ekşi maya ekmek satıyoruz.' });
    // Shown to the owner, not yet replied to: asked counts the replied rounds only.
    expect(view.onboarding.rounds).toEqual([expect.objectContaining({ round: 1, replied: false })]);
    expect(view.questions.slice(0, 2)).toEqual([
      expect.objectContaining({ id: 'name', required: true, state: 'open', asked: 0, text: 'Firmanızın adı ne?' }),
      expect.objectContaining({ id: 'sector', state: 'open', asked: 0 }),
    ]);
    const answered = await call(t.port, 'POST', '/api/onboarding/answers', { answers: { name: 'Tatlı Fırın', tools: { social: ['Instagram'] } } });
    expect(answered.status).toBe(200);
    expect(answered.body.questions.filter((q: { state: string }) => q.state === 'answered').map((q: { id: string }) => q.id)).toEqual(['name', 'tools']);
    // The answers on screen are the owner's reply to the round.
    expect(answered.body.onboarding.rounds).toEqual([expect.objectContaining({ round: 1, replied: true })]);
    expect(answered.body.questions.find((q: { id: string }) => q.id === 'sector')).toMatchObject({ state: 'open', asked: 1 });
    expect(t.company.profile().sections.identity).toMatchObject({ by: 'owner', assumedFields: [], fields: { name: 'Tatlı Fırın' } });
    expect((await call(t.port, 'POST', '/api/onboarding/answers', { answers: { revenue: '1M' } })).status).toBe(400);
    expect((await call(t.port, 'POST', '/api/onboarding/answers', {})).status).toBe(400);
  });

  it('shows the owner the role templates and hires from one', async () => {
    const t = await start();
    t.company.hireCoordinator();
    const templates = (await call(t.port, 'GET', '/api/role-templates')).body;
    expect(templates.map((x: { id: string }) => x.id)).toContain('icerik-yazari');
    expect(templates.find((x: { id: string }) => x.id === 'icerik-yazari')).toMatchObject({ title: 'İçerik Yazarı', model: 'sonnet', methods: ['content'] });
    const hired = await call(t.port, 'POST', '/api/employees', { name: 'Ece', template: 'icerik-yazari', role: 'Marka dili: samimi.' });
    expect(hired.status).toBe(201);
    expect(hired.body).toMatchObject({ name: 'Ece', title: 'İçerik Yazarı', template: { id: 'icerik-yazari' } });
    expect(hired.body.role).toContain('### Bu şirkette\n\nMarka dili: samimi.');
    expect((await call(t.port, 'POST', '/api/employees', { name: 'Can', template: 'yok' })).status).toBe(400);
    // The old form, free text, as before.
    expect((await call(t.port, 'POST', '/api/employees', { name: 'Ada', role: 'Testleri yazar.' })).body).toMatchObject({ role: 'Testleri yazar.', template: null });
  });

  it('shows the owner a plan’s blueprint and how far its install went (B5)', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const plain = t.company.propose(c.id, { method: METHOD, title: 'Düz plan', goal: 'g', approach: 'a' });
    expect((await call(t.port, 'GET', `/api/plans/${plain.id}/blueprint`)).status).toBe(404);
    expect((await call(t.port, 'GET', '/api/plans/yok/blueprint')).status).toBe(404);
    // A blueprint plan: the whole blueprint, every step pending until it is installed.
    for (const [section, fields] of [['identity', { name: 'Fırın', sector: 'gıda' }], ['offer', { products: ['ekmek'] }], ['customers', { segments: ['mahalle'], channels: ['dükkan'] }], ['goals', { goals: ['satış'] }], ['success', { done: ['kâr'] }], ['tools', { email: ['Gmail'] }], ['constraints', { budget: '0', other: ['yok'] }]] as const) {
      t.company.profileUpdate(c.id, { section, fields, assumed: false });
    }
    const { plan } = t.blueprints.propose(c.id, { title: 'Kurulum', summary: 'Bir fırın.', roles: [{ key: 'satis', name: 'Ada', template: 'satis-asistani' }], playbook: [], goals: [], routines: [], tasks: [] });
    const body = (await call(t.port, 'GET', `/api/plans/${plan.id}/blueprint`)).body;
    expect(body).toMatchObject({ planId: plan.id, blueprint: { title: 'Kurulum', roles: [{ key: 'satis', name: 'Ada' }] }, steps: [{ step: 'role:satis', state: 'pending' }], closedMode: [] });
  });

  it('shows the owner the capability vocabulary and what the office or one desk has of it; hires with capabilities (B7)', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    t.events.append(c.id, { type: 'session.started', model: 'm', mcp: [{ name: 'claude.ai Gmail', status: 'connected', tools: 30 }, { name: 'office', status: 'connected', tools: 18 }] });
    const all = (await call(t.port, 'GET', '/api/capabilities')).body;
    expect(all.version).toBe(1);
    expect(all.capabilities).toHaveLength(23);
    // Gmail's session from before names: only a lower bound of what the vocabulary does not know.
    expect(all.unclassified).toEqual([expect.objectContaining({ server: 'claude.ai Gmail', tools: 30, unclassified: null })]);
    expect(all.capabilities.find((x: { id: string }) => x.id === 'email.send')).toMatchObject({ title: 'E-posta gönderme', outward: true });
    expect(all.coverage.map((x: { id: string }) => x.id)).toEqual(all.capabilities.map((x: { id: string }) => x.id));
    expect(all.coverage.find((x: { id: string }) => x.id === 'email.read')).toMatchObject({ status: 'open', providers: [expect.objectContaining({ name: 'claude.ai Gmail', openOn: ['Koordinatör'] })] });
    const hired = await call(t.port, 'POST', '/api/employees', { name: 'Ada', role: 'Yanıtlar.', capabilities: ['email.read', 'crm.read'] });
    expect(hired.status).toBe(201);
    expect(hired.body).toMatchObject({ name: 'Ada', capabilities: ['email.read', 'crm.read'] });
    const ada = (await call(t.port, 'GET', `/api/capabilities?employee=${hired.body.id}`)).body;
    expect(ada.coverage.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([['email.read', 'unseen'], ['crm.read', 'missing']]);
    expect((await call(t.port, 'GET', '/api/capabilities?employee=yok')).status).toBe(404);
    expect((await call(t.port, 'POST', '/api/employees', { name: 'Can', role: 'r', capabilities: ['email.sending'] })).status).toBe(400);
  });

  it('shows the owner the integration registry, read-only', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    expect((await call(t.port, 'GET', '/api/integrations')).body).toEqual([]);
    t.events.append(c.id, { type: 'session.started', model: 'm', mcp: [{ name: 'claude.ai Gmail', status: 'needs-auth' }, { name: 'office', status: 'connected' }] });
    const list = (await call(t.port, 'GET', '/api/integrations')).body;
    expect(list.map((i: { name: string; status: string }) => [i.name, i.status])).toEqual([['office', 'connected'], ['claude.ai Gmail', 'needs_auth']]);
    expect(list[1].desks).toEqual([expect.objectContaining({ employeeId: c.id, status: 'needs_auth', open: false })]);
  });

  it('shows the owner the budget and lets them change the constitution', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    t.budget.recordSpend(c.id, { service: 'Canva', usd: 12, purpose: 'görsel' });
    expect((await call(t.port, 'GET', '/api/budget')).body).toMatchObject({ month: { usd: 12 }, reserve: { active: false, limitPct: 75 } });
    expect((await call(t.port, 'GET', '/api/budget/spend')).body.map((x: { service: string }) => x.service)).toEqual(['Canva']);
    expect((await call(t.port, 'POST', '/api/constitution', { ownerReservePct: 40 })).body).toMatchObject({ ownerReservePct: 40 });
    expect((await call(t.port, 'POST', '/api/constitution', { ownerReservePct: 400 })).status).toBe(400);
    expect((await call(t.port, 'GET', '/api/office')).body.budget).toMatchObject({ constitution: { ownerReservePct: 40 } });
  });

  it('shows the owner what waits for them and lets them approve or reject it', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const buy = t.company.openProposal(ada.id, { kind: 'purchase', title: 'Telefon hattı', text: 'Müşteriler arıyor.', usd: 12 });
    const idea = t.company.openProposal(ada.id, { kind: 'idea', title: 'Blog', text: 'Haftalık.' });
    expect((await call(t.port, 'GET', '/api/proposals')).body.map((p: { title: string }) => p.title).sort()).toEqual(['Blog', 'Telefon hattı']);
    expect((await call(t.port, 'POST', `/api/proposals/${buy.id}/approve`, { note: 'Alıyorum.' })).body).toMatchObject({ status: 'accepted', note: 'Alıyorum.' });
    expect((await call(t.port, 'POST', `/api/proposals/${buy.id}/reject`)).status).toBe(409);
    expect((await call(t.port, 'POST', `/api/proposals/${idea.id}/approve`)).status).toBe(409);
    expect((await call(t.port, 'GET', '/api/office')).body.proposals.map((p: { status: string }) => p.status).sort()).toEqual(['accepted', 'open']);
  });

  it('lets the owner stop a plan and a goal and pause the company, and shows goals and the pause in the snapshot', async () => {
    const t = await start();
    t.budget.setConstitution({ autonomy: 'free' });
    const c = t.company.hireCoordinator();
    const goal = t.company.goalSet(c.id, { title: 'Lansman', why: 'misyon', done: ['site'] });
    const plan = t.company.propose(c.id, { method: METHOD, title: 'Site', goal: 'g', approach: 'a', goalId: goal.id });
    expect((await call(t.port, 'POST', `/api/plans/${plan.id}/stop`)).body).toMatchObject({ id: plan.id, status: 'stopped' });
    expect((await call(t.port, 'POST', `/api/plans/${plan.id}/stop`)).status).toBe(409);
    expect((await call(t.port, 'POST', `/api/goals/${goal.id}/stop`)).body).toMatchObject({ status: 'dropped' });
    expect((await call(t.port, 'POST', '/api/company/pause')).status).toBe(200);
    let office = await call(t.port, 'GET', '/api/office');
    expect(office.body).toMatchObject({ paused: true });
    expect(office.body.goals.map((g: { title: string }) => g.title)).toEqual(['Lansman']);
    expect((await call(t.port, 'POST', '/api/company/resume')).status).toBe(200);
    office = await call(t.port, 'GET', '/api/office');
    expect(office.body.paused).toBe(false);
  });

  it('review focus: the owner parks, releases and prioritizes from the sheet; running, reviewing and hand-over tasks refuse a release', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    const a = t.company.createTask(c.id, { assignee: ada.id, title: 'A' });
    const parked = await call(t.port, 'POST', `/api/tasks/${a.id}/park`, { until: '+1d', reason: 'yarına' });
    expect(parked.body).toMatchObject({ id: a.id, status: 'parked', parkedReason: 'yarına' });
    expect((await call(t.port, 'POST', `/api/tasks/${a.id}/park`, { until: 'dün', reason: 'x' })).status).toBe(400);
    const released = await call(t.port, 'POST', `/api/tasks/${a.id}/release`);
    expect(released.body).toMatchObject({ id: a.id, status: 'waiting', notBefore: null, priority: 1 });
    const b = t.company.createTask(c.id, { assignee: ada.id, title: 'B' });
    expect((await call(t.port, 'POST', `/api/tasks/${b.id}/prioritize`, { priority: 1 })).body.priority).toBe(1);
    t.company.start(b.id);
    expect((await call(t.port, 'POST', `/api/tasks/${b.id}/release`)).status).toBe(409);
    const r = t.company.createTask(c.id, { assignee: ada.id, title: 'R', reviewer: can.id });
    t.company.finish(ada.id, r.id, { summary: 'bitti', outputs: [], learned: '' });
    expect((await call(t.port, 'POST', `/api/tasks/${r.id}/release`)).status).toBe(409);
    expect((await call(t.port, 'POST', `/api/tasks/${r.id}/park`, { until: '+1h', reason: 'x' })).status).toBe(409);
    const h = t.company.beginHandover(can.id);
    expect((await call(t.port, 'POST', `/api/tasks/${h.id}/release`)).status).toBe(409);
    expect((await call(t.port, 'POST', '/api/tasks/00000000-0000-0000-0000-000000000000/release')).status).toBe(404);
    const heard = t.notices.pending(c.id).filter((n) => n.topic === 'agenda.owner_changed');
    expect(heard.length).toBe(3);
  });

  it('lets the owner pause, resume and stop a routine, and shows routines in the snapshot', async () => {
    const t = await start({ clock: { status: () => ({ nextDueAt: null, nextDueLabel: null, lastRunAt: null, lastJumpAt: null }) } });
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const s = t.company.createSchedule(c.id, { title: 'Günlük', assignee: ada.id, cron: '0 9 * * *' });
    expect((await call(t.port, 'POST', `/api/schedules/${s.id}/pause`)).body.status).toBe('paused');
    expect((await call(t.port, 'POST', `/api/schedules/${s.id}/resume`)).body.status).toBe('active');
    expect((await call(t.port, 'POST', `/api/schedules/${s.id}/stop`)).body.status).toBe('stopped');
    expect((await call(t.port, 'POST', `/api/schedules/${s.id}/resume`)).status).toBe(409);
    const office = await call(t.port, 'GET', '/api/office');
    expect(office.body.schedules.map((x: { title: string }) => x.title)).toEqual(['Günlük']);
    expect(office.body.clock).toMatchObject({ nextDueAt: null });
  });

  it('serves the agenda', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.company.createTask(c.id, { assignee: ada.id, title: 'İş' });
    const agenda = await call(t.port, 'GET', '/api/agenda');
    expect(agenda.status).toBe(200);
    expect(agenda.body.employees.find((e: { name: string }) => e.name === 'Ada').entries[0]).toMatchObject({ kind: 'queued', title: 'İş' });
  });
});
