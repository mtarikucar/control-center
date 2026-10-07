import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApi } from '../src/api.ts';
import { QuotaTracker } from '../src/quota.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, until, waitFor } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const quota = new QuotaTracker(s.db, s.events);
  const api = createApi({ engine: f.engine, roster: s.roster, events: s.events, quota }, { allowedOrigins: ['http://127.0.0.1:5173'] });
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { s, port };
}

interface Reply {
  status: number;
  body: any;
}

function call(port: number, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...opts.headers };
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function openWs(port: number, path: string, origin?: string) {
  const messages: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, origin ? { origin } : {});
  ws.on('message', (data) => messages.push(JSON.parse(String(data))));
  const opened = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`ws reddedildi: ${res.statusCode}`)));
  });
  cleanups.push(() => ws.terminate());
  const waitUntil = async (done: (ms: any[]) => boolean): Promise<any[]> => {
    await until(() => done(messages));
    return messages;
  };
  return { messages, opened, waitUntil };
}

describe('API', () => {
  it('hires, lists and messages an employee, then returns its events', async () => {
    const { s, port } = await start();
    const hired = await call(port, 'POST', '/api/employees', { body: { name: 'Ada', role: 'Yazılımcı', model: 'haiku' } });
    expect(hired.status).toBe(201);
    expect(hired.body).toMatchObject({ name: 'Ada', lifecycle: 'idle' });

    const office = await call(port, 'GET', '/api/office');
    expect(office.status).toBe(200);
    expect(office.body.employees.map((e: { name: string }) => e.name)).toEqual(['Ada']);
    expect(office.body.usage[hired.body.id].total.inputTokens).toBe(0);

    expect((await call(port, 'POST', `/api/employees/${hired.body.id}/messages`, { body: { text: 'merhaba' } })).status).toBe(202);
    await waitFor(s.events, (x) => x.event.type === 'turn.finished');
    const events = await call(port, 'GET', `/api/employees/${hired.body.id}/events?after=0`);
    expect(events.body.map((x: { event: { type: string } }) => x.event.type)).toContain('message.assistant');

    const after = await call(port, 'GET', '/api/office');
    expect(after.body.quota.status).toBe('allowed');
    expect(after.body.usage[hired.body.id].total.inputTokens).toBe(10);
    expect(after.body.usage[hired.body.id].today).toMatchObject({ turns: 1, sideAnswers: 0 });
  });

  it('runs side questions, stop, resume and the terminal hand-off', async () => {
    const { s, port } = await start();
    const { body: e } = await call(port, 'POST', '/api/employees', { body: { name: 'Ada', role: 'r' } });
    await call(port, 'POST', `/api/employees/${e.id}/messages`, { body: { text: 'merhaba' } });
    await waitFor(s.events, (x) => x.event.type === 'turn.finished');
    expect((await call(port, 'POST', `/api/employees/${e.id}/side-questions`, { body: { text: 'durum?' } })).body).toEqual({ ok: true, answer: 'side:durum?|history:1' });
    expect((await call(port, 'POST', `/api/employees/${e.id}/stop`)).body.lifecycle).toBe('stopped');
    expect((await call(port, 'POST', `/api/employees/${e.id}/resume`)).body.lifecycle).toBe('idle');
    const terminal = await call(port, 'POST', `/api/employees/${e.id}/terminal`);
    expect(terminal.body.command).toContain(`claude --resume ${e.sessionId}`);
    expect((await call(port, 'POST', `/api/employees/${e.id}/messages`, { body: { text: 'x' } })).status).toBe(409);
    expect((await call(port, 'DELETE', `/api/employees/${e.id}/terminal`)).body.lifecycle).toBe('idle');
    expect((await call(port, 'DELETE', `/api/employees/${e.id}`)).status).toBe(204);
  });

  it('maps errors to status codes with Turkish messages', async () => {
    const { port } = await start();
    const bad = await call(port, 'POST', '/api/employees', { body: { name: '', role: 'r' } });
    expect(bad).toEqual({ status: 400, body: { error: 'Ad boş olamaz.' } });
    expect((await call(port, 'POST', '/api/employees', { headers: { 'content-type': 'application/json' }, body: undefined })).status).toBe(400);
    expect((await call(port, 'GET', '/api/employees/00000000-0000-0000-0000-000000000000/events')).status).toBe(404);
    expect((await call(port, 'GET', '/api/nope')).status).toBe(404);
  });

  it('rejects a body that is not an object with a Turkish 400', async () => {
    const { port } = await start();
    expect(await call(port, 'POST', '/api/employees', { body: null })).toEqual({ status: 400, body: { error: 'Geçersiz istek gövdesi.' } });
  });

  it('a client reconnecting with an after from a reset database still gets live events', async () => {
    const { port } = await start();
    const ws = openWs(port, '/ws?after=999999');
    await ws.opened;
    await ws.waitUntil((ms) => ms.length > 0);
    await call(port, 'POST', '/api/employees', { body: { name: 'Ada', role: 'r' } });
    const messages = await ws.waitUntil((ms) => ms.some((m) => m.type === 'event' && m.event.event.type === 'employee.hired'));
    expect(messages.some((m) => m.type === 'event')).toBe(true);
  });

  it('review focus: rejects cross-site, rebinding and non-JSON requests', async () => {
    const { port } = await start();
    const hire = { body: { name: 'X', role: 'r' } };
    expect((await call(port, 'POST', '/api/employees', { ...hire, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(port, 'GET', '/api/office', { headers: { host: `evil.example:${port}` } })).status).toBe(403);
    expect((await call(port, 'POST', '/api/employees', { ...hire, headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await call(port, 'POST', '/api/employees', { ...hire, headers: { origin: 'http://127.0.0.1:5173' } })).status).toBe(201);
    expect((await call(port, 'POST', '/api/employees', { body: { name: 'Y', role: 'r' }, headers: { origin: `http://localhost:${port}` } })).status).toBe(201);
    await expect(openWs(port, '/ws', 'https://evil.example').opened).rejects.toThrow(/403|reddedildi/);
  });

  it('survives a malformed WebSocket frame from a local client', async () => {
    const { port } = await start();
    const socket = connect(port, '127.0.0.1');
    cleanups.push(() => socket.destroy());
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    socket.write(
      'GET /ws HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
    );
    await new Promise<void>((resolve) => socket.once('data', () => resolve()));
    socket.write(Buffer.from([0x83, 0x80, 1, 2, 3, 4])); // reserved opcode 3, masked, empty payload
    await new Promise((r) => setTimeout(r, 200));
    expect((await call(port, 'GET', '/api/office')).status).toBe(200);
  });

  it('streams a snapshot and then live events over WebSocket', async () => {
    const { port } = await start();
    const ws = openWs(port, '/ws');
    await ws.opened;
    await ws.waitUntil((ms) => ms.length > 0);
    await call(port, 'POST', '/api/employees', { body: { name: 'Ada', role: 'r' } });
    const messages = await ws.waitUntil((ms) => ms.some((m) => m.type === 'event' && m.event.event.type === 'employee.hired'));
    expect(messages[0].type).toBe('snapshot');
    expect(messages[0].snapshot.employees).toEqual([]);
  });

  it('replays missed events when reconnecting with ?after=', async () => {
    const { s, port } = await start();
    const { body: e } = await call(port, 'POST', '/api/employees', { body: { name: 'Ada', role: 'r' } });
    const before = s.events.lastSeq();
    await call(port, 'POST', `/api/employees/${e.id}/messages`, { body: { text: 'merhaba' } });
    await waitFor(s.events, (x) => x.event.type === 'turn.finished');
    const messages = await openWs(port, `/ws?after=${before}`).waitUntil((ms) => ms.some((m) => m.type === 'event' && m.event.event.type === 'turn.finished'));
    expect(messages[0].type).toBe('snapshot');
    const replayed = messages.filter((m) => m.type === 'event');
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.every((m) => m.event.seq > before)).toBe(true);
  });
});
