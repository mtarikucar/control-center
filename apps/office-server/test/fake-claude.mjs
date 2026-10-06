#!/usr/bin/env node
// Test double for the `claude` CLI: speaks the subset of stream-json that office-server relies on.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const stateDir = process.env.FAKE_CLAUDE_STATE ?? join(process.cwd(), '.fake-claude');
mkdirSync(stateDir, { recursive: true });
if (process.env.FAKE_CLAUDE_ARGV_LOG) appendFileSync(process.env.FAKE_CLAUDE_ARGV_LOG, `${JSON.stringify({ args, cwd: process.cwd() })}\n`);

const sessionId = opt('--resume') ?? opt('--session-id') ?? randomUUID();
const historyFile = join(stateDir, `${sessionId}.json`);
const history = existsSync(historyFile) ? JSON.parse(readFileSync(historyFile, 'utf8')) : [];
const remember = (text) => {
  history.push(text);
  writeFileSync(historyFile, JSON.stringify(history));
};
const out = (obj) => process.stdout.write(`${JSON.stringify({ ...obj, session_id: sessionId })}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 };
let queued = 0;
const result = (extra = {}) =>
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.01, usage, result: '', queued_turn_count: queued, ...extra });
const rateLimit = (status, resetsInSec) => {
  const resetsAt = Math.floor(Date.now() / 1000) + resetsInSec;
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

if (opt('--output-format') === 'json') {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  process.stdout.write(
    `${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `side:${prompt.trim()}|history:${history.length}`, usage, total_cost_usd: 0.002, session_id: randomUUID() })}\n`,
  );
  process.exit(0);
}

if (process.env.FAKE_CLAUDE_NOISE) process.stdout.write('Warning: something odd\n{not json\n');

let initSent = false;
let busy = null;

async function turn(text) {
  if (!initSent) {
    out({ type: 'system', subtype: 'init', model: 'fake-model', cwd: process.cwd(), permissionMode: 'bypassPermissions', mcp_servers: [{ name: 'office', status: 'connected' }] });
    initSent = true;
  }
  remember(text);
  if (text.includes('CRASH')) {
    process.stderr.write('boom: fake crash\n');
    process.exit(3);
  }
  if (text.includes('LIMIT')) {
    rateLimit('rejected', Number(process.env.FAKE_CLAUDE_LIMIT_RESET_SEC ?? '2'));
    result({ subtype: 'error_during_execution', is_error: true, result: 'usage limit reached' });
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
      busy.injected.push(text);
      remember(text);
      return;
    }
    queued += 1;
    chain = chain.then(() => {
      queued -= 1;
      return turn(text);
    });
  })
  .on('close', () => {
    chain.then(() => process.exit(0));
  });
