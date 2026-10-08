import { afterEach, describe, expect, it } from 'vitest';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';
import { brandTopic, CLIENTS, clientNote, pilotBlueprint } from './pilot-ajans-fixtures.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/**
 * KÖ8 (pilot-senaryosu §7): "marka dili <müşteri>" finds that client's brand guide in the first three, for 6 of 6.
 * Only the memory is used, so the same test runs on any branch's search (B11's one index, or the search before it).
 * KO8_TABLE=1 prints the result table.
 */
describe('pilot agency package (C5-3) — KÖ8: the brand guides are found', () => {
  it('“marka dili <müşteri>” puts the client’s brand guide in the first three for all six, beside the rule topics and the client notes', () => {
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const t = companyFor(s, f, ['coder']);
    const coordinator = t.company.hireCoordinator();
    for (const p of pilotBlueprint().playbook) t.memory.updatePlaybook(coordinator.id, { topic: p.topic, text: p.text });
    for (const { slug } of CLIENTS) t.memory.writeNote(coordinator.id, clientNote(slug));
    const rows = CLIENTS.map(({ name }) => {
      const query = `marka dili ${name}`;
      const hits = t.memory.search(query);
      const rank = hits.findIndex((h) => h.kind === 'playbook' && h.id === brandTopic(name)) + 1;
      return { query, rank, top: hits.slice(0, 3).map((h) => `[${h.kind}] ${h.title}`) };
    });
    if (process.env.KO8_TABLE) {
      console.log(['| Sorgu | Sıra | İlk 3 |', '|---|---|---|', ...rows.map((r) => `| ${r.query} | ${r.rank || 'yok'} | ${r.top.join(' · ')} |`)].join('\n'));
    }
    expect(rows.map((r) => [r.query, r.rank >= 1 && r.rank <= 3])).toEqual(CLIENTS.map(({ name }) => [`marka dili ${name}`, true]));
  });
});
