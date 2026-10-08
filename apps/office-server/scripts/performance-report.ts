// How the work went, from an office database, read-only (what performanceRead shows):
//   node apps/office-server/scripts/performance-report.ts [--db <file>] [--days N] [--employee <id>] [--plan <id>] [--json]
// --db defaults to $OFFICE_DATA_DIR/office.db (~/.control-center/office.db). Nothing is written: the database is
// opened read-only.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { formatPerformance, performanceReport } from '../src/performance.ts';

// `pnpm … -- …` passes the "--" on: ignore it.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { db: { type: 'string' }, days: { type: 'string' }, employee: { type: 'string' }, plan: { type: 'string' }, json: { type: 'boolean', default: false } },
});
const file = values.db ?? join(process.env.OFFICE_DATA_DIR ?? join(homedir(), '.control-center'), 'office.db');
const days = values.days === undefined ? undefined : Number(values.days);
if (days !== undefined && (!Number.isInteger(days) || days < 1)) {
  console.error('--days bir tam sayı olmalı (1 ya da daha çok).');
  process.exit(2);
}
const db = new DatabaseSync(file, { readOnly: true });
try {
  const report = performanceReport(db, { since: days ? Date.now() - days * 86_400_000 : null });
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Veritabanı: ${file} (salt okunur)\n`);
    console.log(formatPerformance(report, { employee: values.employee, plan: values.plan, days }));
  }
} finally {
  db.close();
}
