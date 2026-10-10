import type { OnceResult } from '../claude/once.ts';
import { codexUsage } from './normalize.ts';
import { CodexProcess, type CodexOptions } from './process.ts';

/** A read-only fork answers independently while the worker's task continues. */
export function runCodexOnce(o: CodexOptions & { input: string; timeoutMs: number; signal?: AbortSignal }): Promise<OnceResult> {
  const fail = (text: string): OnceResult => ({ ok: false, text, usage: codexUsage(null), sessionUsage: null, sessionCostUsd: 0 });
  if (o.signal?.aborted) return Promise.resolve(fail('iptal edildi'));
  return new Promise((resolve) => {
    let answer = '', error = '', done = false;
    const finish = (result: OnceResult) => {
      if (done) return; done = true; clearTimeout(timer); o.signal?.removeEventListener('abort', abort);
      void proc.close().then(() => resolve(result), () => resolve(result));
    };
    const proc = new CodexProcess(o, {
      onEvent: (event) => {
        if (event.type === 'message.assistant') answer += `${answer ? '\n\n' : ''}${event.text}`;
        if (event.type === 'error') error = event.message;
        if (event.type === 'turn.finished') finish({ ok: event.ok, text: answer || error, usage: event.usage, sessionUsage: null, sessionCostUsd: 0 });
      },
      onExit: (_code, _signal, stderr) => finish(fail(error || stderr || 'Codex yan sorusu tamamlanamadı')),
    });
    const abort = () => finish(fail('iptal edildi'));
    const timer = setTimeout(() => finish(fail('Codex yan sorusu zaman aşımına uğradı')), o.timeoutMs);
    o.signal?.addEventListener('abort', abort, { once: true });
    proc.sendUser(o.input);
  });
}
