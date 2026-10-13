import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { pageHeaders } from './owner-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start() {
  const s = setup(10);
  const f = fakeEngine(s);
  const c = companyFor(s, f, ['coder', 'manager'], undefined, undefined, { departments: true });
  c.budget.setConstitution({ maxEmployees: 8 });
  const api = createApi(
    { engine: f.engine, roster: s.roster, events: s.events, quota: new QuotaTracker(s.db, s.events), company: { service: c.company, tasks: c.tasks, plans: c.plans, memory: c.memory, budget: c.budget, proposals: c.proposals, departments: c.departments! } },
    { allowedOrigins: [] },
  );
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { port, roster: s.roster, ...c, departments: c.departments! };
}

/** As the office page sends it (pageHeaders), unless `page: false` (a request from outside the page). */
async function call(port: number, method: string, path: string, body?: unknown, o: { page?: boolean } = {}): Promise<{ status: number; body: any }> {
  const page = method === 'GET' || o.page === false ? {} : await pageHeaders(port);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...page } }, (res) => {
      let data = '';
      res.on('data', (x) => (data += x));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write(JSON.stringify(body ?? {}));
    req.end();
  });
}

describe('departments API (spec §7)', () => {
  it('the owner opens, changes, moves into and closes a department; the snapshot carries them; without the page’s nonce it is refused', async () => {
    const t = await start();
    t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect((await call(t.port, 'GET', '/api/department-templates')).body.map((x: { id: string }) => x.id)).toEqual(['ic-dis-iletisim', 'operasyon-finans', 'pazarlama', 'satis', 'yazilim-otomasyon']);
    const created = await call(t.port, 'POST', '/api/departments', { template: 'pazarlama' });
    expect(created).toMatchObject({ status: 201, body: { name: 'Pazarlama', headId: null, status: 'open' } });
    const id = created.body.id as string;
    expect((await call(t.port, 'POST', `/api/employees/${ada.id}/department`, { departmentId: id })).body).toMatchObject({ departmentId: id, team: 'Pazarlama' });
    expect((await call(t.port, 'POST', `/api/departments/${id}`, { headId: ada.id, mission: 'Yeni misyon' })).body).toMatchObject({ headId: ada.id, mission: 'Yeni misyon' });
    expect((await call(t.port, 'GET', '/api/office')).body.departments).toEqual([expect.objectContaining({ id, name: 'Pazarlama', headId: ada.id })]);
    expect((await call(t.port, 'GET', '/api/departments')).body).toHaveLength(1);
    expect((await call(t.port, 'POST', `/api/departments/${id}/close`, {})).status).toBe(400);
    expect((await call(t.port, 'POST', `/api/departments/${id}/close`, { reason: 'deneme' })).body).toMatchObject({ status: 'closed' });
    expect((await call(t.port, 'POST', '/api/departments', { name: 'X', mission: 'm' }, { page: false })).status).toBe(403);
  });

  it('a plan’s stream notes', async () => {
    const t = await start();
    t.budget.setConstitution({ autonomy: 'free' });
    const coord = t.company.hireCoordinator('sonnet');
    const dep = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: dep.id, head: true });
    const plan = t.company.propose(coord.id, { title: 'Lansman', goal: 'g', approach: 'a', method: METHOD, streams: [{ id: 'duyuru', title: 'Duyuru', owner: 'Pazarlama' }] });
    t.company.streamPlan(head.id, plan.id, 'duyuru', 'Önce metin.');
    expect((await call(t.port, 'GET', `/api/plans/${plan.id}/stream-notes`)).body).toEqual(JSON.parse(JSON.stringify(t.company.streamNotes(plan.id))));
  });

  it('a head who is nobody’s changes nothing: the name, mission and scope stay as they were', async () => {
    const t = await start();
    t.company.hireCoordinator('sonnet');
    const dep = (await call(t.port, 'POST', '/api/departments', { template: 'pazarlama' })).body as { id: string; mission: string };
    const bad = await call(t.port, 'POST', `/api/departments/${dep.id}`, { headId: '00000000-0000-4000-8000-000000000000', mission: 'Yeni misyon' });
    expect(bad.status).toBe(404);
    expect(t.departments.get(dep.id).mission).toBe(dep.mission);
    expect((await call(t.port, 'POST', '/api/departments/yok-boyle-bir-sey', { mission: 'x' })).status).toBe(404);
  });

  it('a head who cannot be one (the coordinator, someone let go, not an id) is refused whole: nothing of the change is written', async () => {
    const t = await start();
    const coordinator = t.company.hireCoordinator('sonnet');
    const gone = t.company.hire(OWNER, { name: 'Gül', role: 'r' });
    t.roster.update(gone.id, { lifecycle: 'archived' });
    const created = (await call(t.port, 'POST', '/api/departments', { template: 'pazarlama' })).body as { id: string; name: string; mission: string; scope: string };
    const change = { name: 'Yeni Ad', mission: 'Yeni misyon', scope: 'Yeni sınır' };
    const unchanged = () => expect(t.departments.get(created.id)).toMatchObject({ name: created.name, mission: created.mission, scope: created.scope, headId: null });
    expect((await call(t.port, 'POST', `/api/departments/${created.id}`, { ...change, headId: coordinator.id })).status).toBe(409);
    unchanged();
    expect((await call(t.port, 'POST', `/api/departments/${created.id}`, { ...change, headId: gone.id })).status).toBe(409);
    unchanged();
    const numeric = await call(t.port, 'POST', `/api/departments/${created.id}`, { ...change, headId: 7 });
    expect(numeric).toMatchObject({ status: 400, body: { error: 'headId bir çalışan kimliği ya da null olmalı.' } });
    unchanged();
    // A head who can be one still goes together with the fields.
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect((await call(t.port, 'POST', `/api/departments/${created.id}`, { ...change, headId: ada.id })).body).toMatchObject({ ...change, headId: ada.id });
  });

  it('a field of the wrong type is a 400 that names the field, never a 500', async () => {
    const t = await start();
    t.company.hireCoordinator('sonnet');
    const created = (await call(t.port, 'POST', '/api/departments', { template: 'pazarlama' })).body as { id: string };
    for (const field of ['template', 'name', 'mission', 'scope']) {
      expect(await call(t.port, 'POST', '/api/departments', { [field]: 5 }), field).toMatchObject({ status: 400, body: { error: `${field} metin olmalı.` } });
    }
    for (const field of ['name', 'mission', 'scope']) {
      expect(await call(t.port, 'POST', `/api/departments/${created.id}`, { [field]: ['x'] }), field).toMatchObject({ status: 400, body: { error: `${field} metin olmalı.` } });
    }
    expect(await call(t.port, 'POST', `/api/departments/${created.id}/close`, { reason: { a: 1 } })).toMatchObject({ status: 400, body: { error: 'reason metin olmalı.' } });
    expect((await call(t.port, 'POST', '/api/departments', [] as unknown)).status).toBe(400);
    expect(t.departments.list()).toMatchObject([{ id: created.id, status: 'open' }]);
  });

  it('moving someone needs departmentId in the body: without the key nobody is sent to the centre; null is the centre', async () => {
    const t = await start();
    t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const dep = (await call(t.port, 'POST', '/api/departments', { template: 'pazarlama' })).body as { id: string };
    expect((await call(t.port, 'POST', `/api/employees/${ada.id}/department`, { departmentId: dep.id })).body).toMatchObject({ departmentId: dep.id });
    for (const body of [{}, { department: dep.id }, { departmentId: 5 }, [] as unknown]) {
      expect(await call(t.port, 'POST', `/api/employees/${ada.id}/department`, body), JSON.stringify(body)).toMatchObject({ status: 400, body: { error: 'departmentId gerekli (merkez için null).' } });
      expect(t.roster.get(ada.id)).toMatchObject({ departmentId: dep.id });
    }
    const centre = await call(t.port, 'POST', `/api/employees/${ada.id}/department`, { departmentId: null });
    expect(centre.status).toBe(200);
    expect(centre.body).not.toHaveProperty('departmentId');
    expect(t.roster.get(ada.id)).not.toHaveProperty('departmentId');
  });
});
