#!/usr/bin/env node
// The office gate's PreToolUse hook (B9a; design tasarim-b9-kanca-onay.md §4). Claude Code runs it before a tool call
// with the call on stdin; it asks the office (OFFICE_GATE_URL, with the session's own token OFFICE_GATE_TOKEN) and
// exits 0 to let the call run or 2 to stop it, the reason on stderr for the model. Every failure is 2 (fail-closed): a
// hook that exits with anything else is a non-blocking error and the call would run. No dependencies.
import { appendFileSync } from 'node:fs';

const deny = (reason) => {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
};
process.on('uncaughtException', () => deny('OFİS KAPISI: kanca hata verdi; çağrı yapılmadı. Biraz sonra tekrar dene.'));
process.on('unhandledRejection', () => deny('OFİS KAPISI: kanca hata verdi; çağrı yapılmadı. Biraz sonra tekrar dene.'));

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let call;
try {
  call = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  deny('OFİS KAPISI: kancanın girdisi okunamadı; çağrı yapılmadı.');
}
if (!call || typeof call !== 'object' || Array.isArray(call) || typeof call.tool_name !== 'string' || !call.tool_name) {
  deny('OFİS KAPISI: kancanın girdisi okunamadı; çağrı yapılmadı.');
}
// For the real-session test of the matcher: which tools reached the hook at all.
if (process.env.OFFICE_GATE_TRACE) appendFileSync(process.env.OFFICE_GATE_TRACE, `${call.tool_name}\n`);
// The office's own tools never wait (the matcher leaves them out too; this is its plan B).
if (call.tool_name.startsWith('mcp__office__')) process.exit(0);

const url = process.env.OFFICE_GATE_URL;
const token = process.env.OFFICE_GATE_TOKEN;
if (!url || !token) deny('OFİS KAPISI: ofis kapısının adresi ya da jetonu yok; çağrı yapılmadı.');
const timeoutMs = Math.min(Number(process.env.OFFICE_GATE_TIMEOUT_MS) || 8000, 9000);

let answer;
try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(call),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) deny(`OFİS KAPISI: ofis kapısı isteği geri çevirdi (HTTP ${res.status}); çağrı yapılmadı.`);
  answer = await res.json();
} catch {
  deny('OFİS KAPISI: ofis kapısına ulaşılamadı; çağrı yapılmadı. Biraz sonra tekrar dene.');
}
if (answer && answer.decision === 'allow') process.exit(0);
deny(answer && typeof answer.reason === 'string' && answer.reason ? answer.reason : 'OFİS KAPISI: ofis kapısının cevabı anlaşılmadı; çağrı yapılmadı.');
