import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.ts';
import { ValidationError } from '../src/errors.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { QuotaTracker } from '../src/quota.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const tools: McpTool[] = [
  { name: 'echo', description: 'Echo back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, kinds: ['member', 'lead', 'coordinator'], run: ({ employee }, args) => `${employee.name}: ${String(args.text)}` },
  { name: 'boss', description: 'Coordinator only.', inputSchema: { type: 'object', properties: {} }, kinds: ['coordinator'], run: () => 'ok' },
  { name: 'fails', description: 'Always invalid.', inputSchema: { type: 'object', properties: {} }, kinds: ['member', 'coordinator'], run: () => { throw new ValidationError('Bu girdi geçersiz.'); } },
];

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const tokens = new TokenRegistry();
  const quota = new QuotaTracker(s.db, s.events);
  const api = createApi({ engine: f.engine, roster: s.roster, events: s.events, quota, mcp: { tokens, tools } }, { allowedOrigins: [] });
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  const member = s.roster.create({ name: 'Ada', role: 'r' });
  const boss = s.roster.create({ name: 'Koor', role: 'r', kind: 'coordinator' });
  return { port, tokens, member, boss, memberToken: tokens.issue(member.id), bossToken: tokens.issue(boss.id) };
}

function mcp(port: number, body: unknown, token?: string, method = 'POST'): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (token) headers.authorization = `Bearer ${token}`;
    const req = httpRequest({ host: '127.0.0.1', port, method, path: '/mcp', headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write(JSON.stringify(body));
    req.end();
  });
}

describe('/mcp', () => {
  it('initializes with the version the client asked for and acknowledges notifications', async () => {
    const t = await start();
    const init = await mcp(t.port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: 'x' } } }, t.memberToken);
    expect(init.status).toBe(200);
    expect(init.body).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'office' } } });
    expect((await mcp(t.port, { jsonrpc: '2.0', method: 'notifications/initialized' }, t.memberToken)).status).toBe(202);
    expect((await mcp(t.port, { jsonrpc: '2.0', id: 2, method: 'ping' }, t.memberToken)).body).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
  });

  it('lists only the tools the caller may use', async () => {
    const t = await start();
    const names = async (token: string) => (await mcp(t.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, token)).body.result.tools.map((x: { name: string }) => x.name);
    expect(await names(t.memberToken)).toEqual(['echo', 'fails']);
    expect(await names(t.bossToken)).toEqual(['echo', 'boss', 'fails']);
  });

  it('calls a tool as the token’s employee and turns office errors into tool errors the model can read', async () => {
    const t = await start();
    const ok = await mcp(t.port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'merhaba' } } }, t.memberToken);
    expect(ok.body.result).toEqual({ content: [{ type: 'text', text: 'Ada: merhaba' }] });
    const bad = await mcp(t.port, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'fails', arguments: {} } }, t.memberToken);
    expect(bad.body.result).toEqual({ content: [{ type: 'text', text: 'Bu girdi geçersiz.' }], isError: true });
    const forbidden = await mcp(t.port, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'boss', arguments: {} } }, t.memberToken);
    expect(forbidden.body.error).toMatchObject({ code: -32602 });
  });

  it('review focus: refuses missing, made-up and revoked tokens', async () => {
    const t = await start();
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await mcp(t.port, list)).status).toBe(401);
    expect((await mcp(t.port, list, 'made-up')).status).toBe(401);
    t.tokens.revoke(t.member.id);
    expect((await mcp(t.port, list, t.memberToken)).status).toBe(401);
  });

  it('answers unknown methods (and Claude Code’s server/discover probe) with method-not-found, and has no event stream', async () => {
    const t = await start();
    expect((await mcp(t.port, { jsonrpc: '2.0', id: 9, method: 'server/discover' }, t.memberToken)).body.error).toMatchObject({ code: -32601 });
    expect((await mcp(t.port, { jsonrpc: '2.0', id: 9, method: 'resources/list' }, t.memberToken)).body.error).toMatchObject({ code: -32601 });
    expect((await mcp(t.port, null, t.memberToken, 'GET')).status).toBe(405);
  });
});

describe('TokenRegistry', () => {
  it('gives every session a fresh token and forgets the previous one', () => {
    const tokens = new TokenRegistry();
    const first = tokens.issue('e1');
    const second = tokens.issue('e1');
    expect(first).not.toBe(second);
    expect(tokens.resolve(first)).toBeNull();
    expect(tokens.resolve(second)).toBe('e1');
    tokens.revoke('e1');
    expect(tokens.resolve(second)).toBeNull();
  });
});
