import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.ts';
import { setup, tempDir, waitFor } from './helpers.ts';

const enabled = process.env.OFFICE_SMOKE === '1';

/** One raw stream-json line of the claude CLI (only what this test reads). */
interface Raw {
  type?: string;
  subtype?: string;
  model?: string;
  modelUsage?: Record<string, unknown>;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

/**
 * Acceptance R5 at K3: a model switch on the real CLI (haiku → sonnet, the cheapest pair) restarts the session with
 * `--resume --model`, the conversation goes on (the code word from the first turn is remembered) and the model really
 * changed (the CLI's own init and result say so). It also records what the prompt cache does around the switch.
 * A few short turns, a few cents. SMOKE_OUT=<file> writes the table.
 */
describe.skipIf(!enabled)('real claude: a model switch keeps the conversation (haiku → sonnet)', () => {
  it('remembers across the switch; init and result name the new model; cache tokens per turn', async () => {
    const s = setup();
    const raw = join(tempDir('claude-raw-'), 'raw.jsonl');
    // The CLI's stdout is teed to a file so the test can read its own words (model names, cache tokens).
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))), RAW_LOG: raw };
    const engine = new Engine({ roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: ['sh', '-c', 'claude "$@" | tee -a "$RAW_LOG"', 'sh'], env });
    const word = `zebra-${Math.floor(1000 + Math.random() * 9000)}`;
    const turns: Array<{ prompt: string; seq: number }> = [];
    const turn = async (prompt: string, hint = {}) => {
      const after = s.events.lastSeq();
      engine.send(e.id, prompt, 'system', hint);
      const done = await waitFor(s.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished', { after, timeoutMs: 180_000 });
      expect(done.event).toMatchObject({ ok: true });
      turns.push({ prompt, seq: done.seq });
      return s.events
        .list({ after, limit: 5000 })
        .filter((x) => x.event.type === 'message.assistant')
        .map((x) => (x.event as { text: string }).text)
        .join(' ');
    };
    const e = engine.hire({ name: 'Smoke', role: 'Kısa cevap veren bir test çalışanısın; araç kullanma.', model: 'haiku' });
    try {
      await turn(`Remember this code word for later: ${word}. Reply with exactly: OK`);
      await turn('Reply with exactly: OK2');
      const recalled = await turn('What was the code word I gave you? Reply with the code word only.', { model: 'sonnet' });
      await turn('Reply with exactly: OK3');

      expect(recalled).toContain(word);
      // The real CLI announces its model (system init) at every turn, not once per process.
      const inits = s.events.list({ employeeId: e.id, limit: 5000 }).filter((x) => x.event.type === 'session.started').map((x) => (x.event as { model: string }).model);
      expect(inits.map((m) => (/haiku/.test(m) ? 'haiku' : /sonnet/.test(m) ? 'sonnet' : m))).toEqual(['haiku', 'haiku', 'sonnet', 'sonnet']);
      expect(s.roster.get(e.id).model).toBe('haiku');

      const lines = existsSync(raw) ? readFileSync(raw, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Raw) : [];
      const results = lines.filter((l) => l.type === 'result');
      expect(results).toHaveLength(4);
      expect(Object.keys(results[2]!.modelUsage ?? {}).some((m) => /sonnet/.test(m))).toBe(true);
      const finished = s.events.list({ employeeId: e.id, limit: 5000 }).filter((x) => x.event.type === 'turn.finished');
      const table = [
        `Kod kelimesi: ${word} · geçişten sonraki cevap: “${recalled.trim()}”`,
        `Turların CLI init modeli: ${inits.join(' → ')}`,
        '',
        '| Tur | İstem | Model (result.modelUsage) | Giriş | Önbellek okuma | Önbellek yazma | Çıkış | USD (tur) |',
        '|---:|---|---|---:|---:|---:|---:|---:|',
        ...results.map((r, i) => {
          const u = (finished[i]?.event as { usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }; costUsd: number }) ?? null;
          return `| ${i + 1} | ${turns[i]!.prompt.slice(0, 40)} | ${Object.keys(r.modelUsage ?? {}).join(', ')} | ${r.usage?.input_tokens ?? '?'} | ${r.usage?.cache_read_input_tokens ?? '?'} | ${r.usage?.cache_creation_input_tokens ?? '?'} | ${r.usage?.output_tokens ?? '?'} | ${u ? u.costUsd.toFixed(4) : '?'} |`;
        }),
      ].join('\n');
      console.log(`\n${table}\n`);
      if (process.env.SMOKE_OUT) writeFileSync(process.env.SMOKE_OUT, `${table}\n`);
    } finally {
      await engine.shutdown();
      s.cleanup();
    }
  }, 600_000);
});

/**
 * The cache lifetime behind cacheTtlMinutes (5): two turns at once, then one after a 6½-minute pause on the same
 * session and model. If the pause turn writes the conversation to the cache again, the cache had gone cold. Opt-in
 * (OFFICE_SMOKE_TTL=1): it waits in real time. SMOKE_TTL_OUT=<file> writes the table.
 */
describe.skipIf(process.env.OFFICE_SMOKE_TTL !== '1')('real claude: how long the prompt cache stays warm', () => {
  it('cache tokens of a turn right after the last and of one after 6½ minutes', async () => {
    const s = setup();
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE')));
    const engine = new Engine({ roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: ['claude'], env });
    const e = engine.hire({ name: 'Ttl', role: 'Kısa cevap veren bir test çalışanısın; araç kullanma.', model: 'haiku' });
    const turn = async (prompt: string) => {
      const after = s.events.lastSeq();
      engine.send(e.id, prompt, 'system');
      const done = await waitFor(s.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished', { after, timeoutMs: 180_000 });
      return done.event as { usage: { cacheReadTokens: number; cacheCreationTokens: number }; costUsd: number };
    };
    try {
      const rows = [['ilk', await turn('Reply with exactly: A')], ['hemen ardından', await turn('Reply with exactly: B')]] as Array<[string, Awaited<ReturnType<typeof turn>>]>;
      await new Promise((r) => setTimeout(r, 6.5 * 60_000));
      rows.push(['6½ dk sonra', await turn('Reply with exactly: C')]);
      const table = ['| Tur | Önbellek okuma | Önbellek yazma | USD |', '|---|---:|---:|---:|', ...rows.map(([n, u]) => `| ${n} | ${u.usage.cacheReadTokens} | ${u.usage.cacheCreationTokens} | ${u.costUsd.toFixed(4)} |`)].join('\n');
      console.log(`\n${table}\n`);
      if (process.env.SMOKE_TTL_OUT) writeFileSync(process.env.SMOKE_TTL_OUT, `${table}\n`);
    } finally {
      await engine.shutdown();
      s.cleanup();
    }
  }, 900_000);
});

