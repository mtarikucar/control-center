import { randomUUID } from 'node:crypto';
import type { CompanyProfile, ProfileEntry, ProfileFields, ProfileSection } from '@cc/shared';
import type { Db } from '../db.ts';

interface ProfileRow {
  id: string;
  version: number;
  section: string;
  json: string;
  assumed: number;
  assumed_fields: string;
  by: string;
  ts: number;
}

const entryFromRow = (r: ProfileRow): ProfileEntry => ({
  id: r.id, version: r.version, section: r.section as ProfileSection, fields: JSON.parse(r.json) as ProfileFields,
  assumedFields: JSON.parse(r.assumed_fields) as string[], assumed: r.assumed === 1, by: r.by, ts: r.ts,
});

/** The company profile, one row per version (spec 2026-10-08-company-profile-design §3): nothing is overwritten. */
export class ProfileStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  /** A section's new state, under the next company-wide version. */
  write(section: ProfileSection, fields: ProfileFields, assumedFields: string[], by: string): ProfileEntry {
    const id = randomUUID();
    this.#db
      .prepare(
        'INSERT INTO company_profile (id, version, section, json, assumed, assumed_fields, by, ts) SELECT ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, ?, ? FROM company_profile',
      )
      .run(id, section, JSON.stringify(fields), assumedFields.length > 0 ? 1 : 0, JSON.stringify(assumedFields), by, this.#now());
    return entryFromRow(this.#db.prepare('SELECT * FROM company_profile WHERE id = ?').get(id) as unknown as ProfileRow);
  }

  /** Each section's latest entry. */
  current(): CompanyProfile {
    const rows = this.#db
      .prepare('SELECT p.* FROM company_profile p JOIN (SELECT section, MAX(version) AS v FROM company_profile GROUP BY section) l ON p.section = l.section AND p.version = l.v')
      .all() as unknown as ProfileRow[];
    const sections: CompanyProfile['sections'] = {};
    let version = 0;
    for (const row of rows) {
      const entry = entryFromRow(row);
      sections[entry.section] = entry;
      version = Math.max(version, entry.version);
    }
    return { version, sections };
  }

  /** A section's versions, newest first. */
  history(section: ProfileSection, limit = 20): ProfileEntry[] {
    const rows = this.#db.prepare('SELECT * FROM company_profile WHERE section = ? ORDER BY version DESC LIMIT ?').all(section, limit) as unknown as ProfileRow[];
    return rows.map(entryFromRow);
  }
}
