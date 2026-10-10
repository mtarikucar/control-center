import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.ts';
import { loadConfig } from '../src/config.ts';
import { codexItem, codexQuota, codexUsage } from '../src/codex/normalize.ts';
import { parseRoleTemplate } from '../src/company/role-templates.ts';
import { CODEX_SESSION_FILE, codexSession } from '../src/codex/process.ts';
import { setup, tempDir, until, waitFor } from './helpers.ts';
import { createApi } from '../src/api.ts';
import { QuotaTracker } from '../src/quota.ts';
import { pageHeaders } from './owner-helpers.ts';

const fake = fileURLToPath(new URL('./fake-codex.mjs', import.meta.url));
const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });
function make(gate?: { url: () => string; hook: string }, tokens?: import('../src/mcp/tokens.ts').TokenRegistry) {
  const s = setup(), log = join(s.dataDir, 'rpc.jsonl');
  const engine = new Engine({ ...s, claudeCommand: ['never-run-claude'], provider: 'codex', codexCommand: [process.execPath, fake], env: { ...process.env, FAKE_CODEX_LOG: log }, ...(gate && tokens ? { gate, mcp: { url: () => gate.url(), tokens } } : {}) });
  cleanup.push(s.cleanup, () => s.db.close(), () => engine.shutdown());
  return { ...s, engine, log };
}
function transcript(log: string): Array<Record<string, any>> { return readFileSync(log, 'utf8').split('\n').slice(0, -1).filter(Boolean).map(l => JSON.parse(l)); }
async function turn(t: ReturnType<typeof make>, id: string, text: string) {
  const after = t.events.lastSeq(); t.engine.send(id, text);
  const finished = await waitFor(t.events, s => s.event.type === 'turn.finished', { after });
  return { finished: finished.event, events: t.events.list({ employeeId: id, after }) };
}

describe('Codex office integration', () => {
  it('loads the shipped employee role templates with Windows line endings', () => {
    const role = readFileSync(new URL('../src/company/craft/roles/arastirmaci.md', import.meta.url), 'utf8');
    expect(parseRoleTemplate('arastirmaci', role.replace(/\r?\n/g, '\r\n'))).toEqual(parseRoleTemplate('arastirmaci', role.replaceAll('\r\n', '\n')));
  });
  it('validates the default provider and command', () => {
    expect(loadConfig({ OFFICE_PROVIDER: 'codex' }).dataDir).toMatch(/\.control-center-codex$/);
    expect(loadConfig({ OFFICE_PROVIDER: 'codex', OFFICE_CODEX_COMMAND: '["codex-custom"]' }).codexCommand).toEqual(['codex-custom']);
    expect(() => loadConfig({ OFFICE_PROVIDER: 'x' })).toThrow(/OFFICE_PROVIDER/);
    expect(() => loadConfig({ OFFICE_CODEX_COMMAND: '[]' })).toThrow(/OFFICE_CODEX_COMMAND/);
  });
  it('normalizes cached tokens without double counting and classifies only completed turns as successful', () => {
    expect(codexUsage({ inputTokens: 20, cachedInputTokens: 8, outputTokens: 4 })).toEqual({ inputTokens: 12, outputTokens: 4, cacheReadTokens: 8, cacheCreationTokens: 0 });
    expect(codexQuota({ primary: { usedPercent: 100, resetsAt: 123 } }, true)).toMatchObject({ status: 'rejected', limitResetsAt: 123000 });
    expect(codexItem({ type: 'agentMessage', text: 'hello' }, false)).toEqual([]);
    expect(codexItem({ type: 'commandExecution', id: 'x', status: 'completed', exitCode: 1 }, true)).toMatchObject([{ type: 'tool.finished', isError: true }]);
  });
  it('inherits native integrations and permissions, reads all catalog pages, and writes a role card', async () => {
    const t = make(), e = t.engine.hire({ name: 'Ada', role: 'Yazılım geliştir', model: 'fable' });
    const started = await waitFor(t.events, s => s.event.type === 'session.started');
    expect(started.event).toMatchObject({ model: 'test-codex / medium', mcp: [{ name: 'office', status: 'connected', tools: 2 }, { name: 'personal', status: 'connected', tools: 1 }] });
    const cwd = join(t.dataDir, 'desks', e.slug);
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toContain('Yazılım geliştir');
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).not.toContain('@office-guide.md');
    expect(codexSession(cwd)).toBe('codex-thread-1');
    const start = transcript(t.log).find(m => m.method === 'thread/start');
    expect(start?.params).toMatchObject({ model: 'test-codex', sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' });
    expect(start?.params.config).toEqual({ 'features.image_generation': true });
    expect(t.engine.runtime()).toEqual({ provider: 'codex', mode: 'mixed', costAvailable: false });
  });
  it('delivers multiple messages once, accounts for per-turn tokens, and resumes the same native thread', async () => {
    const t = make(), e = t.engine.hire({ name: 'Ada', role: 'r' });
    const first = await turn(t, e.id, 'bir');
    expect(first.events.filter(s => s.event.type === 'message.assistant').map(s => s.event)).toEqual([{ type: 'message.assistant', text: 'echo:bir', provider: 'codex' }]);
    expect(first.finished).toMatchObject({ ok: true, usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 5 } });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
    await t.engine.stop(e.id); t.engine.resume(e.id);
    await turn(t, e.id, 'iki');
    expect(transcript(t.log).find(m => m.method === 'thread/resume')?.params.threadId).toBe('codex-thread-1');
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });
  it('steers an active task, interrupts it, and distinguishes a failed turn', async () => {
    const t = make(), e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'SLOW');
    await until(() => existsSync(t.log) && transcript(t.log).some(m => m.method === 'turn/start'));
    const result = await turn(t, e.id, 'steering');
    expect(result.events.some(s => s.event.type === 'message.assistant' && s.event.text === 'steered:steering')).toBe(true);
    expect((await turn(t, e.id, 'FAIL')).finished).toMatchObject({ ok: false });
    t.engine.send(e.id, 'SLOW');
    await until(() => transcript(t.log).filter(m => m.method === 'turn/start').length >= 4);
    await t.engine.stop(e.id);
    expect(transcript(t.log).some(m => m.method === 'turn/interrupt')).toBe(true);
    expect(t.roster.get(e.id).lifecycle).toBe('stopped');
  });
  it('forks side questions without replacing the desk session, and hands off a native Codex resume command', async () => {
    const t = make(), e = t.engine.hire({ name: 'Ada', role: 'r' });
    await turn(t, e.id, 'iş');
    const file = join(t.dataDir, 'desks', e.slug, CODEX_SESSION_FILE), original = readFileSync(file, 'utf8');
    expect(await t.engine.sideQuestion(e.id, 'durum')).toEqual({ ok: true, answer: 'echo:durum' });
    expect(readFileSync(file, 'utf8')).toBe(original);
    expect(transcript(t.log).find(m => m.method === 'thread/fork')?.params).toMatchObject({ threadId: 'codex-thread-1', ephemeral: true, excludeTurns: true, sandbox: 'read-only', approvalPolicy: 'untrusted', config: { 'features.image_generation': false, 'features.apps': false, 'features.multi_agent': false, 'mcp_servers.personal.enabled': false, 'plugins.test@plugin.enabled': false } });
    const handoff = await t.engine.openInTerminal(e.id);
    expect(handoff.command).toContain('codex resume'); expect(handoff.command).toContain('codex-thread-1');
  });
  it('routes command/file approvals through the office gate and fails closed when it is unreachable', async () => {
    const { TokenRegistry } = await import('../src/mcp/tokens.ts');
    let allow = false;
    const calls: Array<Record<string, unknown>> = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      calls.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ decision: allow ? 'allow' : 'deny', reason: 'onay gerekiyor' }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const port = (server.address() as { port: number }).port;
    const t = make({ url: () => `http://127.0.0.1:${port}/gate/check`, hook: '' }, new TokenRegistry());
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    expect((await turn(t, e.id, 'COMMAND')).events.some(s => s.event.type === 'message.assistant' && s.event.text === 'denied')).toBe(true);
    allow = true; await turn(t, e.id, 'WRITE');
    expect(calls.map(c => c.tool_name)).toEqual(['Bash', 'Write']);
    await new Promise<void>(resolve => server.close(() => resolve()));
    expect((await turn(t, e.id, 'COMMAND')).events.some(s => s.event.type === 'message.assistant' && s.event.text === 'denied')).toBe(true);
  });
  it('records native images without base64 payloads and reports generation failures', () => {
    const item = { type: 'imageGeneration', id: 'image-1', status: 'completed', savedPath: '/images/ugc.png', revisedPrompt: 'UGC photo', result: 'BASE64_MUST_NOT_ENTER_EVENT_LOG' };
    expect(codexItem(item, false)).toMatchObject([{ type: 'tool.started', name: 'Imagegen' }]);
    expect(codexItem(item, true)).toEqual([
      { type: 'tool.finished', toolUseId: 'image-1', isError: false, output: 'Görsel hazır: /images/ugc.png' },
      { type: 'image.generated', path: '/images/ugc.png', prompt: 'UGC photo' },
    ]);
    expect(codexItem({ ...item, failure: { type: 'usageLimitExceeded' } }, true)).toMatchObject([{ type: 'tool.finished', isError: true, output: 'Görsel üretilemedi: usageLimitExceeded' }]);
    expect(codexItem({ ...item, savedPath: undefined }, true)).toHaveLength(1);
  });
  it('waits for owner connector answers, keeps them out of request events, and rejects replay or another employee', async () => {
    const t = make(), e = t.engine.hire({ name: 'Ada', role: 'r' });
    await turn(t, e.id, 'ready');
    const other = t.engine.hire({name:'Other',role:'r'});
    for (const prompt of ['ELICIT', 'PERMISSIONS', 'QUESTION']) {
      const after = t.events.lastSeq(); t.engine.send(e.id, prompt);
      const stored = await waitFor(t.events, s => s.employeeId === e.id && s.event.type === 'codex.request', {after});
      const pending = t.engine.codexRequests(e.id)[0]!;
      expect(stored.event).toEqual({type:'codex.request',requestId:pending.id,provider:'codex'});
      expect(() => t.engine.answerCodexRequest(other.id, pending.id, 'accept', {})).toThrow();
      if (prompt === 'QUESTION') expect(() => t.engine.answerCodexRequest(e.id, pending.id, 'accept', {})).toThrow(/yanıt/);
      const content = prompt === 'ELICIT' ? {choice:'selected'} : prompt === 'QUESTION' ? {q:{answers:['answer']}} : {filesystem:{read:['/unrequested']}};
      t.engine.answerCodexRequest(e.id, pending.id, 'accept', content);
      await waitFor(t.events, s => s.employeeId === e.id && s.event.type === 'turn.finished', {after});
      expect(t.engine.codexRequests(e.id)).toEqual([]);
      expect(() => t.engine.answerCodexRequest(e.id, pending.id, 'accept', content)).toThrow(/etkin/);
      if (prompt === 'PERMISSIONS') expect(transcript(t.log).filter(m => m.result?.permissions).at(-1)?.result).toEqual({permissions:{network:{enabled:true}},scope:'turn'});
    }
    const after = t.events.lastSeq(); t.engine.send(e.id, 'ELICIT');
    await waitFor(t.events, s => s.employeeId === e.id && s.event.type === 'codex.request', {after});
    await t.engine.stop(e.id);
    expect(t.engine.codexRequests(e.id)).toEqual([]);
  });
  it('protects live connector replies with the owner guard and returns conflict after completion', async () => {
    const t = make(), e = t.engine.hire({name:'Ada',role:'r'});
    const api = createApi({...t,quota:new QuotaTracker(t.db,t.events)}, {allowedOrigins:[]});
    await new Promise<void>(r => api.server.listen(0,'127.0.0.1',r)); cleanup.push(() => api.close());
    const port = (api.server.address() as {port:number}).port;
    const url = `http://127.0.0.1:${port}/api/employees/${e.id}/codex-requests`;
    await turn(t,e.id,'ready');
    const after = t.events.lastSeq(); t.engine.send(e.id,'ELICIT');
    await waitFor(t.events,s => s.event.type === 'codex.request',{after});
    const pending = await (await fetch(url)).json();
    const body = JSON.stringify({requestId:pending[0].id,action:'decline'});
    expect((await fetch(url,{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body})).status).toBe(403);
    expect(t.engine.codexRequests(e.id)).toHaveLength(1);
    const headers = {...await pageHeaders(port),'content-type':'application/json'};
    expect((await fetch(url,{method:'POST',headers,body})).status).toBe(200);
    expect((await fetch(url,{method:'POST',headers,body})).status).toBe(409);
  });
});
