import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.ts';
import { Company } from '../src/company/company.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import { QuotaTracker } from '../src/quota.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const tasks = new TaskStore(s.db);
  const plans = new PlanStore(s.db);
  const notices = new NoticeStore(s.db);
  const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => ['coder', 'manager'] });
  const quota = new QuotaTracker(s.db, s.events);
  const api = createApi({ engine: f.engine, roster: s.roster, events: s.events, quota, company: { service: company, tasks, plans } }, { allowedOrigins: [] });
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { port, company, tasks };
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
    const a = t.company.propose(c.id, { title: 'A', goal: 'g', approach: 'x' });
    const b = t.company.propose(c.id, { title: 'B', goal: 'g', approach: 'x' });
    expect((await call(t.port, 'POST', `/api/plans/${a.id}/approve`)).body).toMatchObject({ id: a.id, status: 'approved' });
    expect((await call(t.port, 'POST', `/api/plans/${a.id}/approve`)).status).toBe(409);
    expect((await call(t.port, 'POST', `/api/plans/${b.id}/decline`)).body.status).toBe('declined');
    expect((await call(t.port, 'POST', '/api/plans/00000000-0000-0000-0000-000000000000/approve')).status).toBe(404);
    t.company.createTask(c.id, { assignee: c.id, title: 'iş', planId: a.id });
    const office = await call(t.port, 'GET', '/api/office');
    expect(office.body.plans.map((p: { title: string }) => p.title).sort()).toEqual(['A', 'B']);
    expect(office.body.tasks.map((x: { title: string }) => x.title)).toEqual(['iş']);
  });
});
