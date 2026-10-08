import { randomUUID } from 'node:crypto';
import { EMPLOYEE_KINDS, MODEL_ALIASES, type Employee, type EmployeeKind, type HireInput, type ModelAlias, type TemplateRef } from '@cc/shared';
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
  title: string;
  team: string;
  kind: string;
  reports_to: string | null;
  template: string | null;
  template_version: number | null;
  /** Absent in a database before v17. */
  capabilities?: string | null;
}

function fromRow(r: Row): Employee {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    role: r.role,
    model: r.model as ModelAlias,
    characterId: r.character_id,
    title: r.title,
    team: r.team,
    kind: r.kind as EmployeeKind,
    reportsTo: r.reports_to,
    deskIndex: r.desk_index,
    sessionId: r.session_id,
    sessionStarted: r.session_started === 1,
    lifecycle: r.lifecycle as Employee['lifecycle'],
    limitResetsAt: r.limit_resets_at,
    lastError: r.last_error,
    createdAt: r.created_at,
    template: r.template ? { id: r.template, version: r.template_version ?? 1 } : null,
    capabilities: r.capabilities ? (JSON.parse(r.capabilities) as string[]) : [],
  };
}

/**
 * What the roster writes for a hire: the input, and what the company resolved — the template (never the raw id) and the
 * capabilities checked against the vocabulary (never the raw list).
 */
export type NewEmployee = HireInput & { templateRef?: TemplateRef | null; capabilityIds?: string[] };

export type EmployeePatch = Partial<
  Pick<Employee, 'lifecycle' | 'sessionStarted' | 'limitResetsAt' | 'lastError' | 'role' | 'title' | 'team' | 'kind' | 'reportsTo' | 'model' | 'capabilities'>
>;

export class Roster {
  readonly #db: Db;
  readonly #deskCount: number;
  readonly #now: () => number;
  readonly #slugTaken: (slug: string) => boolean;

  /** `slugTaken` reports slugs in use outside the database, e.g. desk folders left by an earlier database. */
  constructor(db: Db, deskCount: number, now: () => number = Date.now, slugTaken: (slug: string) => boolean = () => false) {
    this.#db = db;
    this.#deskCount = deskCount;
    this.#now = now;
    this.#slugTaken = slugTaken;
  }

  create(input: NewEmployee): Employee {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const role = typeof input.role === 'string' ? input.role.trim() : '';
    if (!name) throw new ValidationError('Ad boş olamaz.');
    if (name.length > 60) throw new ValidationError('Ad en fazla 60 karakter olabilir.');
    if (!role) throw new ValidationError('Rol tanımı boş olamaz.');
    const model = input.model === undefined ? 'sonnet' : input.model;
    if (!(MODEL_ALIASES as readonly unknown[]).includes(model)) throw new ValidationError(`Bilinmeyen model: ${String(model)}`);
    const characterId = typeof input.characterId === 'string' && input.characterId.trim() ? input.characterId.trim() : 'coder';
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title.length > 80) throw new ValidationError('Unvan en fazla 80 karakter olabilir.');
    const team = typeof input.team === 'string' ? input.team.trim() : '';
    if (team.length > 40) throw new ValidationError('Ekip adı en fazla 40 karakter olabilir.');
    const kind = input.kind ?? 'member';
    if (!(EMPLOYEE_KINDS as readonly unknown[]).includes(kind)) throw new ValidationError(`Bilinmeyen çalışan türü: ${String(kind)}`);
    const reportsTo = typeof input.reportsTo === 'string' && input.reportsTo ? input.reportsTo : null;

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
      title,
      team,
      kind,
      reportsTo,
      deskIndex,
      sessionId: randomUUID(),
      sessionStarted: false,
      lifecycle: 'stopped',
      limitResetsAt: null,
      lastError: null,
      createdAt: this.#now(),
      template: input.templateRef ?? null,
      capabilities: input.capabilityIds ?? [],
    };
    // A free-text hire with no capabilities writes the row exactly as before templates (v16) and capabilities (v17);
    // the template columns only for a template hire, the capabilities only when some are declared.
    const columns = ['id', 'slug', 'name', 'role', 'model', 'character_id', 'desk_index', 'session_id', 'session_started', 'lifecycle', 'limit_resets_at', 'last_error', 'created_at', 'title', 'team', 'kind', 'reports_to'];
    const values: Array<string | number | null> = [
      employee.id, employee.slug, employee.name, employee.role, employee.model, employee.characterId, employee.deskIndex, employee.sessionId, 0, employee.lifecycle, null, null,
      employee.createdAt, employee.title, employee.team, employee.kind, employee.reportsTo,
    ];
    if (employee.template) {
      columns.push('template', 'template_version');
      values.push(employee.template.id, employee.template.version);
    }
    if (employee.capabilities!.length > 0) {
      columns.push('capabilities');
      values.push(JSON.stringify(employee.capabilities));
    }
    this.#db.prepare(`INSERT INTO employees (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values);
    return employee;
  }

  /** Slugs are unique across archived employees too, because desk folders are never deleted. */
  #uniqueSlug(base: string): string {
    let slug = base;
    const taken = (s: string) => this.#db.prepare('SELECT 1 FROM employees WHERE slug = ?').get(s) !== undefined || this.#slugTaken(s);
    for (let n = 2; taken(slug); n += 1) {
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
      .prepare(
        `UPDATE employees SET lifecycle = ?, session_started = ?, limit_resets_at = ?, last_error = ?, role = ?, title = ?,
           team = ?, kind = ?, reports_to = ?, model = ? WHERE id = ?`,
      )
      .run(next.lifecycle, next.sessionStarted ? 1 : 0, next.limitResetsAt, next.lastError, next.role, next.title, next.team, next.kind, next.reportsTo, next.model, id);
    // Only when given: every other change leaves the v17 column alone (and works on a database before it).
    if (patch.capabilities !== undefined) {
      this.#db.prepare('UPDATE employees SET capabilities = ? WHERE id = ?').run(patch.capabilities.length ? JSON.stringify(patch.capabilities) : null, id);
    }
    return next;
  }

}
