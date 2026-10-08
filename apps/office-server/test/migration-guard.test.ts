import { describe, expect, it } from 'vitest';
import { aheadOfCode, appliedVersion, migrateDown, migrateUp, openDb, type Db } from '../src/db.ts';
import { MIGRATIONS, type Migration } from '../src/migrations.ts';

// The real case (task 57b8d3f2): B26's branch numbers its migration 16 and is to become 19 after core-3, whose B6
// (role templates) is 16 too; the management cycle's branch has a 16 as well. The SQL here is a stand-in.
const B26_AS_16: Migration = { version: 16, name: 'KPI readings', up: 'CREATE TABLE kpi_readings (id INTEGER PRIMARY KEY);', down: 'DROP TABLE kpi_readings;' };
const B6_16: Migration = { version: 16, name: 'role templates: which one an employee was hired from', up: 'ALTER TABLE employees ADD COLUMN template TEXT;', down: 'ALTER TABLE employees DROP COLUMN template;' };
const B7_17: Migration = { version: 17, name: 'capabilities', up: 'CREATE TABLE b7 (id INTEGER);', down: 'DROP TABLE b7;' };
const B5_18: Migration = { version: 18, name: 'blueprint', up: 'CREATE TABLE b5 (id INTEGER);', down: 'DROP TABLE b5;' };
const B26_AS_19: Migration = { ...B26_AS_16, version: 19 };

const applied = (db: Db) => (db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as unknown as Array<{ version: number; name: string }>).map((r) => `${r.version}:${r.name}`);
const tables = (db: Db) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as Array<{ name: string }>).map((r) => r.name);
const columns = (db: Db, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>).map((c) => c.name);

describe('migrations: an applied version must be the code’s migration of that number', () => {
  it('B26 went live alone as 16, then core-3’s 16 arrives: nothing runs, and it says which version and both names', () => {
    const db = openDb(':memory:');
    migrateUp(db, [...MIGRATIONS, B26_AS_16]);
    const before = applied(db);
    expect(() => migrateUp(db, [...MIGRATIONS, B6_16, B7_17, B5_18, B26_AS_19])).toThrow(
      'v16 canlıda “KPI readings”, kodda “role templates: which one an employee was hired from”: göç sırası bozuk.',
    );
    // Nothing ran: B6's column, B7's and B5's tables and B26 as 19 are all absent.
    expect(applied(db)).toEqual(before);
    expect(columns(db, 'employees')).not.toContain('template');
    expect(tables(db)).not.toContain('b7');
  });

  it('and the other way round: core-3’s 16 is live and a branch still numbering B26 16 is started', () => {
    const db = openDb(':memory:');
    migrateUp(db, [...MIGRATIONS, B6_16]);
    expect(() => migrateUp(db, [...MIGRATIONS, B26_AS_16])).toThrow('v16 canlıda “role templates: which one an employee was hired from”, kodda “KPI readings”: göç sırası bozuk.');
  });

  it('review (Kerem): a database ahead of the code — only the code went back after core-3, the merge notes’ way — opens; nothing runs and the versions above are named', () => {
    const db = openDb(':memory:');
    migrateUp(db, [...MIGRATIONS, B6_16, B7_17, B5_18]);
    const before = applied(db);
    expect(migrateUp(db)).toBe(18);
    expect(applied(db)).toEqual(before);
    expect(aheadOfCode(db)).toEqual([
      { version: 16, name: 'role templates: which one an employee was hired from' },
      { version: 17, name: 'capabilities' },
      { version: 18, name: 'blueprint' },
    ]);
    // A database the code knows whole is not ahead.
    expect(aheadOfCode(db, [...MIGRATIONS, B6_16, B7_17, B5_18])).toEqual([]);
  });

  it('a database ahead of the code is not migrated down by it: it does not know the downs above, and going below them would leave them on top', () => {
    const db = openDb(':memory:');
    migrateUp(db, [...MIGRATIONS, B6_16, B7_17, B5_18]);
    expect(() => migrateDown(db, 14)).toThrow('Veritabanı koddan ileride (v16, v17, v18 bu kodda yok): bu kod geri göç yapamaz; geri almayı o göçleri bilen kodla yap.');
    expect(appliedVersion(db)).toBe(18);
    expect(applied(db)).toContain('15:integration registry: what the coordinator records by hand');
    // Nothing to revert (the rehearsal script's migrateDown to where it started): no refusal.
    expect(migrateDown(db, 18)).toBe(18);
  });

  it('a version inside the code’s range that the code lost (a merge dropped 16 and kept 17) stops it: “kodda yok”', () => {
    const db = openDb(':memory:');
    migrateUp(db, [...MIGRATIONS, B26_AS_16]);
    expect(() => migrateUp(db, [...MIGRATIONS, B7_17])).toThrow('v16 canlıda “KPI readings”, kodda yok: göç sırası bozuk.');
  });

  it('ahead is only above the code: a version within the code’s range with another name still stops it', () => {
    const db = openDb(':memory:');
    migrateUp(db, [...MIGRATIONS, B26_AS_16, B7_17]);
    expect(() => migrateUp(db, [...MIGRATIONS, B6_16])).toThrow('v16 canlıda “KPI readings”, kodda “role templates: which one an employee was hired from”: göç sırası bozuk.');
  });

  it('a migration of the code below the last applied one that was never applied — the one the runner would skip — stops it', () => {
    const db = openDb(':memory:');
    // B26 went live already numbered 19, before core-3: 16–18 are in the code now but would never run.
    migrateUp(db, [...MIGRATIONS, B26_AS_19]);
    expect(() => migrateUp(db, [...MIGRATIONS, B6_16, B7_17, B5_18, B26_AS_19])).toThrow(
      'v16 kodda “role templates: which one an employee was hired from” ama canlıda uygulanmamış; sonraki bir göç uygulandığı için hiç çalışmazdı: göç sırası bozuk.',
    );
  });

  it('also the one right below the last applied: B7’s 17 went live before B6’s 16', () => {
    const db = openDb(':memory:');
    migrateUp(db, [...MIGRATIONS, B7_17]);
    expect(() => migrateUp(db, [...MIGRATIONS, B6_16, B7_17])).toThrow(
      'v16 kodda “role templates: which one an employee was hired from” ama canlıda uygulanmamış; sonraki bir göç uygulandığı için hiç çalışmazdı: göç sırası bozuk.',
    );
  });

  it('migrateDown refuses too: it would run another migration’s down on this database', () => {
    const db = openDb(':memory:');
    migrateUp(db, [...MIGRATIONS, B26_AS_16]);
    expect(() => migrateDown(db, 15, [...MIGRATIONS, B6_16])).toThrow('v16 canlıda “KPI readings”, kodda “role templates: which one an employee was hired from”: göç sırası bozuk.');
    expect(tables(db)).toContain('kpi_readings');
    expect(appliedVersion(db)).toBe(16);
  });

  it('a database whose names match goes on as before: up, down and up again', () => {
    const db = openDb(':memory:');
    const code = [...MIGRATIONS, B6_16, B7_17];
    expect(migrateUp(db, [...MIGRATIONS, B6_16])).toBe(16);
    expect(migrateUp(db, code)).toBe(17);
    expect(migrateDown(db, 15, code)).toBe(15);
    expect(migrateUp(db, code)).toBe(17);
  });
});
