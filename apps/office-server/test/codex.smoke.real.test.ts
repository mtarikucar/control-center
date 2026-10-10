import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Engine } from '../src/engine.ts';
import { handleMcp, type McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { loadConfig } from '../src/config.ts';
import { companyFor } from './company-helpers.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { setup, waitFor } from './helpers.ts';

/** Opt in: uses the signed-in Codex account for one bounded turn in an isolated test desk. */
it.skipIf(process.env.OFFICE_CODEX_SMOKE !== '1')('real Codex writes a deliverable through the office gate and calls its authenticated office MCP', async () => {
  const s = setup(), tokens = new TokenRegistry();
  let pings = 0, approvals = 0;
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      if (req.url === '/gate/check') { approvals += 1; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ decision: 'allow' })); return; }
      const out = await handleMcp({ method: req.method ?? '', authorization: req.headers.authorization, body, tokens, roster: s.roster, tools: [{ name: 'diagnosticPing', description: 'Confirm the completed ControlCenter diagnostic task.', inputSchema: { type: 'object', properties: {} }, kinds: ['member'], run: () => { pings += 1; return 'CONTROL_CENTER_CODEX_OK'; } }] });
      res.statusCode = out.status; res.setHeader('content-type', 'application/json'); res.end(out.body ? JSON.stringify(out.body) : undefined);
    } catch { res.statusCode = 500; res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const engine = new Engine({ ...s, claudeCommand: ['unused'], provider: 'codex', codexCommand: ['codex'], mcp: { tokens, url: () => `http://127.0.0.1:${port}/mcp` }, gate: { hook: '', url: () => `http://127.0.0.1:${port}/gate/check` } });
  try {
    const e = engine.hire({ name: 'Codex smoke', role: 'Yalnız bağlantı tanısını yürüt. Başka çalışan alma; dış bağlantı veya yayın kullanma.', model: 'haiku' });
    await waitFor(s.events, x => x.event.type === 'session.started', { timeoutMs: 60000 });
    engine.send(e.id, 'Bu yalnız bağlantı testidir: masandaki smoke.txt dosyasına yalnız CONTROL_CENTER_CODEX_OK yaz (apply_patch kullan, shell kullanma). Sonra office diagnosticPing aracını çağır ve sonucunu aynen yanıtla. Başka iş yapma.');
    const done = await waitFor(s.events, x => x.event.type === 'turn.finished', { timeoutMs: 180000 });
    expect(done.event).toMatchObject({ ok: true });
    expect(pings, JSON.stringify(s.events.list().map(x => x.event))).toBe(1); expect(approvals).toBeGreaterThan(0);
    expect(readFileSync(join(s.dataDir, 'desks', e.slug, 'smoke.txt'), 'utf8').trim()).toBe('CONTROL_CENTER_CODEX_OK');
    expect(s.events.list().some(x => x.event.type === 'message.assistant' && x.event.text.includes('CONTROL_CENTER_CODEX_OK'))).toBe(true);
  } finally { await engine.shutdown(); await new Promise<void>(resolve => server.close(() => resolve())); s.db.close(); s.cleanup(); }
}, 240000);

/** Opt in: two bounded native turns verify delegation and an archived hand-in across the two accounts. */
it.skipIf(process.env.OFFICE_MIXED_SMOKE !== '1')('real Claude delegates to real Codex and the office archives its completed task', async () => {
  const s = setup(), tokens = new TokenRegistry(), config = loadConfig();
  let tools: McpTool[] = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      if (req.url === '/gate/check') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ decision: 'allow' })); return; }
      const out = await handleMcp({ method: req.method ?? '', authorization: req.headers.authorization, body, tokens, roster: s.roster, tools });
      res.statusCode = out.status; res.setHeader('content-type', 'application/json'); res.end(out.body ? JSON.stringify(out.body) : undefined);
    } catch { res.statusCode = 500; res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const engine = new Engine({ ...s, provider: 'claude', claudeCommand: config.claudeCommand, codexCommand: config.codexCommand, mcp: { tokens, url: () => `http://127.0.0.1:${port}/mcp` }, gate: { hook: '', url: () => `http://127.0.0.1:${port}/gate/check` } });
  const c = companyFor(s, { engine, argvLog: '', state: '', cleanup: () => engine.shutdown() });
  c.budget.setConstitution({ autonomy: 'free' });
  tools = officeTools({ ...s, ...c, engine, characters: () => ['coder'], plans: () => c.plans.list(), agenda: { text: () => '' } }).filter(t => ['taskCreate', 'taskFinish', 'officeStatus'].includes(t.name));
  try {
    const worker = engine.hire({ name: 'Codex diagnostic', provider: 'codex', role: 'Yalnız verilen bağlantı tanısını yürüt, dosyayı üret ve taskFinish ile teslim et.', model: 'haiku' });
    const coordinator = engine.hire({ name: 'Claude diagnostic', provider: 'claude', kind: 'coordinator', role: 'Yalnız bağlantı tanısı için taskCreate ile diğer çalışana bir görev aç. Başka iş veya araç kullanma.', model: 'haiku' });
    await waitFor(s.events, e => e.employeeId === worker.id && e.event.type === 'session.started', { timeoutMs: 60000 });
    const after = s.events.lastSeq();
    engine.send(coordinator.id, `Bu sahibinin istediği sınırlı bağlantı tanısıdır. Yalnız office taskCreate aracını bir kez çağır: assignee="${worker.id}", title="MIXED_SMOKE", description="mixed.txt dosyasına CONTROL_CENTER_MIXED_OK yaz, apply_patch kullan; sonra taskFinish ile teslim et.", done=["mixed.txt içinde CONTROL_CENTER_MIXED_OK var"]. İnceleyici veya plan verme. Sonra kısa yanıtla; başka hiçbir iş yapma.`);
    const delegation = await waitFor(s.events, e => e.employeeId === coordinator.id && e.event.type === 'turn.finished', { after, timeoutMs: 180000 });
    expect(delegation.event).toMatchObject({ ok: true });
    const task = c.tasks.list().find(t => t.title === 'MIXED_SMOKE');
    expect(task, JSON.stringify(s.events.list().map(e => e.event))).toBeTruthy();
    expect(task!.requester).toBe(coordinator.id); expect(task!.assignee).toBe(worker.id);
    c.company.start(task!.id);
    const beforeWork = s.events.lastSeq();
    engine.send(worker.id, `Görev ${task!.id}: ${task!.description}\nBitti tanımı: ${task!.done.join('; ')}. taskFinish çağrısında outputs=["mixed.txt"] ve bir kanıt satırı ver. Başka iş yapma.`);
    const done = await waitFor(s.events, e => e.employeeId === worker.id && e.event.type === 'turn.finished', { after: beforeWork, timeoutMs: 180000 });
    expect(done.event).toMatchObject({ ok: true, provider: 'codex' });
    const result = c.tasks.get(task!.id);
    expect(result.status, JSON.stringify(s.events.list().map(e => e.event))).toBe('done');
    expect(result.result?.archive).toBeTruthy();
    expect(readFileSync(join(s.dataDir, 'desks', worker.slug, 'mixed.txt'), 'utf8').trim()).toBe('CONTROL_CENTER_MIXED_OK');
  } finally { await engine.shutdown(); await new Promise<void>(resolve => server.close(() => resolve())); s.db.close(); s.cleanup(); }
}, 420000);
