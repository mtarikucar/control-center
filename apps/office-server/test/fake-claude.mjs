#!/usr/bin/env node
// Test double for the `claude` CLI: speaks the subset of stream-json that office-server relies on.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const stateDir = process.env.FAKE_CLAUDE_STATE ?? join(process.cwd(), '.fake-claude');
mkdirSync(stateDir, { recursive: true });
// What the session would read at start: the desk's own settings' deny rules (B5's closed mode), or null without a file.
const deskSettings = join(process.cwd(), '.claude', 'settings.json');
const deny = existsSync(deskSettings) ? (JSON.parse(readFileSync(deskSettings, 'utf8')).permissions?.deny ?? null) : null;
if (process.env.FAKE_CLAUDE_ARGV_LOG) appendFileSync(process.env.FAKE_CLAUDE_ARGV_LOG, `${JSON.stringify({ args, cwd: process.cwd(), deny })}\n`);

const failFlag = process.env.FAKE_CLAUDE_FAIL_FLAG;
if (failFlag && existsSync(failFlag)) {
  // The file may hold how many starts in a row fail (default one).
  const left = Number(readFileSync(failFlag, 'utf8')) || 1;
  if (left > 1) writeFileSync(failFlag, String(left - 1));
  else unlinkSync(failFlag);
  process.stderr.write('startup failure\n');
  process.exit(1);
}
const replay = args.includes('--replay-user-messages');
const ack = (uuid, text) => {
  if (replay && uuid) out({ type: 'user', uuid, isReplay: true, message: { role: 'user', content: text } });
};

const sessionId = opt('--resume') ?? opt('--session-id') ?? randomUUID();
const historyFile = join(stateDir, `${sessionId}.json`);
const state = existsSync(historyFile)
  ? JSON.parse(readFileSync(historyFile, 'utf8'))
  : { messages: [], totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0 } };
const history = state.messages;
const save = () => writeFileSync(historyFile, JSON.stringify(state));
const remember = (text) => {
  history.push(text);
  save();
};
const out = (obj) => process.stdout.write(`${JSON.stringify({ ...obj, session_id: sessionId })}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 };
const modelUsage = (t) => ({
  'fake-model': { inputTokens: t.input, outputTokens: t.output, cacheReadInputTokens: t.cacheRead, cacheCreationInputTokens: t.cacheCreation, costUSD: t.cost },
});
const add = (t, cost) => ({
  input: t.input + usage.input_tokens,
  output: t.output + usage.output_tokens,
  cacheRead: t.cacheRead + usage.cache_read_input_tokens,
  cacheCreation: t.cacheCreation + usage.cache_creation_input_tokens,
  cost: t.cost + cost,
});
let queued = 0;
// Like the real CLI: `usage` is this turn only, `total_cost_usd` and `modelUsage` are running totals for the session.
const result = (extra = {}) => {
  state.totals = add(state.totals, 0.01);
  save();
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: state.totals.cost, modelUsage: modelUsage(state.totals), usage, result: '', queued_turn_count: queued, ...extra });
};
const rateLimit = (status, resetsInSec) => {
  const resetsAt = Math.floor(Date.now() / 1000) + resetsInSec;
  const limitType = process.env.FAKE_CLAUDE_LIMIT_TYPE;
  if (status === 'rejected' && limitType) {
    // A per-model weekly limit: the unified windows are not full, the top-level fields name the limiting window.
    const now = Math.floor(Date.now() / 1000);
    out({
      type: 'rate_limit_event',
      rate_limit_info: {
        status,
        resetsAt,
        rateLimitType: limitType,
        unifiedWindows: { five_hour: { utilization: 0.3, resetsAt: now + 5000 }, seven_day: { utilization: 0.5, resetsAt: now + 90_000 } },
      },
    });
    return;
  }
  out({
    type: 'rate_limit_event',
    rate_limit_info: {
      status,
      resetsAt,
      rateLimitType: 'five_hour',
      unifiedWindows: {
        five_hour: { utilization: status === 'rejected' ? 1 : 0.25, resetsAt },
        seven_day: { utilization: 0.1, resetsAt: resetsAt + 86_400 },
      },
    },
  });
};
const say = (text) => out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

if (process.env.FAKE_CLAUDE_IGNORE_TERM) {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
if (process.env.FAKE_CLAUDE_GRANDCHILD) {
  // Like a dev server a Bash tool left running: it holds our stdout and outlives us unless its group is killed.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
  writeFileSync(process.env.FAKE_CLAUDE_GRANDCHILD, String(child.pid));
}

if (opt('--output-format') === 'json') {
  if (process.env.FAKE_CLAUDE_SIDE_HANG) setInterval(() => {}, 1000);
  if (process.env.FAKE_CLAUDE_SIDE_HANG) await new Promise(() => {});
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  const forkTotals = add(state.totals, 0.002); // a fork starts from the parent's running total
  process.stdout.write(
    `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `side:${prompt.trim()}|history:${history.length}`, usage, total_cost_usd: forkTotals.cost, modelUsage: modelUsage(forkTotals), session_id: randomUUID() })}\n`,
  );
  process.exit(0);
}

if (process.env.FAKE_CLAUDE_NOISE) process.stdout.write('Warning: something odd\n{not json\n');

let initSent = false;
let busy = null;

async function turn(text, uuid) {
  // The real CLI announces itself (system init) at every turn; once per process is enough for the office.
  if (!initSent) {
    out({ type: 'system', subtype: 'init', model: opt('--model') ?? 'fake-model', cwd: process.cwd(), permissionMode: 'bypassPermissions', mcp_servers: [{ name: 'office', status: 'connected' }] });
    initSent = true;
  }
  const unavailable = (process.env.FAKE_CLAUDE_UNAVAILABLE_MODELS ?? '').split(',').filter(Boolean);
  if (process.env.FAKE_CLAUDE_ERROR_BEFORE_ACK && unavailable.includes(opt('--model') ?? '')) {
    // A CLI that answers with the error before it replays the message: the message is never acknowledged.
    const why = `There's an issue with the selected model (${opt('--model')}). It may not exist or you may not have access to it.`;
    say(why);
    result({ is_error: true, result: why });
    return;
  }
  ack(uuid, text);
  remember(text);
  // Like the real CLI on a model the account cannot use: it takes the message, answers with an error and stays up.
  if (unavailable.includes(opt('--model') ?? '')) {
    const why = `There's an issue with the selected model (${opt('--model')}). It may not exist or you may not have access to it. Run --model to pick a different model.`;
    say(why);
    result({ is_error: true, result: why });
    return;
  }
  if (text.includes('CRASH')) {
    process.stderr.write('boom: fake crash\n');
    process.exit(3);
  }
  if (text.includes('LIMIT')) {
    rateLimit('rejected', Number(process.env.FAKE_CLAUDE_LIMIT_RESET_SEC ?? '2'));
    result({ subtype: 'error_during_execution', is_error: true, result: 'usage limit reached' });
    return;
  }
  if (text.includes('TOOLFAIL')) {
    // Works (a tool runs), then the turn ends with an error for a reason that is not the model (e.g. overloaded).
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_tf', name: 'Write', input: { file_path: '/d/half.txt', content: 'yarım' } }] } });
    result({ subtype: 'error_during_execution', is_error: true, result: 'overloaded' });
    return;
  }
  if (text.includes('OOPS')) {
    // Fails for a reason other than the subscription (e.g. the API is overloaded): no rate-limit event.
    result({ subtype: 'error_during_execution', is_error: true, result: 'overloaded' });
    return;
  }
  if (text.includes('BIGWRITE')) {
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_big', name: 'Write', input: { file_path: '/d/a.txt', content: 'x'.repeat(10_000) } }] } });
    result();
    return;
  }
  if (text.includes('SLOW')) {
    busy = { interrupted: false, injected: [] };
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_fake1', name: 'Bash', input: { command: 'sleep 1' } }] } });
    for (let i = 0; i < 20 && !busy.interrupted; i += 1) await sleep(50);
    const { interrupted, injected } = busy;
    busy = null;
    if (interrupted) {
      result({ subtype: 'error_during_execution', is_error: true, result: null });
      return;
    }
    out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fake1', is_error: false, content: 'done' }] } });
    // Writing the final answer: a message arriving now is not injected but queued for a follow-up turn.
    await sleep(Number(process.env.FAKE_CLAUDE_FINAL_MS ?? '300'));
    say(`slow-done${injected.length ? ` saw:${injected.join(',')}` : ''}`);
    rateLimit('allowed', 3600);
    result({ num_turns: 2, result: 'slow-done' });
    return;
  }
  if (text.includes('HOLD') && process.env.FAKE_CLAUDE_HOLD_DIR) {
    // A long piece of work: the turn lasts until the test releases it (a file named after the session).
    const release = join(process.env.FAKE_CLAUDE_HOLD_DIR, sessionId);
    while (!existsSync(release)) await sleep(10);
    unlinkSync(release);
    say('held-done');
    result();
    return;
  }
  if (text.includes('WHAT DID I SAY')) {
    say(`you said: ${history[history.length - 2] ?? 'nothing'}`);
    result();
    return;
  }
  say(`echo: ${text}`);
  rateLimit('allowed', 3600);
  result({ result: `echo: ${text}` });
}

let chain = Promise.resolve();
createInterface({ input: process.stdin })
  .on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === 'control_request' && msg.request?.subtype === 'interrupt') {
      out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
      if (busy) busy.interrupted = true;
      return;
    }
    if (msg.type !== 'user') return;
    const text = typeof msg.message?.content === 'string' ? msg.message.content : '';
    if (busy) {
      ack(msg.uuid, text);
      busy.injected.push(text);
      remember(text);
      return;
    }
    queued += 1;
    chain = chain.then(() => {
      queued -= 1;
      return turn(text, msg.uuid);
    });
  })
  .on('close', () => {
    if (process.env.FAKE_CLAUDE_IGNORE_TERM) return; // a hung claude: only SIGKILL ends it
    chain.then(() => process.exit(0));
  });
