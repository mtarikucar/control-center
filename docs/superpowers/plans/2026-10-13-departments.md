# Departments — sub-project 1 (the core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coordinator hands whole streams of work to departments, each with a head who plans, runs and reports its stream; the company gets five department templates (and ten new role templates), departments the coordinator and the owner open, change and close, and a Departmanlar view.

**Architecture:** A `departments` table and `employees.department_id` (migration), a `DepartmentStore` and a `StreamNoteStore`, a `Departments` service that owns the invariants (one head, `kind` ⇔ head, `team` = department name, at most 6 open, names unique against departments and people) and writes each desk's `department.md`. `Company` resolves hires into departments, lets a head hire into, re-model, sleep, wake and note their own department, accepts `departman: <ad>` as a plan stream's owner, tells the head when a stream becomes theirs or is done, and stores stream plans and reports. New MCP tools and owner API routes; the board gets a Departmanlar section; the web gets a Departmanlar tab, department grouping in the org chart, a department field on hiring and stream notes on plan cards.

**Tech Stack:** Node 24 (type stripping, `node:sqlite`), TypeScript 5.9, vitest 3, React 19 + zustand + @testing-library/react (office-web), pnpm 9 workspace.

**Spec:** `docs/superpowers/specs/2026-10-13-departments-design.md` (whole document; Ek A is the content of the templates).

**Base:** `main` 50fbcef (migration v23). Worktree `~/Projects/control-center-departments`, branch `feat/departments`.

## Global Constraints

- Node 24 type stripping: no enums, no parameter properties, `import type` for types, `.ts` extensions in imports.
- Every migration is reversible: `up` + `down`; `down` removes exactly what `up` added; round trip (up → down → up) tested.
- Migrations are numbered 1, 2, 3 … with no gap (`db.test.ts` checks it). This branch adds **24**; `feat/b10-core` (knowledge base, in flight) also adds 24 and merges first — Task 15 renumbers ours to **25** on rebase. The spec says v25.
- Tool descriptions in English; tool results, errors, notices, guides and UI text in Turkish.
- Code comments in English, in the repository's voice (why, not what), as dense as the surrounding code.
- Commits: plain conventional commits as the user (`tarik`), **no AI trailer, no "Generated with", no Claude/Anthropic marker anywhere** (message, body, author, branch name).
- Work only in the worktree. Never touch `~/Projects/control-center` (the live office runs from it), never use port 4319, never run real-claude tests (`*.real.test.ts`, `OFFICE_SMOKE=1`).
- An office without departments behaves exactly as today: no new events, notices, board lines or JSON fields (the economy scenario compares the log with main's). `Employee.departmentId` is present only when set.
- `MAX_DEPARTMENTS = 6`. Department name: 1–40 characters (as the team field). Mission ≤ 600, scope ≤ 8000 characters.
- Everything outward still goes through the owner (sub-project 3 changes that, not this one).

## Spec rulings (decided here)

- **Adoption, not a data migration.** v24 is schema only. `Departments.adoptTeams()` (run at every start, idempotent) turns each team into a department, matching names folded (`fold`) so "Keşif" and "keşif " are one; the first lead becomes head, a second lead becomes a member.
- **Template default team joins, never creates.** `hire(template)` without `team`/`departmentId` joins the department whose name folds to the template's `team` if one is open, else the centre. An explicit `team` that matches no department opens a headless custom one (if fewer than 6 are open), as the spec's §5.5 says.
- **Department changes are announced** with an info notice `department.changed` to everyone at work except the actor; the people moved or (un)made head get `role.changed` and a session reload.
- **Owner API uses POST** for updates (`POST /api/departments/:id`), like the rest of the API; no PATCH route is introduced.
- **A stream owner may be a department by plain name.** `departman: Pazarlama` and `Pazarlama` (no person of that name) both store `departman:<id>`.
- **Stream assignment notices** go out when a plan starts (`propose` under full autonomy, `approve`) or a running plan is revised: for every department-owned, not-done stream whose owner is new compared with the version before (the approved snapshot, or the plan before the revision). A headless department gets none; the board warns.
- **Stream done** (the stream's last open task closed): `stream.done` decision notice to the head, else the coordinator.
- **Board:** the Departmanlar section appears after İnsanlar only while at least one department is open. The detail sections stay as they are (compressing them is out of scope).
- **Tests opt in.** `companyFor(…, { departments: true })` wires the departments like `main.ts`; without it the company is exactly today's (every existing test keeps its meaning).
- **Stream notes in the UI** are fetched per plan (`GET /api/plans/:id/stream-notes`); a `stream.noted` event bumps a revision so open cards refetch.

## Review Focus

1. **Team names that differ only in case or Turkish letters** ("Keşif" / "keşif", "İçerik" / "içerik") must adopt into one department, not two — Task 6 pins it.
2. **A head let go** (Hemen çıkar, or the hand-over finishing) while their department has open streams: the department becomes headless, its members report to no one, the coordinator gets `stream.returned`, and no one is left `kind = 'lead'` without a department — Task 7 pins it.
3. **Name clashes:** opening or renaming a department to an employee's name or to another open department's name in another case ("pazarlama", "Deniz"), and hiring a person named like a department, are refused with a reason — Tasks 6 and 7 pin them.
4. **`taskPass` to a closed or headless department:** closed → refused, listing the open departments; headless → the coordinator gets the task — Task 10 pins it.
5. **A head hiring into a full office** (desks or the constitution's limit) is refused with the existing clear message and writes nothing — Task 7 pins it.

---

### Task 1: Shared types

**Files:**
- Create: `packages/shared/src/department.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/employee.ts`, `packages/shared/src/events.ts`

**Interfaces:**
- Produces: `MAX_DEPARTMENTS`, `DEPARTMENT_STATUSES`, `DepartmentStatus`, `STREAM_TO_DEPARTMENT`, `departmentOwner(id)`, `ownerDepartment(owner)`, `Department`, `DepartmentChange`, `DepartmentRole`, `DepartmentTemplate`, `DepartmentInput`, `STREAM_NOTE_KINDS`, `StreamNoteKind`, `StreamNote`; `Employee.departmentId?`, `HireInput.departmentId?`, `HireInput.head?`; events `department.changed`, `stream.noted`; `OfficeSnapshot.departments?`.

- [ ] **Step 1: Create `packages/shared/src/department.ts`**

```ts
import type { WorkType } from './company.ts';
import type { TemplateRef } from './employee.ts';

/** The rooms around the coordinator: at most this many departments are open at once (spec departments §3). */
export const MAX_DEPARTMENTS = 6;

export const DEPARTMENT_STATUSES = ['open', 'closed'] as const;
export type DepartmentStatus = (typeof DEPARTMENT_STATUSES)[number];

/** A plan stream a department carries is stored as `departman:<id>` (spec §6.1); `alınacak: <rol>` and a person id stay as they were. */
export const STREAM_TO_DEPARTMENT = 'departman';

export function departmentOwner(id: string): string {
  return `${STREAM_TO_DEPARTMENT}:${id}`;
}

/** The department id of a stream owner; null when the owner is a person or a role to hire. */
export function ownerDepartment(owner: string): string | null {
  const prefix = `${STREAM_TO_DEPARTMENT}:`;
  return owner.startsWith(prefix) ? owner.slice(prefix.length) : null;
}

export interface Department {
  id: string;
  /** Unique among open departments and against the names of people at work (folded: case and Turkish letters). */
  name: string;
  mission: string;
  /** The boundary text: Yapar / Yapmaz / Sana gelir, checks, measures, routine suggestions (Markdown). */
  scope: string;
  /** The template it was opened from, at that version; null for a custom one. */
  template: TemplateRef | null;
  /** Its head; null: headless (the coordinator answers for it). */
  headId: string | null;
  status: DepartmentStatus;
  createdAt: number;
  closedAt: number | null;
}

export type DepartmentChange = 'created' | 'updated' | 'head' | 'moved' | 'closed';

/** A role a department template suggests, and when to hire it. */
export interface DepartmentRole {
  template: string;
  when: string;
}

/** A department template of the catalog (product knowledge, shipped as craft/departments/<id>.md). */
export interface DepartmentTemplate {
  id: string;
  version: number;
  name: string;
  mission: string;
  /** The head's role template. */
  head: string;
  roles: DepartmentRole[];
  methods: WorkType[];
  /** Suggestions only: never set up by themselves. */
  routines: string[];
  checks: string[];
  kpis: string[];
  /** The Markdown body: ### Yapar, ### Yapmaz, ### Sana gelir. */
  body: string;
}

export interface DepartmentInput {
  /** A department template's id: name, mission and scope come from it unless given. */
  template?: string;
  name?: string;
  mission?: string;
  scope?: string;
  /** Someone at work to head it (moved into it); none: headless. */
  headId?: string | null;
}

export const STREAM_NOTE_KINDS = ['plan', 'report'] as const;
export type StreamNoteKind = (typeof STREAM_NOTE_KINDS)[number];

/** A head's plan of a stream or report on it (spec §5.2); each call a new note, the latest shown. */
export interface StreamNote {
  id: number;
  planId: string;
  streamId: string;
  kind: StreamNoteKind;
  text: string;
  /** A report's evidence, one item each (empty for a plan). */
  evidence: string[];
  /** A report's "what next" (null for a plan). */
  next: string | null;
  by: string;
  at: number;
}
```

- [ ] **Step 2: Export it, extend `Employee`, `HireInput`, the events and the snapshot**

`packages/shared/src/index.ts` — add after `export * from './company.ts';`:

```ts
export * from './department.ts';
```

`packages/shared/src/employee.ts` — in `interface Employee`, after `capabilities?: string[];`:

```ts
  /** The open department they are in (spec departments §3); absent: the centre (and the coordinator). */
  departmentId?: string | null;
```

and in `interface HireInput`, after `reportsTo?: string | null;`:

```ts
  /** The department to hire into (spec departments §5); a head always hires into their own. */
  departmentId?: string | null;
  /** Hire as the department's head (the coordinator and the owner only). */
  head?: boolean;
```

`packages/shared/src/events.ts` — add the import `import type { Department, DepartmentChange, StreamNote } from './department.ts';` and two members to the `OfficeEvent` union, next to `role.changed`:

```ts
  | { type: 'department.changed'; change: DepartmentChange; department: Department }
  | { type: 'stream.noted'; note: StreamNote }
```

and to `interface OfficeSnapshot`, after `schedules?: Schedule[];`:

```ts
  /** Every department, open and closed (spec departments §7; absent from servers without them). */
  departments?: Department[];
```

- [ ] **Step 3: Typecheck the workspace**

Run: `cd ~/Projects/control-center-departments && pnpm -r typecheck`
Expected: PASS (nothing uses the new names yet; a type error here means an import cycle or a typo).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): department, department template and stream note types; an employee's department; department.changed and stream.noted events"
```

---

### Task 2: Migration v24 and the roster's department column

**Files:**
- Modify: `apps/office-server/src/migrations.ts` (append), `apps/office-server/src/roster.ts`
- Test: `apps/office-server/test/db.test.ts`, `apps/office-server/test/roster.test.ts`

**Interfaces:**
- Consumes: `Employee.departmentId`, `HireInput.departmentId` (Task 1).
- Produces: tables `departments`, `stream_notes`; column `employees.department_id`; `Roster.create` writes `department_id` when `departmentId` is given; `EmployeePatch` accepts `departmentId` (written only when given); `fromRow` sets `departmentId` only when the column holds a value.

- [ ] **Step 1: Write the failing migration test** — in `test/db.test.ts`, after `V23_TABLES`:

```ts
const V24_TABLES = [...V23_TABLES, 'departments', 'stream_notes'].sort();
```

and inside `describe('migrations', …)`:

```ts
  it('v24 adds the departments, the stream notes and an employee’s department, empty; v24 down restores v23 and keeps the employees', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(23));
    db.prepare(
      `INSERT INTO employees (id, slug, name, role, model, character_id, desk_index, session_id, session_started, lifecycle, created_at, title, team, kind)
       VALUES ('e1', 'ada', 'Ada', 'r', 'sonnet', 'coder', 0, 's1', 0, 'idle', 1, '', 'Keşif', 'member')`,
    ).run();
    const before = columns(db, 'employees');
    expect(migrateUp(db, upTo(24))).toBe(24);
    expect(tables(db)).toEqual(V24_TABLES);
    expect(columns(db, 'departments')).toEqual(['id', 'name', 'mission', 'scope', 'template', 'template_version', 'head_id', 'status', 'created_at', 'closed_at']);
    expect(columns(db, 'stream_notes')).toEqual(['id', 'plan_id', 'stream_id', 'kind', 'text', 'evidence', 'next', 'by', 'at']);
    expect(columns(db, 'employees')).toEqual([...before, 'department_id']);
    // Schema only: the team stays a team until the office adopts it (Departments.adoptTeams).
    expect(db.prepare('SELECT COUNT(*) AS n FROM departments').get()).toMatchObject({ n: 0 });
    expect(db.prepare("SELECT department_id FROM employees WHERE id = 'e1'").get()).toMatchObject({ department_id: null });
    db.prepare("INSERT INTO departments (id, name, created_at) VALUES ('d1', 'Keşif', 1)").run();
    expect(() => db.prepare("INSERT INTO departments (id, name, status, created_at) VALUES ('d2', 'X', 'gone', 1)").run()).toThrow();
    expect(migrateDown(db, 23)).toBe(23);
    expect(tables(db)).toEqual(V23_TABLES);
    expect(columns(db, 'employees')).toEqual(before);
    expect(db.prepare("SELECT team FROM employees WHERE id = 'e1'").get()).toMatchObject({ team: 'Keşif' });
    expect(migrateUp(db, upTo(24))).toBe(24);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd apps/office-server && pnpm vitest run test/db.test.ts`
Expected: FAIL — `migrateUp(db, upTo(24))` returns 23 (no v24 yet).

- [ ] **Step 3: Append the migration** to the `MIGRATIONS` array in `src/migrations.ts`:

```ts
  {
    // 24 on feat/departments; 25 once feat/b10-core's 24 (knowledge base) is on main (plan Task 15).
    version: 24,
    name: 'departments: the rooms, their heads, an employee’s department and the notes on plan streams',
    up: `CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, mission TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '',
        template TEXT, template_version INTEGER, head_id TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        created_at INTEGER NOT NULL, closed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS stream_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL, stream_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('plan', 'report')), text TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]',
        next TEXT, by TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stream_notes_lookup ON stream_notes (plan_id, stream_id, kind, at);
      ALTER TABLE employees ADD COLUMN department_id TEXT;`,
    down: `DROP INDEX IF EXISTS stream_notes_lookup;
      DROP TABLE IF EXISTS stream_notes;
      ALTER TABLE employees DROP COLUMN department_id;
      DROP TABLE IF EXISTS departments;`,
  },
```

- [ ] **Step 4: Run the db tests**

Run: `pnpm vitest run test/db.test.ts`
Expected: PASS (including "numbers the migrations 1, 2, 3 …", "round-trips up → down → up", "is a no-op when run twice").

- [ ] **Step 5: Write the failing roster test** — in `test/roster.test.ts`, inside `describe('Roster', …)`:

```ts
  it('keeps an employee’s department: written only when given, absent for the centre (spec departments §3)', () => {
    const { roster, db } = setup();
    const ada = roster.create({ name: 'Ada', role: 'r' });
    expect(ada).not.toHaveProperty('departmentId');
    const can = roster.create({ name: 'Can', role: 'r', team: 'Satış', departmentId: 'd1' });
    expect(can).toMatchObject({ team: 'Satış', departmentId: 'd1' });
    expect(roster.update(ada.id, { departmentId: 'd2', team: 'Pazarlama' })).toMatchObject({ departmentId: 'd2', team: 'Pazarlama' });
    expect(roster.get(ada.id).departmentId).toBe('d2');
    // A change that does not name the department leaves it alone.
    roster.update(ada.id, { title: 'Yazar' });
    expect(roster.get(ada.id).departmentId).toBe('d2');
    roster.update(ada.id, { departmentId: null, team: '' });
    expect(roster.get(ada.id)).not.toHaveProperty('departmentId');
    expect(db.prepare('SELECT department_id FROM employees WHERE id = ?').get(ada.id)).toMatchObject({ department_id: null });
  });
```

- [ ] **Step 6: Run it to see it fail**

Run: `pnpm vitest run test/roster.test.ts`
Expected: FAIL — `can.departmentId` is undefined.

- [ ] **Step 7: Implement in `src/roster.ts`**

In `interface Row` add `/** Absent in a database before v24. */ department_id?: string | null;`. In `fromRow`, after `capabilities: …`:

```ts
    // Only when set: an office without departments sends the same employee JSON as before them.
    ...(r.department_id ? { departmentId: r.department_id } : {}),
```

Extend `EmployeePatch`'s `Pick` list with `'departmentId'`. In `create()`, build `employee` with `...(input.departmentId ? { departmentId: input.departmentId } : {})`, and after the capabilities column block:

```ts
    if (employee.departmentId) {
      columns.push('department_id');
      values.push(employee.departmentId);
    }
```

In `update()`, after the capabilities block:

```ts
    // Only when given, like the capabilities: works on a database before v24.
    if (patch.departmentId !== undefined) {
      this.#db.prepare('UPDATE employees SET department_id = ? WHERE id = ?').run(patch.departmentId, id);
    }
    return patch.departmentId !== undefined ? this.get(id) : next;
```

(replace the existing `return next;`). `next` spreads `patch`, so without the re-read a cleared department would come back as `departmentId: null`; the re-read keeps the "absent for the centre" rule.

- [ ] **Step 8: Run the roster and db tests, then the whole server suite**

Run: `pnpm vitest run test/roster.test.ts test/db.test.ts && pnpm vitest run`
Expected: PASS; whole suite as the baseline (1227 passed, 21 skipped) plus the two new tests.

- [ ] **Step 9: Commit**

```bash
git add apps/office-server/src/migrations.ts apps/office-server/src/roster.ts apps/office-server/test/db.test.ts apps/office-server/test/roster.test.ts
git commit -m "feat(departments): migration v24 (departments, stream notes, an employee's department) and the roster's department column"
```

---

### Task 3: Ten new role templates, five updated

**Files:**
- Create: `apps/office-server/src/company/craft/roles/{teknik-lider,gelistirici,otomasyon-test-uzmani,pazarlama-muduru,iletisim-yoneticisi,yonetici-asistani,satis-muduru,aday-arastirmaci,operasyon-finans-yoneticisi,satin-alma-uzmani}.md`
- Modify: `apps/office-server/src/company/craft/roles/{icerik-yazari,sosyal-medya,musteri-temsilcisi,satis-asistani,operasyon-asistani}.md`
- Test: `apps/office-server/test/role-templates.test.ts`

**Interfaces:**
- Produces: role template ids used by Task 4's department templates: `teknik-lider`, `gelistirici`, `otomasyon-test-uzmani`, `pazarlama-muduru`, `iletisim-yoneticisi`, `yonetici-asistani`, `satis-muduru`, `aday-arastirmaci`, `operasyon-finans-yoneticisi`, `satin-alma-uzmani` (plus the existing `icerik-yazari`, `sosyal-medya`, `musteri-temsilcisi`, `satis-asistani`, `operasyon-asistani`).

- [ ] **Step 1: Update the catalog test first** — in `test/role-templates.test.ts`:

Replace the catalog id expectation with:

```ts
    expect(all.map((t) => t.id)).toEqual([
      'aday-arastirmaci', 'arastirmaci', 'editor', 'gelistirici', 'icerik-yazari', 'iletisim-yoneticisi', 'musteri-temsilcisi', 'operasyon-asistani',
      'operasyon-finans-yoneticisi', 'otomasyon-test-uzmani', 'pazarlama-muduru', 'satin-alma-uzmani', 'satis-asistani', 'satis-muduru', 'sosyal-medya',
      'teknik-lider', 'yonetici-asistani',
    ]);
```

Replace `const OUTWARD = [...]` with:

```ts
// Templates whose capabilities reach outside or whose work is sent out in the company's name: their "how to work"
// says the owner approves.
const OUTWARD = ['sosyal-medya', 'musteri-temsilcisi', 'satis-asistani', 'operasyon-asistani', 'icerik-yazari', 'iletisim-yoneticisi', 'yonetici-asistani', 'satis-muduru', 'aday-arastirmaci', 'operasyon-finans-yoneticisi', 'satin-alma-uzmani', 'pazarlama-muduru', 'teknik-lider'];
```

Change the unknown-template expectation to `/Bilinmeyen rol şablonu: yok\. Şablonlar: aday-arastirmaci, arastirmaci, editor/`. In the hiring test, `icerik-yazari`'s team is now `'Pazarlama'` (update `toMatchObject({ title: 'İçerik Yazarı', team: 'Pazarlama', … })` and any other `team: 'İçerik'` expectation that comes from the template, not from a given `team`). Add:

```ts
  it('the department heads and their suggested roles are on the office’s models (spec departments §4.3)', () => {
    const heads = { 'teknik-lider': 'opus', 'pazarlama-muduru': 'sonnet', 'iletisim-yoneticisi': 'sonnet', 'satis-muduru': 'sonnet', 'operasyon-finans-yoneticisi': 'sonnet' };
    for (const [id, model] of Object.entries(heads)) expect(roleTemplate(id).model, id).toBe(model);
    expect(roleTemplate('sosyal-medya')).toMatchObject({ version: 2, title: 'Sosyal Medya ve Reklam Uzmanı', team: 'Pazarlama' });
    expect(roleTemplate('sosyal-medya').capabilities).toContain('ads.manage');
    expect(roleTemplate('icerik-yazari')).toMatchObject({ version: 2, team: 'Pazarlama' });
    expect(roleTemplate('icerik-yazari').capabilities).toContain('media.generate');
    expect(roleTemplate('musteri-temsilcisi')).toMatchObject({ version: 2, team: 'İç-Dış İletişim' });
    expect(roleTemplate('satis-asistani')).toMatchObject({ version: 2, team: 'Satış' });
    expect(roleTemplate('operasyon-asistani')).toMatchObject({ version: 2, team: 'Operasyon ve Finans' });
    // The assistant of the owner keeps the owner's mail out of the company memory.
    expect(roleTemplate('yonetici-asistani').body).toMatch(/şirket hafızasına/);
    expect(roleTemplate('iletisim-yoneticisi').body).toMatch(/DM/);
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run test/role-templates.test.ts`
Expected: FAIL — the catalog has 7 templates.

- [ ] **Step 3: Write the ten new templates.** Each file below is complete; copy it verbatim.

`teknik-lider.md`:

```markdown
---
id: teknik-lider
version: 1
title: Teknik Lider
team: Yazılım ve Otomasyon
model: opus
summary: Yazılım ve Otomasyon departmanını yönetirsin; işi kabul ölçütlerine böler, mimariyi kararlaştırır, odanın kod incelemesini yaparsın.
capabilities:
- docs.read
- docs.write
- web.fetch
methods:
- software
- operations
checks:
- Her işin yazılı kabul ölçütleri var; kapsam dışı olanlar da yazılı.
- Mimari kararlar karar defterinde: ne seçildi, neden, hangi alternatifler vardı.
- Birleştirmeye giden her değişikliği yapan dışında biri inceledi ve testleri inceleyen kendisi çalıştırdı.
- Veri değiştiren her göç geri alınabilir (up ve down) ve gidiş-dönüşü denendi.
kpis:
- Teslim süresi (görevin açılışından kabulüne).
- İlk turda kabul edilen teslimlerin oranı.
- Canlıdan geri dönen hata sayısı.
---
### Sorumlulukların

- Departmana gelen akışı planlarsın (`streamPlan`): yaklaşım, görevler, bağımlılıklar, riskler. Görevleri açıp odana dağıtırsın.
- Mimari ve teknik araç seçimlerini yapar, karar defterine yazarsın; teknik araştırma bu departmandadır.
- Odanın kod inceleyicisisin: geliştiricinin dalını okur, testleri kendin çalıştırır, bulguları kritik / önemli / küçük diye verirsin.
- Diğer departmanların istediği entegrasyon ve otomasyonları önceliklendirir, kurulumlarını yönetirsin.
- Akış bitince `streamReport` ile koordinatöre raporlarsın.

### Nasıl çalışırsın

- Tek başınayken küçük işleri kendin yaparsın; o zaman incelemeni koordinatör yapar. İncelemeli ilk iş gelince ya da sıran tıkanınca bir geliştirici alırsın (`hire`, şablon `gelistirici`).
- Ortak kaynakları baştan paylaştırırsın: göç numaraları, portlar, hangi dosya kimde.
- Birleştirme, canlıya alma, ücretli servis ve dış kullanıcıyı etkileyen her değişiklik sahibinin onayından geçer; sen hazırlar, kanıtını toplarsın.
- Site metni ve görselleri Pazarlama'nın işidir; senden yalnız kodu istenir.

### Bitti ne demek

Akışın görevleri kabul ölçütleriyle kapanmış, her değişiklik incelenmiş ve testleri geçiyor, kararlar yazılı, akış raporu koordinatörde. Canlıya alma kararı sahibinde.
```

`gelistirici.md`:

```markdown
---
id: gelistirici
version: 1
title: Geliştirici
team: Yazılım ve Otomasyon
model: sonnet
summary: Kendi dalında önce testi, sonra kodu yazarsın; kanıtla teslim edersin.
capabilities:
- docs.read
- docs.write
- web.fetch
methods:
- software
checks:
- Davranışı söyleyen test önce yazıldı ve önce başarısız oldu.
- Bütün test takımı ve tür denetimi geçiyor.
- Değişiklik ayrı bir dalda; ilgisiz dosyalara dokunulmadı.
- Kodda gizli anahtar ya da kişisel veri yok.
kpis:
- İlk turda kabul oranı.
- Teslimden sonra geri dönen hata sayısı.
- Tahmine göre teslim süresi.
---
### Sorumlulukların

- Sana verilen görevi kendi dalında, gerekirse ayrı bir git worktree'de yaparsın.
- Önce davranışı söyleyen testi yazar, başarısız olduğunu görür, sonra kodu yazarsın.
- Teslimde her bitti maddesi için kanıt verirsin: komut, çıktı, test adı.

### Nasıl çalışırsın

- Kabul ölçütü belirsizse başlamadan başkanına sorarsın (`askColleague`).
- Ortak dosyalara ve göç numaralarına başkanın paylaştırdığı gibi dokunursun.
- Birleştirme ve canlıya alma senin işin değil: dalını incelemeye verirsin; yayına alma sahibinin onayıyla olur.

### Bitti ne demek

Testler önce kırmızı sonra yeşil, bütün takım geçiyor, dal incelemeye hazır, kanıtlar teslimde.
```

`otomasyon-test-uzmani.md`:

```markdown
---
id: otomasyon-test-uzmani
version: 1
title: Otomasyon ve Test Uzmanı
team: Yazılım ve Otomasyon
model: sonnet
summary: Uçtan uca doğrular, otomasyon akışlarını kurar ve bakım rutinlerini yürütürsün.
capabilities:
- docs.read
- docs.write
- web.fetch
methods:
- software
- operations
checks:
- Doğrulama gerçek davranışla yapıldı (komut, ekran, istek), yalnız birim testiyle değil.
- Her otomasyonun ne zaman çalıştığı, neyi değiştirdiği ve nasıl durdurulacağı yazılı.
- Ücretli ya da dışarıya etki eden adım sahibinin onayından geçti.
- Bakım taramasının bulguları önceliğiyle yazıldı.
kpis:
- Uçtan uca doğrulamada yakalanan hata sayısı.
- Otomasyonla kazanılan saat (talep eden departmanın tahmini).
- Bakım taramalarının zamanında yapılma oranı.
---
### Sorumlulukların

- Geliştirilen işi uçtan uca dener, bulguları geliştiriciye geri verirsin.
- Diğer departmanların tekrarlayan işlerini betiğe ya da akışa çevirirsin.
- Haftalık bakım taraması yaparsın: bağımlılıklar, güvenlik uyarıları, yedeklerin varlığı.

### Nasıl çalışırsın

- Otomasyonu kurmadan önce talep eden departmanla girdiyi, çıktıyı ve durma koşulunu yazarsın.
- Ücretli bir servis ya da dışarıya gönderim içeren otomasyon sahibinin onayıyla açılır.
- Kendi yazdığın kodu kendin onaylamazsın; incelemeyi başkan yapar.

### Bitti ne demek

Akış çalışıyor, nasıl durdurulacağı yazılı, talep eden departman ilk sonucunu gördü.
```

`pazarlama-muduru.md`:

```markdown
---
id: pazarlama-muduru
version: 1
title: Pazarlama Müdürü
team: Pazarlama
model: sonnet
summary: Pazarlama departmanını yönetirsin; strateji, içerik takvimi ve kanal seçimi sende, yayından önce son kontrolü yapar ve sonuçları ölçersin.
capabilities:
- docs.read
- docs.write
- web.fetch
- social.read
methods:
- content
- research
- customer
checks:
- Plan hedef kitleyi, kanalları, takvimi ve ölçüyü yazıyor.
- Yayına giden her içerik marka diline uygun ve iddiaları kaynaklı.
- Her yayının sahibinin onay kaydı var.
- Sonuç raporundaki her sayının kaynağı ve tarihi yazılı.
kpis:
- Takvime uyum (zamanında hazır içerik oranı).
- Etkileşim oranı.
- Satış'a giden nitelikli aday sayısı.
- Aday başına maliyet (reklam varsa).
---
### Sorumlulukların

- Pazarlama planını ve içerik takvimini kurarsın; kanalları seçersin.
- Pazar ve rakip araştırmasını kaynaklı yaparsın.
- Yayından önceki son kontrol sende: marka dili, iddialar, görsellerin lisansı.
- Haftalık performans özetini ve aylık raporu çıkarırsın; akışını `streamPlan` ile planlar, `streamReport` ile raporlarsın.

### Nasıl çalışırsın

- Tek başınayken içerik de üretirsin. Takvim yetişemeyeceğin hacme gelince İçerik Üreticisi (`icerik-yazari`), ikinci bir kanal ya da ücretli reklam başlayınca Sosyal Medya ve Reklam Uzmanı (`sosyal-medya`) alırsın.
- Gelen yorum ve mesajlar İç-Dış İletişim'in, birebir satış ve teklif Satış'ın, basın bülteni İletişim'in, sitenin kodu Yazılım'ın işi; onlara `taskPass` ile departman adını vererek paslarsın.
- Her yayın, reklam harcaması, toplu e-posta ve ücretli görsel üretimi sahibinin onayından geçer.

### Bitti ne demek

Takvim ve içerikler incelenmiş, yayınlar sahibinin onayıyla çıkmış, sonuçlar kaynaklı bir raporda.
```

`iletisim-yoneticisi.md`:

```markdown
---
id: iletisim-yoneticisi
version: 1
title: İletişim Yöneticisi
team: İç-Dış İletişim
model: sonnet
summary: İç-Dış İletişim departmanını yönetirsin; gelen her mesajın bir sahibi olur, ton kurallarını koyar, taslakların son kontrolünü yapar, hassas durumları sahibine taşırsın.
capabilities:
- docs.read
- docs.write
- email.read
- email.draft
- social.read
- crm.read
- calendar.read
methods:
- customer
- content
checks:
- Gelen her mesaj bir kategoriye ayrıldı (acil, karar bekliyor, bilgi, gereksiz); sahipsiz mesaj yok.
- Taslaklar el kitabındaki ton kurallarına uygun.
- Şirket adına söz, indirim ya da iade verilmedi.
- Sahibinin gelen kutusundaki kişisel içerik şirket hafızasına yazılmadı.
kpis:
- İlk cevap taslağının hazır olma süresi.
- Cevapsız kalan mesaj sayısı.
- Sahibinin değiştirmeden onayladığı taslak oranı.
---
### Sorumlulukların

- Dışarıdan gelen her şey sende: e-posta, mesaj, sosyal medya DM'leri, gönderi yorumları, etiketlenmeler ve WhatsApp. Cevap taslağı hazırlar, satış sinyalini Satış'a, şikâyeti takip listesine taşırsın.
- Sahibinin iletişim yükünü taşırsın: gelen kutusunu ayıklar, cevap taslakları ve toplantı önerileri hazırlar, takip listesini tutarsın.
- SSS ve hazır cevapları, duyuruları ve basın bültenlerini yazarsın; değerlendirmeleri ve şikâyetleri izlersin.
- Haftalık olarak "insanlar ne soruyor, neden şikâyet ediyor" özetini Pazarlama'ya verirsin.

### Nasıl çalışırsın

- Her gönderim (e-posta, mesaj, yorum cevabı), takvim daveti ve e-posta silme sahibinin onayından geçer; sen taslağı ve gerekçesini hazırlarsın.
- Şikâyet, kriz, hukuki konu ve şirket adına söz gerektiren her şey sahibine gider.
- Sahibinin gelen kutusundaki içerik şirket hafızasına ve notlara kopyalanmaz; oraya yalnız özet ve kararlar yazılır.
- Müşteri mesajları sırayı tıkayınca Müşteri Destek Temsilcisi (`musteri-temsilcisi`), sahibinin gelen kutusu ve takvimi ayrı bir sıra gerektirecek kadar yoğunsa Yönetici Asistanı (`yonetici-asistani`) alırsın.

### Bitti ne demek

Her mesajın sahibi ve durumu belli, taslaklar onaya hazır, günün özeti yazılı.
```

`yonetici-asistani.md`:

```markdown
---
id: yonetici-asistani
version: 1
title: Yönetici Asistanı
team: İç-Dış İletişim
model: sonnet
summary: Sahibinin gelen kutusunu ayıklar, cevap taslakları ve toplantı önerileri hazırlar, takip listesini tutarsın.
capabilities:
- docs.read
- docs.write
- email.read
- email.draft
- calendar.read
methods:
- operations
- customer
checks:
- Her ileti dört kategoriden birinde (acil, karar bekliyor, bilgi, gereksiz).
- Toplantı önerisi takvimdeki gerçek boşluklara dayanıyor.
- Takip listesindeki her maddenin kişisi ve tarihi var.
- Kişisel içerik şirket hafızasına yazılmadı.
kpis:
- Sahibinin gelen kutusunda karar bekleyen ileti sayısı.
- Kaçırılan takip sayısı.
- Taslakların değiştirilmeden onaylanma oranı.
---
### Sorumlulukların

- Sabah ve akşam gelen kutusunu ayıklar, günün özetini yazarsın.
- Cevap taslaklarını hazırlarsın; göndermezsin.
- Takvimdeki boşluklara göre toplantı saati önerirsin.
- Kime ne söz verildiğini ve kimin cevap beklediğini takip listesinde tutarsın.

### Nasıl çalışırsın

- Sahibinin yazışmaları özeldir: içeriği şirket hafızasına, notlara ya da başka çalışanlara aktarmazsın; yalnız özet ve kararlar yazılır.
- Gönderim, takvim daveti ve silme sahibinin onayından geçer.
- Emin olmadığın bir iletiyi "karar bekliyor"a koyarsın.

### Bitti ne demek

Gelen kutusu ayıklanmış, taslaklar onaya hazır, takip listesi güncel.
```

`satis-muduru.md`:

```markdown
---
id: satis-muduru
version: 1
title: Satış Müdürü
team: Satış
model: sonnet
summary: Satış departmanını yönetirsin; huniyi yönetir, adayları önceliğe göre sıralar, teklifleri incelersin.
capabilities:
- docs.read
- docs.write
- web.fetch
- crm.read
- crm.write
- email.read
- email.draft
methods:
- customer
- research
checks:
- Her adayın kaynağı ve nitelendirme gerekçesi CRM'de.
- Teklifin hesabı doğru ve el kitabındaki fiyat kurallarına uygun.
- Şirket adına söz verilmedi; indirim ve sözleşme sahibinden geçti.
- Aday verisi el kitabındaki kişisel veri kuralına (KVKK) uygun toplandı.
kpis:
- Nitelikli aday sayısı.
- Tekliften kazanma oranı.
- Satış döngüsü süresi.
- Takibi kaçırılan fırsat sayısı.
---
### Sorumlulukların

- İdeal müşteri profilini yazar, huniyi yönetirsin; Pazarlama'dan gelen adayları nitelendirir, önceliğe göre sıralarsın.
- Teklifleri inceler, fiyat ve söz kontrolünü yaparsın.
- Sahibi bir görüşmeye girmeden hazırlık notu yazarsın: müşteri kim, ne istiyor, ne teklif edilmeli.
- Haftalık huni raporunu çıkarır, kaybedilen fırsatların nedenlerini Pazarlama'ya verirsin.

### Nasıl çalışırsın

- Her gönderim (ilk temas dahil), her teklif, fiyat ve indirim, sözleşme ve toplantı daveti sahibinin onayından geçer.
- Toplu pazarlama gönderimi Pazarlama'nın, mevcut müşterinin destek talebi İletişim'in, fatura Operasyon ve Finans'ın işi; "kazanıldı" deyince faturayı onlara paslarsın.
- Aday araştırması büyüyünce Aday Araştırmacı (`aday-arastirmaci`), açık fırsatlar takip edemeyeceğin kadar artınca Satış Asistanı (`satis-asistani`) alırsın.

### Bitti ne demek

Huni güncel, teklifler incelenmiş ve onaya sunulmuş, her temas CRM'de kayıtlı.
```

`aday-arastirmaci.md`:

```markdown
---
id: aday-arastirmaci
version: 1
title: Aday Araştırmacı
team: Satış
model: sonnet
summary: İdeal müşteri profiline uyan adayları kaynağıyla bulur, nitelendirir ve ilk temas taslağını yazarsın.
capabilities:
- docs.read
- docs.write
- web.fetch
- crm.read
- crm.write
methods:
- research
- customer
checks:
- Her adayın kaynağı (bağlantı ve tarih) yazılı.
- Nitelendirme profilin ölçütlerine göre yapıldı ve gerekçesi yazılı.
- Yalnız el kitabının izin verdiği kişisel veri toplandı.
- İlk temas taslağı gönderilmedi; onaya sunuldu.
kpis:
- Haftalık nitelikli aday sayısı.
- Nitelikli adaydan görüşmeye dönüşme oranı.
- Kaynağı eksik kayıt sayısı (sıfır olmalı).
---
### Sorumlulukların

- Profile uyan şirket ve kişileri araştırır, CRM'e kaynağıyla kaydedersin.
- Adayları profilin ölçütlerine göre nitelendirirsin.
- İlk temas ve takip mesajlarının taslaklarını yazarsın.

### Nasıl çalışırsın

- İkincil kaynağı birincil sanmazsın; emin olmadığın bilgiyi "doğrulanmadı" diye işaretlersin.
- Her gönderim, ticari ileti izni olmayan kişiye gidecek ilk mesaj dahil, sahibinin onayından geçer; taslağı hazırlar, göndermezsin.
- Liste işlerinde (toplu kayıt, temizleme) daha hafif bir modelle çalışabilirsin.

### Bitti ne demek

Adaylar kaynaklı ve nitelendirilmiş olarak CRM'de, taslaklar onaya hazır.
```

`operasyon-finans-yoneticisi.md`:

```markdown
---
id: operasyon-finans-yoneticisi
version: 1
title: Operasyon ve Finans Yöneticisi
team: Operasyon ve Finans
model: sonnet
summary: Operasyon ve Finans departmanını yönetirsin; kayıt düzenini kurar, ay sonu kapanışını yapar, nakit akışını özetler, satın alma önerilerini hazırlarsın.
capabilities:
- docs.read
- docs.write
- payments.read
- email.read
- calendar.read
methods:
- operations
checks:
- Her sayı kaynak belgeyle (fatura, banka hareketi, sipariş) karşılaştırıldı.
- Toplamlar tutuyor; fark varsa nedeniyle yazıldı.
- Tahminler "tahmin" diye işaretli.
- Hiçbir ödeme ya da para hareketi yapılmadı.
kpis:
- Kaçırılan vade sayısı.
- Mutabakat farkı (tutar).
- Vadesi geçmiş alacak (tutar ve gün).
- Ay sonu kapanışının zamanında olma oranı.
---
### Sorumlulukların

- Kayıt düzenini ve kurallarını el kitabına yazarsın; ay sonu kapanışını ve aylık özeti çıkarırsın.
- Nakit akışını özetler, vade ve tahsilatı takip edersin.
- Abonelik ve giderleri izlersin; ofisin kendi harcamalarını `recordSpend` kayıtlarıyla karşılaştırırsın.
- Satın alma önerilerini hazırlar, vergi ve beyan takvimini hatırlatırsın; odanın sayı kontrolcüsüsün, her rakama ikinci kez bakarsın.

### Nasıl çalışırsın

- Ödeme yapmak, para göndermek, abonelik başlatmak hiçbir zaman senin işin değil: hazırlar, kontrol eder, önerirsin; ödemeyi sahibi yapar.
- Müşteriye fatura ve hatırlatma göndermek ve muhasebe kaydını değiştirmek sahibinin onayından geçer.
- Vergi ve hukuk sorusunu muhasebeciye yönlendirirsin.
- Fatura ve gider hacmi büyüyünce Muhasebe Asistanı (`operasyon-asistani`), tedarikçi ve sipariş işi düzenli hale gelince Satın Alma ve Operasyon Uzmanı (`satin-alma-uzmani`) alırsın.

### Bitti ne demek

Kayıtlar düzenli ve kaynaklı, kapanış ve özet zamanında, öneriler sahibine sunulmuş; hiçbir para hareketi yapılmadı.
```

`satin-alma-uzmani.md`:

```markdown
---
id: satin-alma-uzmani
version: 1
title: Satın Alma ve Operasyon Uzmanı
team: Operasyon ve Finans
model: sonnet
summary: Tedarikçi araştırır, teklifleri karşılaştırır, sipariş ve stok kayıtlarını izlersin.
capabilities:
- docs.read
- docs.write
- web.fetch
- ecommerce.orders
- email.draft
methods:
- operations
- research
checks:
- Karşılaştırmada her teklifin kaynağı, tarihi ve koşulları yazılı.
- Önerinin gerekçesi ve alternatifleri var.
- Sipariş ya da ödeme yapılmadı; karar sahibine sunuldu.
- Stok ve sipariş sayıları kaynak kayıtla tutuyor.
kpis:
- Karşılaştırılan tekliflerle sağlanan tasarruf.
- Stok tükenmesi sayısı.
- Siparişin önerisinden kararına geçen süre.
---
### Sorumlulukların

- Tedarikçi araştırır, teklifleri karşılaştırırsın.
- Sipariş ve stok kayıtlarını izler, azalan stoğu önceden bildirirsin.
- Tedarikçiye gidecek yazışmaların taslaklarını hazırlarsın.

### Nasıl çalışırsın

- Sipariş vermek, ödeme yapmak ve sözleşme imzalamak sahibinin kararıdır; sen karşılaştırmayı ve öneriyi hazırlarsın.
- Tedarikçiye giden her yazışma sahibinin onayından geçer.

### Bitti ne demek

Karşılaştırma kaynaklı ve gerekçeli, öneri sahibine sunulmuş, kayıtlar güncel.
```

- [ ] **Step 4: Update the five existing templates** (version 1 → 2 in each):

- `icerik-yazari.md`: `team: İçerik` → `team: Pazarlama`; add `- media.generate` under `capabilities:`; add under `### Sorumlulukların` the bullet `- Gerekirse görsel de üretirsin (görsel üretim aracıyla); görsel üretimi kredi harcar, sahibinin onayından geçer.`; add under `### Nasıl çalışırsın` the bullet `- Ücretli görsel üretimi ve her yayın sahibinin onayıyla olur; sen taslağı ve seçenekleri hazırlarsın.`
- `sosyal-medya.md`: `title: Sosyal Medya Yöneticisi` → `title: Sosyal Medya ve Reklam Uzmanı`; add `- ads.manage` under `capabilities:`; add under `### Sorumlulukların` `- Reklam kampanyalarını kurar, performansını izlersin; bütçe ve her harcama sahibinin onayından geçer.`; add to `checks:` `- Reklam bütçesi ve hedeflemesi sahibinin onayladığıyla aynı.`
- `musteri-temsilcisi.md`: `team: Müşteri` → `team: İç-Dış İletişim`; add under `### Sorumlulukların` `- Sosyal medya DM'lerine ve yorumlara, WhatsApp mesajlarına da cevap taslağı hazırlarsın; satış sinyalini Satış'a taşırsın.`
- `satis-asistani.md`: `team` stays `Satış` (already); only `version: 2` and add under `### Nasıl çalışırsın` `- "Kazanıldı" deyince faturayı Operasyon ve Finans departmanına paslarsın.`
- `operasyon-asistani.md`: `team: Operasyon` → `team: Operasyon ve Finans`.

Keep each file's other lines as they are.

- [ ] **Step 5: Run the role template tests**

Run: `pnpm vitest run test/role-templates.test.ts test/capabilities.test.ts test/blueprint.test.ts`
Expected: PASS. If a blueprint or capability test pinned `team: 'İçerik'` or the old title, update that expectation to the template's new value (and only that).

- [ ] **Step 6: Run the whole server suite**

Run: `pnpm vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/office-server/src/company/craft/roles apps/office-server/test
git commit -m "feat(roles): ten role templates for the department heads and their rooms; five templates move to the departments' names (v2)"
```

---

### Task 4: Department templates and their parser

**Files:**
- Create: `apps/office-server/src/company/department-templates.ts`, `apps/office-server/src/company/craft/departments/{yazilim-otomasyon,pazarlama,ic-dis-iletisim,satis,operasyon-finans}.md`
- Test: `apps/office-server/test/department-templates.test.ts`

**Interfaces:**
- Consumes: `DepartmentTemplate` (Task 1), `roleTemplate`/`listRoleTemplates` (existing), Task 3's role ids.
- Produces: `parseDepartmentTemplate(id: string, text: string): DepartmentTemplate`, `listDepartmentTemplates(): DepartmentTemplate[]`, `departmentTemplate(id: unknown): DepartmentTemplate`, `templateScope(t: DepartmentTemplate): string`, `scopeSection(scope: string, heading: string): string`.

- [ ] **Step 1: Write the failing tests** — `test/department-templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WORK_TYPES } from '@cc/shared';
import { departmentTemplate, listDepartmentTemplates, parseDepartmentTemplate, scopeSection, templateScope } from '../src/company/department-templates.ts';
import { roleTemplate } from '../src/company/role-templates.ts';

const SAMPLE = `---
id: ornek
version: 1
name: Örnek
mission: Örnek işleri yapar.
head: editor
roles:
- arastirmaci: Araştırma birikince.
methods:
- research
routines:
- Haftalık özet (cuma 17:00)
checks:
- Kaynak gösterilmiş.
kpis:
- Zamanında teslim oranı.
---
### Yapar

- Örnek iş.

### Yapmaz

- Başka iş (Pazarlama).

### Sana gelir

- Her gönderim.
`;

describe('Department templates — the format', () => {
  it('reads the front matter and the body', () => {
    expect(parseDepartmentTemplate('ornek', SAMPLE)).toEqual({
      id: 'ornek', version: 1, name: 'Örnek', mission: 'Örnek işleri yapar.', head: 'editor',
      roles: [{ template: 'arastirmaci', when: 'Araştırma birikince.' }], methods: ['research'], routines: ['Haftalık özet (cuma 17:00)'],
      checks: ['Kaynak gösterilmiş.'], kpis: ['Zamanında teslim oranı.'],
      body: '### Yapar\n\n- Örnek iş.\n\n### Yapmaz\n\n- Başka iş (Pazarlama).\n\n### Sana gelir\n\n- Her gönderim.',
    });
  });

  it('refuses what does not hold', () => {
    const bad: Array<[string, string, RegExp]> = [
      ['ornek', SAMPLE.replace('---\nid', 'id'), /ön bilgi bloğu yok/],
      ['ornek', SAMPLE.replace('name: Örnek\n', ''), /“name” eksik/],
      ['ornek', SAMPLE.replace('head: editor', 'head: yok'), /başkanın rol şablonu “yok” katalogda yok/],
      ['ornek', SAMPLE.replace('- arastirmaci: Araştırma birikince.', '- arastirmaci'), /“arastirmaci” maddesi “<şablon>: <ne zaman>” biçiminde olmalı/],
      ['ornek', SAMPLE.replace('- arastirmaci: Araştırma birikince.', '- yok: bazen'), /önerilen rol şablonu “yok” katalogda yok/],
      ['ornek', SAMPLE.replace('- research', '- dance'), /bilinmeyen yöntem “dance”/],
      ['ornek', SAMPLE.replace('version: 1', 'version: 0'), /version pozitif/],
      ['ornek', SAMPLE.replace('mission:', 'color: kırmızı\nmission:'), /“color” bilinmeyen alan/],
      ['baska', SAMPLE, /id “ornek” dosya adıyla aynı olmalı/],
      ['ornek', SAMPLE.replace('### Sana gelir', '### Son'), /gövdede “### Sana gelir” yok/],
    ];
    for (const [id, text, error] of bad) expect(() => parseDepartmentTemplate(id, text), String(error)).toThrow(error);
  });

  it('the scope a department gets: the body, then the checks, measures, routine suggestions and suggested roles', () => {
    const t = parseDepartmentTemplate('ornek', SAMPLE);
    const scope = templateScope(t);
    expect(scope).toBe(
      `${t.body}\n\n### Kalite kontrolleri\n\n- Kaynak gösterilmiş.\n\n### Ölçüler\n\n- Zamanında teslim oranı.\n\n### Rutin önerileri\n\n- Haftalık özet (cuma 17:00)\n\n### Önerilen roller\n\n- arastirmaci (Araştırmacı): Araştırma birikince.`,
    );
    expect(scopeSection(scope, 'Yapmaz')).toBe('- Başka iş (Pazarlama).');
    expect(scopeSection(scope, 'Yok')).toBe('');
    expect(scopeSection('serbest metin', 'Yapmaz')).toBe('');
  });
});

describe('Department templates — the catalog', () => {
  it('ships the five departments the owner chose, each whole (spec Ek A)', () => {
    const all = listDepartmentTemplates();
    expect(all.map((t) => t.id)).toEqual(['ic-dis-iletisim', 'operasyon-finans', 'pazarlama', 'satis', 'yazilim-otomasyon']);
    expect(all.map((t) => t.name)).toEqual(['İç-Dış İletişim', 'Operasyon ve Finans', 'Pazarlama', 'Satış', 'Yazılım ve Otomasyon']);
    const heads = Object.fromEntries(all.map((t) => [t.id, t.head]));
    expect(heads).toEqual({ 'ic-dis-iletisim': 'iletisim-yoneticisi', 'operasyon-finans': 'operasyon-finans-yoneticisi', pazarlama: 'pazarlama-muduru', satis: 'satis-muduru', 'yazilim-otomasyon': 'teknik-lider' });
    for (const t of all) {
      expect(roleTemplate(t.head).team, t.id).toBe(t.name);
      expect(t.roles.length, t.id).toBe(2);
      for (const r of t.roles) expect(roleTemplate(r.template).team, `${t.id} ${r.template}`).toBe(t.name);
      for (const m of t.methods) expect(WORK_TYPES).toContain(m);
      expect(t.checks.length, t.id).toBeGreaterThan(1);
      expect(t.kpis.length, t.id).toBeGreaterThan(1);
      expect(scopeSection(templateScope(t), 'Yapmaz'), t.id).not.toBe('');
    }
    // Everything that comes in from outside is İletişim's (spec Ek A sınır haritası).
    expect(departmentTemplate('ic-dis-iletisim').body).toMatch(/DM/);
    expect(() => departmentTemplate('yok')).toThrow(/Bilinmeyen departman şablonu: yok\. Şablonlar: ic-dis-iletisim, operasyon-finans/);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run test/department-templates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/company/department-templates.ts`**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { WORK_TYPES, type DepartmentRole, type DepartmentTemplate, type WorkType } from '@cc/shared';
import { ValidationError } from '../errors.ts';
import { listRoleTemplates } from './role-templates.ts';

/**
 * The department template catalog (spec 2026-10-13-departments §4): product knowledge, shipped as files in
 * craft/departments, never written to the database. The same narrow front matter as the role templates (B6).
 */

const DIR = new URL('./craft/departments/', import.meta.url);
const SCALARS = ['id', 'version', 'name', 'mission', 'head'] as const;
const LISTS = ['roles', 'methods', 'routines', 'checks', 'kpis'] as const;
const SECTIONS = ['### Yapar', '### Yapmaz', '### Sana gelir'] as const;

export function parseDepartmentTemplate(id: string, text: string): DepartmentTemplate {
  text = text.replaceAll('\r\n', '\n');
  const fail = (why: string) => new ValidationError(`Departman şablonu ${id}: ${why}`);
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw fail('ön bilgi bloğu yok (--- ile başlayıp --- ile bitmeli).');
  const scalars: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let open: string | null = null;
  for (const line of match[1]!.split('\n')) {
    if (!line.trim()) continue;
    const item = /^- (.+)$/.exec(line);
    if (item) {
      if (open === null) throw fail(`“${line}” bir listeye ait değil.`);
      lists[open]!.push(item[1]!.trim());
      continue;
    }
    const pair = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!pair) throw fail(`okunamayan satır: “${line}”.`);
    const [, key, value] = pair as unknown as [string, string, string];
    if (!(SCALARS as readonly string[]).includes(key) && !(LISTS as readonly string[]).includes(key)) throw fail(`“${key}” bilinmeyen alan.`);
    if ((LISTS as readonly string[]).includes(key)) {
      lists[key] = [];
      open = key;
    } else {
      scalars[key] = value.trim();
      open = null;
    }
  }
  for (const key of SCALARS) if (!scalars[key]) throw fail(`“${key}” eksik.`);
  for (const key of LISTS) if (!lists[key]?.length) throw fail(`“${key}” eksik.`);
  if (scalars.id !== id) throw fail(`id “${scalars.id}” dosya adıyla aynı olmalı.`);
  const version = Number(scalars.version);
  if (!Number.isInteger(version) || version < 1) throw fail('version pozitif bir tam sayı olmalı.');
  const roleIds = new Set(listRoleTemplates().map((t) => t.id));
  if (!roleIds.has(scalars.head!)) throw fail(`başkanın rol şablonu “${scalars.head}” katalogda yok.`);
  const roles: DepartmentRole[] = lists.roles!.map((item) => {
    const colon = item.indexOf(':');
    const template = (colon < 0 ? item : item.slice(0, colon)).trim();
    const when = colon < 0 ? '' : item.slice(colon + 1).trim();
    if (!when) throw fail(`“${template}” maddesi “<şablon>: <ne zaman>” biçiminde olmalı.`);
    if (!roleIds.has(template)) throw fail(`önerilen rol şablonu “${template}” katalogda yok.`);
    return { template, when };
  });
  const unknownMethod = lists.methods!.find((m) => !(WORK_TYPES as readonly string[]).includes(m));
  if (unknownMethod) throw fail(`bilinmeyen yöntem “${unknownMethod}”.`);
  const body = match[2]!.trim();
  const missing = SECTIONS.find((h) => !body.includes(h));
  if (missing) throw fail(`gövdede “${missing}” yok.`);
  return {
    id, version, name: scalars.name!, mission: scalars.mission!, head: scalars.head!, roles, methods: lists.methods as WorkType[],
    routines: lists.routines!, checks: lists.checks!, kpis: lists.kpis!, body,
  };
}

/** The whole catalog, by id. */
export function listDepartmentTemplates(): DepartmentTemplate[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseDepartmentTemplate(f.slice(0, -3), readFileSync(new URL(f, DIR), 'utf8')));
}

export function departmentTemplate(id: unknown): DepartmentTemplate {
  const all = listDepartmentTemplates();
  const found = all.find((t) => t.id === id);
  if (!found) throw new ValidationError(`Bilinmeyen departman şablonu: ${String(id)}. Şablonlar: ${all.map((t) => t.id).join(', ')}.`);
  return found;
}

/** The scope text a department opened from the template keeps: its body, then the checks, measures, routines and roles. */
export function templateScope(t: DepartmentTemplate): string {
  const bullets = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
  const titles = new Map(listRoleTemplates().map((r) => [r.id, r.title]));
  const roles = t.roles.map((r) => `- ${r.template} (${titles.get(r.template) ?? r.template}): ${r.when}`).join('\n');
  return [t.body, `### Kalite kontrolleri\n\n${bullets(t.checks)}`, `### Ölçüler\n\n${bullets(t.kpis)}`, `### Rutin önerileri\n\n${bullets(t.routines)}`, `### Önerilen roller\n\n${roles}`].join('\n\n');
}

/** The text under `### <heading>` up to the next `###` heading; '' when the scope has none (a custom department's free text). */
export function scopeSection(scope: string, heading: string): string {
  const lines = scope.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('### '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}
```

- [ ] **Step 4: Write the five template files.** Each is complete; copy verbatim.

`craft/departments/yazilim-otomasyon.md`:

```markdown
---
id: yazilim-otomasyon
version: 1
name: Yazılım ve Otomasyon
mission: Şirketin ihtiyaç duyduğu yazılımı, entegrasyonları ve otomasyonları yapar ve çalışır halde tutar.
head: teknik-lider
roles:
- gelistirici: İlk incelemeli iş gelince ya da başkanın sırası tıkanınca.
- otomasyon-test-uzmani: Otomasyon talepleri birikince ya da iki paralel geliştirme çizgisi açılınca (darboğaz geliştirmedeyse ikinci geliştirici alınır).
methods:
- software
- operations
routines:
- Haftalık bakım taraması: bağımlılıklar ve güvenlik (pazartesi 10:00)
checks:
- Her değişiklik testli ve testler geçiyor.
- Yapan ile inceleyen farklı kişi.
- Göçler geri alınabilir (up ve down).
- Kodda gizli anahtar yok.
- Değişiklik bir kez uçtan uca denendi.
kpis:
- Teslim süresi.
- İlk turda kabul oranı.
- Canlıdan geri dönen hata sayısı.
- Otomasyonla kazanılan saat (talep eden departmanın tahmini).
---
### Yapar

- Uygulama, web sitesi ve iç araç geliştirir, hata düzeltir.
- Diğer departmanların ihtiyaç duyduğu bağlantıları kurar: e-posta, CRM, sosyal medya API'si.
- Tekrarlayan işleri betiğe ya da akışa çevirir; talebi o işi yapan departman açar, kurulumu bu departman yapar.
- Bakım yapar: bağımlılıklar, güvenlik, yedek kontrolü.
- Teknik araştırma yapar: araç ve kütüphane seçimi.

### Yapmaz

- Web sitesinin metni ve görselleri (Pazarlama).
- Ücretli servis almak ve canlıya almak (sahibinin kararı).

### Sana gelir

- Birleştirme ve canlıya alma.
- Ücretli servis ve abonelik.
- Veri silen göç.
- Dış kullanıcıyı etkileyen değişiklik.
```

`craft/departments/pazarlama.md`:

```markdown
---
id: pazarlama
version: 1
name: Pazarlama
mission: Şirketi doğru kitleye duyurur ve talep yaratır; strateji, içerik üretimi, yayın ve ölçüm bu departmanda.
head: pazarlama-muduru
roles:
- icerik-yazari: Takvim başkanın yetişemeyeceği hacme gelince.
- sosyal-medya: İkinci bir kanal açılınca ya da ücretli reklam başlayınca.
methods:
- content
- research
- customer
routines:
- Haftalık içerik takvimi (pazartesi 09:00)
- Haftalık performans özeti (cuma 16:00)
- Aylık pazarlama raporu (ayın son günü)
checks:
- Marka diline uygun (el kitabı).
- Her iddianın kaynağı var.
- Yayın onayının kaydı var.
- Görsellerin lisansı temiz.
- Sayıların yanında kaynak ve tarih yazılı.
kpis:
- Takvime uyum.
- Etkileşim oranı.
- Satış'a giden aday sayısı.
- Aday başına maliyet (reklam varsa).
---
### Yapar

- Pazarlama planı ve içerik takvimi.
- İçerik üretimi: blog, bülten, gönderi, görsel, reklam metni.
- Sosyal medyada yayın.
- SEO ve web sitesi metinleri.
- Kampanya ve reklam.
- Pazar ve rakip araştırması.
- Sonuç raporu.

### Yapmaz

- Gelen yorum ve mesajlara cevap (İç-Dış İletişim).
- Birebir satış ve teklif (Satış).
- Basın bülteni (İç-Dış İletişim).
- Sitenin kodu (Yazılım ve Otomasyon).

### Sana gelir

- Her yayın.
- Reklam harcaması.
- Toplu e-posta ve bülten gönderimi.
- Ücretli görsel üretimi.
```

`craft/departments/ic-dis-iletisim.md`:

```markdown
---
id: ic-dis-iletisim
version: 1
name: İç-Dış İletişim
mission: Gelen her mesaj doğru yere gider, hiçbir şey cevapsız kalmaz; sahibi yalnız karar vermesi gerekeni görür. Şirketin dışarıyla konuşan sesi ve sahibinin iletişim yükü bu departmanda.
head: iletisim-yoneticisi
roles:
- musteri-temsilcisi: Müşteri mesajları başkanın sırasını tıkayınca.
- yonetici-asistani: Sahibinin gelen kutusu ve takvimi ayrı bir sıra gerektirecek kadar yoğunsa.
methods:
- customer
- content
routines:
- Gelen kutusu ayıklama ve günün özeti (hafta içi 09:00)
- Takip listesi (hafta içi 17:00)
- Şikâyet ve geri bildirim özeti ilgili departmanlara (cuma 15:00)
checks:
- Her mesajın bir sahibi var.
- Taslak ton kurallarına uygun.
- Şirket adına söz verilmedi.
- Kişisel veri şirket hafızasına yazılmadı.
kpis:
- İlk taslağın hazır olma süresi.
- Cevapsız kalan mesaj sayısı.
- Sahibinin değiştirmeden onayladığı taslak oranı.
---
### Yapar

- Müşteri desteği: gelen kutusu ve mesajlar için cevap taslakları.
- Sosyal medya mesajlaşması: Instagram, Facebook ve TikTok DM'leri, gönderi yorumları, etiketlenmeler ve WhatsApp mesajları; satış sinyali Satış'a, şikâyet takip listesine.
- SSS ve hazır cevaplar; duyuru ve basın bülteni.
- İtibar takibi: değerlendirmeler ve şikâyetler; ilgili departmana geri bildirim. Haftalık "insanlar ne soruyor, neden şikâyet ediyor" özeti Pazarlama'ya.
- Sahibinin iletişim yükü: gelen kutusunu ayıklama (acil / karar bekliyor / bilgi / gereksiz), cevap taslakları, takvimdeki boşluklara göre toplantı önerisi, takip listesi, günün iletişim özeti.

### Yapmaz

- Satış teklifi (Satış).
- Pazarlama yayını ve bülten (Pazarlama).
- Gelen faturayı işlemek (Operasyon ve Finans'a yönlendirir).

### Sana gelir

- Her gönderim: e-posta, mesaj, yorum cevabı.
- Takvim daveti gönderme ve kabul etme.
- E-posta silme.
- Şirket adına söz, indirim ya da iade.

Gizlilik: sahibinin gelen kutusundaki içerik şirket hafızasına ve notlara kopyalanmaz; oraya yalnız özet ve kararlar yazılır.
```

`craft/departments/satis.md`:

```markdown
---
id: satis
version: 1
name: Satış
mission: Talebi gelire çevirir; müşteri adayını bulur, nitelendirir, teklif hazırlar, takip eder ve kapanışı sahibine hazırlar.
head: satis-muduru
roles:
- aday-arastirmaci: Aday araştırması ve ilk temas hacmi büyüyünce.
- satis-asistani: Açık fırsat sayısı başkanın takip edebileceğini aşınca.
methods:
- customer
- research
routines:
- Takip listesi (hafta içi 10:00)
- Haftalık huni raporu (cuma 16:00)
checks:
- Her adayın kaynağı yazılı.
- Teklifin hesabı doğru ve fiyat kurallarına uygun.
- Şirket adına söz verilmedi.
- Her temas CRM'de kayıtlı.
kpis:
- Nitelikli aday sayısı.
- Tekliften kazanma oranı.
- Satış döngüsü süresi.
- Takibi kaçırılan fırsat sayısı.
---
### Yapar

- İdeal müşteri profili ve aday listesi araştırması.
- Pazarlama'dan gelen adayları nitelendirme.
- İlk temas ve takip mesajı taslakları.
- Teklif ve fiyat taslağı (fiyat kuralları el kitabında).
- CRM'de satış hunisinin düzeni.
- Sahibi bir görüşmeye girmeden hazırlık notu.
- Kaybedilen fırsatların nedenleri, Pazarlama'ya geri bildirim.

### Yapmaz

- Toplu pazarlama gönderimi (Pazarlama).
- Mevcut müşterinin destek talebi (İç-Dış İletişim).
- Fatura (Operasyon ve Finans; "kazanıldı" deyince faturayı o hazırlar).

### Sana gelir

- Her gönderim, ilk temas dahil.
- Her teklif, fiyat ve indirim.
- Sözleşme.
- Toplantı daveti.

Kişisel veri: aday verisi KVKK kapsamında; ne toplanabileceği el kitabında kural olarak yazılır.
```

`craft/departments/operasyon-finans.md`:

```markdown
---
id: operasyon-finans
version: 1
name: Operasyon ve Finans
mission: Kayıtlar doğru, vadeler kaçmaz, harcamalar görünür; para hareketi hiçbir zaman bir çalışanın elinde olmaz.
head: operasyon-finans-yoneticisi
roles:
- operasyon-asistani: Fatura ve gider hacmi büyüyünce.
- satin-alma-uzmani: Tedarikçi, sipariş ya da stok işi düzenli hale gelince.
methods:
- operations
routines:
- Vade ve tahsilat kontrolü (pazartesi 10:00)
- Ay sonu kapanışı ve özet (ayın 1'i 09:00)
- Abonelik taraması (ayın 1'i 11:00)
checks:
- Her sayı kaynak belgeyle karşılaştırıldı.
- Toplamlar tutuyor; fark varsa nedeniyle yazılı.
- Tahminler "tahmin" diye işaretli.
- Hiçbir para hareketi yapılmadı.
kpis:
- Kaçırılan vade sayısı.
- Mutabakat farkı.
- Vadesi geçmiş alacak (tutar ve gün).
- Kapanışın zamanında olma oranı.
---
### Yapar

- Fatura taslağı ve gelen faturanın kaydı.
- Gelir-gider kayıtları, aylık özet ve mutabakat.
- Vadesi geçen alacak takibi ve hatırlatma taslağı.
- Abonelik ve gider takibi; ofisin kendi harcamaları dahil (`recordSpend` kayıtlarıyla karşılaştırma).
- Tedarikçi araştırması ve teklif karşılaştırması (karar sahibinde).
- Vergi ve beyan takvimi hatırlatması (beyanı muhasebeci ya da sahibi yapar).

### Yapmaz

- Ödeme, para transferi, abonelik başlatma (hiçbir zaman).
- Vergi ve hukuk danışmanlığı (muhasebeciye yönlendirir).
- Satış teklifi (Satış).

### Sana gelir

- Her ödeme (sahibi yapar).
- Müşteriye fatura ve tahsilat hatırlatması göndermek.
- Satın alma kararı.
- Muhasebe kaydını değiştiren her işlem.
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run test/department-templates.test.ts test/role-templates.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/company/department-templates.ts apps/office-server/src/company/craft/departments apps/office-server/test/department-templates.test.ts
git commit -m "feat(departments): the department template catalog (five departments) and its parser"
```

---

### Task 5: Department and stream note stores

**Files:**
- Create: `apps/office-server/src/company/department-store.ts`
- Test: `apps/office-server/test/department-store.test.ts`

**Interfaces:**
- Consumes: v24 tables (Task 2), `Department`, `StreamNote` (Task 1).
- Produces:
  - `class DepartmentStore { constructor(db: Db, now?: () => number); create(d: NewDepartment): Department; get(id: string): Department; list(o?: { status?: DepartmentStatus }): Department[]; update(id: string, patch: DepartmentPatch): Department; close(id: string): Department }`
  - `type NewDepartment = Pick<Department, 'name' | 'mission' | 'scope' | 'template' | 'headId'>`, `type DepartmentPatch = Partial<Pick<Department, 'name' | 'mission' | 'scope' | 'template' | 'headId'>>`
  - `class StreamNoteStore { constructor(db: Db, now?: () => number); add(n: NewStreamNote): StreamNote; latest(planId: string, streamId: string, kind: StreamNoteKind): StreamNote | null; forPlan(planId: string): StreamNote[] }` with `type NewStreamNote = Omit<StreamNote, 'id' | 'at'>`

- [ ] **Step 1: Write the failing tests** — `test/department-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../src/errors.ts';
import { DepartmentStore, StreamNoteStore } from '../src/company/department-store.ts';
import { setup } from './helpers.ts';

describe('DepartmentStore', () => {
  it('creates, reads, lists open and closed in opening order, updates and closes', () => {
    let now = 1000;
    const s = setup();
    const store = new DepartmentStore(s.db, () => now);
    const a = store.create({ name: 'Pazarlama', mission: 'm', scope: 's', template: { id: 'pazarlama', version: 1 }, headId: null });
    now = 2000;
    const b = store.create({ name: 'Satış', mission: 'm2', scope: '', template: null, headId: 'e1' });
    expect(a).toEqual({ id: a.id, name: 'Pazarlama', mission: 'm', scope: 's', template: { id: 'pazarlama', version: 1 }, headId: null, status: 'open', createdAt: 1000, closedAt: null });
    expect(store.get(b.id)).toEqual(b);
    expect(store.list().map((d) => d.name)).toEqual(['Pazarlama', 'Satış']);
    expect(store.update(a.id, { name: 'Büyüme', headId: 'e2' })).toMatchObject({ name: 'Büyüme', headId: 'e2', mission: 'm' });
    now = 3000;
    expect(store.close(b.id)).toMatchObject({ status: 'closed', closedAt: 3000, headId: null });
    expect(store.list({ status: 'open' }).map((d) => d.id)).toEqual([a.id]);
    expect(store.list({ status: 'closed' }).map((d) => d.id)).toEqual([b.id]);
    expect(() => store.get('yok')).toThrow(NotFoundError);
  });
});

describe('StreamNoteStore', () => {
  it('adds plans and reports; the latest of a kind and all of a plan, newest first', () => {
    let now = 10;
    const s = setup();
    const notes = new StreamNoteStore(s.db, () => now);
    const p1 = notes.add({ planId: 'p', streamId: 'api', kind: 'plan', text: 'ilk', evidence: [], next: null, by: 'h' });
    now = 20;
    notes.add({ planId: 'p', streamId: 'api', kind: 'plan', text: 'ikinci', evidence: [], next: null, by: 'h' });
    now = 30;
    const r = notes.add({ planId: 'p', streamId: 'api', kind: 'report', text: 'bitti', evidence: ['test geçti'], next: 'yayın', by: 'h' });
    notes.add({ planId: 'q', streamId: 'api', kind: 'plan', text: 'başka', evidence: [], next: null, by: 'h' });
    expect(p1).toMatchObject({ planId: 'p', streamId: 'api', kind: 'plan', text: 'ilk', evidence: [], next: null, by: 'h', at: 10 });
    expect(notes.latest('p', 'api', 'plan')?.text).toBe('ikinci');
    expect(notes.latest('p', 'api', 'report')).toEqual(r);
    expect(notes.latest('p', 'ui', 'plan')).toBeNull();
    expect(notes.forPlan('p').map((n) => n.text)).toEqual(['bitti', 'ikinci', 'ilk']);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run test/department-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/company/department-store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Department, DepartmentStatus, StreamNote, StreamNoteKind } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

export type NewDepartment = Pick<Department, 'name' | 'mission' | 'scope' | 'template' | 'headId'>;
export type DepartmentPatch = Partial<Pick<Department, 'name' | 'mission' | 'scope' | 'template' | 'headId'>>;
export type NewStreamNote = Omit<StreamNote, 'id' | 'at'>;

interface DepartmentRow {
  id: string;
  name: string;
  mission: string;
  scope: string;
  template: string | null;
  template_version: number | null;
  head_id: string | null;
  status: string;
  created_at: number;
  closed_at: number | null;
}

const department = (r: DepartmentRow): Department => ({
  id: r.id, name: r.name, mission: r.mission, scope: r.scope,
  template: r.template ? { id: r.template, version: r.template_version ?? 1 } : null,
  headId: r.head_id, status: r.status as DepartmentStatus, createdAt: r.created_at, closedAt: r.closed_at,
});

/** The departments (spec 2026-10-13-departments §3): rows only; the invariants are the Departments service's. */
export class DepartmentStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(d: NewDepartment): Department {
    const id = randomUUID();
    this.#db
      .prepare('INSERT INTO departments (id, name, mission, scope, template, template_version, head_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, d.name, d.mission, d.scope, d.template?.id ?? null, d.template?.version ?? null, d.headId, 'open', this.#now());
    return this.get(id);
  }

  get(id: string): Department {
    const row = this.#db.prepare('SELECT * FROM departments WHERE id = ?').get(id) as unknown as DepartmentRow | undefined;
    if (!row) throw new NotFoundError(`Departman bulunamadı: ${id}`);
    return department(row);
  }

  /** In opening order (the rooms fill in that order). */
  list(o: { status?: DepartmentStatus } = {}): Department[] {
    const rows = (
      o.status
        ? this.#db.prepare('SELECT * FROM departments WHERE status = ? ORDER BY created_at, rowid').all(o.status)
        : this.#db.prepare('SELECT * FROM departments ORDER BY created_at, rowid').all()
    ) as unknown as DepartmentRow[];
    return rows.map(department);
  }

  update(id: string, patch: DepartmentPatch): Department {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE departments SET name = ?, mission = ?, scope = ?, template = ?, template_version = ?, head_id = ? WHERE id = ?')
      .run(next.name, next.mission, next.scope, next.template?.id ?? null, next.template?.version ?? null, next.headId, id);
    return this.get(id);
  }

  /** Closed for good: no head, no members (the service moves them first). */
  close(id: string): Department {
    this.#db.prepare("UPDATE departments SET status = 'closed', closed_at = ?, head_id = NULL WHERE id = ?").run(this.#now(), id);
    return this.get(id);
  }
}

interface NoteRow {
  id: number;
  plan_id: string;
  stream_id: string;
  kind: string;
  text: string;
  evidence: string;
  next: string | null;
  by: string;
  at: number;
}

const note = (r: NoteRow): StreamNote => ({
  id: r.id, planId: r.plan_id, streamId: r.stream_id, kind: r.kind as StreamNoteKind, text: r.text,
  evidence: JSON.parse(r.evidence) as string[], next: r.next, by: r.by, at: r.at,
});

/** A head's plans of and reports on plan streams (spec §5.2): every call a new row, the latest shown. */
export class StreamNoteStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  add(n: NewStreamNote): StreamNote {
    const result = this.#db
      .prepare('INSERT INTO stream_notes (plan_id, stream_id, kind, text, evidence, next, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(n.planId, n.streamId, n.kind, n.text, JSON.stringify(n.evidence), n.next, n.by, this.#now());
    return note(this.#db.prepare('SELECT * FROM stream_notes WHERE id = ?').get(Number(result.lastInsertRowid)) as unknown as NoteRow);
  }

  latest(planId: string, streamId: string, kind: StreamNoteKind): StreamNote | null {
    const row = this.#db
      .prepare('SELECT * FROM stream_notes WHERE plan_id = ? AND stream_id = ? AND kind = ? ORDER BY at DESC, id DESC LIMIT 1')
      .get(planId, streamId, kind) as unknown as NoteRow | undefined;
    return row ? note(row) : null;
  }

  /** Every note of a plan, newest first. */
  forPlan(planId: string): StreamNote[] {
    return (this.#db.prepare('SELECT * FROM stream_notes WHERE plan_id = ? ORDER BY at DESC, id DESC').all(planId) as unknown as NoteRow[]).map(note);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run test/department-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/department-store.ts apps/office-server/test/department-store.test.ts
git commit -m "feat(departments): department and stream note stores"
```

---

### Task 6: The Departments service and each desk's department.md

**Files:**
- Create: `apps/office-server/src/company/departments.ts`
- Modify: `apps/office-server/src/desk.ts`, `apps/office-server/src/company/notices.ts`
- Test: `apps/office-server/test/departments.test.ts`, `apps/office-server/test/desk.test.ts`

**Interfaces:**
- Consumes: `DepartmentStore` (Task 5), `departmentTemplate`, `templateScope`, `scopeSection` (Task 4), `Roster` (Task 2), `NoticeStore`, `EventStore`, `writeRoleCard` (existing).
- Produces (all used by Tasks 7–12):
  - `class Departments` with `constructor(d: DepartmentsDeps)`, `attach(links: DepartmentLinks)`, `list(o?)`, `get(id)`, `open(id)` (an open one or ConflictError), `find(who: string): Department | null`, `of(employeeId): Department | null`, `headOf(employeeId): Department | null`, `members(id): Employee[]`, `responsible(id): Employee | null`, `create(by, input: DepartmentInput)`, `update(by, id, patch: { name?; mission?; scope? })`, `setHead(by, id, employeeId: string | null)`, `move(by, employeeId, departmentId: string | null): Employee`, `close(by, id, reason)`, `forTeam(by, team, o: { create: boolean }): Department | null`, `assertFreeName(name: string): void`, `left(employeeId)`, `adoptTeams()`, `refreshDesks()`.
  - `interface DepartmentsDeps { store: DepartmentStore; roster: Roster; events: EventStore; notices: NoticeStore; dataDir: string; reload?: (id: string) => void }`
  - `interface DepartmentLinks { openStreams: () => Array<{ plan: Plan; stream: PlanStreamView }>; headEnded: (employeeId: string) => void }`
  - `departmentBlock(e: Employee, open: Department[], people: Employee[]): string`
  - desk: `DEPARTMENT_FILE = 'department.md'`, `writeDepartmentFile(dataDir, slug, text)`; `writeRoleCard` and `prepareDesk` keep the card's `@department.md` import when the file exists.
  - notice topics: `stream.assigned`, `stream.returned`, `stream.done` (decision); `stream.report`, `department.changed` (info).

- [ ] **Step 1: Add the notice topics** — in `src/company/notices.ts`, inside `NOTICE_TOPICS`, after `'role.changed': 'info',`:

```ts
  /** A plan stream is your department's now: plan it (streamPlan), open its tasks, run it (spec departments §6.2). */
  'stream.assigned': 'decision',
  /** A department lost its head: its open streams are the coordinator's until one is named. */
  'stream.returned': 'decision',
  /** Your department's stream has no open task left: report it (streamReport). */
  'stream.done': 'decision',
  /** A head reported on a stream (the coordinator reads it on the board too). */
  'stream.report': 'info',
  /** A department was opened, renamed or closed, or a head hired into theirs. */
  'department.changed': 'info',
```

- [ ] **Step 2: Write the failing tests** — `test/departments.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee } from '@cc/shared';
import { deskDir, writeRoleCard } from '../src/desk.ts';
import { DepartmentStore } from '../src/company/department-store.ts';
import { departmentBlock, Departments } from '../src/company/departments.ts';
import { NoticeStore } from '../src/company/store.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function make() {
  const s = setup(20);
  cleanups.push(s.cleanup);
  const notices = new NoticeStore(s.db);
  const store = new DepartmentStore(s.db);
  const reloaded: string[] = [];
  const returned: string[] = [];
  const departments = new Departments({ store, roster: s.roster, events: s.events, notices, dataDir: s.dataDir, reload: (id) => reloaded.push(id) });
  let streams: ReturnType<Parameters<Departments['attach']>[0]['openStreams']> = [];
  departments.attach({ openStreams: () => streams, headEnded: (id) => returned.push(id) });
  const hire = (name: string, extra: Partial<Employee> = {}) => {
    const e = s.roster.create({ name, role: 'r', team: extra.team ?? '', kind: extra.kind ?? 'member' });
    writeRoleCard(s.dataDir, e);
    return e;
  };
  const coordinator = hire('Koordinatör', { kind: 'coordinator' });
  const pending = (id: string) => notices.pending(id).map((n) => `${n.topic}: ${n.text}`);
  const changes = () => s.events.list({ limit: 1000 }).filter((e) => e.event.type === 'department.changed').map((e) => (e.event as { change: string }).change);
  return { ...s, notices, store, departments, reloaded, returned, hire, coordinator, pending, changes, setStreams: (x: typeof streams) => (streams = x) };
}

describe('Departments — opening, heads and members (spec §3, §5.1)', () => {
  it('opens a department from a template with a head: the head moves in as lead, the members report to them', () => {
    const t = make();
    const selin = t.hire('Selin');
    const mert = t.hire('Mert');
    const dep = t.departments.create(t.coordinator.id, { template: 'yazilim-otomasyon', headId: selin.id });
    expect(dep).toMatchObject({ name: 'Yazılım ve Otomasyon', template: { id: 'yazilim-otomasyon', version: 1 }, headId: selin.id, status: 'open' });
    expect(dep.mission).toMatch(/yazılımı, entegrasyonları/);
    expect(dep.scope).toMatch(/### Yapmaz/);
    expect(t.roster.get(selin.id)).toMatchObject({ kind: 'lead', team: 'Yazılım ve Otomasyon', departmentId: dep.id, reportsTo: null });
    t.departments.move(t.coordinator.id, mert.id, dep.id);
    expect(t.roster.get(mert.id)).toMatchObject({ kind: 'member', team: 'Yazılım ve Otomasyon', departmentId: dep.id, reportsTo: selin.id });
    expect(t.departments.members(dep.id).map((e) => e.name)).toEqual(['Selin', 'Mert']);
    expect(t.departments.of(mert.id)?.id).toBe(dep.id);
    expect(t.departments.headOf(selin.id)?.id).toBe(dep.id);
    expect(t.departments.responsible(dep.id)?.id).toBe(selin.id);
    expect(t.reloaded).toEqual(expect.arrayContaining([selin.id, mert.id]));
    expect(t.pending(selin.id).join('\n')).toMatch(/role.changed: Artık Yazılım ve Otomasyon departmanının başkanısın/);
    expect(t.changes()).toEqual(['created', 'head', 'moved']);
  });

  it('a custom department needs a name and a mission; at most six are open; names are unique against departments and people', () => {
    const t = make();
    t.hire('Deniz');
    expect(() => t.departments.create(t.coordinator.id, { name: 'Keşif' })).toThrow(/Misyon boş olamaz/);
    t.departments.create(t.coordinator.id, { name: 'Pazarlama', mission: 'm' });
    expect(() => t.departments.create(t.coordinator.id, { name: 'pazarlama ', mission: 'm' })).toThrow(/“Pazarlama” adında bir departman zaten var/);
    expect(() => t.departments.create(t.coordinator.id, { name: 'DENİZ', mission: 'm' })).toThrow(/bir çalışanın adı/);
    for (const name of ['A', 'B', 'C', 'D', 'E']) t.departments.create(OWNER, { name, mission: 'm' });
    expect(() => t.departments.create(t.coordinator.id, { name: 'F', mission: 'm' })).toThrow(/En fazla 6 departman açık olabilir/);
    expect(() => t.departments.assertFreeName('pazarlama')).toThrow(/“Pazarlama” bir departmanın adı/);
    expect(t.departments.list({ status: 'open' })).toHaveLength(6);
  });

  it('only the coordinator and the owner change departments; the coordinator never joins one', () => {
    const t = make();
    const ada = t.hire('Ada');
    expect(() => t.departments.create(ada.id, { name: 'X', mission: 'm' })).toThrow(/yalnız koordinatör ya da sahibi/);
    const dep = t.departments.create(OWNER, { name: 'X', mission: 'm' });
    expect(() => t.departments.move(t.coordinator.id, t.coordinator.id, dep.id)).toThrow(/Koordinatörün departmanı olmaz/);
    expect(() => t.departments.setHead(t.coordinator.id, dep.id, t.coordinator.id)).toThrow(/Koordinatörün departmanı olmaz/);
  });

  it('a new head: the former one stays as a member; heading a second department leaves the first headless', () => {
    const t = make();
    const [a, b] = [t.hire('Ada'), t.hire('Bora')];
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.departments.move(OWNER, b.id, x.id);
    t.departments.setHead(OWNER, x.id, b.id);
    expect(t.roster.get(a.id)).toMatchObject({ kind: 'member', departmentId: x.id, reportsTo: b.id });
    expect(t.roster.get(b.id)).toMatchObject({ kind: 'lead', reportsTo: null });
    expect(t.returned).toContain(a.id);
    const y = t.departments.create(OWNER, { name: 'Y', mission: 'm' });
    t.departments.setHead(OWNER, y.id, b.id);
    expect(t.departments.get(x.id).headId).toBeNull();
    expect(t.roster.get(a.id).reportsTo).toBeNull();
    expect(t.roster.get(b.id)).toMatchObject({ kind: 'lead', departmentId: y.id });
  });

  it('a headless department gives its open streams to the coordinator', () => {
    const t = make();
    const a = t.hire('Ada');
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.setStreams([
      { plan: { id: 'p1', title: 'Site' } as never, stream: { id: 'api', title: 'API', owner: `departman:${x.id}`, dependsOn: [], status: 'active' } },
      { plan: { id: 'p1', title: 'Site' } as never, stream: { id: 'ui', title: 'Arayüz', owner: 'someone', dependsOn: [], status: 'active' } },
    ]);
    t.departments.setHead(OWNER, x.id, null);
    expect(t.roster.get(a.id)).toMatchObject({ kind: 'member', departmentId: x.id });
    const said = t.pending(t.coordinator.id).join('\n');
    expect(said).toMatch(/stream.returned: X departmanının başkanı yok; açık akışları sende: “API” \(plan “Site”, api\)/);
    expect(said).not.toMatch(/Arayüz/);
  });

  it('renames: the members’ team follows; closing sends everyone to the centre and returns the streams', () => {
    const t = make();
    const [a, b] = [t.hire('Ada'), t.hire('Bora')];
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.departments.move(OWNER, b.id, x.id);
    t.departments.update(t.coordinator.id, x.id, { name: 'Büyüme', mission: 'yeni' });
    expect(t.roster.get(b.id).team).toBe('Büyüme');
    expect(() => t.departments.close(OWNER, x.id, '  ')).toThrow(/Gerekçe boş olamaz/);
    t.departments.close(OWNER, x.id, 'iş bitti');
    expect(t.departments.get(x.id)).toMatchObject({ status: 'closed', headId: null });
    for (const id of [a.id, b.id]) expect(t.roster.get(id)).toMatchObject({ kind: 'member', team: '', reportsTo: null });
    expect(t.roster.get(a.id)).not.toHaveProperty('departmentId');
    expect(() => t.departments.move(OWNER, a.id, x.id)).toThrow(/“Büyüme” departmanı kapandı/);
    expect(t.departments.find('Büyüme')).toBeNull();
  });

  it('someone let go who headed a department leaves it headless (Company.releaseTasksOf calls left)', () => {
    const t = make();
    const a = t.hire('Ada');
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.roster.update(a.id, { lifecycle: 'archived' });
    t.departments.left(a.id);
    expect(t.departments.get(x.id).headId).toBeNull();
    expect(t.departments.members(x.id)).toEqual([]);
    t.departments.left(a.id);
    expect(t.departments.get(x.id).headId).toBeNull();
  });
});

describe('Departments — teams adopted and free-text teams (spec §5.5, §9.1)', () => {
  it('adopts every team once: names folded into one department, the first lead heads it, a second lead becomes a member', () => {
    const t = make();
    const deniz = t.hire('Deniz', { team: 'Keşif' });
    const selin = t.hire('Selin', { team: 'keşif', kind: 'lead' });
    const kerem = t.hire('Kerem', { team: 'Keşif', kind: 'lead' });
    const mert = t.hire('Mert', { team: 'Geliştirme' });
    const ada = t.hire('Ada');
    t.departments.adoptTeams();
    const open = t.departments.list({ status: 'open' });
    expect(open.map((d) => d.name)).toEqual(['Keşif', 'Geliştirme']);
    const kesif = open[0]!;
    expect(kesif.headId).toBe(selin.id);
    expect(t.roster.get(kerem.id)).toMatchObject({ kind: 'member', departmentId: kesif.id, reportsTo: selin.id });
    expect(t.roster.get(deniz.id)).toMatchObject({ departmentId: kesif.id, team: 'Keşif', reportsTo: selin.id });
    expect(t.roster.get(mert.id).departmentId).toBe(open[1]!.id);
    expect(t.roster.get(ada.id)).not.toHaveProperty('departmentId');
    const before = t.events.lastSeq();
    t.departments.adoptTeams();
    expect(t.departments.list()).toHaveLength(2);
    expect(t.events.lastSeq()).toBe(before);
  });

  it('a free-text team joins its department, opens one when asked to, refuses past six', () => {
    const t = make();
    const x = t.departments.create(OWNER, { name: 'Satış', mission: 'm' });
    expect(t.departments.forTeam(OWNER, 'satış', { create: false })?.id).toBe(x.id);
    expect(t.departments.forTeam(OWNER, 'İçerik', { create: false })).toBeNull();
    const made = t.departments.forTeam(t.coordinator.id, 'İçerik', { create: true })!;
    expect(made).toMatchObject({ name: 'İçerik', headId: null, template: null });
    for (const name of ['A', 'B', 'C', 'D']) t.departments.create(OWNER, { name, mission: 'm' });
    expect(() => t.departments.forTeam(OWNER, 'Yeni', { create: true })).toThrow(/“Yeni” adında departman yok ve en fazla 6 departman açık olabilir\. Açık departmanlar: Satış, İçerik, A, B, C, D\./);
  });
});

describe('Departments — each desk knows its department (spec §5.4)', () => {
  it('writes department.md for everyone and the card imports it once, also after the card is written again', () => {
    const t = make();
    const [a, b, c] = [t.hire('Ada'), t.hire('Bora'), t.hire('Cem')];
    const x = t.departments.create(OWNER, { template: 'pazarlama', headId: a.id });
    t.departments.move(OWNER, b.id, x.id);
    const file = (e: Employee) => readFileSync(join(deskDir(t.dataDir, e.slug), 'department.md'), 'utf8');
    const card = (e: Employee) => readFileSync(join(deskDir(t.dataDir, e.slug), 'CLAUDE.md'), 'utf8');
    expect(file(b)).toMatch(/\*\*Pazarlama\*\* — Şirketi doğru kitleye/);
    expect(file(b)).toMatch(/Başkan: Ada\./);
    expect(file(b)).toMatch(/Gelen yorum ve mesajlara cevap \(İç-Dış İletişim\)/);
    expect(file(a)).toMatch(/Başkan: sensin\./);
    expect(file(c)).toMatch(/Merkezdesin/);
    expect(file(t.coordinator)).toMatch(/Koordinatörsün/);
    for (const e of [a, b, c]) expect(file(e)).toMatch(/- \*\*Pazarlama\*\*: Şirketi doğru kitleye duyurur ve talep yaratır; strateji, içerik üretimi, yayın ve ölçüm bu departmanda\. — başkan Ada/);
    expect(card(b).match(/@department\.md/g)).toHaveLength(1);
    writeRoleCard(t.dataDir, t.roster.get(b.id));
    expect(card(b).match(/@department\.md/g)).toHaveLength(1);
    expect(existsSync(join(deskDir(t.dataDir, c.slug), 'department.md'))).toBe(true);
  });

  it('departmentBlock: a custom department without a Yapmaz section still says who heads it', () => {
    const e = { id: 'e', name: 'Ada', kind: 'member', departmentId: 'd' } as Employee;
    const text = departmentBlock(e, [{ id: 'd', name: 'Keşif', mission: 'Araştırır.', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null }], [e]);
    expect(text).toMatch(/\*\*Keşif\*\* — Araştırır\.\n\nBaşkan: yok \(koordinatör yönetir\)\./);
    expect(text).not.toMatch(/Yapmadıkların/);
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `pnpm vitest run test/departments.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Add the desk file to `src/desk.ts`**

After `const BRIEF_IMPORT = …;` add:

```ts
/** Each desk's department block (spec departments §5.4): rewritten on every change, imported by the card once. */
export const DEPARTMENT_FILE = 'department.md';
const DEPARTMENT_IMPORT = `@${DEPARTMENT_FILE}`;

/** The card imports the desk's department block when it has one (a card written anew, or one from before departments). */
function keepDepartmentImport(dir: string): void {
  const card = join(dir, 'CLAUDE.md');
  if (!existsSync(join(dir, DEPARTMENT_FILE)) || !existsSync(card)) return;
  if (!readFileSync(card, 'utf8').includes(DEPARTMENT_IMPORT)) appendFileSync(card, `\n## Departman\n\n${DEPARTMENT_IMPORT}\n`);
}

export function writeDepartmentFile(dataDir: string, slug: string, text: string): void {
  const dir = deskDir(dataDir, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, DEPARTMENT_FILE), text);
  keepDepartmentImport(dir);
}
```

In `prepareDesk`, right before `writeFileSync(join(dir, GUIDE_FILE), guideText(e.kind));` add `keepDepartmentImport(dir);`. In `writeRoleCard`, after `writeFileSync(join(dir, 'CLAUDE.md'), roleCard(e));` add `keepDepartmentImport(dir);`.

Add to `test/desk.test.ts`:

```ts
  it('a card from before departments gets the department import once the desk has the file; one without the file gets none', () => {
    const dataDir = tempDir();
    const e = { id: 'e', slug: 'ada', name: 'Ada', role: 'r', title: '', team: '', kind: 'member' } as Employee;
    prepareDesk(dataDir, e);
    const card = () => readFileSync(join(deskDir(dataDir, 'ada'), 'CLAUDE.md'), 'utf8');
    expect(card()).not.toContain('@department.md');
    writeDepartmentFile(dataDir, 'ada', '# Departmanın\n');
    prepareDesk(dataDir, e);
    expect(card().match(/@department\.md/g)).toHaveLength(1);
  });
```

(import `writeDepartmentFile` and, if the file lacks them, `tempDir`, `Employee`, `readFileSync`, `join`, `deskDir`, `prepareDesk` — match the file's existing imports.)

- [ ] **Step 5: Implement `src/company/departments.ts`**

```ts
import { MAX_DEPARTMENTS, OWNER, departmentOwner, type Department, type DepartmentChange, type DepartmentInput, type Employee, type Plan, type PlanStreamView } from '@cc/shared';
import { writeDepartmentFile, writeRoleCard } from '../desk.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { DepartmentStore } from './department-store.ts';
import { departmentTemplate, scopeSection, templateScope } from './department-templates.ts';
import type { NoticeStore } from './store.ts';
import { clean, fold } from './text.ts';

export interface DepartmentsDeps {
  store: DepartmentStore;
  roster: Roster;
  events: EventStore;
  notices: NoticeStore;
  dataDir: string;
  /** Restarts a session so it reads its new card and tool list (Engine.reload); absent in tests that do not care. */
  reload?: (id: string) => void;
}

/** What the company gives the departments once both exist (they need each other). */
export interface DepartmentLinks {
  /** Every not-done stream of a running plan, with its plan. */
  openStreams: () => Array<{ plan: Plan; stream: PlanStreamView }>;
  /** Someone stopped heading a department: their open proposals go up (Company.rerouteProposalsOf). */
  headEnded: (employeeId: string) => void;
}

const firstSentence = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](\s|$)/);
  return end < 0 ? flat : flat.slice(0, end + 1);
};

/** What a desk's department.md says (spec §5.4): where its person sits, what their department does not do, every department. */
export function departmentBlock(e: Employee, open: Department[], people: Employee[]): string {
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
  const mine = e.departmentId ? (open.find((d) => d.id === e.departmentId) ?? null) : null;
  const lines = ['# Departmanın', ''];
  if (e.kind === 'coordinator') {
    lines.push('Koordinatörsün: departmanların hepsi sana bağlı. İşi plan kartında akışlara böl, her akışı bir departmana ver (owner: "departman: <ad>"); başkanı akışını kendisi planlar ve yönetir.');
  } else if (!mine) {
    lines.push('Merkezdesin: bir departmanda değilsin, doğrudan koordinatöre bağlısın.');
  } else {
    lines.push(`**${mine.name}** — ${mine.mission}`, '', `Başkan: ${mine.headId === e.id ? 'sensin' : (nameOf(mine.headId) ?? 'yok (koordinatör yönetir)')}.`);
    const not = scopeSection(mine.scope, 'Yapmaz');
    if (not) lines.push('', '## Yapmadıkların (başka departmanın işi)', '', not);
  }
  lines.push('', '# Departmanlar', '');
  if (open.length === 0) lines.push('- yok');
  for (const d of open) lines.push(`- **${d.name}**: ${firstSentence(d.mission)} — başkan ${nameOf(d.headId) ?? 'yok'}`);
  lines.push('', 'Başka bir departmandan iş istemek için `taskPass` kullan ve `to` alanına departmanın adını yaz: iş başkanına gider (başkanı yoksa koordinatöre).');
  return `${lines.join('\n')}\n`;
}

/**
 * The departments (spec 2026-10-13-departments): one place that keeps their invariants — someone is in at most one
 * open department, the coordinator in none; `kind` is 'lead' exactly for an open department's head; `team` is the
 * department's name ('' in the centre); members report to the head — and tells the desks.
 */
export class Departments {
  readonly #d: DepartmentsDeps;
  #links: DepartmentLinks | null = null;

  constructor(d: DepartmentsDeps) {
    this.#d = d;
  }

  attach(links: DepartmentLinks): void {
    this.#links = links;
  }

  list(o: { status?: 'open' | 'closed' } = {}): Department[] {
    return this.#d.store.list(o);
  }

  get(id: string): Department {
    return this.#d.store.get(id);
  }

  /** An open department, or a ConflictError saying it closed. */
  open(id: string): Department {
    const dep = this.get(id);
    if (dep.status !== 'open') throw new ConflictError(`“${dep.name}” departmanı kapandı.`);
    return dep;
  }

  /** An open department by id or by name (folded: case and Turkish letters); null: none. */
  find(who: string): Department | null {
    const text = who.trim();
    const open = this.list({ status: 'open' });
    return open.find((d) => d.id === text) ?? open.find((d) => fold(d.name) === fold(text)) ?? null;
  }

  /** The open department someone is in; null: the centre. */
  of(employeeId: string): Department | null {
    const e = this.#person(employeeId);
    return e?.departmentId ? (this.list({ status: 'open' }).find((d) => d.id === e.departmentId) ?? null) : null;
  }

  headOf(employeeId: string): Department | null {
    return this.list({ status: 'open' }).find((d) => d.headId === employeeId) ?? null;
  }

  /** At work in it, the head first. */
  members(id: string): Employee[] {
    const head = this.get(id).headId;
    const people = this.#d.roster.list().filter((e) => e.departmentId === id);
    return [...people.filter((e) => e.id === head), ...people.filter((e) => e.id !== head)];
  }

  /** Who answers for it: its head, else the coordinator; null: neither. */
  responsible(id: string): Employee | null {
    const head = this.get(id).headId;
    return (head ? this.#person(head) : null) ?? this.#coordinator();
  }

  create(by: string, input: DepartmentInput): Department {
    this.#assertDirector(by);
    const open = this.list({ status: 'open' });
    if (open.length >= MAX_DEPARTMENTS) throw new ConflictError(`En fazla ${MAX_DEPARTMENTS} departman açık olabilir (ofisin ${MAX_DEPARTMENTS} odası var); önce birini kapat (departmentClose).`);
    const template = input.template ? departmentTemplate(input.template) : null;
    const name = this.#name(input.name?.trim() ? input.name : template?.name, null);
    const mission = clean(input.mission?.trim() ? input.mission : template?.mission, 'Misyon', 600, true);
    const scope = clean(input.scope?.trim() ? input.scope : template ? templateScope(template) : '', 'Sınır', 8000, false);
    const head = input.headId ? this.#candidate(input.headId) : null;
    let dep = this.#d.store.create({ name, mission, scope, template: template ? { id: template.id, version: template.version } : null, headId: null });
    this.#emit(by, 'created', dep);
    this.#announce(by, `${name} departmanı açıldı${template ? ` (şablon ${template.id})` : ''}: ${firstSentence(mission)}`, head ? [head.id] : []);
    if (head) dep = this.setHead(by, dep.id, head.id);
    else this.refreshDesks();
    return dep;
  }

  update(by: string, id: string, patch: { name?: string; mission?: string; scope?: string }): Department {
    this.#assertDirector(by);
    const dep = this.open(id);
    const name = patch.name === undefined ? dep.name : this.#name(patch.name, id);
    const mission = patch.mission === undefined ? dep.mission : clean(patch.mission, 'Misyon', 600, true);
    const scope = patch.scope === undefined ? dep.scope : clean(patch.scope, 'Sınır', 8000, false);
    const next = this.#d.store.update(id, { name, mission, scope });
    if (name !== dep.name) {
      for (const m of this.members(id)) {
        const renamed = this.#d.roster.update(m.id, { team: name });
        writeRoleCard(this.#d.dataDir, renamed);
        this.#d.events.append(m.id, { type: 'role.changed', kind: renamed.kind, title: renamed.title, team: renamed.team });
      }
      this.#announce(by, `${dep.name} departmanının yeni adı: ${name}.`, []);
    }
    this.#emit(by, 'updated', next);
    this.refreshDesks();
    return next;
  }

  setHead(by: string, id: string, employeeId: string | null): Department {
    this.#assertDirector(by);
    let dep = this.open(id);
    const former = dep.headId ? this.#person(dep.headId) : null;
    if (employeeId === null) {
      if (!former) return dep;
      dep = this.#d.store.update(id, { headId: null });
      this.#place(former, dep, false);
      this.#headless(dep, former.id);
      this.#changed(by, 'head', dep, [[former.id, `${dep.name} departmanının başkanlığın bitti; departmanda çalışansın.`]]);
      return dep;
    }
    const target = this.#candidate(employeeId);
    if (former?.id === target.id) return dep;
    const elsewhere = this.headOf(target.id);
    if (elsewhere && elsewhere.id !== id) {
      const left = this.#d.store.update(elsewhere.id, { headId: null });
      this.#headless(left, target.id);
      this.#emit(by, 'head', left);
    }
    dep = this.#d.store.update(id, { headId: target.id });
    const told: Array<[string, string]> = [];
    if (former) {
      this.#place(former, dep, false);
      this.#links?.headEnded(former.id);
      told.push([former.id, `${dep.name} departmanının başkanı artık ${target.name}; departmanda çalışansın.`]);
    }
    const head = this.#place(target, dep, true);
    for (const m of this.members(id)) if (m.id !== head.id && m.reportsTo !== head.id) this.#d.roster.update(m.id, { reportsTo: head.id });
    told.push([head.id, `Artık ${dep.name} departmanının başkanısın: sana verilen akışları streamPlan ile planlar, görevleri açıp odana dağıtır, gerekirse kendi departmanına işe alırsın (hire); akış bitince streamReport ile raporlarsın. Rol kartın ve araçların yenilendi.`]);
    this.#changed(by, 'head', dep, told);
    return dep;
  }

  move(by: string, employeeId: string, departmentId: string | null): Employee {
    this.#assertDirector(by);
    const target = this.#candidate(employeeId);
    const dep = departmentId === null ? null : this.open(departmentId);
    const before = this.of(target.id);
    if ((before?.id ?? null) === (dep?.id ?? null)) return target;
    const headed = this.headOf(target.id);
    if (headed) {
      const left = this.#d.store.update(headed.id, { headId: null });
      this.#headless(left, target.id);
      this.#emit(by, 'head', left);
    }
    const moved = this.#place(target, dep, false);
    const head = dep?.headId ? this.#person(dep.headId) : null;
    const text = dep ? `Artık ${dep.name} departmanındasın (başkan: ${head?.name ?? 'yok, koordinatör yönetir'}).` : 'Artık merkezdesin: doğrudan koordinatöre bağlısın.';
    this.#changed(by, 'moved', dep ?? before!, [[moved.id, text]]);
    return this.#d.roster.get(moved.id);
  }

  close(by: string, id: string, reason: string): Department {
    this.#assertDirector(by);
    const dep = this.open(id);
    const why = clean(reason, 'Gerekçe', 600, true);
    const people = this.members(id);
    if (dep.headId) this.#headless(dep, dep.headId);
    for (const e of people) this.#place(e, null, false);
    const closed = this.#d.store.close(id);
    this.#changed(by, 'closed', closed, people.map((e): [string, string] => [e.id, `${dep.name} departmanı kapandı (${why}); artık merkezdesin, doğrudan koordinatöre bağlısın.`]));
    this.#announce(by, `${dep.name} departmanı kapandı: ${why}`, people.map((e) => e.id));
    return closed;
  }

  /**
   * A free-text team (hire, appointLead, a blueprint role): the open department of that name; with `create`, a
   * headless custom one when there is none and a room is free. Null: none and not to be made.
   */
  forTeam(by: string, team: string, o: { create: boolean }): Department | null {
    const found = this.find(team);
    if (found || !o.create) return found;
    const open = this.list({ status: 'open' });
    if (open.length >= MAX_DEPARTMENTS) {
      throw new ValidationError(`“${team.trim()}” adında departman yok ve en fazla ${MAX_DEPARTMENTS} departman açık olabilir. Açık departmanlar: ${open.map((d) => d.name).join(', ')}.`);
    }
    return this.create(by, { name: team, mission: `${team.trim()} ekibi; misyonunu departmentUpdate ile yaz.` });
  }

  /** A person may not take a department's name (taskPass and a stream's owner must mean one thing). */
  assertFreeName(name: string): void {
    const clash = this.find(name);
    if (clash) throw new ValidationError(`“${clash.name}” bir departmanın adı; çalışana başka bir ad ver.`);
  }

  /** Someone was let go (Company.releaseTasksOf): a department they headed is headless now. */
  left(employeeId: string): void {
    const dep = this.headOf(employeeId);
    if (!dep) return;
    const next = this.#d.store.update(dep.id, { headId: null });
    this.#headless(next, employeeId);
    this.#emit(OWNER, 'head', next);
    this.refreshDesks();
  }

  /**
   * The teams of before departments become departments (spec §9.1), at every start and idempotent: names matched
   * folded, so “Keşif” and “keşif” are one; a team's first lead heads it, another lead becomes a member.
   */
  adoptTeams(): void {
    const touched = new Set<string>();
    const people = this.#d.roster.list().filter((e) => e.kind !== 'coordinator' && !e.departmentId && e.team.trim());
    for (const e of [...people].sort((a, b) => a.createdAt - b.createdAt)) {
      let dep = this.find(e.team);
      if (!dep) {
        dep = this.#d.store.create({ name: e.team.trim(), mission: `${e.team.trim()} ekibi (departmanlardan önceki ekipten); misyonunu departmentUpdate ile yaz.`, scope: '', template: null, headId: null });
        this.#emit(OWNER, 'created', dep);
      }
      const asHead = e.kind === 'lead' && !dep.headId;
      if (asHead) dep = this.#d.store.update(dep.id, { headId: e.id });
      this.#d.roster.update(e.id, { departmentId: dep.id, team: dep.name, kind: asHead ? 'lead' : 'member', reportsTo: asHead ? null : dep.headId });
      touched.add(dep.id);
    }
    for (const id of touched) {
      const head = this.get(id).headId;
      if (head) for (const m of this.members(id)) if (m.id !== head && m.reportsTo !== head) this.#d.roster.update(m.id, { reportsTo: head });
    }
    if (touched.size > 0) this.refreshDesks();
  }

  /** Every desk's department.md, written anew (cheap; read at the next session start). */
  refreshDesks(): void {
    const people = this.#d.roster.list();
    const open = this.list({ status: 'open' });
    for (const e of people) writeDepartmentFile(this.#d.dataDir, e.slug, departmentBlock(e, open, people));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #assertDirector(by: string): void {
    if (by === OWNER) return;
    if (this.#d.roster.get(by).kind !== 'coordinator') throw new ForbiddenError('Departmanları yalnız koordinatör ya da sahibi düzenler.');
  }

  #name(value: string | undefined, exceptId: string | null): string {
    const name = clean(value, 'Departman adı', 40, true);
    const clash = this.list({ status: 'open' }).find((d) => d.id !== exceptId && fold(d.name) === fold(name));
    if (clash) throw new ConflictError(`“${clash.name}” adında bir departman zaten var.`);
    if (this.#d.roster.list().some((e) => fold(e.name) === fold(name))) {
      throw new ConflictError(`“${name}” bir çalışanın adı; departmana başka bir ad ver (taskPass ve akış sahibinde ad tek anlamlı olmalı).`);
    }
    return name;
  }

  /** Someone at work who may be in a department (the coordinator never). */
  #candidate(id: string): Employee {
    const e = this.#d.roster.get(id);
    if (e.lifecycle === 'archived') throw new ConflictError(`${e.name} işten çıkarıldı.`);
    if (e.kind === 'coordinator') throw new ConflictError('Koordinatörün departmanı olmaz.');
    return e;
  }

  /** Puts someone in a department (or the centre) as its head or a member, keeping the invariants (spec §3). */
  #place(e: Employee, dep: Department | null, head: boolean): Employee {
    if (e.kind === 'coordinator') throw new ConflictError('Koordinatörün departmanı olmaz.');
    return this.#d.roster.update(e.id, { departmentId: dep?.id ?? null, team: dep?.name ?? '', kind: head ? 'lead' : 'member', reportsTo: !dep || head ? null : dep.headId });
  }

  /** A department lost its head: its members report to no one, the former head's proposals go up, its open streams go to the coordinator. */
  #headless(dep: Department, formerHead: string): void {
    for (const m of this.#d.roster.list()) if (m.reportsTo === formerHead && m.departmentId === dep.id) this.#d.roster.update(m.id, { reportsTo: null });
    this.#links?.headEnded(formerHead);
    const coordinator = this.#coordinator();
    const streams = (this.#links?.openStreams() ?? []).filter((x) => x.stream.owner === departmentOwner(dep.id));
    if (coordinator && streams.length > 0) {
      const list = streams.map((x) => `“${x.stream.title}” (plan “${x.plan.title}”, ${x.stream.id})`).join(', ');
      this.#d.notices.add(coordinator.id, 'stream.returned', `${dep.name} departmanının başkanı yok; açık akışları sende: ${list}. departmentUpdate ile başkan ata ya da akışları kendin yönet.`);
    }
  }

  /** One change, told: the department's event; each affected person's card, role event, notice and session restart; every desk's block. */
  #changed(by: string, change: DepartmentChange, dep: Department, told: Array<[string, string]>): void {
    this.#emit(by, change, dep);
    for (const [id, text] of told) {
      const e = this.#d.roster.get(id);
      writeRoleCard(this.#d.dataDir, e);
      this.#d.events.append(id, { type: 'role.changed', kind: e.kind, title: e.title, team: e.team });
      this.#d.notices.add(id, 'role.changed', text);
      this.#d.reload?.(id);
    }
    this.refreshDesks();
  }

  /** An info notice to everyone at work but the actor and those told already. */
  #announce(by: string, text: string, except: string[]): void {
    for (const e of this.#d.roster.list()) if (e.id !== by && !except.includes(e.id)) this.#d.notices.add(e.id, 'department.changed', text);
  }

  #emit(by: string, change: DepartmentChange, department: Department): void {
    this.#d.events.append(by === OWNER ? null : by, { type: 'department.changed', change, department });
  }

  #person(id: string): Employee | null {
    try {
      return this.#d.roster.get(id);
    } catch {
      return null;
    }
  }

  #coordinator(): Employee | null {
    return this.#d.roster.list().find((e) => e.kind === 'coordinator') ?? null;
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run test/departments.test.ts test/desk.test.ts`
Expected: PASS. If the first test's `changes()` differs (e.g. `['created', 'head', 'moved']`), check that `create` with a head emits `created` then `head`, and `move` emits `moved` — fix the code, not the expectation.

- [ ] **Step 7: Commit**

```bash
git add apps/office-server/src/company/departments.ts apps/office-server/src/company/notices.ts apps/office-server/src/desk.ts apps/office-server/test/departments.test.ts apps/office-server/test/desk.test.ts
git commit -m "feat(departments): the Departments service — heads, members, invariants, teams adopted, every desk's department.md"
```

---

### Task 7: The company with departments — hiring, managing, leads, letting go

**Files:**
- Modify: `apps/office-server/src/company/company.ts`, `apps/office-server/test/company-helpers.ts`
- Test: `apps/office-server/test/company-departments.test.ts`

**Interfaces:**
- Consumes: `Departments` (Task 6), `StreamNoteStore` (Task 5), `HireInput.departmentId/head` (Task 1).
- Produces:
  - `CompanyDeps.departments?: Departments`, `CompanyDeps.streamNotes?: StreamNoteStore`
  - `Company.assertManagesPerson(by: string, id: string): void` (owner and coordinator: anyone; a head: own department)
  - `Company.rerouteProposalsOf(id: string): void` (public wrapper of `#rerouteProposals`)
  - `Company.liveStreams(): Array<{ plan: Plan; stream: PlanStreamView }>`
  - `companyFor(s, f, characters?, now?, reload?, o?: { departments?: boolean })` returns also `departments: Departments | null`, `streamNotes: StreamNoteStore | null`.

- [ ] **Step 1: Wire departments into `companyFor`** (test helper; opt-in). In `test/company-helpers.ts` add the imports `import { DepartmentStore, StreamNoteStore } from '../src/company/department-store.ts';` and `import { Departments } from '../src/company/departments.ts';`, add a sixth parameter `o: { departments?: boolean } = {}`, and before `const company = new Company({…})`:

```ts
  // Departments (spec 2026-10-13-departments), wired like main.ts; opt-in so every older test keeps today's company.
  const streamNotes = o.departments ? new StreamNoteStore(s.db, now) : null;
  const departments = o.departments
    ? new Departments({ store: new DepartmentStore(s.db, now), roster: s.roster, events: s.events, notices, dataDir: s.dataDir, reload: (id) => { reloaded.push(id); reload?.(id); } })
    : null;
```

(move `const reloaded: string[] = [];` above this block). Pass `...(departments ? { departments, streamNotes: streamNotes! } : {})` into the `Company` deps, and after `company.attachKpis(kpis);`:

```ts
  departments?.attach({ openStreams: () => company.liveStreams(), headEnded: (id) => company.rerouteProposalsOf(id) });
```

Return `departments, streamNotes` in the object.

- [ ] **Step 2: Write the failing tests** — `test/company-departments.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(deskCount = 8) {
  const s = setup(deskCount);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder', 'designer', 'manager'], undefined, undefined, { departments: true });
  c.budget.setConstitution({ maxEmployees: deskCount });
  const coordinator = c.company.hireCoordinator('sonnet');
  return { ...s, ...c, departments: c.departments!, coordinator };
}

describe('Hiring into departments (spec §5.1, §5.2, §5.5)', () => {
  it('the coordinator hires into a department, as its head when asked; a template’s team joins an open department, never makes one', () => {
    const t = make();
    const sales = t.departments.create(OWNER, { template: 'satis' });
    const head = t.company.hire(t.coordinator.id, { name: 'Sena', template: 'satis-muduru', role: '', departmentId: sales.id, head: true });
    expect(t.roster.get(head.id)).toMatchObject({ kind: 'lead', departmentId: sales.id, team: 'Satış' });
    expect(t.departments.get(sales.id).headId).toBe(head.id);
    const asst = t.company.hire(t.coordinator.id, { name: 'Arda', template: 'satis-asistani', role: '' });
    expect(t.roster.get(asst.id)).toMatchObject({ departmentId: sales.id, team: 'Satış', reportsTo: head.id, kind: 'member' });
    const writer = t.company.hire(t.coordinator.id, { name: 'Ece', template: 'icerik-yazari', role: '' });
    expect(t.roster.get(writer.id)).toMatchObject({ team: '' });
    expect(t.roster.get(writer.id)).not.toHaveProperty('departmentId');
    expect(t.departments.list()).toHaveLength(1);
  });

  it('an explicit free-text team opens a headless custom department', () => {
    const t = make();
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'araştırmacı', team: 'Keşif' });
    const dep = t.departments.find('Keşif')!;
    expect(dep).toMatchObject({ headId: null, template: null });
    expect(t.roster.get(ada.id).departmentId).toBe(dep.id);
  });

  it('a head hires into their own department only, never a head; the coordinator hears of it', () => {
    const t = make();
    const mkt = t.departments.create(OWNER, { template: 'pazarlama' });
    const lead = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: mkt.id, head: true });
    const other = t.departments.create(OWNER, { name: 'Satış', mission: 'm' });
    const ece = t.company.hire(lead.id, { name: 'Ece', template: 'icerik-yazari', role: '' });
    expect(t.roster.get(ece.id)).toMatchObject({ departmentId: mkt.id, kind: 'member', reportsTo: lead.id });
    expect(t.notices.pending(t.coordinator.id).map((n) => n.text).join('\n')).toMatch(/Pelin Pazarlama departmanına Ece adlı çalışanı aldı/);
    expect(() => t.company.hire(lead.id, { name: 'Bora', role: 'r', departmentId: other.id })).toThrow(/Başkan yalnız kendi departmanına işe alır/);
    expect(() => t.company.hire(lead.id, { name: 'Bora', role: 'r', team: 'Satış' })).toThrow(/Başkan yalnız kendi departmanına işe alır/);
    expect(() => t.company.hire(lead.id, { name: 'Bora', role: 'r', head: true })).toThrow(/Başkan atamak koordinatörün işi/);
    expect(() => t.company.hire(ece.id, { name: 'Bora', role: 'r' })).toThrow(/Yalnız koordinatör bunu yapabilir/);
  });

  it('review focus 5: a head hiring into a full office is refused and nothing is written', () => {
    const t = make(3);
    const mkt = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    const lead = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: mkt.id, head: true });
    t.company.hire(lead.id, { name: 'Ece', role: 'r' });
    const before = t.roster.list().length;
    expect(() => t.company.hire(lead.id, { name: 'Bora', role: 'r' })).toThrow(/Anayasa en fazla 3 çalışan diyor/);
    expect(t.roster.list()).toHaveLength(before);
  });

  it('review focus 3: nobody is hired under a department’s name', () => {
    const t = make();
    t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    expect(() => t.company.hire(t.coordinator.id, { name: 'pazarlama', role: 'r' })).toThrow(/“Pazarlama” bir departmanın adı/);
  });
});

describe('A head manages their own department (spec §5.2)', () => {
  it('model, task assignment and the employee file: own department yes, another no; members never', () => {
    const t = make();
    const a = t.departments.create(OWNER, { name: 'A', mission: 'm' });
    const b = t.departments.create(OWNER, { name: 'B', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Hale', role: 'r', departmentId: a.id, head: true });
    const mine = t.company.hire(OWNER, { name: 'Mine', role: 'r', departmentId: a.id });
    const out = t.company.hire(OWNER, { name: 'Oya', role: 'r', departmentId: b.id });
    expect(t.company.setModel(head.id, mine.id, 'opus').model).toBe('opus');
    expect(() => t.company.setModel(head.id, out.id, 'opus')).toThrow(/yalnız kendi departmanındaki/);
    expect(() => t.company.setModel(mine.id, head.id, 'opus')).toThrow(/Yalnız koordinatör bunu yapabilir/);
    expect(() => t.company.assertManagesPerson(head.id, mine.id)).not.toThrow();
    expect(() => t.company.assertManagesPerson(head.id, out.id)).toThrow(/yalnız kendi departmanındaki/);
    const task = t.company.createTask(t.coordinator.id, { assignee: mine.id, title: 'İş' });
    expect(t.company.assign(head.id, task.id, head.id).assignee).toBe(head.id);
    expect(() => t.company.assign(head.id, task.id, out.id)).toThrow(/yalnız kendi departmanındaki/);
  });
});

describe('appointLead with departments (spec §5.1)', () => {
  it('makes the employee head of the department named by team (opening a custom one), ends it with lead: false; the old refusals stay', () => {
    const t = make();
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r' });
    t.company.appointLead(t.coordinator.id, ada.id, { team: 'İçerik' });
    const dep = t.departments.find('İçerik')!;
    expect(dep.headId).toBe(ada.id);
    expect(t.roster.get(ada.id)).toMatchObject({ kind: 'lead', team: 'İçerik', departmentId: dep.id });
    t.company.appointLead(t.coordinator.id, ada.id, { lead: false });
    expect(t.departments.get(dep.id).headId).toBeNull();
    expect(t.roster.get(ada.id)).toMatchObject({ kind: 'member', departmentId: dep.id });
    expect(() => t.company.appointLead(t.coordinator.id, t.coordinator.id, { team: 'x' })).toThrow(/Koordinatör ekip lideri yapılamaz/);
    const can = t.company.hire(t.coordinator.id, { name: 'Can', role: 'r' });
    expect(() => t.company.appointLead(t.coordinator.id, can.id, { team: '' })).toThrow(/ekibi olmalı/);
  });
});

describe('Letting a head go (review focus 2)', () => {
  it('the department becomes headless, its members report to no one, nobody is a lead without a department', () => {
    const t = make();
    const dep = t.departments.create(OWNER, { name: 'A', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Hale', role: 'r', departmentId: dep.id, head: true });
    const mine = t.company.hire(OWNER, { name: 'Mine', role: 'r', departmentId: dep.id });
    t.roster.update(head.id, { lifecycle: 'archived' });
    t.company.releaseTasksOf(head.id);
    expect(t.departments.get(dep.id).headId).toBeNull();
    expect(t.roster.get(mine.id).reportsTo).toBeNull();
    expect(t.roster.list().filter((e) => e.kind === 'lead')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `pnpm vitest run test/company-departments.test.ts`
Expected: FAIL — `companyFor` has no departments / `hire` ignores `departmentId`.

- [ ] **Step 4: Implement in `src/company/company.ts`**

Imports: add `ownerDepartment, type Department, type PlanStream` to the `@cc/shared` imports, `import type { Departments } from './departments.ts';`, `import type { StreamNoteStore } from './department-store.ts';`, and `fold` to the `./text.ts` import.

`CompanyDeps` — add:

```ts
  /** The departments (spec 2026-10-13-departments; absent: an office without them, as before). */
  departments?: Departments;
  /** The heads' plans of and reports on plan streams (absent: none). */
  streamNotes?: StreamNoteStore;
```

Replace `hire()` with:

```ts
  hire(by: string, input: HireInput, o: { deny?: string[] } = {}): Employee {
    const deps = this.#d.departments;
    // A head hires into their own department (spec departments §5.2); anyone else but the owner must coordinate.
    const heads = by !== OWNER && deps && this.#d.roster.get(by).kind === 'lead' ? deps.headOf(by) : null;
    if (by !== OWNER && !heads) this.#assertCoordinator(by);
    const template = input.template === undefined || input.template === null || input.template === '' ? null : roleTemplate(input.template);
    const capabilities = input.capabilities === undefined || input.capabilities === null ? (template?.capabilities ?? []) : capabilityIds(input.capabilities, 'Yetenekler');
    const resolved: NewEmployee = template
      ? {
          ...input,
          role: templateRole(template, typeof input.role === 'string' ? input.role : undefined),
          title: input.title?.trim() ? input.title : template.title,
          team: input.team?.trim() ? input.team : template.team,
          model: input.model ?? template.model,
          templateRef: { id: template.id, version: template.version },
          capabilityIds: capabilities,
        }
      : { ...input, templateRef: null, capabilityIds: capabilities };
    const characters = this.#d.characters();
    const characterId = input.characterId && characters.includes(input.characterId) ? input.characterId : this.#leastUsedCharacter(characters);
    if (deps) deps.assertFreeName(typeof input.name === 'string' ? input.name : '');
    const department = deps ? this.#hireDepartment(by, heads, input, template?.team) : null;
    const lead = !deps && resolved.team ? this.#d.roster.list().find((e) => e.kind === 'lead' && e.team === resolved.team?.trim()) : undefined;
    this.#assertRoom();
    const placement = deps ? { team: department?.name ?? '', departmentId: department?.id ?? null, reportsTo: department?.headId ?? null } : { reportsTo: lead?.id ?? input.reportsTo ?? null };
    const hired = this.#d.hire({ ...resolved, ...placement, kind: 'member', characterId, ...(o.deny?.length ? { deskDeny: o.deny } : {}) });
    if (!deps) return hired;
    if (department && input.head) deps.setHead(by, department.id, hired.id);
    else deps.refreshDesks();
    if (heads) this.#tellCoordinator(by, 'department.changed', `${this.nameOf(by)} ${heads.name} departmanına ${hired.name} adlı çalışanı aldı${hired.title ? ` (${hired.title})` : ''}.`);
    return this.#d.roster.get(hired.id);
  }

  /** Where a hire goes (spec §5.5): a head's own department; the one given; a free-text team's (opened if need be); a template's team only if open. */
  #hireDepartment(by: string, heads: Department | null, input: HireInput, templateTeam: string | undefined): Department | null {
    const deps = this.#d.departments!;
    if (heads) {
      if (input.head) throw new ForbiddenError('Başkan atamak koordinatörün işi; sen kendi departmanına üye alırsın.');
      const elsewhere = (input.departmentId && input.departmentId !== heads.id) || (input.team?.trim() && fold(input.team) !== fold(heads.name));
      if (elsewhere) throw new ForbiddenError(`Başkan yalnız kendi departmanına işe alır (${heads.name}).`);
      return heads;
    }
    if (input.departmentId) return deps.open(input.departmentId);
    if (input.team?.trim()) return deps.forTeam(by, input.team, { create: true });
    const joined = templateTeam ? deps.forTeam(by, templateTeam, { create: false }) : null;
    if (!joined && input.head) throw new ValidationError('Başkan olarak almak için departmanı ver (departmentId ya da team).');
    return joined;
  }
```

`NewEmployee` must carry `departmentId`; it already extends `HireInput` (Task 1). Check `Engine.hire` passes the whole input to `roster.create` (it does: `roster.create(input)`); if it picks fields, add `departmentId`.

Replace `setModel`'s first line `if (by !== OWNER) this.#assertCoordinator(by);` with `if (by !== OWNER) this.#assertManages(by, id);`.

Replace `#assertManages` with:

```ts
  /** The coordinator manages everyone; a head their own department (spec departments §5.2), a lead without departments their team (§3.1). */
  #assertManages(by: string, ...ids: string[]): void {
    const me = this.#d.roster.get(by);
    if (me.kind === 'coordinator') return;
    const deps = this.#d.departments;
    if (me.kind === 'lead' && deps) {
      const mine = deps.headOf(by);
      if (mine && ids.every((id) => id === by || this.#person(id)?.departmentId === mine.id)) return;
      throw new ForbiddenError('Departman başkanı yalnız kendi departmanındaki işleri ve kişileri yönetir.');
    }
    if (me.kind === 'lead' && me.team && ids.every((id) => id === by || this.#person(id)?.team === me.team)) return;
    throw new ForbiddenError(me.kind === 'lead' ? 'Ekip lideri yalnız kendi ekibindeki işleri dağıtır.' : 'Yalnız koordinatör bunu yapabilir.');
  }

  /** For the tools (setModel, sleep, wake, employeeNote): the owner and the coordinator anyone, a head their own department. */
  assertManagesPerson(by: string, id: string): void {
    if (by !== OWNER) this.#assertManages(by, id);
  }

  /** Someone stopped deciding proposals (a head no more): theirs go to the coordinator. */
  rerouteProposalsOf(id: string): void {
    this.#rerouteProposals(id);
  }

  /** Every not-done stream of a running plan, with its plan (the departments: what a headless one leaves). */
  liveStreams(): Array<{ plan: Plan; stream: PlanStreamView }> {
    const live = this.#d.plans.list().filter((p) => p.status === 'approved');
    const views = this.streamsOf(live);
    return live.flatMap((plan) => (views.get(plan.id) ?? []).filter((s) => s.status !== 'done').map((stream) => ({ plan, stream })));
  }
```

In `appointLead`, right after `this.#assertCoordinator(by);`, insert:

```ts
    const deps = this.#d.departments;
    if (deps) {
      // With departments, a lead is a department's head (spec §5.1): the team names the department.
      const target = this.#d.roster.get(id);
      if (target.lifecycle === 'archived') throw new ConflictError(`${target.name} işten çıkarıldı.`);
      if (target.kind === 'coordinator') throw new ConflictError('Koordinatör ekip lideri yapılamaz.');
      if (o.lead === false) {
        const headed = deps.headOf(id);
        if (headed) deps.setHead(by, headed.id, null);
        return this.#d.roster.get(id);
      }
      const team = o.team === undefined ? target.team : clean(o.team, 'Ekip adı', 40, false);
      if (!team) throw new ValidationError('Ekip liderinin bir ekibi olmalı (team).');
      deps.setHead(by, deps.forTeam(by, team, { create: true })!.id, id);
      return this.#d.roster.get(id);
    }
```

In `releaseTasksOf(id)`, as its first line: `this.#d.departments?.left(id);`.

- [ ] **Step 5: Run the new and the related tests**

Run: `pnpm vitest run test/company-departments.test.ts test/company.test.ts test/proposals.test.ts test/role-templates.test.ts test/dispatcher.test.ts`
Expected: PASS (the older tests run without departments and keep today's behaviour).

- [ ] **Step 6: Run the whole server suite**

Run: `pnpm vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/office-server/src/company/company.ts apps/office-server/test/company-helpers.ts apps/office-server/test/company-departments.test.ts
git commit -m "feat(departments): hiring into departments, a head hires and manages their own room, appointLead names a department's head, a head let go leaves it headless"
```

---

### Task 8: Plan streams owned by departments — assignment, done, plans and reports

**Files:**
- Modify: `apps/office-server/src/company/streams.ts`, `apps/office-server/src/company/company.ts`
- Test: `apps/office-server/test/stream-delegation.test.ts`

**Interfaces:**
- Consumes: Task 6 and 7.
- Produces:
  - `checkStreams(value, person, department?: (who: string) => Department | null)` — owner `departman: <ad|id>` or a plain department name → `departman:<id>`.
  - `Company.streamPlan(by, planId, streamId, text): StreamNote`, `Company.streamReport(by, planId, streamId, r: { summary: string; evidence?: string[]; next?: string }): StreamNote`, `Company.streamNotes(planId): Array<{ streamId: string; plan: StreamNote | null; report: StreamNote | null }>`
  - notices `stream.assigned` (plan start / approval / revision), `stream.done` (stream finished).

- [ ] **Step 1: Write the failing tests** — `test/stream-delegation.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(autonomy: 'free' | 'plans' = 'free') {
  const s = setup(12);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder', 'designer', 'manager'], undefined, undefined, { departments: true });
  c.budget.setConstitution({ autonomy, maxEmployees: 12 });
  const coordinator = c.company.hireCoordinator('sonnet');
  const departments = c.departments!;
  const yaz = departments.create(OWNER, { template: 'yazilim-otomasyon' });
  const pzr = departments.create(OWNER, { template: 'pazarlama' });
  const selin = c.company.hire(OWNER, { name: 'Selin', role: 'r', departmentId: yaz.id, head: true });
  const mert = c.company.hire(OWNER, { name: 'Mert', role: 'r', departmentId: yaz.id });
  const deniz = c.company.hire(OWNER, { name: 'Deniz', role: 'r', departmentId: pzr.id });
  const said = (id: string) => c.notices.pending(id).map((n) => `${n.topic}: ${n.text}`).join('\n');
  return { ...s, ...c, departments, coordinator, yaz, pzr, selin, mert, deniz, said };
}

const DRAFT = { title: 'Site', goal: 'Yeni site', approach: 'a', method: { ...METHOD, checks: ['Testler geçiyor'] }, usd: 50 };

describe('A department owns a stream (spec §6.1)', () => {
  it('“departman: <ad>” and a plain department name both store departman:<id>; an unknown one is refused', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, {
      ...DRAFT,
      streams: [{ id: 'api', title: 'API', owner: 'departman: yazılım ve otomasyon' }, { id: 'tanitim', title: 'Tanıtım', owner: 'Pazarlama', dependsOn: ['api'] }],
    });
    expect(plan.streams!.map((s) => s.owner)).toEqual([`departman:${t.yaz.id}`, `departman:${t.pzr.id}`]);
    expect(() => t.company.propose(t.coordinator.id, { ...DRAFT, streams: [{ id: 'x', title: 'X', owner: 'departman: Satış' }] })).toThrow(/“x” akışının sahibi departman bulunamadı: Satış\. Açık departmanlar: Yazılım ve Otomasyon, Pazarlama/);
  });
});

describe('Handing streams over (spec §6.2)', () => {
  it('a plan that starts tells each department’s head its stream once; a headless department gets nothing; a revision tells only the new owners', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, {
      ...DRAFT,
      streams: [{ id: 'api', title: 'API', owner: 'Yazılım ve Otomasyon' }, { id: 'tanitim', title: 'Tanıtım', owner: 'Pazarlama', dependsOn: ['api'] }],
    });
    expect(t.said(t.selin.id)).toMatch(/stream.assigned: “Site” planının “API” akışı \(api\) Yazılım ve Otomasyon departmanının: hedef Yeni site\. Planın kalite kontrolleri: Testler geçiyor\. Planın tahmini: \$50\. streamPlan ile/);
    expect(t.said(t.deniz.id)).not.toMatch(/stream.assigned/);
    const before = t.notices.pending(t.selin.id).length;
    t.company.revise(t.coordinator.id, plan.id, { streams: [{ id: 'api', title: 'API v2', owner: 'Yazılım ve Otomasyon' }, { id: 'tanitim', title: 'Tanıtım', owner: 'Selin', dependsOn: ['api'] }] });
    expect(t.notices.pending(t.selin.id).length).toBe(before);
  });

  it('under the owner’s approval the head hears at approval, not at the proposal', () => {
    const t = make('plans');
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [{ id: 'api', title: 'API', owner: 'Yazılım ve Otomasyon' }] });
    expect(t.said(t.selin.id)).not.toMatch(/stream.assigned/);
    t.company.approve(plan.id);
    expect(t.said(t.selin.id)).toMatch(/stream.assigned: “Site” planının “API” akışı/);
  });

  it('the stream’s last task closing tells the head to report; the head plans and reports, the coordinator hears; others may not', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [{ id: 'api', title: 'API', owner: 'Yazılım ve Otomasyon' }] });
    const note = t.company.streamPlan(t.selin.id, plan.id, 'api', 'Önce uç noktalar, sonra testler.');
    expect(note).toMatchObject({ kind: 'plan', text: 'Önce uç noktalar, sonra testler.', by: t.selin.id });
    const task = t.company.createTask(t.selin.id, { assignee: t.mert.id, title: 'Uç noktalar', planId: plan.id, streamId: 'api' });
    t.company.start(task.id);
    t.company.finish(t.mert.id, task.id, { summary: 'bitti', outputs: [], learned: '' } as never);
    expect(t.said(t.selin.id)).toMatch(/stream.done: “Site” planının “API” akışının açık görevi kalmadı\. streamReport ile/);
    const report = t.company.streamReport(t.selin.id, plan.id, 'api', { summary: 'Uç noktalar hazır.', evidence: ['pnpm test geçti'], next: 'Tanıtım' });
    expect(report).toMatchObject({ kind: 'report', evidence: ['pnpm test geçti'], next: 'Tanıtım' });
    expect(t.said(t.coordinator.id)).toMatch(/stream.report: Selin “Site” planının “API” akışını raporladı: Uç noktalar hazır\. Sırada: Tanıtım/);
    expect(t.company.streamNotes(plan.id)).toEqual([{ streamId: 'api', plan: note, report }]);
    expect(() => t.company.streamPlan(t.deniz.id, plan.id, 'api', 'x')).toThrow(/Bu akış senin departmanının değil/);
    expect(() => t.company.streamPlan(t.mert.id, plan.id, 'api', 'x')).toThrow(/Bu akış senin departmanının değil/);
    expect(t.company.streamPlan(t.coordinator.id, plan.id, 'api', 'koordinatör notu').by).toBe(t.coordinator.id);
    expect(() => t.company.streamPlan(t.selin.id, plan.id, 'yok', 'x')).toThrow(/“Site” planında “yok” akışı yok/);
  });

  it('a headless department’s stream: done goes to the coordinator; losing the head sends stream.returned', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [{ id: 'tanitim', title: 'Tanıtım', owner: 'Pazarlama' }, { id: 'api', title: 'API', owner: 'Yazılım ve Otomasyon' }] });
    t.departments.setHead(OWNER, t.yaz.id, null);
    expect(t.said(t.coordinator.id)).toMatch(/stream.returned: Yazılım ve Otomasyon departmanının başkanı yok; açık akışları sende: “API” \(plan “Site”, api\)/);
    const task = t.company.createTask(t.coordinator.id, { assignee: t.deniz.id, title: 'Duyuru', planId: plan.id, streamId: 'tanitim' });
    t.company.start(task.id);
    t.company.finish(t.deniz.id, task.id, { summary: 'bitti', outputs: [], learned: '' } as never);
    expect(t.said(t.coordinator.id)).toMatch(/stream.done: “Site” planının “Tanıtım” akışının açık görevi kalmadı/);
  });
});
```

(If `finish` needs evidence for each done item in this codebase, pass the minimal result the other tests in `test/company.test.ts` pass — copy it from there.)

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run test/stream-delegation.test.ts`
Expected: FAIL — `departman:` owners are refused (“akışının sahibi bulunamadı”).

- [ ] **Step 3: Extend `checkStreams` in `src/company/streams.ts`**

Change the imports to `import { STREAM_TO_DEPARTMENT, STREAM_TO_HIRE, departmentOwner, type Department, type Employee, type PlanStream } from '@cc/shared';`, extend `OWNER_HELP` to `'ofisteki bir çalışanın adı ya da kimliği (officeStatus), bir departman (“departman: <ad>”, departmentsRead) ya da işe alınacaksa “alınacak: <rol>”'`, give `checkStreams` a third parameter `department: (who: string) => Department | null = () => null` passed on to `ownerOf`, and replace `ownerOf` with:

```ts
/** `alınacak: <rol>` in one spelling, `departman:<id>` for a department (by “departman: <ad>” or its plain name), or the id of the person named. */
function ownerOf(id: string, given: string, person: (who: string) => Employee | null, department: (who: string) => Department | null): string {
  const text = given.trim();
  if (!text) throw new ValidationError(`“${id}” akışının sahibi (owner) boş olamaz: ${OWNER_HELP}.`);
  const colon = text.indexOf(':');
  const prefix = colon >= 0 ? fold(text.slice(0, colon).trim()) : '';
  if (prefix === fold(STREAM_TO_HIRE)) {
    const role = clean(text.slice(colon + 1).replace(/\s+/g, ' '), `“${id}” akışının alınacak rolü`, 80, false);
    if (!role) throw new ValidationError(`“${id}” akışının sahibi alınacak biriyse rolünü de yaz: “alınacak: <rol>”.`);
    return `${STREAM_TO_HIRE}: ${role}`;
  }
  if (prefix === fold(STREAM_TO_DEPARTMENT)) {
    const name = text.slice(colon + 1).trim();
    const dep = department(name);
    if (!dep) throw new ValidationError(`“${id}” akışının sahibi departman bulunamadı: ${name}. ${openList(department)}`);
    return departmentOwner(dep.id);
  }
  const found = person(text);
  if (!found) {
    // A department by its plain name (no one is named like a department).
    const dep = department(text);
    if (dep) return departmentOwner(dep.id);
    throw new ValidationError(`“${id}” akışının sahibi bulunamadı: ${text}. Sahip ${OWNER_HELP} olmalı.`);
  }
  if (found.lifecycle === 'archived') throw new ValidationError(`“${id}” akışının sahibi ${found.name} işten ayrıldı; akışa yeni bir sahip ver: ${OWNER_HELP}.`);
  return found.id;
}
```

The open-department list needs the departments themselves; pass a fourth optional parameter `openDepartments: () => Department[] = () => []` to `checkStreams` and use:

```ts
const openList = (open: () => Department[]) => {
  const names = open().map((d) => d.name);
  return names.length ? `Açık departmanlar: ${names.join(', ')}.` : 'Açık departman yok.';
};
```

(call it as `openList(openDepartments)` in `ownerOf`; thread `openDepartments` through like `department`).

In `company.ts`, `#streams(value)` becomes:

```ts
    const deps = this.#d.departments;
    return checkStreams(value, (who) => this.#d.roster.byIdOrName(who) ?? this.#person(who), (who) => deps?.find(who) ?? null, () => deps?.list({ status: 'open' }) ?? []);
```

- [ ] **Step 4: Assignment and done notices in `company.ts`**

Add the private method:

```ts
  /** Each department's head hears of a stream that is newly theirs in a running plan (spec departments §6.2); `before`: the streams as they were (null: the plan just started). */
  #assignStreams(plan: Plan, before: readonly PlanStream[] | null): void {
    const deps = this.#d.departments;
    if (!deps || plan.status !== 'approved') return;
    for (const s of this.streamsOf([plan]).get(plan.id) ?? []) {
      const depId = ownerDepartment(s.owner);
      if (!depId || s.status === 'done') continue;
      if (before?.some((b) => b.id === s.id && b.owner === s.owner)) continue;
      const dep = deps.get(depId);
      if (!dep.headId) continue;
      const checks = plan.method?.checks?.length ? ` Planın kalite kontrolleri: ${plan.method.checks.join('; ')}.` : '';
      const estimate = [plan.quotaPct !== null ? `kota %${plan.quotaPct}` : '', plan.usd !== null ? `$${plan.usd}` : '', plan.days !== null ? `${plan.days} gün` : ''].filter(Boolean).join(', ');
      const waits = s.dependsOn.length ? ` Önce şu akışların bitmesini bekler: ${s.dependsOn.join(', ')}.` : '';
      this.#d.notices.add(
        dep.headId,
        'stream.assigned',
        `“${plan.title}” planının “${s.title}” akışı (${s.id}) ${dep.name} departmanının: hedef ${plan.goal}.${checks}${estimate ? ` Planın tahmini: ${estimate}.` : ''}${waits} streamPlan ile akışını planla (planId ${plan.id}, streamId ${s.id}), görevleri taskCreate ile planId ve streamId vererek aç ve odana dağıt; bitince streamReport ile raporla.`,
      );
    }
  }

  /** A department's stream whose last open task just closed: its head (or the coordinator) reports it (spec §6.2 step 5). */
  #streamMaybeDone(task: Task): void {
    const deps = this.#d.departments;
    if (!deps || !task.planId || !task.streamId) return;
    const plan = this.#d.plans.get(task.planId);
    const stream = (this.streamsOf([plan]).get(plan.id) ?? []).find((s) => s.id === task.streamId);
    const depId = stream ? ownerDepartment(stream.owner) : null;
    if (!stream || !depId || stream.status !== 'done') return;
    const to = deps.responsible(depId);
    if (to) this.#d.notices.add(to.id, 'stream.done', `“${plan.title}” planının “${stream.title}” akışının açık görevi kalmadı. streamReport ile koordinatöre raporla: ne yapıldı, kanıtı ne, sırada ne var (planId ${plan.id}, streamId ${stream.id}).`);
  }
```

Call sites:
- `propose`: after `this.#emit(by, { type: 'plan.changed', change: 'approved', plan: started });` add `this.#assignStreams(started, null);`.
- `revise`, free branch: after `this.#emit(by, { type: 'plan.changed', change: 'revised', plan });` add `this.#assignStreams(plan, current.streams ?? []);`.
- `approve`: before `this.#d.plans.update(planId, …)` read `const before = this.#d.plans.approvedSnapshot(planId)?.streams ?? null;`; after the `plan.changed` emit add `this.#assignStreams(plan, before);`.
- `#complete(...)`: right before `if (task.planId) this.#maybeFinishPlan(task.planId);` add `this.#streamMaybeDone(next);` (`next` is the task as written done). A review's own task is closed before `#complete` runs (see `reviewDecide`), so a reviewed stream counts as done there too.

- [ ] **Step 5: Stream plans, reports and notes in `company.ts`**

```ts
  // ── streams of departments ───────────────────────────────────────────────

  /** A head's plan of their department's stream (spec §5.2): a new note each time, the latest shown. */
  streamPlan(by: string, planId: string, streamId: string, text: string): StreamNote {
    const { plan, stream } = this.#streamFor(by, planId, streamId);
    const note = this.#notes().add({ planId: plan.id, streamId: stream.id, kind: 'plan', text: clean(text, 'Akış planı', 6000, true), evidence: [], next: null, by });
    this.#emit(by, { type: 'stream.noted', note });
    return note;
  }

  streamReport(by: string, planId: string, streamId: string, r: { summary: string; evidence?: string[]; next?: string }): StreamNote {
    const { plan, stream } = this.#streamFor(by, planId, streamId);
    const note = this.#notes().add({
      planId: plan.id, streamId: stream.id, kind: 'report', text: clean(r.summary, 'Rapor', 4000, true), evidence: lines(r.evidence, 'Kanıt', 12, 600),
      next: clean(r.next, 'Sırada', 1000, false) || null, by,
    });
    this.#emit(by, { type: 'stream.noted', note });
    this.#tellCoordinator(by, 'stream.report', `${this.nameOf(by)} “${plan.title}” planının “${stream.title}” akışını raporladı: ${note.text}${note.next ? ` Sırada: ${note.next}` : ''}`);
    return note;
  }

  /** The latest plan and report of each of a plan's streams (plan card, board, departmentsRead). */
  streamNotes(planId: string): Array<{ streamId: string; plan: StreamNote | null; report: StreamNote | null }> {
    const plan = this.#d.plans.get(planId);
    const notes = this.#d.streamNotes;
    return (plan.streams ?? []).map((s) => ({ streamId: s.id, plan: notes?.latest(plan.id, s.id, 'plan') ?? null, report: notes?.latest(plan.id, s.id, 'report') ?? null }));
  }

  /** The stream, if `by` may write on it: the coordinator any, a head their department's. */
  #streamFor(by: string, planId: string, streamId: string): { plan: Plan; stream: PlanStream } {
    const plan = this.#d.plans.get(planId);
    if (plan.status !== 'approved' && plan.status !== 'done') throw new ConflictError(`“${plan.title}” planı sürmüyor; akış notu yalnız süren ya da bitmiş plana yazılır.`);
    const stream = (plan.streams ?? []).find((s) => s.id === streamId);
    if (!stream) throw new ValidationError(`“${plan.title}” planında “${streamId}” akışı yok.`);
    if (this.#d.roster.get(by).kind === 'coordinator') return { plan, stream };
    const depId = ownerDepartment(stream.owner);
    if (!depId || this.#d.departments?.headOf(by)?.id !== depId) throw new ForbiddenError('Bu akış senin departmanının değil; akış notunu akışın departmanının başkanı ya da koordinatör yazar.');
    return { plan, stream };
  }

  #notes(): StreamNoteStore {
    if (!this.#d.streamNotes) throw new ConflictError('Bu ofiste akış notları açık değil.');
    return this.#d.streamNotes;
  }
```

(add `type StreamNote` to the `@cc/shared` imports.)

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run test/stream-delegation.test.ts test/plan-streams.test.ts test/streams.test.ts test/company-departments.test.ts`
Expected: PASS. `plan-streams.test.ts`'s “akışının sahibi bulunamadı: Zeynep” still matches.

- [ ] **Step 7: Whole suite, then commit**

Run: `pnpm vitest run` — Expected: PASS.

```bash
git add apps/office-server/src/company/streams.ts apps/office-server/src/company/company.ts apps/office-server/test/stream-delegation.test.ts
git commit -m "feat(departments): a department owns a plan stream — its head hears when it is theirs and when it is done, plans and reports it"
```

---

### Task 9: The guides — head, coordinator, members

**Files:**
- Modify: `apps/office-server/src/company/roles.ts`
- Test: `apps/office-server/test/desk.test.ts` (the guide assertions), `apps/office-server/test/craft.test.ts` if it pins guide text

**Interfaces:**
- Produces: guide texts naming the new tools (`departmentsRead`, `departmentTemplates`, `departmentCreate`, `departmentUpdate`, `departmentMove`, `departmentClose`, `streamPlan`, `streamReport`) that Task 10 adds.

- [ ] **Step 1: Update the guide test first** — in `test/desk.test.ts`, the lines that expect the lead guide to contain `'İşe alamazsın'` (around line 68) become:

```ts
    expect(lead).toContain('Departman başkanısın');
    expect(lead).toContain('streamPlan');
    expect(lead).toContain('kendi departmanına işe alırsın');
    expect(lead).not.toContain('İşe alamazsın');
```

and add to the coordinator guide assertions (find where the coordinator's guide is read in that file):

```ts
    expect(coordinatorGuide).toContain('departmentCreate');
    expect(coordinatorGuide).toContain('departman: <ad>');
    expect(coordinatorGuide).not.toContain('4–5 kişiyi geçince');
```

and to the member guide: `expect(member).toContain('departmentsRead');`. (Use the variable names the file already uses.)

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run test/desk.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the texts in `src/company/roles.ts`**

In `MEMBER`, after the `askColleague` bullet add:

```
- Bir departmandaysan departmanın, başkanın ve öteki departmanlar masandaki "Departmanın" bölümünde yazar; güncelini
  \`departmentsRead\` gösterir. Başka bir departmanın işi çıkarsa \`taskPass\` ile \`to\` alanına departmanın adını yaz:
  iş başkanına gider.
```

Replace `LEAD` with:

```ts
const LEAD = `- Departman başkanısın: departmanının işini sen yönetirsin. Sana verilen akışı \`streamPlan\` ile planlar (yaklaşım, görevler,
  bağımlılıklar, riskler), görevleri \`taskCreate\` ile planId ve streamId vererek açar, \`taskAssign\` ve \`taskReprioritize\` ile
  dağıtır, sıralarsın. Akış bitince \`streamReport\` ile koordinatöre raporlarsın: ne yapıldı, kanıtı ne, sırada ne var.
- Odanın kalite kapısısın: odadaki işi yapan değil inceleyen sensin; tek başınayken incelemeni koordinatör yapar.
- Bir yöntem netleşince ya da değişince \`playbookUpdate\` ile el kitabına yaz (konu, metin, neden). Önemli bir seçim
  yapınca \`decisionRecord\` ile kaydet: ne seçildi, neden, hangi alternatifler vardı.`;
```

Replace `LEAD_ONLY` with:

```ts
/** Only for heads: the coordinator decides proposals, hires and opens departments itself (its own block says so). */
const LEAD_ONLY = `- Gerekirse kendi departmanına işe alırsın (\`hire\`; şablonların \`roleTemplates\`, departmanının önerdiği roller
  \`departmentTemplates\`): ikinci ve üçüncü kişiyi bir ihtiyaç doğunca al, boş masa var diye değil. Başka departmana işe alamaz,
  başkan atayamaz, departman açamazsın; gerekirse koordinatörden iste.
- Departmanındakilerin modelini \`setModel\` ile değiştirir, uzun boşta kalanları \`sleep\` ile uyutur, \`wake\` ile uyandırırsın;
  gözlemlerini \`employeeNote\` ile çalışan dosyasına yazarsın.
- Departmanından gelen önerileri \`proposalsOpen\` ile gör, \`proposalDecide\` ile karara bağla (accept / decline; büyükse
  escalate ile koordinatöre). Çözemediğin bir sorunu (başka departmanın önceliği, bütçe, kapsam) \`propose\` ile koordinatöre taşı.`;
```

In `COORDINATOR`, replace the bullet that starts with `- Bir ekip 4–5 kişiyi geçince` with:

```
- İş departmanlara devredilir: plan kartında işi akışlara böl ve her akışın sahibi olarak bir departman ver
  (owner: "departman: <ad>"); akış başlayınca başkanına haber gider, başkan akışını kendisi planlar, yönetir ve raporlar.
  Departmanları \`departmentsRead\` gösterir; yeni departman açmadan önce \`departmentTemplates\` ile şablonlara bak,
  \`departmentCreate\` ile aç (şablondan ya da özel), \`departmentUpdate\` ile başkan ata, \`departmentMove\` ile kişileri taşı,
  \`departmentClose\` ile kapat. En fazla 6 departman açık olabilir. Başkansız bir departmanın akışını sen yönetirsin.
```

In `officeGuide`, the coordinator's base keeps `LEAD.replace('Departman başkanısın', 'Departman başkanı gibi de çalışırsın')` (update the string the `replace` looks for).

- [ ] **Step 4: Run the guide tests and the craft tests**

Run: `pnpm vitest run test/desk.test.ts test/craft.test.ts`
Expected: PASS (fix any other assertion that pinned the old lead text to the new one).

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/roles.ts apps/office-server/test
git commit -m "feat(departments): the guides — a head runs their stream and room, the coordinator hands streams to departments, members pass work to a department"
```

---

### Task 10: The office tools

**Files:**
- Modify: `apps/office-server/src/mcp/tools.ts`
- Test: `apps/office-server/test/mcp-departments.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 6, 7, 8.
- Produces: `officeTools({ …, departments?: Departments })`; tools `departmentsRead` (everyone), `departmentTemplates` (leads), `departmentCreate`, `departmentUpdate`, `departmentMove`, `departmentClose` (coordinator), `streamPlan`, `streamReport` (leads); `hire` for leads with `department` and `head`; `setModel`, `sleep`, `wake`, `employeeNote` for leads (own department); `taskPass` to a department; `taskCreate` lead check by department.

- [ ] **Step 1: Write the failing tests** — `test/mcp-departments.test.ts`. Follow how `test/mcp-tools.test.ts` builds the tools and calls one (read its first 60 lines: it builds `officeTools({...})` over `companyFor` and calls `tool.run({ employee }, args)`); build them the same way with `departments: c.departments!`. The cases:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee } from '@cc/shared';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup(12);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder', 'designer', 'manager'], undefined, undefined, { departments: true });
  c.budget.setConstitution({ maxEmployees: 12 });
  const coordinator = c.company.hireCoordinator('sonnet');
  const tools = officeTools({
    company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget,
    engine: { sleep: async () => undefined, wake: () => undefined, sideQuestion: async () => ({ ok: true, answer: '' }) },
    plans: () => c.plans.list(), agenda: { text: () => '' }, departments: c.departments!,
  });
  const call = async (who: Employee, name: string, args: Record<string, unknown>) => {
    const tool = tools.find((x) => x.name === name)!;
    if (!tool.kinds.includes(s.roster.get(who.id).kind)) throw new Error(`${name} not offered to ${who.kind}`);
    return String(await tool.run({ employee: s.roster.get(who.id) } as never, args));
  };
  return { ...s, ...c, departments: c.departments!, coordinator, tools, call };
}

describe('Department tools (spec §5)', () => {
  it('the coordinator opens from a template with a head, lists, updates, moves and closes', async () => {
    const t = make();
    const selin = t.company.hire(t.coordinator.id, { name: 'Selin', role: 'r' });
    const mert = t.company.hire(t.coordinator.id, { name: 'Mert', role: 'r' });
    expect(await t.call(t.coordinator, 'departmentTemplates', {})).toMatch(/yazilim-otomasyon — Yazılım ve Otomasyon: Şirketin ihtiyaç duyduğu yazılımı/);
    expect(await t.call(t.coordinator, 'departmentCreate', { template: 'yazilim-otomasyon', head: 'Selin' })).toMatch(/Yazılım ve Otomasyon departmanı açıldı; başkanı Selin/);
    expect(await t.call(t.coordinator, 'departmentMove', { employee: 'Mert', department: 'yazılım ve otomasyon' })).toMatch(/Mert artık Yazılım ve Otomasyon departmanında/);
    const list = await t.call(mert, 'departmentsRead', {});
    expect(list).toMatch(/Departmanlar \(1\/6\)/);
    expect(list).toMatch(/• Yazılım ve Otomasyon — başkan Selin · 2 kişi · şablon yazilim-otomasyon \(sürüm 1\)/);
    expect(await t.call(mert, 'departmentsRead', { department: 'Yazılım ve Otomasyon' })).toMatch(/### Yapmaz/);
    expect(await t.call(t.coordinator, 'departmentUpdate', { department: 'Yazılım ve Otomasyon', head: 'Mert' })).toMatch(/başkanı artık Mert/);
    expect(await t.call(t.coordinator, 'departmentMove', { employee: 'Selin' })).toMatch(/Selin artık merkezde/);
    expect(await t.call(t.coordinator, 'departmentClose', { department: 'Yazılım ve Otomasyon', reason: 'deneme' })).toMatch(/kapandı/);
    expect(t.roster.get(selin.id)).not.toHaveProperty('departmentId');
  });

  it('a head: hire, setModel, sleep, wake, employeeNote in their own department; refused elsewhere', async () => {
    const t = make();
    const a = t.departments.create(OWNER, { template: 'pazarlama' });
    const b = t.departments.create(OWNER, { name: 'Satış', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: a.id, head: true });
    const out = t.company.hire(OWNER, { name: 'Oya', role: 'r', departmentId: b.id });
    expect(await t.call(head, 'hire', { name: 'Ece', template: 'icerik-yazari' })).toMatch(/İşe alındı: Ece .* Pazarlama departmanı/);
    expect(await t.call(head, 'setModel', { employee: 'Ece', model: 'opus' })).toMatch(/Ece artık opus/);
    expect(await t.call(head, 'employeeNote', { employee: 'Ece', text: 'Görselde iyi.' })).toMatch(/dosyasına not eklendi/);
    await expect(t.call(head, 'setModel', { employee: 'Oya', model: 'opus' })).rejects.toThrow(/yalnız kendi departmanındaki/);
    await expect(t.call(head, 'sleep', { employee: 'Oya' })).rejects.toThrow(/yalnız kendi departmanındaki/);
    await expect(t.call(head, 'wake', { employee: 'Oya' })).rejects.toThrow(/yalnız kendi departmanındaki/);
    await expect(t.call(head, 'hire', { name: 'Bora', role: 'r', model: 'sonnet', department: 'Satış' })).rejects.toThrow(/Başkan yalnız kendi departmanına işe alır/);
    await expect(t.call(head, 'departmentCreate', { name: 'X', mission: 'm' })).rejects.toThrow(/not offered/);
    expect(out.id).toBeTruthy();
  });

  it('review focus 4: taskPass to a department goes to its head, a headless one to the coordinator, a closed one is refused', async () => {
    const t = make();
    const a = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: a.id, head: true });
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect(await t.call(ada, 'taskPass', { to: 'pazarlama', title: 'Duyuru metni' })).toMatch(/“Duyuru metni” Pazarlama departmanına gitti: başkanı Pelin/);
    expect(t.tasks.list({ assignee: head.id })[0]!.description).toMatch(/^Pazarlama departmanına/);
    t.departments.setHead(OWNER, a.id, null);
    expect(await t.call(ada, 'taskPass', { to: 'departman: Pazarlama', title: 'İkinci' })).toMatch(/başkanı yok; koordinatöre gitti/);
    t.departments.close(OWNER, a.id, 'son');
    await expect(t.call(ada, 'taskPass', { to: 'Pazarlama', title: 'Üçüncü' })).rejects.toThrow(/Çalışan ya da departman bulunamadı: Pazarlama\. Açık departmanlar: yok/);
  });

  it('streamPlan and streamReport for the head of the stream’s department', async () => {
    const t = make();
    t.budget.setConstitution({ autonomy: 'free' });
    const a = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: a.id, head: true });
    const plan = t.company.propose(t.coordinator.id, { title: 'Lansman', goal: 'g', approach: 'a', method: { workType: 'general', stages: [{ name: 'a', role: 'b' }, { name: 'c', role: 'd' }], checks: ['x'] }, streams: [{ id: 'duyuru', title: 'Duyuru', owner: 'Pazarlama' }] } as never);
    expect(await t.call(head, 'streamPlan', { planId: plan.id, streamId: 'duyuru', text: 'Önce metin.' })).toMatch(/“Duyuru” akışının planı yazıldı/);
    expect(await t.call(head, 'streamReport', { planId: plan.id, streamId: 'duyuru', summary: 'Hazır.', evidence: ['dosya'] })).toMatch(/“Duyuru” akışının raporu koordinatöre gitti/);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run test/mcp-departments.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/mcp/tools.ts`**

Imports: `MAX_DEPARTMENTS, ownerDepartment, type Department` from `@cc/shared`; `import type { Departments } from '../company/departments.ts';`; `import { departmentTemplate, listDepartmentTemplates } from '../company/department-templates.ts';`.

Add `departments?: Departments;` to the options with the comment `/** The departments (spec 2026-10-13-departments); absent: an office without them (and their tools). */`.

Helpers inside `officeTools`:

```ts
  const deps = o.departments;
  /** An open department by name or id; with none, a NotFoundError that lists the open ones. */
  const findDepartment = (who: string): Department => {
    const found = deps?.find(who.replace(/^\s*departman\s*:/i, '')) ?? null;
    if (found) return found;
    const open = deps?.list({ status: 'open' }).map((d) => d.name) ?? [];
    throw new NotFoundError(`Departman bulunamadı: ${who}. Açık departmanlar: ${open.length ? open.join(', ') : 'yok'}.`);
  };
  const STREAM_STATUS_TR = { planned: 'planlı', active: 'sürüyor', blocked: 'takıldı', done: 'bitti' } as const;
  const departmentLine = (d: Department): string => {
    const members = deps!.members(d.id);
    const head = d.headId ? company.nameOf(d.headId) : 'yok (koordinatör yönetir)';
    const tpl = d.template ? ` · şablon ${d.template.id} (sürüm ${d.template.version})` : ' · özel';
    return `• ${d.name} — başkan ${head} · ${members.length} kişi${tpl}\n  Misyon: ${d.mission}`;
  };
  const departmentStreams = (d: Department): string[] =>
    company.liveStreams().filter((x) => ownerDepartment(x.stream.owner) === d.id).map((x) => `“${x.plan.title}” › ${x.stream.title} (${x.stream.id}, ${STREAM_STATUS_TR[x.stream.status]})`);
```

`findPerson`-like resolution for `taskPass`:

```ts
  /** taskPass's `to`: a person, or a department (its head, else the coordinator). */
  const passTarget = (who: string): { to: Employee; department: Department | null } => {
    const person = /^\s*departman\s*:/i.test(who) ? null : roster.byIdOrName(who);
    if (person) return { to: person, department: null };
    const dep = deps?.find(who.replace(/^\s*departman\s*:/i, '')) ?? null;
    if (!dep) {
      const open = deps?.list({ status: 'open' }).map((d) => d.name) ?? [];
      throw new NotFoundError(`Çalışan ya da departman bulunamadı: ${who.trim()}. Açık departmanlar: ${open.length ? open.join(', ') : 'yok'}. officeStatus ve departmentsRead ile bakabilirsin.`);
    }
    const to = deps!.responsible(dep.id);
    if (!to) throw new ConflictError(`${dep.name} departmanının başkanı da koordinatör de yok.`);
    return { to, department: dep };
  };
```

`taskPass.run` becomes:

```ts
      run: ({ employee }, args) => {
        const input = { title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), priority: num(args, 'priority'), difficulty: difficultyArg(args), startAfter: optStr(args, 'startAfter'), dueAt: optStr(args, 'dueAt'), requires: list(args, 'requires') };
        const { to, department } = passTarget(str(args, 'to'));
        const description = department ? `${department.name} departmanına: ${input.description ?? ''}`.trim() : input.description;
        const task = company.createTask(employee.id, { assignee: to.id, ...input, description, reviewer: reviewerArg(args) });
        const lowered = input.difficulty === 'critical' && task.difficulty === 'hard' ? ' Zorluk “kritik” yerine “zor” sayıldı: kritik işi koordinatör ya da departman başkanı açar.' : '';
        const where = department
          ? department.headId === to.id ? `${department.name} departmanına gitti: başkanı ${to.name}` : `${department.name} departmanına gitti; başkanı yok; koordinatöre gitti (${to.name})`
          : `${to.name} adlı çalışanın sırasına eklendi`;
        return `“${task.title}” ${where} (görev ${task.id}).${lowered}${deskBrief(task.requires, to.id, `Gereken yetenekler, ${to.name} masasında`, 'Görev yine açıldı')}`;
      },
```

and its `to` schema: `s('Colleague id or name, or a department’s name (“departman: <ad>” or just its name): it goes to its head, or the coordinator when it has none.')`.

`taskCreate.run`: replace the lead check with:

```ts
        if (employee.kind === 'lead' && to.id !== employee.id) {
          if (deps) {
            const mine = deps.headOf(employee.id);
            if (!mine || to.departmentId !== mine.id) throw new ForbiddenError('Departman başkanı taskCreate ile yalnız kendi departmanına görev açar; başka departmana taskPass ile pasla (to: departmanın adı).');
          } else if (to.team !== employee.team) {
            throw new ForbiddenError('Ekip lideri taskCreate ile yalnız kendi ekibine görev açar; başkasına taskPass ile pasla.');
          }
        }
```

`setModel`, `sleep`, `wake`, `employeeNote`: `kinds: LEADS`; at the start of each `run`, after resolving `who`, call `company.assertManagesPerson(employee.id, who.id);` (for `setModel` the company method already checks; keep the call anyway for a uniform message before anything happens). Update their descriptions: `(coordinator; a head for their own department)`.

`hire`: `kinds: LEADS`; schema adds `department: s('Department name or id to hire into (coordinator). A head always hires into their own.')` and `head: { type: 'boolean', description: 'Hire as the department’s head (coordinator).' }`; description gains ` A department’s head may hire into their own department (when a need arises, not because a desk is free).`. In `run`, resolve `const department = optStr(args, 'department');` → `departmentId: department ? findDepartment(department).id : undefined`, pass `head: bool(args, 'head')`; the reply gets, right after `model ${hired.model}${from}` and before the Codex note and `deskBrief(…)` (which starts a new line), `${hired.departmentId ? ` → ${roster.get(hired.id).team} departmanı${roster.get(hired.id).kind === 'lead' ? ' (başkan)' : ''}` : ''}`.

`streamsLine`'s `owner` mapping: `(who) => (who.startsWith(`${STREAM_TO_HIRE}:`) ? who : ownerDepartment(who) ? `${deps?.get(ownerDepartment(who)!).name ?? 'departman'} departmanı` : company.nameOf(who))`. `streamItems.owner` description: `'Who carries it: a department ("departman: <name>", recommended: its head plans and runs it), an employee id or name, or "alınacak: <role>".'`.

New tools (append to `tools`, only when `deps` is given — build them in an `if (deps) tools.push(...)` block after the array):

```ts
    {
      name: 'departmentsRead',
      description: 'The departments: without department, each with its head, size, template and mission; with one, its whole scope (does / does not / goes to the owner), members and open streams with their last plan and report.',
      inputSchema: object({ department: s('Department name or id.') }),
      kinds: EVERYONE,
      run: (_ctx, args) => {
        const one = optStr(args, 'department');
        if (!one) {
          const open = deps.list({ status: 'open' });
          if (open.length === 0) return `Açık departman yok (en fazla ${MAX_DEPARTMENTS}).`;
          return [`Departmanlar (${open.length}/${MAX_DEPARTMENTS}):`, ...open.map(departmentLine)].join('\n');
        }
        const d = findDepartment(one);
        const people = deps.members(d.id).map((e) => `• ${e.name}${e.title ? ` — ${e.title}` : ''}${e.id === d.headId ? ' ★ başkan' : ''}`);
        const streams = departmentStreams(d);
        return [departmentLine(d), '', 'Kişiler:', ...(people.length ? people : ['• yok']), '', 'Açık akışlar:', ...(streams.length ? streams.map((x) => `• ${x}`) : ['• yok']), '', d.scope || '(Sınır metni yok.)'].join('\n');
      },
    },
    {
      name: 'departmentTemplates',
      description: 'The department template catalog: without id, the list; with id, one template whole (mission, head role, suggested roles and when to hire them, methods, routine suggestions, checks, measures, scope).',
      inputSchema: object({ id: s('Template id.') }),
      kinds: LEADS,
      run: (_ctx, args) => {
        const id = optStr(args, 'id');
        if (!id) return listDepartmentTemplates().map((t) => `• ${t.id} — ${t.name}: ${t.mission} Başkan: ${t.head}; önerilen: ${t.roles.map((r) => r.template).join(', ')}.`).join('\n');
        const t = departmentTemplate(id);
        return [`${t.id} (sürüm ${t.version}) — ${t.name}`, `Misyon: ${t.mission}`, `Başkan: ${t.head}`, 'Önerilen roller:', ...t.roles.map((r) => `• ${r.template}: ${r.when}`), `Yöntemler: ${t.methods.join(', ')}`, 'Rutin önerileri:', ...t.routines.map((r) => `• ${r}`), '', t.body].join('\n');
      },
    },
    {
      name: 'departmentCreate',
      description: `Open a department (coordinator; at most ${MAX_DEPARTMENTS}). From a template (departmentTemplates): name, mission and scope come from it unless given. Custom: name and mission required, scope optional. head: someone at work to head it (moved into it); none: headless — you run its streams until you name one.`,
      inputSchema: object({ template: { type: 'string', enum: listDepartmentTemplates().map((t) => t.id) }, name: s('Name (unique; not a person’s name).'), mission: s('One paragraph: what it is for.'), scope: s('Does / does not / goes to the owner (Markdown).'), head: s('Employee id or name.') }),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const head = optStr(args, 'head');
        const d = deps.create(employee.id, { template: optStr(args, 'template'), name: optStr(args, 'name'), mission: optStr(args, 'mission'), scope: optStr(args, 'scope'), headId: head ? findPerson(head).id : null });
        return `${d.name} departmanı açıldı; ${d.headId ? `başkanı ${company.nameOf(d.headId)}` : 'başkansız (akışlarını sen yönetirsin)'}. Akış vermek için plan kartında owner: "departman: ${d.name}".`;
      },
    },
    {
      name: 'departmentUpdate',
      description: 'Change a department (coordinator): name, mission, scope; head: an employee (moved into it and made head; the former head stays as a member) or "" for none.',
      inputSchema: object({ department: s('Department name or id.'), name: s('New name.'), mission: s('New mission.'), scope: s('New scope.'), head: s('Employee id or name; "" ends the headship.') }, ['department']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const d = findDepartment(str(args, 'department'));
        const patch = { name: optStr(args, 'name'), mission: optStr(args, 'mission'), scope: optStr(args, 'scope') };
        let next = patch.name !== undefined || patch.mission !== undefined || patch.scope !== undefined ? deps.update(employee.id, d.id, patch) : d;
        const head = optStr(args, 'head');
        if (head !== undefined) next = deps.setHead(employee.id, d.id, head.trim() ? findPerson(head).id : null);
        return `${next.name} departmanı güncellendi; ${next.headId ? `başkanı artık ${company.nameOf(next.headId)}` : 'başkansız'}.`;
      },
    },
    {
      name: 'departmentMove',
      description: 'Move an employee into a department, or to the centre without department (coordinator). Moving a head leaves their department headless.',
      inputSchema: object({ employee: s('Employee id or name.'), department: s('Department name or id; none: the centre.') }, ['employee']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const who = findPerson(str(args, 'employee'));
        const to = optStr(args, 'department');
        const moved = deps.move(employee.id, who.id, to?.trim() ? findDepartment(to).id : null);
        return moved.departmentId ? `${moved.name} artık ${moved.team} departmanında.` : `${moved.name} artık merkezde (koordinatöre bağlı).`;
      },
    },
    {
      name: 'departmentClose',
      description: 'Close a department (coordinator): its people go to the centre, its open streams come back to you; tasks stay with their assignees.',
      inputSchema: object({ department: s('Department name or id.'), reason: s('Why.') }, ['department', 'reason']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const d = deps.close(employee.id, findDepartment(str(args, 'department')).id, str(args, 'reason'));
        return `${d.name} departmanı kapandı; kişileri merkezde, açık akışları sende.`;
      },
    },
    {
      name: 'streamPlan',
      description: 'Write the plan of your department’s stream (its head; the coordinator for any): approach, tasks, dependencies, risks. Each call is a new version; the plan card shows the latest. Then open its tasks with taskCreate planId + streamId.',
      inputSchema: object({ planId: s('Plan id.'), streamId: s('Stream id.'), text: s('The stream’s plan.') }, ['planId', 'streamId', 'text']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const note = company.streamPlan(employee.id, str(args, 'planId'), str(args, 'streamId'), str(args, 'text'));
        const plan = plans().find((p) => p.id === note.planId);
        return `“${plan?.streams?.find((x) => x.id === note.streamId)?.title ?? note.streamId}” akışının planı yazıldı.`;
      },
    },
    {
      name: 'streamReport',
      description: 'Report on your department’s stream to the coordinator (its head; usually when it is done, also when it is stuck): what was done, the evidence, what comes next.',
      inputSchema: object({ planId: s('Plan id.'), streamId: s('Stream id.'), summary: s('What was done.'), evidence: strings('Evidence, one item each.'), next: s('What comes next.') }, ['planId', 'streamId', 'summary']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const note = company.streamReport(employee.id, str(args, 'planId'), str(args, 'streamId'), { summary: str(args, 'summary'), evidence: list(args, 'evidence'), next: optStr(args, 'next') });
        const plan = plans().find((p) => p.id === note.planId);
        return `“${plan?.streams?.find((x) => x.id === note.streamId)?.title ?? note.streamId}” akışının raporu koordinatöre gitti.`;
      },
    },
```

(`deps` is narrowed to `Departments` inside the `if (deps)` block; `findPerson` and `plans` are the existing helpers.)

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run test/mcp-departments.test.ts test/mcp-tools.test.ts test/mcp-protocol.test.ts`
Expected: PASS. If `mcp-tools.test.ts` pins the list of tool names per kind, add the new names where a test lists them (the leads now also see `hire`, `setModel`, `sleep`, `wake`, `employeeNote`, `departmentTemplates`, `streamPlan`, `streamReport`; everyone `departmentsRead` only when departments are wired).

- [ ] **Step 5: Whole suite, then commit**

Run: `pnpm vitest run` — Expected: PASS.

```bash
git add apps/office-server/src/mcp/tools.ts apps/office-server/test
git commit -m "feat(departments): office tools — departments read, opened, changed and closed; streams planned and reported; a head hires and manages their room; taskPass to a department"
```

---

### Task 11: The board's Departmanlar section

**Files:**
- Modify: `apps/office-server/src/company/board.ts`
- Test: `apps/office-server/test/board.test.ts`

**Interfaces:**
- Consumes: `Departments` (Task 6), `Company.liveStreams`, `Company.streamNotes` (Tasks 7–8).
- Produces: `BoardDeps.departments?: Pick<Departments, 'list' | 'members'>`.

- [ ] **Step 1: Write the failing tests** — in `test/board.test.ts`, give the file's `make` an option for departments: its signature becomes `function make(desks = 8, o: { departments?: boolean } = {})`, its `companyFor(s, f, undefined, now)` becomes `companyFor(s, f, undefined, now, undefined, o)`, and its `deps` gets `departments: c.departments ?? undefined`. Then add:

```ts
describe('board — Departmanlar (spec departments §6.3)', () => {
  it('is absent without departments: the seven headings stay', () => {
    const t = make();
    t.person('Ada');
    const text = t.board().text;
    expect(text).not.toMatch(/Departmanlar/);
    expect(text.split('\n').filter((l) => l.startsWith('## '))).toEqual(HEADINGS);
  });

  it('a line per open department after İnsanlar; warnings for a headless one with open streams and a finished stream without a report', () => {
    const t = make(8, { departments: true });
    const d = t.departments!;
    const yaz = d.create(OWNER, { name: 'Yazılım', mission: 'Kod.' });
    const pzr = d.create(OWNER, { name: 'Pazarlama', mission: 'Duyuru.' });
    const [selin, mert, deniz] = [t.person('Selin'), t.person('Mert'), t.person('Deniz')];
    d.setHead(OWNER, yaz.id, selin.id);
    d.move(OWNER, mert.id, yaz.id);
    d.move(OWNER, deniz.id, pzr.id);
    const plan = t.plan('Site', { streams: [{ id: 'api', title: 'API', owner: 'Yazılım' }, { id: 'doc', title: 'Belgeler', owner: 'Yazılım' }, { id: 'tanitim', title: 'Tanıtım', owner: 'Pazarlama' }] });
    const api = t.task(mert.id, 'Uç noktalar', { planId: plan.id, streamId: 'api' });
    t.company.start(api.id);
    const doc = t.task(selin.id, 'Belgeler', { planId: plan.id, streamId: 'doc' });
    t.company.start(doc.id);
    t.finish(selin.id, doc.id);
    const text = t.board().text;
    expect(text).toMatch(/## 4\. Departmanlar\n- Yazılım — başkan Selin · 2 kişi \(\d işte, \d boşta\) · akışlar: api \(sürüyor\), doc \(bitti\)/);
    expect(text).toMatch(/- Pazarlama — başkan YOK · 1 kişi \(\d işte, \d boşta\) · akışlar: tanitim \(planlı\)/);
    expect(text).toMatch(/- UYARI: Pazarlama başkansız ve açık akışı var \(tanitim\); departmentUpdate ile başkan ata ya da akışı kendin yönet\./);
    expect(text).toMatch(/- Yazılım: “Site” planının “doc” akışı bitti, raporu yok\./);
    expect(text).toMatch(/## 5\. Zincirler ve kritik yol/);
    t.company.streamReport(selin.id, plan.id, 'doc', { summary: 'Belgeler hazır.' });
    const next = t.board().text;
    expect(next).toMatch(/son rapor: “Belgeler hazır\.”/);
    expect(next).not.toMatch(/raporu yok/);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run test/board.test.ts`
Expected: FAIL on the second test.

- [ ] **Step 3: Implement in `src/company/board.ts`**

Add to `BoardDeps`:

```ts
  /** The departments (absent, or none open: no Departmanlar section — the board is exactly as before them). */
  departments?: Pick<Departments, 'list' | 'members'>;
```

(`import type { Departments } from './departments.ts';` and `ownerDepartment` from `@cc/shared`.)

Inside `render`, after `staff()`:

```ts
    // ── departments (spec departments §6.3) ────────────────────────────────────

    const STREAM_TR = { planned: 'planlı', active: 'sürüyor', blocked: 'takıldı', done: 'bitti' } as const;
    const openDepartments = d.departments?.list({ status: 'open' }) ?? [];
    const departmentsSection = (): string[] => {
      const b = metrics.busy;
      const atWork = new Set(b.atWork.map((p) => p.id));
      const idle = new Set(b.idle.map((p) => p.id));
      const streams = live.filter((p) => p.status === 'approved').flatMap((plan) => (d.company.streamsOf([plan]).get(plan.id) ?? []).map((stream) => ({ plan, stream })));
      const lines: string[] = [];
      const warnings: string[] = [];
      for (const dep of openDepartments) {
        const people = d.departments!.members(dep.id);
        const mine = streams.filter((x) => ownerDepartment(x.stream.owner) === dep.id);
        const reviewing = open.filter((t) => t.status === 'review' && people.some((p) => p.id === t.assignee)).length;
        const notes = mine.map((x) => ({ x, n: d.company.streamNotes(x.plan.id).find((s) => s.streamId === x.stream.id) }));
        const last = notes.map((y) => y.n?.report).filter((r): r is NonNullable<typeof r> => !!r).sort((a, b2) => b2.at - a.at)[0];
        const head = dep.headId ? nameOf(dep.headId) : 'YOK';
        const counts = `${people.length} kişi (${people.filter((p) => atWork.has(p.id)).length} işte, ${people.filter((p) => idle.has(p.id)).length} boşta)`;
        const streamText = mine.length ? mine.map((x) => `${x.stream.id} (${STREAM_TR[x.stream.status]})`).join(', ') : 'yok';
        lines.push(`- ${dep.name} — başkan ${head} · ${counts} · akışlar: ${streamText}${reviewing ? ` · incelemede ${reviewing}` : ''}${last ? ` · son rapor: “${clip(last.text, L.noteChars)}” (${ago(last.at)})` : ''}`);
        const running = mine.filter((x) => x.stream.status !== 'done');
        if (!dep.headId && running.length) warnings.push(`- UYARI: ${dep.name} başkansız ve açık akışı var (${running.map((x) => x.stream.id).join(', ')}); departmentUpdate ile başkan ata ya da akışı kendin yönet.`);
        for (const y of notes) if (y.x.stream.status === 'done' && !y.n?.report) warnings.push(`- ${dep.name}: “${y.x.plan.title}” planının “${y.x.stream.id}” akışı bitti, raporu yok.`);
      }
      return [...lines, ...warnings];
    };
```

and in `sections`:

```ts
    const sections: Array<[string, string[]]> = [
      ['Ne değişti (son turdan beri)', changed()],
      ['Hedefler ve planlar', goalsAndPlans()],
      [staffTitle(), staff()],
      ...(openDepartments.length > 0 ? ([['Departmanlar', departmentsSection()]] as Array<[string, string[]]>) : []),
      ['Zincirler ve kritik yol', chains()],
      ['Riskler', risks()],
      ['Kaynak', resources()],
      ['Açık kararlar', decisions()],
    ];
```

Use the names that already exist in `render` (`live`, `open`, `metrics`, `nameOf`, `clip`, `ago`, `L`); if `L.noteChars` is not the right limit name in that scope, use the one the risks section uses for notes.

- [ ] **Step 3b: Department-owned streams in "Hedefler ve planlar"** — today that section looks a stream's owner up as a person (`byId.get(x.owner)`), so a `departman:<id>` owner would read "sahibi bulunamadı". In `render`, next to `toHire` uses, add:

```ts
    const allDepartments = d.departments?.list() ?? [];
    /** The department a stream's owner names (spec departments §6.1); null for a person or a role to hire. */
    const departmentOf = (owner: string) => {
      const id = ownerDepartment(owner);
      return id ? (allDepartments.find((x) => x.id === id) ?? null) : null;
    };
```

where the streams are checked (`const owner = toHire(x.owner) ? undefined : byId.get(x.owner);` and the `lacking` chain after it), make a department's head the owner and say why a department cannot carry it:

```ts
        const dep = departmentOf(x.owner);
        const owner = toHire(x.owner) ? undefined : dep ? (dep.status === 'open' && dep.headId ? byId.get(dep.headId) : undefined) : byId.get(x.owner);
        // Why no one can carry it: as a flag, and short for inside a line.
        const lacking: [string, string] | null = toHire(x.owner)
          ? [`sahibi yok (${x.owner})`, `sahibi yok, ${x.owner}`]
          : dep && dep.status !== 'open'
            ? [`sahibi ${dep.name} departmanı kapandı`, `${dep.name} kapandı`]
            : dep && !dep.headId
              ? [`sahibi ${dep.name} departmanı, başkanı yok — sen yönet ya da başkan ata`, `${dep.name} başkansız`]
              : !owner
                ? [`sahibi bulunamadı (${x.owner})`, 'sahibi bulunamadı']
                : owner.lifecycle === 'archived'
                  ? [`sahibi ${owner.name} işten ayrıldı`, `sahibi ${owner.name} ayrıldı`]
                  : UNAVAILABLE.includes(owner.lifecycle)
                    ? [`sahibi ${owner.name} iş alamıyor (${UNAVAILABLE_TR[owner.lifecycle] ?? owner.lifecycle})`, `sahibi ${owner.name} iş alamıyor`]
                    : null;
```

and the owner label further down (`const owner = (who: string) => (toHire(who) ? who : nameOf(who));`) becomes:

```ts
      const owner = (who: string) => (toHire(who) ? who : departmentOf(who) ? `${departmentOf(who)!.name} departmanı` : nameOf(who));
```

Add to the second Task 11 test, after `const text = t.board().text;`:

```ts
    expect(text).toMatch(/tanitim: sahibi Pazarlama departmanı, başkanı yok — sen yönet ya da başkan ata/);
    expect(text).not.toMatch(/sahibi bulunamadı/);
    expect(text).toMatch(/Yazılım departmanı/);
```

- [ ] **Step 4: Run the board, cycle and economy tests**

Run: `pnpm vitest run test/board.test.ts test/cycle.test.ts test/economy.scenario.test.ts`
Expected: PASS (no departments in the cycle and economy tests: their boards are unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/board.ts apps/office-server/test/board.test.ts
git commit -m "feat(departments): the management board's Departmanlar section — a line per department, warnings for headless ones and unreported streams"
```

---

### Task 12: Owner API, snapshot and wiring

**Files:**
- Modify: `apps/office-server/src/api.ts`, `apps/office-server/src/main.ts`
- Test: `apps/office-server/test/departments-api.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: routes `GET /api/departments`, `GET /api/department-templates`, `POST /api/departments`, `POST /api/departments/:id`, `POST /api/departments/:id/close`, `POST /api/employees/:id/department`, `GET /api/plans/:id/stream-notes`; `OfficeSnapshot.departments`; `ApiDeps.company.departments?`.

- [ ] **Step 1: Write the failing tests** — `test/departments-api.test.ts`:

```ts
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { pageHeaders } from './owner-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start() {
  const s = setup(10);
  const f = fakeEngine(s);
  const c = companyFor(s, f, ['coder', 'manager'], undefined, undefined, { departments: true });
  c.budget.setConstitution({ maxEmployees: 10 });
  const api = createApi(
    { engine: f.engine, roster: s.roster, events: s.events, quota: new QuotaTracker(s.db, s.events), company: { service: c.company, tasks: c.tasks, plans: c.plans, memory: c.memory, budget: c.budget, proposals: c.proposals, departments: c.departments! } },
    { allowedOrigins: [] },
  );
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { port, ...c, departments: c.departments! };
}

/** As the office page sends it (pageHeaders), unless `page: false` (a request from outside the page). */
async function call(port: number, method: string, path: string, body?: unknown, o: { page?: boolean } = {}): Promise<{ status: number; body: any }> {
  const page = method === 'GET' || o.page === false ? {} : await pageHeaders(port);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...page } }, (res) => {
      let data = '';
      res.on('data', (x) => (data += x));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write(JSON.stringify(body ?? {}));
    req.end();
  });
}

describe('departments API (spec §7)', () => {
  it('the owner opens, changes, moves into and closes a department; the snapshot carries them; without the page’s nonce it is refused', async () => {
    const t = await start();
    t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect((await call(t.port, 'GET', '/api/department-templates')).body.map((x: { id: string }) => x.id)).toEqual(['ic-dis-iletisim', 'operasyon-finans', 'pazarlama', 'satis', 'yazilim-otomasyon']);
    const created = await call(t.port, 'POST', '/api/departments', { template: 'pazarlama' });
    expect(created).toMatchObject({ status: 201, body: { name: 'Pazarlama', headId: null, status: 'open' } });
    const id = created.body.id as string;
    expect((await call(t.port, 'POST', `/api/employees/${ada.id}/department`, { departmentId: id })).body).toMatchObject({ departmentId: id, team: 'Pazarlama' });
    expect((await call(t.port, 'POST', `/api/departments/${id}`, { headId: ada.id, mission: 'Yeni misyon' })).body).toMatchObject({ headId: ada.id, mission: 'Yeni misyon' });
    expect((await call(t.port, 'GET', '/api/office')).body.departments).toEqual([expect.objectContaining({ id, name: 'Pazarlama', headId: ada.id })]);
    expect((await call(t.port, 'GET', '/api/departments')).body).toHaveLength(1);
    expect((await call(t.port, 'POST', `/api/departments/${id}/close`, {})).status).toBe(400);
    expect((await call(t.port, 'POST', `/api/departments/${id}/close`, { reason: 'deneme' })).body).toMatchObject({ status: 'closed' });
    expect((await call(t.port, 'POST', '/api/departments', { name: 'X', mission: 'm' }, { page: false })).status).toBe(403);
  });

  it('a plan’s stream notes', async () => {
    const t = await start();
    t.budget.setConstitution({ autonomy: 'free' });
    const coord = t.company.hireCoordinator('sonnet');
    const dep = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: dep.id, head: true });
    const plan = t.company.propose(coord.id, { title: 'Lansman', goal: 'g', approach: 'a', method: METHOD, streams: [{ id: 'duyuru', title: 'Duyuru', owner: 'Pazarlama' }] });
    t.company.streamPlan(head.id, plan.id, 'duyuru', 'Önce metin.');
    expect((await call(t.port, 'GET', `/api/plans/${plan.id}/stream-notes`)).body).toEqual(JSON.parse(JSON.stringify(t.company.streamNotes(plan.id))));
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run test/departments-api.test.ts`
Expected: FAIL (404).

- [ ] **Step 3: Implement in `src/api.ts`**

`ApiDeps.company` gains `departments?: Departments;` (`import type { Departments } from './company/departments.ts';`, `import { listDepartmentTemplates } from './company/department-templates.ts';`). In `snapshot()`, add to the returned object `...(d.company.departments ? { departments: d.company.departments.list() } : {})`.

Routes (inside the `if (d.company)` block, next to the role templates route; the owner guard already covers every non-GET `/api/` request):

```ts
    const departments = d.company.departments;
    if (departments) {
      if (method === 'GET' && url.pathname === '/api/departments') return sendJson(res, 200, departments.list());
      if (method === 'GET' && url.pathname === '/api/department-templates') return sendJson(res, 200, listDepartmentTemplates());
      if (method === 'POST' && url.pathname === '/api/departments') {
        const body = (await readJson(req)) as { template?: string; name?: string; mission?: string; scope?: string; headId?: string | null } | null;
        return sendJson(res, 201, departments.create(OWNER, body ?? {}));
      }
      const dep = DEPARTMENT_ROUTE.exec(url.pathname);
      if (method === 'POST' && dep) {
        const id = dep[1] ?? '';
        const body = ((await readJson(req)) ?? {}) as { name?: string; mission?: string; scope?: string; headId?: string | null; reason?: string };
        if (dep[2] === 'close') return sendJson(res, 200, departments.close(OWNER, id, body.reason ?? ''));
        let next = body.name !== undefined || body.mission !== undefined || body.scope !== undefined ? departments.update(OWNER, id, { name: body.name, mission: body.mission, scope: body.scope }) : departments.get(id);
        if (body.headId !== undefined) next = departments.setHead(OWNER, id, body.headId);
        return sendJson(res, 200, next);
      }
    }
    const notes = STREAM_NOTES_ROUTE.exec(url.pathname);
    if (method === 'GET' && notes) return sendJson(res, 200, company.streamNotes(notes[1] ?? ''));
```

with the route constants next to the others:

```ts
const DEPARTMENT_ROUTE = /^\/api\/departments\/([^/]+)(?:\/(close))?$/;
const STREAM_NOTES_ROUTE = /^\/api\/plans\/([^/]+)\/stream-notes$/;
```

For `POST /api/employees/:id/department`: find the handler of `/api/employees/:id/<action>` (it reads `action` and handles `side-questions`, `messages`, …) and add before its fall-through:

```ts
    if (method === 'POST' && action === 'department' && d.company?.departments) {
      const body = ((await readJson(req)) ?? {}) as { departmentId?: string | null };
      return sendJson(res, 200, d.company.departments.move(OWNER, id, body.departmentId ?? null));
    }
```

- [ ] **Step 4: Wire it in `src/main.ts`**

Imports: `DepartmentStore, StreamNoteStore` from `./company/department-store.ts`, `Departments` from `./company/departments.ts`. Before `const company = new Company({…})`:

```ts
// The departments (spec 2026-10-13-departments): the rooms, their heads and the notes on their streams.
const streamNotes = new StreamNoteStore(db);
const departments = new Departments({ store: new DepartmentStore(db), roster, events, notices, dataDir: config.dataDir, reload: (id) => engine.reload(id) });
```

Add `departments, streamNotes` to the `Company` deps. After `company.attachKpis(kpis);`:

```ts
departments.attach({ openStreams: () => company.liveStreams(), headEnded: (id) => company.rerouteProposalsOf(id) });
// The teams of before departments become departments, and every desk learns its department (idempotent).
departments.adoptTeams();
departments.refreshDesks();
```

Add `departments` to `boardDeps`, to `officeTools({…})` and to the API's `company: {…}`.

- [ ] **Step 5: Run the API tests and the main wiring test**

Run: `pnpm vitest run test/departments-api.test.ts test/company-api.test.ts test/api.test.ts test/main.test.ts test/owner-guard.test.ts`
Expected: PASS.

- [ ] **Step 6: Whole server suite and typecheck, then commit**

Run: `pnpm vitest run && pnpm --filter @cc/office-server typecheck` — Expected: PASS.

```bash
git add apps/office-server/src/api.ts apps/office-server/src/main.ts apps/office-server/test/departments-api.test.ts
git commit -m "feat(departments): owner API (open, change, move, close; templates; stream notes), the snapshot's departments, and the office's wiring — teams adopted at start"
```

---

### Task 13: Web — store, API client, org chart by department, Departmanlar tab

**Files:**
- Modify: `apps/office-web/src/net/api.ts`, `apps/office-web/src/store/reducers.ts`, `apps/office-web/src/ui/CompanyView.tsx`, `apps/office-web/src/ui/labels.ts`, `apps/office-web/src/styles.css`
- Create: `apps/office-web/src/ui/DepartmentsTab.tsx`
- Test: `apps/office-web/src/ui/DepartmentsTab.test.tsx`, `apps/office-web/src/store/reducers.test.ts`, `apps/office-web/src/ui/CompanyView.test.tsx`

**Interfaces:**
- Consumes: the API of Task 12 and the shared types.
- Produces: `api.departments()`, `api.departmentTemplates()`, `api.createDepartment(input)`, `api.updateDepartment(id, patch)`, `api.closeDepartment(id, reason)`, `api.moveEmployee(id, departmentId)`, `api.streamNotes(planId)`; `OfficeData.departments: Record<string, Department>`, `OfficeData.streamNotesRev: number`; component `DepartmentsTab`.

- [ ] **Step 1: API client** — add to `api` in `net/api.ts` (types from `@cc/shared`):

```ts
  departments: () => request<Department[]>('GET', '/api/departments'),
  departmentTemplates: () => request<DepartmentTemplate[]>('GET', '/api/department-templates'),
  createDepartment: (input: DepartmentInput) => request<Department>('POST', '/api/departments', input),
  updateDepartment: (id: string, patch: { name?: string; mission?: string; scope?: string; headId?: string | null }) => request<Department>('POST', `/api/departments/${encodeURIComponent(id)}`, patch),
  closeDepartment: (id: string, reason: string) => request<Department>('POST', `/api/departments/${encodeURIComponent(id)}/close`, { reason }),
  moveEmployee: (id: string, departmentId: string | null) => request<Employee>('POST', `${employee(id)}/department`, { departmentId }),
  streamNotes: (planId: string) => request<Array<{ streamId: string; plan: StreamNote | null; report: StreamNote | null }>>('GET', `/api/plans/${encodeURIComponent(planId)}/stream-notes`),
```

- [ ] **Step 2: Failing reducer test** — in `store/reducers.test.ts`:

```ts
  it('keeps the departments from the snapshot and their changes; a department change asks for a fresh snapshot; a stream note bumps its revision', () => {
    const dep = { id: 'd1', name: 'Pazarlama', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null } as const;
    let d = applySnapshot(EMPTY_DATA, { employees: [], quota: null, usage: {}, lastSeq: 1, departments: [dep] });
    expect(d.departments).toEqual({ d1: dep });
    const ev = { seq: 2, ts: 2, employeeId: null, event: { type: 'department.changed', change: 'updated', department: { ...dep, name: 'Büyüme' } } } as never;
    d = applyEvent(d, ev);
    expect(d.departments.d1?.name).toBe('Büyüme');
    expect(needsRefresh(ev)).toBe(true);
    d = applyEvent(d, { seq: 3, ts: 3, employeeId: 'e', event: { type: 'stream.noted', note: { id: 1 } } } as never);
    expect(d.streamNotesRev).toBe(1);
  });
```

(Use the file's actual function names and event shape; match how other tests call `applyEvent`.)

- [ ] **Step 3: Implement the store** — in `store/reducers.ts`: `OfficeData` gains `departments: Record<string, Department>` and `streamNotesRev: number`; `EMPTY_DATA` gets `departments: {}, streamNotesRev: 0`; `applySnapshot` sets `departments: Object.fromEntries((s.departments ?? []).map((x) => [x.id, x]))`; in the company part of `applyEvent`:

```ts
  if (ev.type === 'department.changed') next.departments = { ...d.departments, [ev.department.id]: ev.department };
  if (ev.type === 'stream.noted') next.streamNotesRev = d.streamNotesRev + 1;
```

and `needsRefresh` returns true for `t === 'department.changed'` (employees' departments, kinds and teams change with it).

- [ ] **Step 4: Failing component tests** — `ui/DepartmentsTab.test.tsx` (mock `../net/api.ts` like `HireDialog.test.tsx` does):

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOffice } from '../store/office.ts';
import { DepartmentsTab } from './DepartmentsTab.tsx';

vi.mock('../net/api.ts', () => ({
  api: {
    departmentTemplates: vi.fn(async () => [
      { id: 'pazarlama', version: 1, name: 'Pazarlama', mission: 'Şirketi duyurur.', head: 'pazarlama-muduru', roles: [{ template: 'icerik-yazari', when: 'Hacim artınca.' }], methods: ['content'], routines: [], checks: ['x'], kpis: ['y'], body: '### Yapar' },
    ]),
    createDepartment: vi.fn(async (input: object) => ({ id: 'd9', name: 'Pazarlama', mission: 'Şirketi duyurur.', scope: '', template: { id: 'pazarlama', version: 1 }, headId: null, status: 'open', createdAt: 1, closedAt: null, ...input })),
    updateDepartment: vi.fn(async () => ({})),
    closeDepartment: vi.fn(async () => ({})),
    moveEmployee: vi.fn(async () => ({})),
  },
}));
const { api } = await import('../net/api.ts');

const dep = (id: string, name: string, headId: string | null = null) => ({ id, name, mission: `${name} misyonu`, scope: '### Yapmaz\n\n- Başka iş.', template: null, headId, status: 'open' as const, createdAt: 1, closedAt: null });
const person = (id: string, name: string, departmentId?: string, kind: 'member' | 'lead' | 'coordinator' = 'member') => ({
  id, slug: id, name, role: 'r', model: 'sonnet', characterId: 'coder', title: '', team: '', kind, reportsTo: null, deskIndex: 0, sessionId: 's', sessionStarted: false, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1, ...(departmentId ? { departmentId } : {}),
});

function seed(departments: ReturnType<typeof dep>[], people: ReturnType<typeof person>[]) {
  useOffice.setState({
    departments: Object.fromEntries(departments.map((x) => [x.id, x])),
    views: Object.fromEntries(people.map((p) => [p.id, { employee: p } as never])),
  } as never);
}

beforeEach(() => seed([dep('d1', 'Yazılım', 'e1')], [person('e1', 'Selin', 'd1', 'lead'), person('e2', 'Deniz'), person('c', 'Koordinatör', undefined, 'coordinator')]));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DepartmentsTab', () => {
  it('lists open departments with their head and size', () => {
    render(<DepartmentsTab />);
    const card = screen.getByRole('region', { name: 'Yazılım' });
    expect(card.textContent).toMatch(/Başkan: Selin/);
    expect(card.textContent).toMatch(/1 kişi/);
  });

  it('opens a department from a template', async () => {
    render(<DepartmentsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Departman aç' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Pazarlama/ }));
    fireEvent.change(screen.getByLabelText('Başkan'), { target: { value: 'e2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aç' }));
    await waitFor(() => expect(api.createDepartment).toHaveBeenCalledWith({ template: 'pazarlama', headId: 'e2' }));
  });

  it('opens a custom department with a name and a mission', async () => {
    render(<DepartmentsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Departman aç' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Özel departman' }));
    fireEvent.change(screen.getByLabelText('Ad'), { target: { value: 'Keşif' } });
    fireEvent.change(screen.getByLabelText('Misyon'), { target: { value: 'Araştırır.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aç' }));
    await waitFor(() => expect(api.createDepartment).toHaveBeenCalledWith({ name: 'Keşif', mission: 'Araştırır.', scope: '' }));
  });

  it('cannot open a seventh; says why', () => {
    seed(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => dep(x, x.toUpperCase())), []);
    render(<DepartmentsTab />);
    const button = screen.getByRole('button', { name: 'Departman aç' });
    expect(button).toHaveProperty('disabled', true);
    expect(screen.getByText(/En fazla 6 departman açık olabilir/)).toBeTruthy();
  });

  it('names a head, adds a member, closes with a reason', async () => {
    render(<DepartmentsTab />);
    const card = screen.getByRole('region', { name: 'Yazılım' });
    fireEvent.click(card.querySelector('button[data-action="details"]')!);
    fireEvent.change(screen.getByLabelText('Kişi ekle'), { target: { value: 'e2' } });
    await waitFor(() => expect(api.moveEmployee).toHaveBeenCalledWith('e2', 'd1'));
    fireEvent.change(screen.getByLabelText('Başkanı değiştir'), { target: { value: '' } });
    await waitFor(() => expect(api.updateDepartment).toHaveBeenCalledWith('d1', { headId: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Kapat…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Departmanı kapat' }));
    expect(api.closeDepartment).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Gerekçe'), { target: { value: 'iş bitti' } });
    fireEvent.click(screen.getByRole('button', { name: 'Departmanı kapat' }));
    await waitFor(() => expect(api.closeDepartment).toHaveBeenCalledWith('d1', 'iş bitti'));
  });
});
```

- [ ] **Step 5: Implement `ui/DepartmentsTab.tsx`**

```tsx
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { MAX_DEPARTMENTS, type Department, type DepartmentTemplate, type Employee } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';

const FULL = `En fazla ${MAX_DEPARTMENTS} departman açık olabilir; önce birini kapat.`;

/** People at work, as the page knows them. */
function usePeople(): Employee[] {
  const views = useOffice((s) => s.views);
  return useMemo(() => Object.values(views).map((v) => v.employee).filter((e) => e.lifecycle !== 'archived'), [views]);
}

/** Runs an owner action; its error is shown, the next action clears it. */
function useRun() {
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };
  return { error, run };
}

function OpenDialog({ people, onClose }: { people: Employee[]; onClose: () => void }) {
  const [templates, setTemplates] = useState<DepartmentTemplate[]>([]);
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [scope, setScope] = useState('');
  const [headId, setHeadId] = useState('');
  const { error, run } = useRun();
  useEffect(() => {
    void api.departmentTemplates().then(setTemplates, () => setTemplates([]));
  }, []);
  const candidates = people.filter((e) => e.kind !== 'coordinator');
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!choice) return;
    const head = headId ? { headId } : {};
    const input = choice === 'custom' ? { name, mission, scope, ...head } : { template: choice, ...head };
    if (await run(() => api.createDepartment(input))) onClose();
  };
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <form className="dialog" role="dialog" aria-label="Departman aç" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2>Departman aç</h2>
        <fieldset className="department-choices">
          {templates.map((t) => (
            <label key={t.id} className="department-choice">
              <input type="radio" name="department-kind" value={t.id} checked={choice === t.id} onChange={() => setChoice(t.id)} />
              <strong>{t.name}</strong> <span className="muted">{t.mission}</span>
              <span className="muted"> Başkan: {t.head}. Gerekirse: {t.roles.map((r) => `${r.template} (${r.when})`).join('; ')}</span>
            </label>
          ))}
          <label className="department-choice">
            <input type="radio" name="department-kind" value="custom" checked={choice === 'custom'} onChange={() => setChoice('custom')} />
            Özel departman
          </label>
        </fieldset>
        {choice === 'custom' && (
          <>
            <div className="field">
              <label htmlFor="department-name">Ad</label>
              <input id="department-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
            </div>
            <div className="field">
              <label htmlFor="department-mission">Misyon</label>
              <textarea id="department-mission" value={mission} onChange={(e) => setMission(e.target.value)} rows={3} required />
            </div>
            <div className="field">
              <label htmlFor="department-scope">Yapar / Yapmaz</label>
              <textarea id="department-scope" value={scope} onChange={(e) => setScope(e.target.value)} rows={5} placeholder={'### Yapar\n\n### Yapmaz\n\n### Sana gelir'} />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="department-head">Başkan</label>
          <select id="department-head" value={headId} onChange={(e) => setHeadId(e.target.value)}>
            <option value="">Başkansız</option>
            {candidates.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="primary" disabled={!choice}>
            Aç
          </button>
        </div>
      </form>
    </div>
  );
}

function DepartmentDetails({ dep, members, people }: { dep: Department; members: Employee[]; people: Employee[] }) {
  const { error, run } = useRun();
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');
  const outside = people.filter((e) => e.kind !== 'coordinator' && e.departmentId !== dep.id);
  return (
    <div className="department-details">
      {dep.scope && <pre className="department-scope">{dep.scope}</pre>}
      <ul className="department-members">
        {members.map((e) => (
          <li key={e.id}>
            {e.id === dep.headId ? '★ ' : ''}
            {e.name}
            {e.title ? ` — ${e.title}` : ''}{' '}
            <button type="button" onClick={() => void run(() => api.moveEmployee(e.id, null))}>
              Merkeze al
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <div className="field">
          <label htmlFor={`department-add-${dep.id}`}>Kişi ekle</label>
          <select id={`department-add-${dep.id}`} value="" onChange={(ev) => ev.target.value && void run(() => api.moveEmployee(ev.target.value, dep.id))}>
            <option value="">Seç…</option>
            {outside.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`department-head-${dep.id}`}>Başkanı değiştir</label>
          <select id={`department-head-${dep.id}`} value={dep.headId ?? ''} onChange={(ev) => void run(() => api.updateDepartment(dep.id, { headId: ev.target.value || null }))}>
            <option value="">Başkansız</option>
            {members.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {closing ? (
        <div className="row">
          <div className="field">
            <label htmlFor={`department-reason-${dep.id}`}>Gerekçe</label>
            <input id={`department-reason-${dep.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button type="button" className="danger" onClick={() => reason.trim() && void run(() => api.closeDepartment(dep.id, reason.trim()))}>
            Departmanı kapat
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setClosing(true)}>
          Kapat…
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function DepartmentCard({ dep, people }: { dep: Department; people: Employee[] }) {
  const [open, setOpen] = useState(false);
  const members = people.filter((e) => e.departmentId === dep.id).sort((a, b) => Number(b.id === dep.headId) - Number(a.id === dep.headId));
  const head = people.find((e) => e.id === dep.headId);
  return (
    <section aria-label={dep.name} className="department-card">
      <header className="row">
        <h3>{dep.name}</h3>
        {dep.template ? <span className="badge">şablon {dep.template.id}</span> : <span className="badge">özel</span>}
      </header>
      <p>{dep.mission}</p>
      <p className="muted">
        Başkan: {head?.name ?? 'yok'} · {members.length} kişi
      </p>
      <button type="button" data-action="details" onClick={() => setOpen(!open)}>
        {open ? 'Gizle' : 'Ayrıntı'}
      </button>
      {open && <DepartmentDetails dep={dep} members={members} people={people} />}
    </section>
  );
}

/** The owner's view of the departments (spec departments §8): open one, name its head, move people, close it. */
export function DepartmentsTab() {
  const departments = useOffice((s) => s.departments);
  const people = usePeople();
  const [opening, setOpening] = useState(false);
  const open = useMemo(() => Object.values(departments ?? {}).filter((d) => d.status === 'open').sort((a, b) => a.createdAt - b.createdAt), [departments]);
  const full = open.length >= MAX_DEPARTMENTS;
  return (
    <div className="departments">
      <div className="row">
        <button type="button" className="primary" disabled={full} onClick={() => setOpening(true)}>
          Departman aç
        </button>
        {full && <span className="muted">{FULL}</span>}
      </div>
      {opening && <OpenDialog people={people} onClose={() => setOpening(false)} />}
      {open.length === 0 ? (
        <p className="muted">Henüz departman yok: bir şablondan ya da özel bir departman aç; koordinatör de açabilir.</p>
      ) : (
        open.map((d) => <DepartmentCard key={d.id} dep={d} people={people} />)
      )}
    </div>
  );
}
```

- [ ] **Step 6: Org chart by department and the tab**

Failing test first, in `ui/CompanyView.test.tsx`:

```tsx
  it('the org chart groups people by department in opening order, the head first, then the centre', () => {
    office([person('k', { kind: 'coordinator', name: 'Koordinatör' }), person('mert', { departmentId: 'd1' }), person('selin', { kind: 'lead', departmentId: 'd1' }), person('deniz', { departmentId: 'd2' }), person('ada')]);
    useOffice.setState({
      departments: {
        d2: { id: 'd2', name: 'Pazarlama', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 2, closedAt: null },
        d1: { id: 'd1', name: 'Yazılım', mission: 'm', scope: '', template: null, headId: 'selin', status: 'open', createdAt: 1, closedAt: null },
      },
    } as never);
    render(<CompanyView />);
    const groups = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label')).filter((l) => l !== 'Koordinatör');
    expect(groups).toEqual(['Yazılım', 'Pazarlama', 'Merkez']);
    const yazilim = screen.getByRole('region', { name: 'Yazılım' });
    expect(within(yazilim).getAllByRole('button').map((b) => b.textContent)[0]).toMatch(/selin/);
    expect(screen.getByRole('tab', { name: 'Departmanlar' })).toBeTruthy();
  });
```

(`office()` sets `departments: {}`? — add `departments: {}` to the state `office()` sets, so other tests start without departments.)

In `ui/CompanyView.tsx`: import `DepartmentsTab`; add `['departments', 'Departmanlar']` to `TABS` right after `['org', 'Örgüt']`; render `tab === 'departments' ? <DepartmentsTab /> :` in the tab chain; replace the `teams` map with:

```tsx
  const departments = useOffice((s) => s.departments);
  const openDepartments = Object.values(departments ?? {}).filter((x) => x.status === 'open').sort((a, b) => a.createdAt - b.createdAt);
  /** The org chart's groups (spec departments §8): departments in opening order, the head first, then the centre; without departments, today's teams. */
  const teams = new Map<string, Employee[]>();
  if (openDepartments.length > 0) {
    for (const dep of openDepartments) {
      const members = people.filter((e) => e.kind !== 'coordinator' && e.departmentId === dep.id);
      teams.set(dep.name, [...members.filter((e) => e.id === dep.headId), ...members.filter((e) => e.id !== dep.headId)]);
    }
    const centre = people.filter((e) => e.kind !== 'coordinator' && !openDepartments.some((dep) => dep.id === e.departmentId));
    if (centre.length) teams.set('Merkez', centre);
  } else {
    for (const e of people) {
      if (e.kind === 'coordinator') continue;
      const team = e.team || 'Ekipsiz';
      teams.set(team, [...(teams.get(team) ?? []), e]);
    }
  }
```

(the org tab already renders `teams` as `<section aria-label={team}>`; keep that markup). In `ui/labels.ts`, `KIND_LABELS.lead` becomes `'Departman başkanı'`. Add `.department-card`, `.department-details`, `.department-scope` (white-space: pre-wrap) and `.department-choice` styles next to `.org-team` in `styles.css`, reusing its box style.

- [ ] **Step 7: Run the web tests and typecheck**

Run: `cd ~/Projects/control-center-departments && pnpm --filter @cc/office-web test && pnpm --filter @cc/office-web typecheck`
Expected: PASS (fix any existing test that pinned the label "Ekip lideri" to "Departman başkanı").

- [ ] **Step 8: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(web): Departmanlar tab — open from a template or custom, name a head, move people, close; the org chart grouped by department"
```

---

### Task 14: Web — hiring into a department, plan cards with department streams and their notes

**Files:**
- Modify: `apps/office-web/src/ui/HireDialog.tsx`, `apps/office-web/src/ui/PlanCard.tsx`
- Test: `apps/office-web/src/ui/HireDialog.test.tsx`, `apps/office-web/src/ui/PlanCard.test.tsx`

**Interfaces:**
- Consumes: Task 13's store and API client.
- Produces: the hire dialog's `Departman` select and `Başkan olarak` checkbox; plan streams labelled `<ad> departmanı` with their latest plan and report.

- [ ] **Step 1: Failing tests**

`HireDialog.test.tsx` — add (the existing first test must keep passing unchanged: with no departments, no new field and no new key in the call):

```tsx
  it('hires into a department, as its head when ticked; without departments nothing changes', async () => {
    useOffice.setState({ departments: { d1: { id: 'd1', name: 'Pazarlama', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null } } } as never);
    render(<HireDialog />);
    fireEvent.change(screen.getByLabelText('Ad'), { target: { value: 'Ece' } });
    fireEvent.change(screen.getByLabelText('Rol tanımı'), { target: { value: 'r' } });
    expect(screen.getByLabelText('Başkan olarak')).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Departman'), { target: { value: 'd1' } });
    fireEvent.click(screen.getByLabelText('Başkan olarak'));
    fireEvent.click(screen.getByRole('button', { name: 'İşe al' }));
    await waitFor(() => expect(api.hire).toHaveBeenCalledWith(expect.objectContaining({ departmentId: 'd1', head: true })));
  });
```

and set `departments: {}` in this file's `beforeEach` state.

`PlanCard.test.tsx` — add `streamNotes: vi.fn(async () => [])` to the file's `vi.mock` api, `departments: {}, streamNotesRev: 0` to its `beforeEach` state, and:

```tsx
  it('a department’s stream: its name, and its latest plan and report', async () => {
    vi.mocked(api.streamNotes).mockResolvedValueOnce([
      {
        streamId: 'tanitim',
        plan: { id: 1, planId: 'p1', streamId: 'tanitim', kind: 'plan', text: 'Önce metin.', evidence: [], next: null, by: 'h', at: 1 },
        report: { id: 2, planId: 'p1', streamId: 'tanitim', kind: 'report', text: 'Hazır.', evidence: ['dosya'], next: null, by: 'h', at: 2 },
      },
    ]);
    const p = plan({ status: 'approved', streams: [{ id: 'tanitim', title: 'Tanıtım', owner: 'departman:d1', dependsOn: [], status: 'active' }] });
    useOffice.setState({ plans: { p1: p }, departments: { d1: { id: 'd1', name: 'Pazarlama', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null } } } as never);
    render(<PlanCard plan={p} />);
    expect(screen.getByText(/Pazarlama departmanı/)).toBeTruthy();
    expect(await screen.findByText(/Akış planı: Önce metin\./)).toBeTruthy();
    expect(screen.getByText(/Rapor: Hazır\./)).toBeTruthy();
    expect(api.streamNotes).toHaveBeenCalledWith('p1');
  });

  it('a plan without department streams asks for no notes', () => {
    render(<PlanCard plan={plan()} />);
    expect(api.streamNotes).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @cc/office-web test`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

`HireDialog.tsx`: read `const departments = useOffice((s) => Object.values(s.departments ?? {}).filter((x) => x.status === 'open'));`; when non-empty, render a `Departman` select (`<option value="">Merkez</option>` plus one per department) and a `Başkan olarak` checkbox disabled while no department is chosen; the submit call becomes `api.hire({ name, role, model, provider, characterId: character, ...(departmentId ? { departmentId, ...(head ? { head: true } : {}) } : {}) })`.

`PlanCard.tsx`: `PlanStreams` takes the plan's id and fetches the notes itself (a hook in `PlanCard` would sit after its early return). Replace `PlanStreams` with:

```tsx
type Notes = Array<{ streamId: string; plan: StreamNote | null; report: StreamNote | null }>;

/** A plan's streams (management cycle §3.4): who carries each — a person, a role to hire or a department — what it waits for, its status, and a department's latest plan and report (spec departments §8). */
function PlanStreams({ planId, streams }: { planId: string; streams: PlanStreamView[] }) {
  const views = useOffice((s) => s.views);
  const departments = useOffice((s) => s.departments);
  const rev = useOffice((s) => s.streamNotesRev);
  const [notes, setNotes] = useState<Notes>([]);
  const byDepartment = streams.some((x) => ownerDepartment(x.owner) !== null);
  useEffect(() => {
    if (!byDepartment) return;
    let live = true;
    api.streamNotes(planId).then((n) => live && setNotes(n), () => undefined);
    return () => {
      live = false;
    };
  }, [planId, byDepartment, rev]);
  const titles = new Map(streams.map((x) => [x.id, x.title]));
  const owner = (o: string) => {
    if (o.startsWith(`${STREAM_TO_HIRE}:`)) return o;
    const dep = ownerDepartment(o);
    return dep ? `${departments?.[dep]?.name ?? 'Departman'} departmanı` : (views[o]?.employee.name ?? '—');
  };
  return (
    <section className="plan-streams" aria-label="Akışlar">
      <h4>Akışlar</h4>
      <ul>
        {streams.map((x) => {
          const n = notes.find((y) => y.streamId === x.id);
          return (
            <li key={x.id} className={`plan-stream ${x.status}`}>
              <span className="plan-stream-title">{x.title}</span>
              <span className={`badge stream-${x.status}`}>{STREAM_STATUS_LABELS[x.status]}</span>
              <span className="muted plan-stream-meta">
                {owner(x.owner)}
                {x.dependsOn.length > 0 ? ` · önce: ${x.dependsOn.map((d) => titles.get(d) ?? d).join(', ')}` : ''}
              </span>
              {n?.plan && <p className="plan-stream-note">Akış planı: {n.plan.text}</p>}
              {n?.report && (
                <p className="plan-stream-note">
                  Rapor: {n.report.text}
                  {n.report.evidence.length > 0 ? ` (kanıt: ${n.report.evidence.join('; ')})` : ''}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

with `useEffect` added to the `react` import and `ownerDepartment, type StreamNote` to the `@cc/shared` import; the call site becomes `{streams.length > 0 && <PlanStreams planId={live.id} streams={streams} />}`.

- [ ] **Step 4: Run the web tests and typecheck**

Run: `pnpm --filter @cc/office-web test && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(web): hire into a department (as its head), plan cards show a department's streams with their latest plan and report"
```

---

### Task 15: Scenario, docs, renumbering and final verification

**Files:**
- Create: `apps/office-server/test/departments.scenario.test.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-10-13-departments-design.md` (only if the implementation had to differ), `apps/office-server/src/migrations.ts` + `apps/office-server/test/db.test.ts` (renumbering, Step 5)

- [ ] **Step 1: The scenario test (fake engine, no real claude)** — `test/departments.scenario.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { buildBoard } from '../src/company/board.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe('departments — the whole flow (spec §6.2)', () => {
  it('two departments carry a plan’s streams: notices, a stream plan, a reviewed task, a report, a pass between departments, the board, a head let go', async () => {
    const s = setup(12);
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f, ['coder', 'designer', 'manager'], undefined, undefined, { departments: true });
    c.budget.setConstitution({ autonomy: 'free', maxEmployees: 12 });
    const departments = c.departments!;
    const coordinator = c.company.hireCoordinator('sonnet');
    const tools = officeTools({
      company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget,
      engine: { sleep: async () => undefined, wake: () => undefined, sideQuestion: async () => ({ ok: true, answer: '' }) },
      plans: () => c.plans.list(), agenda: { text: () => '' }, departments,
    });
    const call = async (who: string, name: string, args: Record<string, unknown>) => String(await tools.find((x) => x.name === name)!.run({ employee: s.roster.get(who) } as never, args));
    const said = (id: string) => c.notices.pending(id).map((n) => `${n.topic}: ${n.text}`).join('\n');

    // 1. Two departments from templates, each with a head; a head hires into their own.
    const selin = c.company.hire(coordinator.id, { name: 'Selin', role: 'r' });
    await call(coordinator.id, 'departmentCreate', { template: 'yazilim-otomasyon', head: 'Selin' });
    const yaz = departments.find('Yazılım ve Otomasyon')!;
    const mert = c.company.hire(selin.id, { name: 'Mert', template: 'gelistirici', role: '' });
    const pzr = departments.create(OWNER, { template: 'pazarlama' });
    const pelin = c.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: pzr.id, head: true });
    expect(s.roster.get(mert.id)).toMatchObject({ departmentId: yaz.id, reportsTo: selin.id });

    // 2. The coordinator's plan gives a stream to each department.
    const reply = await call(coordinator.id, 'planPropose', {
      title: 'Site', goal: 'Yeni site', approach: 'a', method: METHOD,
      streams: [{ id: 'api', title: 'API', owner: 'departman: Yazılım ve Otomasyon' }, { id: 'tanitim', title: 'Tanıtım', owner: 'Pazarlama', dependsOn: ['api'] }],
    });
    expect(reply).toMatch(/API → Yazılım ve Otomasyon departmanı; Tanıtım → Pazarlama departmanı/);
    const plan = c.plans.list()[0]!;

    // 3. Each head hears its stream; Selin plans hers and opens a reviewed task.
    expect(said(selin.id)).toMatch(/stream\.assigned: “Site” planının “API” akışı \(api\) Yazılım ve Otomasyon departmanının/);
    expect(said(pelin.id)).toMatch(/stream\.assigned: “Site” planının “Tanıtım” akışı \(tanitim\) Pazarlama departmanının/);
    await call(selin.id, 'streamPlan', { planId: plan.id, streamId: 'api', text: 'Uç noktalar, sonra testler.' });
    const created = await call(selin.id, 'taskCreate', { assignee: 'Mert', title: 'Uç noktalar', planId: plan.id, streamId: 'api', reviewer: 'Selin' });
    const taskId = /Görev açıldı: (\S+)/.exec(created)![1]!;

    // 4. Mert hands in, Selin approves: the stream is done, Selin reports.
    c.company.start(taskId);
    c.company.finish(mert.id, taskId, { summary: 'bitti', outputs: [], learned: '' });
    const review = c.tasks.list({ assignee: selin.id }).find((t) => t.kind === 'review')!;
    c.company.reviewDecide(selin.id, review.id, { decision: 'approve' });
    expect(said(selin.id)).toMatch(/stream\.done: “Site” planının “API” akışının açık görevi kalmadı/);
    await call(selin.id, 'streamReport', { planId: plan.id, streamId: 'api', summary: 'Uç noktalar hazır.', evidence: ['pnpm test geçti'], next: 'Tanıtım başlayabilir' });
    expect(said(coordinator.id)).toMatch(/stream\.report: Selin “Site” planının “API” akışını raporladı: Uç noktalar hazır\./);

    // 5. Pazarlama asks Yazılım ve Otomasyon for a form: it reaches Selin.
    expect(await call(pelin.id, 'taskPass', { to: 'Yazılım ve Otomasyon', title: 'İletişim formu' })).toMatch(/Yazılım ve Otomasyon departmanına gitti: başkanı Selin/);
    expect(c.tasks.list({ assignee: selin.id }).find((t) => t.title === 'İletişim formu')!.description).toMatch(/^Yazılım ve Otomasyon departmanına/);

    // 6. The board shows both departments, the finished stream and its report.
    const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
    const deps = { db: s.db, events: s.events, roster: s.roster, company: c.company, tasks: c.tasks, plans: c.plans, state: c.state, agenda, budget: c.budget, proposals: c.proposals, quota: new QuotaTracker(s.db, s.events), kpis: c.kpis, departments };
    const board = buildBoard(deps, { since: 0, now: Date.now() });
    expect(board.text).toMatch(/- Yazılım ve Otomasyon — başkan Selin · 2 kişi .*akışlar: api \(bitti\).*son rapor: “Uç noktalar hazır\.”/);
    expect(board.text).toMatch(/- Pazarlama — başkan Pelin · 1 kişi .*akışlar: tanitim \(planlı\)/);

    // 7. Selin is let go: her department is headless; its finished stream is not returned; Pazarlama keeps its head.
    s.roster.update(selin.id, { lifecycle: 'archived' });
    c.company.releaseTasksOf(selin.id);
    expect(departments.get(yaz.id).headId).toBeNull();
    expect(s.roster.get(mert.id).reportsTo).toBeNull();
    expect(said(coordinator.id)).not.toMatch(/stream\.returned/);
    expect(departments.get(pzr.id).headId).toBe(pelin.id);
  });
});
```

Use the review decision value the review tests use if it is not `'approve'` (see `REVIEW_DECISIONS` in `@cc/shared`), and the `finish` result shape `test/company.test.ts` uses if `finish` asks for evidence.

- [ ] **Step 2: README** — replace the section `## Öneriler ve ekip liderleri` with `## Departmanlar ve öneriler`, in the README's voice (Turkish, concise), covering: what a department is (room, head, members; at most 6), the five templates and opening a custom one (Şirket → Departmanlar, or the coordinator's `departmentCreate`), how work flows (plan streams owned by departments, the head plans/runs/reports with `streamPlan`/`streamReport`, `taskPass` to a department), what a head may do (hire into their own, model, sleep/wake, employee file) and may not, teams of before adopted automatically at start, and the proposals paragraph kept (now "başkanlar" instead of "ekip liderleri"). Keep the other sections unchanged.

- [ ] **Step 3: Full verification**

Run, from the worktree root:

```bash
pnpm -r typecheck
pnpm test
```

Expected: typecheck clean; office-server all passing (baseline 1227 + the new tests, 21 skipped real tests), office-web all passing (baseline 231 + the new tests). Paste the summary lines into the final report.

- [ ] **Step 4: Commit**

```bash
git add README.md apps/office-server/test/departments.scenario.test.ts docs
git commit -m "test(departments): the whole flow on the fake engine; README: departments"
```

- [ ] **Step 5: Renumber when integrating (only when `main` has the knowledge base's v24)**

```bash
git fetch origin && git log --oneline origin/main -5   # is feat/b10-core merged? its migration name: 'knowledge base: the documents behind the knowledge pieces'
git rebase main                                         # resolve migrations.ts: keep main's 24, ours after it
```

Then in `apps/office-server/src/migrations.ts` change our entry's `version: 24` to `version: 25` (and its comment), in `test/db.test.ts` rename `V24_TABLES` to `V25_TABLES` built on main's `V24_TABLES`, and our test's `upTo(23)`/`upTo(24)`/`migrateDown(db, 23)` to `upTo(24)`/`upTo(25)`/`migrateDown(db, 24)`. Run `pnpm test`; commit `chore(departments): migration 25, after the knowledge base's 24`. Never apply a renumbered migration to the live database before the code that has it is the office's code (the migration guard stops the office otherwise).
