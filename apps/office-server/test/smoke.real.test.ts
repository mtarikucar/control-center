import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.ts';
import { setup, waitFor } from './helpers.ts';

const enabled = process.env.OFFICE_SMOKE === '1';

describe.skipIf(!enabled)('smoke with the real claude CLI (haiku)', () => {
  it('hire → message → side question → stop → resume keeps context', async () => {
    const s = setup();
    const engine = new Engine({ roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: ['claude'] });
    const textsAfter = (seq: number) =>
      s.events
        .list({ after: seq, limit: 5000 })
        .filter((x) => x.event.type === 'message.assistant')
        .map((x) => (x.event as { text: string }).text)
        .join(' ');
    try {
      const e = engine.hire({ name: 'Smoke', role: 'Tek kelimelik cevaplar veren bir test çalışanısın.', model: 'haiku' });
      engine.send(e.id, 'Reply with exactly one word: PONG');
      const first = await waitFor(s.events, (x) => x.event.type === 'turn.finished', { timeoutMs: 120_000 });
      expect(first.event).toMatchObject({ ok: true });
      expect(textsAfter(0)).toMatch(/PONG/);
      expect(s.events.list({ limit: 5000 }).some((x) => x.event.type === 'quota.updated')).toBe(true);
      expect(s.roster.get(e.id).sessionStarted).toBe(true);

      const side = await engine.sideQuestion(e.id, 'Which single word did you reply with? Answer with that word only.');
      expect(side.ok).toBe(true);
      expect(side.answer).toMatch(/PONG/i);

      expect((await engine.stop(e.id)).lifecycle).toBe('stopped');
      engine.resume(e.id);
      engine.send(e.id, 'Repeat your first reply, one word only.');
      const second = await waitFor(s.events, (x) => x.event.type === 'turn.finished', { after: first.seq, timeoutMs: 120_000 });
      expect(second.event).toMatchObject({ ok: true });
      expect(textsAfter(first.seq)).toMatch(/PONG/);
    } finally {
      await engine.shutdown();
      s.cleanup();
    }
  }, 300_000);
});
