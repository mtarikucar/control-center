// The economy plan's live measures from an office database, read-only:
//   node apps/office-server/scripts/economy-report.ts [--db <file>] [--since <date>] [--until <date>]
// --db defaults to $OFFICE_DATA_DIR/office.db (~/.control-center/office.db); dates are local ("2026-10-07" or
// "2026-10-07T09:00"); the window defaults to the last 7 days. Nothing is written: the database is opened read-only.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { economyReport, formatReport, parseWhen } from '../src/economy-report.ts';

// `pnpm economy-report -- …` passes the "--" on: ignore it.
const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== '--'), options: { db: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' } } });
const file = values.db ?? join(process.env.OFFICE_DATA_DIR ?? join(homedir(), '.control-center'), 'office.db');
const until = values.until ? parseWhen(values.until) : Date.now();
const since = values.since ? parseWhen(values.since) : until - 7 * 24 * 60 * 60 * 1000;
const db = new DatabaseSync(file, { readOnly: true });
try {
  console.log(`# Ekonomi raporu\n\nVeritabanı: ${file} (salt okunur)\n`);
  console.log(formatReport(economyReport(db, { since, until })));
} finally {
  db.close();
}
