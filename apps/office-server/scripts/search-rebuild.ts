// Builds the memory search's index (B11) on a COPY of an office database and searches it; the source is only read.
//   node apps/office-server/scripts/search-rebuild.ts [--from <office.db>] [--work <empty dir>] [--query "words"]… [--replay] [--json]
// --from defaults to $OFFICE_DATA_DIR/office.db (~/.control-center/office.db). Steps: the source is opened read-only and
// copied with VACUUM INTO → the copy is migrated up and its index rebuilt (records per kind, time) → each --query, or
// with --replay every memorySearch call in the copy's event log, is searched with the limit it was called with: how many
// hits, which round found them (and = every word, or = some records have only some), the top three.
import { mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { migrateUp } from '../src/db.ts';
import { SearchIndex } from '../src/company/search.ts';

// `pnpm … -- …` passes the "--" on: ignore it.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { from: { type: 'string' }, work: { type: 'string' }, query: { type: 'string', multiple: true }, replay: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } },
});
const source = values.from ?? join(process.env.OFFICE_DATA_DIR ?? join(homedir(), '.control-center'), 'office.db');
const work = values.work ?? mkdtempSync(join(tmpdir(), 'office-search-'));
if (readdirSync(work).length > 0) {
  console.error(`Çalışma klasörü boş olmalı: ${work}`);
  process.exit(2);
}
const copy = join(work, 'office.db');
const from = new DatabaseSync(source, { readOnly: true });
from.prepare('VACUUM INTO ?').run(copy);
from.close();

const db = new DatabaseSync(copy);
const version = migrateUp(db);
const index = new SearchIndex(db);
const start = performance.now();
const records = index.rebuild();
const rebuildMs = Math.round(performance.now() - start);
const kinds = db.prepare('SELECT kind, COUNT(*) AS n FROM search_index GROUP BY kind ORDER BY kind').all() as unknown as Array<{ kind: string; n: number }>;

const calls: Array<{ query: string; limit: number; at: number | null }> = (values.query ?? []).map((query) => ({ query, limit: 10, at: null }));
if (values.replay) {
  const rows = db.prepare("SELECT ts, payload FROM events WHERE type = 'tool.started' ORDER BY seq").all() as unknown as Array<{ ts: number; payload: string }>;
  for (const row of rows) {
    const p = JSON.parse(row.payload) as { name?: string; input?: { query?: unknown; limit?: unknown } };
    if (!p.name?.endsWith('memorySearch') || typeof p.input?.query !== 'string') continue;
    calls.push({ query: p.input.query, limit: typeof p.input.limit === 'number' ? p.input.limit : 10, at: row.ts });
  }
}
const results = calls.map((c) => {
  const { hits, mode } = index.search(c.query, { limit: Math.min(30, Math.max(1, c.limit)) });
  return { ...c, hits: hits.length, partial: hits.filter((h) => h.partial).length, mode, top: hits.slice(0, 3).map((h) => ({ kind: h.kind, id: h.id, title: h.title, matched: h.matched ?? null })) };
});
db.close();

const empty = results.filter((r) => r.hits === 0).length;
if (values.json) {
  console.log(JSON.stringify({ source, copy, version, records, rebuildMs, kinds, results, empty }, null, 2));
} else {
  console.log(`Kaynak (salt okunur, VACUUM INTO): ${source}\nKopya: ${copy} (şema v${version})`);
  console.log(`Dizin: ${records} kayıt, ${rebuildMs} ms (${kinds.map((k) => `${k.kind} ${k.n}`).join(', ')})`);
  for (const [i, r] of results.entries()) {
    console.log(`\n${i + 1}. "${r.query}" (limit ${r.limit}) → ${r.hits} sonuç, tur ${r.mode}${r.partial ? `, ${r.partial} kısmi` : ''}`);
    for (const h of r.top) console.log(`   • [${h.kind}${h.matched === null ? '' : `, kısmi ${h.matched}`}] ${h.title} (${h.id})`);
  }
  if (results.length) console.log(`\nBoş dönen: ${empty}/${results.length}`);
}
