// Per-task Claude cost (tasks.cost_usd, tasks.tokens) recomputed from the turn.finished events:
//   node apps/office-server/scripts/backfill-task-cost.ts [--db <file>] [--apply]
// Without --apply the database is opened read-only and only the before/after totals and the changes are printed;
// --db defaults to $OFFICE_DATA_DIR/office.db (~/.control-center/office.db). --apply writes and needs --db: try it on
// a copy; the office's own database only with the office stopped.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { backfillTaskCosts, formatBackfill } from '../src/task-cost-backfill.ts';

// `pnpm … -- …` passes the "--" on: ignore it.
const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== '--'), options: { db: { type: 'string' }, apply: { type: 'boolean', default: false } } });
if (values.apply && !values.db) {
  console.error('--apply için --db ile dosyayı açıkça ver (önce bir kopyada dene).');
  process.exit(2);
}
const file = values.db ?? join(process.env.OFFICE_DATA_DIR ?? join(homedir(), '.control-center'), 'office.db');
const db = new DatabaseSync(file, { readOnly: !values.apply });
try {
  console.log(`# Görev başı maliyet geri doldurma\n\nVeritabanı: ${file} (${values.apply ? 'yazılıyor' : 'salt okunur'})\n`);
  console.log(formatBackfill(backfillTaskCosts(db, { apply: values.apply }), values.apply));
} finally {
  db.close();
}
