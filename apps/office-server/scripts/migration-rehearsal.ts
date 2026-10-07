// Rehearses this branch's database migrations on a COPY of an office database; the source is only read (copied).
//   node apps/office-server/scripts/migration-rehearsal.ts [--from <office.db>] [--work <empty dir>]
// Steps: copy office.db (+ -wal, -shm) → count every table → back the copy up → migrate up → check the rows are all
// there (old notices are decisions, old tasks have no difficulty) → migrate down to the starting version → check →
// up again → restore the backup over the copy → check. Prints what it saw; exits non-zero if a check fails.
import { copyFileSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { appliedVersion, migrateDown, migrateUp } from '../src/db.ts';

const { values } = parseArgs({ options: { from: { type: 'string' }, work: { type: 'string' } } });
const source = values.from ?? join(process.env.OFFICE_DATA_DIR ?? join(homedir(), '.control-center'), 'office.db');
const work = values.work ?? mkdtempSync(join(tmpdir(), 'office-db-rehearsal-'));
if (readdirSync(work).length > 0) throw new Error(`Çalışma klasörü boş olmalı: ${work}`);

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const copyDb = (from: string, to: string) => {
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(from + suffix)) copyFileSync(from + suffix, to + suffix);
};
const counts = (db: DatabaseSync) =>
  Object.fromEntries(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts%' ORDER BY name").all() as Array<{ name: string }>)
      .filter((t) => t.name !== 'schema_migrations')
      .map((t) => [t.name, (db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number }).n]),
  ) as Record<string, number>;
const same = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).every((k) => a[k] === b[k]);
const open = (file: string) => {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
};
const close = (db: DatabaseSync) => {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
};

const copy = join(work, 'office.db');
const backup = join(work, 'office.db.backup');
copyDb(source, copy);
console.log(`Kaynak (yalnız kopyalandı): ${source}\nKopya: ${copy}\n`);

let db = open(copy);
check((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check === 'ok', 'kopya bütün (integrity_check)');
const start = appliedVersion(db);
const before = counts(db);
console.log(`Başlangıç şema sürümü ${start}; satırlar: ${JSON.stringify(before)}`);
close(db);
copyDb(copy, backup);

db = open(copy);
const up = migrateUp(db);
check(up >= start, `migrateUp: ${start} → ${up}`);
const afterUp = counts(db);
check(same(before, afterUp), 'göç sonrası her tablonun satır sayısı aynı');
const noticeColumns = (db.prepare('PRAGMA table_info(notices)').all() as Array<{ name: string }>).map((c) => c.name);
if (noticeColumns.includes('kind')) {
  const kinds = db.prepare('SELECT kind, topic, COUNT(*) AS n FROM notices GROUP BY kind, topic').all() as Array<{ kind: string; topic: string; n: number }>;
  const old = start < 6 ? kinds : [];
  check(old.every((k) => k.kind === 'decision' && k.topic === ''), `eski notlar karar, konusuz: ${JSON.stringify(kinds)}`);
}
const taskColumns = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((c) => c.name);
if (taskColumns.includes('difficulty') && start < 7) {
  check((db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE difficulty IS NOT NULL').get() as { n: number }).n === 0, 'eski görevlerin zorluğu yok');
}
check((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check === 'ok', 'göç sonrası bütün');

const down = migrateDown(db, start);
check(down === start, `migrateDown: ${up} → ${down}`);
check(same(before, counts(db)), 'geri göç sonrası satır sayıları aynı');
check(migrateUp(db) === up, `yeniden migrateUp: → ${up}`);
close(db);

copyDb(backup, copy);
db = open(copy);
check(appliedVersion(db) === start && same(before, counts(db)), `yedekten dönüş: sürüm ${appliedVersion(db)}, satırlar aynı`);
close(db);

console.log(failures.length ? `\n${failures.length} kontrol geçmedi.` : '\nBütün kontroller geçti.');
process.exitCode = failures.length ? 1 : 0;
