// The pilot's acceptance measures (KÖ1–KÖ11, pilot-senaryosu §7) from an office database, read-only:
//   node apps/office-server/scripts/pilot-metrics.ts [<db> | --db <file>] [--since <date>] [--until <date>] [--level K4]
// The database defaults to $OFFICE_DATA_DIR/office.db (~/.control-center/office.db); for the live office prefer a copy
// (VACUUM INTO). Dates are local ("2026-10-05" or "2026-10-05T09:00"); the window defaults to the last 7 days. Nothing is
// written: the database is opened read-only. Prints a markdown table.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { parseWhen } from '../src/economy-report.ts';
import { formatPilotMetrics, pilotMetrics } from '../src/pilot-metrics.ts';

// `pnpm pilot-metrics -- …` passes the "--" on: ignore it.
const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { db: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' }, level: { type: 'string' } },
  allowPositionals: true,
});
const file = values.db ?? positionals[0] ?? join(process.env.OFFICE_DATA_DIR ?? join(homedir(), '.control-center'), 'office.db');
const until = values.until ? parseWhen(values.until) : Date.now();
const since = values.since ? parseWhen(values.since) : until - 7 * 24 * 60 * 60 * 1000;
const db = new DatabaseSync(file, { readOnly: true });
try {
  console.log(`Veritabanı: ${file} (salt okunur)\n`);
  console.log(formatPilotMetrics(pilotMetrics(db, { since, until, level: values.level })));
} finally {
  db.close();
}
