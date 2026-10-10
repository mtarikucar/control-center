import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
let thread = 'codex-thread-1', turns = 0, total = 0, active = null, initialized = false;
const approvals = new Map();
const log = (m) => { if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify(m)}\n`); };
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const notify = (method, params) => send({ method, params: { threadId: thread, ...params } });
const reply = (id, result) => send({ id, result });
function finish(text, status = 'completed') {
  if (!active) return;
  notify('item/agentMessage/delta', { itemId: `a-${turns}`, delta: 'not-a-second-message' });
  notify('item/completed', { item: { type: 'agentMessage', id: `a-${turns}`, text } });
  total += 15;
  writeFileSync(join(process.cwd(), `.fake-${thread}.json`), JSON.stringify({ turns, total }));
  notify('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: total, cachedInputTokens: turns * 5, outputTokens: turns * 3 }, last: { inputTokens: 15, cachedInputTokens: 5, outputTokens: 3 } } });
  notify('turn/completed', { turn: { id: active, status } });
  active = null;
}
log({ argv: process.argv.slice(2) });
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line); log(m);
  if (!m.method) { const done = approvals.get(m.id); if (done) { approvals.delete(m.id); done(m.result); } return; }
  const p = m.params ?? {};
  if (m.method !== 'initialize' && m.method !== 'initialized' && !initialized) return send({ id: m.id, error: { message: 'not initialized' } });
  switch (m.method) {
    case 'initialize': initialized = true; reply(m.id, {}); break;
    case 'initialized': break;
    case 'account/read': reply(m.id, { account: { type: 'chatgpt' }, requiresOpenaiAuth: true }); break;
    case 'config/read': reply(m.id, { config: { model: 'test-codex', approval_policy: 'on-request', sandbox_mode: 'workspace-write', mcp_servers: { personal: { url: 'https://example.invalid' } }, plugins: { 'test@plugin': { enabled: true } } } }); break;
    case 'model/list': reply(m.id, { data: [{ id: 'test-codex', model: 'test-codex', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high'].map(reasoningEffort => ({ reasoningEffort })) }] }); break;
    case 'thread/start': case 'thread/resume': case 'thread/fork':
      if (m.method === 'thread/fork' && p.ephemeral && !p.excludeTurns) { send({ id: m.id, error: { message: 'ephemeral paginated thread/fork requires excludeTurns: true' } }); break; }
      thread = m.method === 'thread/fork' ? 'codex-fork-1' : p.threadId ?? thread;
      if (m.method !== 'thread/start') {
        const saved = join(process.cwd(), `.fake-${p.threadId}.json`);
        if (existsSync(saved)) ({ turns, total } = JSON.parse(readFileSync(saved, 'utf8')));
      }
      reply(m.id, { thread: { id: thread }, model: p.model ?? 'test-codex' }); break;
    case 'mcpServerStatus/list': reply(m.id, { data: thread === 'codex-fork-1' ? [] : p.cursor ? [{ name: 'personal', runtimeStatus: 'connected', tools: { read: {} } }] : [{ name: 'office', runtimeStatus: 'ready', tools: { taskFinish: {}, taskPark: {} }, authStatus: 'notLoggedIn' }], nextCursor: thread !== 'codex-fork-1' && !p.cursor ? 'page2' : null }); break;
    case 'account/rateLimits/read': reply(m.id, { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 2000000000 }, secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 2000100000 } } }); break;
    case 'turn/start': {
      const text = p.input[0].text;
      if (active) { reply(m.id, { turn: { id: active } }); finish(`steered:${text}`); break; }
      active = `turn-${++turns}`; reply(m.id, { turn: { id: active } }); notify('turn/started', { turn: { id: active } });
      if (text === 'SLOW') break;
      if (['ELICIT', 'PERMISSIONS', 'QUESTION'].includes(text)) {
        const id = 900 + turns;
        approvals.set(id, result => finish(JSON.stringify(result)));
        const method = text === 'ELICIT' ? 'mcpServer/elicitation/request' : text === 'PERMISSIONS' ? 'item/permissions/requestApproval' : 'item/tool/requestUserInput';
        send({ id, method, params: { threadId: thread, turnId: active, ...(text === 'ELICIT' ? {mode:'form',serverName:'personal',message:'Choose',requestedSchema:{type:'object',properties:{choice:{type:'string'}},required:['choice']}} : text === 'PERMISSIONS' ? {permissions:{network:{enabled:true}},reason:'Read website'} : {questions:[{id:'q',question:'Which?',options:null,isSecret:true}]}) }});
        break;
      }
      if (text === 'COMMAND' || text === 'WRITE') {
        const isCommand = text === 'COMMAND', item = isCommand ? { type: 'commandExecution', id: 'tool-1', command: 'echo test', cwd: process.cwd(), status: 'inProgress' } : { type: 'fileChange', id: 'tool-1', changes: [{ path: `${process.cwd()}/output.txt`, diff: '+test' }], status: 'inProgress' };
        notify('item/started', { item });
        const id = 900 + turns;
        approvals.set(id, result => { const allowed = result.decision === 'accept'; notify('item/completed', { item: { ...item, status: allowed ? 'completed' : 'declined', exitCode: allowed ? 0 : 1, aggregatedOutput: allowed ? 'test' : 'denied' } }); finish(allowed ? 'approved' : 'denied'); });
        send({ id, method: isCommand ? 'item/commandExecution/requestApproval' : 'item/fileChange/requestApproval', params: { threadId: thread, turnId: active, itemId: item.id } });
      } else if (text === 'FAIL') finish('failed-turn', 'failed');
      else setTimeout(() => finish(`echo:${text}`), 20);
      break;
    }
    case 'turn/interrupt': reply(m.id, {}); finish('interrupted', 'interrupted'); break;
    default: send({ id: m.id, error: { code: -32601, message: `unknown ${m.method}` } });
  }
}).on('close', () => process.exit(0));
