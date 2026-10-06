import { randomUUID } from 'node:crypto';
import { MODEL_ALIASES, type Employee, type HireInput, type ModelAlias } from '@cc/shared';
import type { Db } from './db.ts';
import { ConflictError, NotFoundError, ValidationError } from './errors.ts';

const TURKISH: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };

export function slugify(name: string): string {
  const lowered = [...name.toLocaleLowerCase('tr-TR')].map((ch) => TURKISH[ch] ?? ch).join('');
  const slug = lowered
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'calisan';
}

interface Row {
  id: string;
  slug: string;
  name: string;
  role: string;
  model: string;
  character_id: string;
  desk_index: number;
  session_id: string;
  session_started: number;
  lifecycle: string;
  limit_resets_at: number | null;
  last_error: string | null;
  created_at: number;
}

function fromRow(r: Row): Employee {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    role: r.role,
    model: r.model as ModelAlias,
    characterId: r.character_id,
    deskIndex: r.desk_index,
    sessionId: r.session_id,
    sessionStarted: r.session_started === 1,
    lifecycle: r.lifecycle as Employee['lifecycle'],
    limitResetsAt: r.limit_resets_at,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

export type EmployeePatch = Partial<Pick<Employee, 'lifecycle' | 'sessionStarted' | 'limitResetsAt' | 'lastError'>>;

export class Roster {
  readonly #db: Db;
  readonly #deskCount: number;
  readonly #now: () => number;

  constructor(db: Db, deskCount: number, now: () => number = Date.now) {
    this.#db = db;
    this.#deskCount = deskCount;
    this.#now = now;
  }

  create(input: HireInput): Employee {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const role = typeof input.role === 'string' ? input.role.trim() : '';
    if (!name) throw new ValidationError('Ad boş olamaz.');
    if (name.length > 60) throw new ValidationError('Ad en fazla 60 karakter olabilir.');
    if (!role) throw new ValidationError('Rol tanımı boş olamaz.');
    const model = input.model === undefined ? 'sonnet' : input.model;
    if (!(MODEL_ALIASES as readonly unknown[]).includes(model)) throw new ValidationError(`Bilinmeyen model: ${String(model)}`);
    const characterId = typeof input.characterId === 'string' && input.characterId.trim() ? input.characterId.trim() : 'coder';

    const used = new Set(this.list().map((e) => e.deskIndex));
    let deskIndex = -1;
    for (let i = 0; i < this.#deskCount; i += 1) {
      if (!used.has(i)) {
        deskIndex = i;
        break;
      }
    }
    if (deskIndex < 0) throw new ConflictError(`Ofis dolu: ${this.#deskCount} masanın hepsi dolu.`);

    const employee: Employee = {
      id: randomUUID(),
      slug: this.#uniqueSlug(slugify(name)),
      name,
      role,
      model: model as ModelAlias,
      characterId,
      deskIndex,
      sessionId: randomUUID(),
      sessionStarted: false,
      lifecycle: 'stopped',
      limitResetsAt: null,
      lastError: null,
      createdAt: this.#now(),
    };
    this.#db
      .prepare(
        `INSERT INTO employees (id, slug, name, role, model, character_id, desk_index, session_id, session_started,
           lifecycle, limit_resets_at, last_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        employee.id,
        employee.slug,
        employee.name,
        employee.role,
        employee.model,
        employee.characterId,
        employee.deskIndex,
        employee.sessionId,
        0,
        employee.lifecycle,
        null,
        null,
        employee.createdAt,
      );
    return employee;
  }

  /** Slugs are unique across archived employees too, because desk folders are never deleted. */
  #uniqueSlug(base: string): string {
    let slug = base;
    for (let n = 2; this.#db.prepare('SELECT 1 FROM employees WHERE slug = ?').get(slug) !== undefined; n += 1) {
      slug = `${base}-${n}`;
    }
    return slug;
  }

  get(id: string): Employee {
    const row = this.#db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as unknown as Row | undefined;
    if (!row) throw new NotFoundError(`Çalışan bulunamadı: ${id}`);
    return fromRow(row);
  }

  list(opts: { includeArchived?: boolean } = {}): Employee[] {
    const rows = (
      opts.includeArchived
        ? this.#db.prepare('SELECT * FROM employees ORDER BY desk_index, created_at').all()
        : this.#db.prepare("SELECT * FROM employees WHERE lifecycle != 'archived' ORDER BY desk_index").all()
    ) as unknown as Row[];
    return rows.map(fromRow);
  }

  update(id: string, patch: EmployeePatch): Employee {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE employees SET lifecycle = ?, session_started = ?, limit_resets_at = ?, last_error = ? WHERE id = ?')
      .run(next.lifecycle, next.sessionStarted ? 1 : 0, next.limitResetsAt, next.lastError, id);
    return next;
  }
}
