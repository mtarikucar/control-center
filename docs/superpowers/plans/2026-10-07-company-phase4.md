# Company Phase 4 — Proposals, Revisions, Team Leads, 3D Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees carry needs, ideas, objections and purchase requests upwards and ask each other quick questions; the coordinator decides or brings big things to the owner (purchases always); team leads run their own teams; a declined revision keeps the plan on its approved version; the coordinator is reminded to report daily; and the 3D office shows it all (the coordinator in the meeting room while planning, the current task and a lead badge on tags, a note when work is passed, a report badge).

**Architecture:** Migration v5 adds `proposals` and `plans.approved_snapshot`. `Company` gains proposals (`openProposal`, `decideProposal`, `ownerDecideProposal`), leads (`appointLead`, lead rights over their team), and rule B on decline (restore the approved snapshot). The Dispatcher's tick reminds the coordinator to report. New tools (`propose`, `proposalsOpen`, `proposalDecide`, `askColleague` via the existing side question, `appointLead`; leads get `taskCreate`/`taskAssign`/`taskReprioritize` for their team). Owner routes approve or reject what waits for them. The web shows proposal cards (Onayla / Reddet), an Öneriler tab, richer tags and a meeting-room zone.

**Tech Stack:** as phases 1–3.

**Spec:** `docs/superpowers/specs/2026-10-06-company-design.md` (§1 items 5–6, §3.1 leads, §4.1 plan states, §4.4 proposals, §4.5 rule B and reports, §7 tools, §8 3D, §12 phase 4).

## Global Constraints

- Node 24 type stripping: no enums, no parameter properties, `import type` for types, `.ts` extensions in imports.
- Every migration is reversible: `up` + `down`, `down` removes exactly what `up` added, round trip tested.
- Tool descriptions in English; tool results, errors and UI text in Turkish.
- Commits: plain conventional commits, no AI trailer.
- Real claude only opt-in (`OFFICE_SMOKE=1`), temp data dirs, never port 4319; clean `~/.claude/projects/-tmp-cc-*` afterwards.

## Spec rulings (decided here)

- **Proposal kinds** (tool values → labels): `need` İhtiyaç, `purchase` Satın alma, `idea` Fikir, `objection` İtiraz. **Statuses:** `open` (with the proposer's lead, else the coordinator), `owner` (waiting for the owner), `accepted`, `declined`. A purchase goes straight to the owner (the coordinator is told). The lead or coordinator decides `accept` / `decline` (written to the decision log) or `escalate`: a lead escalates to the coordinator, the coordinator to the owner. The owner approves or rejects on the card; that is an owner decision in the log, and the proposer and coordinator are told.
- **`askColleague`** is the existing side question (a fork of the colleague's session answers; it is never interrupted and cannot do work), prefixed with who asks.
- **Leads:** `appointLead(employee, team, lead=true)` (coordinator) makes a member lead of a team (required); members of that team report to them, and new hires into that team too. `lead: false` ends it. A lead may `taskCreate` for their team (others get `taskPass`), and `taskAssign`/`taskReprioritize` within it; they cannot hire. The coordinator cannot be a lead.
- **Rule B:** revising an approved (or done) plan saves its approved version; while the revision waits, the plan's new scope is closed (phase 1: no tasks for a draft plan) and running tasks go on; if the owner declines the revision the plan returns to its approved version (`plan.changed` `kept`) instead of being declined.
- **Daily report:** once at least 24 h have passed since the coordinator's last report (or hire, or last reminder) and something was finished since or work is open, the coordinator gets a notice to `reportToOwner`; an unseen report shows as a badge on the coordinator's tag until the owner opens its panel.
- **Meeting room:** while the coordinator has a draft plan waiting (it is discussing it with the owner) and is working or idle, it stands at the meeting table (x 10.5, z 3.3, facing north — reachable, checked).
- **Pass note:** a task created by an employee for someone else (a pass) shows "Yeni iş: …" on the receiver's tag for 8 s.

## Review Focus

1. A purchase never waits for a lead or the coordinator: it reaches the owner even if it is marked, re-routed or escalated by anyone; only the owner settles it (Task 3).
2. Deciding a proposal that is not yours, or one already decided or waiting for the owner, fails with a clear Turkish error and changes nothing (Task 3).
3. A lead cannot assign or reprioritize outside their team or create a task there with `taskCreate`; a member cannot do either (Task 3, Task 5).
4. Declining a revision of an approved plan leaves the plan approved on its old version, with its tasks; declining a never-approved plan still declines it (Task 3).
5. `askColleague` to someone who never spoke, to yourself, or to an unknown name fails clearly; a colleague who is asleep or stopped can still be asked (Task 5).

## File Structure

```
packages/shared/src/
  proposal.ts        NEW Proposal, kinds, statuses, changes
  company.ts         PlanChange + 'kept'
  events.ts          + proposal.changed; snapshot proposals?
  index.ts           + export proposal.ts
apps/office-server/src/
  migrations.ts      + v5
  company/proposal-store.ts NEW ProposalStore
  company/store.ts   PlanStore.saveApproved/approvedSnapshot/restoreApproved/clearApproved
  company/company.ts proposals, leads, rule B
  company/memory.ts  recordOwnerDecision
  company/dispatcher.ts daily report reminder
  company/roles.ts   guide: propose, askColleague, proposals, leads
  mcp/tools.ts       propose, proposalsOpen, proposalDecide, askColleague, appointLead; lead rights
  api.ts, main.ts    proposals routes, snapshot, wiring
apps/office-web/src/
  store/reducers.ts  proposals, pings, unseen reports
  store/office.ts    select() clears unseen reports
  net/api.ts         proposals(), approveProposal(), rejectProposal()
  ui/labels.ts       proposal labels
  ui/ProposalCard.tsx NEW
  ui/EventItem.tsx   proposal cards, kept plans
  ui/CompanyView.tsx + Öneriler tab
  ui/TopBar.tsx      count of what waits for the owner
  office/behavior.ts + meeting zone, planning
  office/layout.ts   meetingSpots
  scene/CharactersLayer.tsx, scene/Character.tsx  tag: badge, task, pass note, report badge; planning
```

---

### Task 1: Shared types and migration v5

**Files:**
- Create: `packages/shared/src/proposal.ts`
- Modify: `packages/shared/src/company.ts`, `packages/shared/src/events.ts`, `packages/shared/src/index.ts`, `apps/office-server/src/migrations.ts`
- Test: `apps/office-server/test/db.test.ts`

**Interfaces:**
- Produces: `PROPOSAL_KINDS`, `ProposalKind`, `PROPOSAL_STATUSES`, `ProposalStatus`, `Proposal`, `ProposalChange`; `PlanChange` gains `'kept'`; event `proposal.changed {change, proposal}`; `OfficeSnapshot.proposals?: Proposal[]`.

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/db.test.ts`:
- add after `V4_TABLES`: `const V5_TABLES = [...V4_TABLES, 'proposals'].sort();`
- in the three full-migration tests ("applies every migration up", "round-trips…", "is a no-op…") change the expected version `4` → `5` and `V4_TABLES` → `V5_TABLES`;
- in "v4 adds the constitution…": the `migrateUp(db)` after the insert becomes `migrateUp(db, upTo(4))` and its last line `expect(migrateUp(db, upTo(4))).toBe(4);`
- append:

```ts
  it('v5 adds proposals and the approved snapshot of plans; v5 down restores v4 and keeps plans', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(4));
    db.prepare(
      `INSERT INTO plans (id, title, goal, approach, people, steps, risks, status, version, proposed_by, created_at, updated_at)
       VALUES ('p1', 'P', 'g', 'a', '', '[]', '', 'approved', 1, 'c', 1, 1)`,
    ).run();
    migrateUp(db);
    expect(tables(db)).toEqual(V5_TABLES);
    expect({ ...(db.prepare('SELECT approved_snapshot FROM plans').get() as object) }).toEqual({ approved_snapshot: null });
    expect(migrateDown(db, 4)).toBe(4);
    expect(tables(db)).toEqual(V4_TABLES);
    expect(columns(db, 'plans')).not.toContain('approved_snapshot');
    expect(db.prepare('SELECT COUNT(*) AS n FROM plans').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db)).toBe(5);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/db.test.ts`
Expected: FAIL — version 4 instead of 5.

- [ ] **Step 3: Shared types**

Create `packages/shared/src/proposal.ts`:

```ts
/** What an employee carries upwards (spec §4.4): a need, a purchase, an idea, an objection ("we are on the wrong track"). */
export const PROPOSAL_KINDS = ['need', 'purchase', 'idea', 'objection'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** open: with the proposer's lead or the coordinator; owner: waiting for the owner (every purchase, and what is escalated). */
export const PROPOSAL_STATUSES = ['open', 'owner', 'accepted', 'declined'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface Proposal {
  id: string;
  ts: number;
  by: string;
  kind: ProposalKind;
  title: string;
  text: string;
  /** For a purchase: the price, USD. */
  usd: number | null;
  planId: string | null;
  status: ProposalStatus;
  /** The lead or coordinator who decides it now (null while it waits for the owner, or once decided by them). */
  routedTo: string | null;
  /** An employee id, or OWNER. */
  decidedBy: string | null;
  note: string | null;
  decidedAt: number | null;
}

export type ProposalChange = 'opened' | 'escalated' | 'accepted' | 'declined';
```

In `packages/shared/src/company.ts` change `PlanChange` to:

```ts
/** `reopened`: a done plan got a new task. `kept`: the owner declined a revision; the plan goes on as approved. */
export type PlanChange = 'proposed' | 'revised' | 'approved' | 'declined' | 'done' | 'reopened' | 'kept';
```

(replace the existing `reopened` comment line with this one.)

In `packages/shared/src/events.ts`: add `import type { Proposal, ProposalChange } from './proposal.ts';`, add before `| { type: 'error'; message: string };`:

```ts
  | { type: 'proposal.changed'; change: ProposalChange; proposal: Proposal }
```

and in `OfficeSnapshot` after `plans?: Plan[];`: `proposals?: Proposal[];`

`packages/shared/src/index.ts`: add `export * from './proposal.ts';`.

Also in `apps/office-web/src/ui/EventItem.tsx`, the `PLAN_CHANGE` map needs the new key so the web compiles: add `kept: 'revizyon reddedildi, onaylı sürümüyle sürüyor',`.

- [ ] **Step 4: Migration v5**

Append to `MIGRATIONS` in `apps/office-server/src/migrations.ts`:

```ts
  {
    version: 5,
    name: 'proposals, approved plan snapshots',
    up: `
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        by_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        usd REAL,
        plan_id TEXT,
        status TEXT NOT NULL,
        routed_to TEXT,
        decided_by TEXT,
        note TEXT,
        decided_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS proposals_status ON proposals (status, ts);
      ALTER TABLE plans ADD COLUMN approved_snapshot TEXT;`,
    down: `
      ALTER TABLE plans DROP COLUMN approved_snapshot;
      DROP INDEX IF EXISTS proposals_status;
      DROP TABLE IF EXISTS proposals;`,
  },
```

- [ ] **Step 5: Run the tests, typecheck, commit**

Run: `pnpm --filter @cc/office-server exec vitest run test/db.test.ts && pnpm test && pnpm typecheck`
Expected: PASS.

```bash
git add packages/shared apps/office-server/src/migrations.ts apps/office-server/test/db.test.ts apps/office-web/src/ui/EventItem.tsx
git commit -m "feat(company): proposals and approved plan snapshots in the data model

Migration v5 (reversible) adds the proposals table and keeps a plan's approved
version while a revision waits; shared types for proposals and the kept plan
change."
```

---

### Task 2: Proposal store and plan snapshots

**Files:**
- Create: `apps/office-server/src/company/proposal-store.ts`
- Modify: `apps/office-server/src/company/store.ts`
- Test: `apps/office-server/test/proposal-store.test.ts`

**Interfaces:**
- Produces:
  - `class ProposalStore { constructor(db, now?); create(p: Omit<Proposal, 'id' | 'ts' | 'decidedBy' | 'note' | 'decidedAt'>): Proposal; get(id): Proposal; list(o?: { statuses?: ProposalStatus[]; routedTo?: string; limit?: number }): Proposal[] /* newest first */; update(id, patch: Partial<Pick<Proposal, 'status' | 'routedTo' | 'decidedBy' | 'note' | 'decidedAt'>>): Proposal }`
  - `PlanStore.saveApproved(id): void`, `PlanStore.approvedSnapshot(id): Plan | null`, `PlanStore.restoreApproved(id): Plan`, `PlanStore.clearApproved(id): void`

- [ ] **Step 1: Write the failing test**

Create `apps/office-server/test/proposal-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateUp, openDb } from '../src/db.ts';
import { ProposalStore } from '../src/company/proposal-store.ts';
import { PlanStore } from '../src/company/store.ts';

function stores() {
  const db = openDb(':memory:');
  migrateUp(db);
  let t = 1_000;
  const now = () => (t += 10);
  return { proposals: new ProposalStore(db, now), plans: new PlanStore(db, now) };
}

describe('ProposalStore', () => {
  it('opens proposals, lists them newest first by status and decider, and records the decision', () => {
    const { proposals } = stores();
    const a = proposals.create({ by: 'e1', kind: 'idea', title: 'Blog', text: 'haftalık', usd: null, planId: null, status: 'open', routedTo: 'c' });
    const b = proposals.create({ by: 'e2', kind: 'purchase', title: 'Telefon hattı', text: 'müşteriler arıyor', usd: 10, planId: 'p1', status: 'owner', routedTo: null });
    expect(proposals.get(a.id)).toEqual({ ...a, decidedBy: null, note: null, decidedAt: null });
    expect(proposals.list().map((p) => p.id)).toEqual([b.id, a.id]);
    expect(proposals.list({ statuses: ['owner'] }).map((p) => p.title)).toEqual(['Telefon hattı']);
    expect(proposals.list({ routedTo: 'c' }).map((p) => p.id)).toEqual([a.id]);
    expect(proposals.update(a.id, { status: 'accepted', decidedBy: 'c', note: 'iyi fikir', decidedAt: 5 })).toMatchObject({ status: 'accepted', note: 'iyi fikir' });
    expect(() => proposals.get('nope')).toThrow(/Öneri bulunamadı/);
  });
});

describe('PlanStore — approved snapshots', () => {
  it('keeps the approved version while a revision waits, restores it, or forgets it', () => {
    const { plans } = stores();
    const p = plans.create({ title: 'Eski', goal: 'g', approach: 'a', people: '', steps: ['bir'], quotaPct: null, usd: 10, days: null, risks: '', proposedBy: 'c' });
    plans.update(p.id, { status: 'approved', approvedAt: 7 });
    expect(plans.approvedSnapshot(p.id)).toBeNull();
    plans.saveApproved(p.id);
    plans.update(p.id, { title: 'Yeni', usd: 50, version: 2, status: 'draft', approvedAt: null });
    expect(plans.approvedSnapshot(p.id)).toMatchObject({ title: 'Eski', status: 'approved', version: 1 });
    expect(plans.restoreApproved(p.id)).toMatchObject({ title: 'Eski', usd: 10, status: 'approved', version: 1, approvedAt: 7 });
    expect(plans.approvedSnapshot(p.id)).toBeNull();
    plans.saveApproved(p.id);
    plans.clearApproved(p.id);
    expect(plans.approvedSnapshot(p.id)).toBeNull();
    expect(() => plans.restoreApproved(p.id)).toThrow(/onaylı sürümü yok/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/proposal-store.test.ts`
Expected: FAIL — cannot resolve `../src/company/proposal-store.ts`.

- [ ] **Step 3: Implement**

Create `apps/office-server/src/company/proposal-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Proposal, ProposalKind, ProposalStatus } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

interface ProposalRow {
  id: string;
  ts: number;
  by_id: string;
  kind: string;
  title: string;
  text: string;
  usd: number | null;
  plan_id: string | null;
  status: string;
  routed_to: string | null;
  decided_by: string | null;
  note: string | null;
  decided_at: number | null;
}

const fromRow = (r: ProposalRow): Proposal => ({
  id: r.id,
  ts: r.ts,
  by: r.by_id,
  kind: r.kind as ProposalKind,
  title: r.title,
  text: r.text,
  usd: r.usd,
  planId: r.plan_id,
  status: r.status as ProposalStatus,
  routedTo: r.routed_to,
  decidedBy: r.decided_by,
  note: r.note,
  decidedAt: r.decided_at,
});

export type ProposalPatch = Partial<Pick<Proposal, 'status' | 'routedTo' | 'decidedBy' | 'note' | 'decidedAt'>>;

export class ProposalStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(p: Omit<Proposal, 'id' | 'ts' | 'decidedBy' | 'note' | 'decidedAt'>): Proposal {
    const proposal: Proposal = { ...p, id: randomUUID(), ts: this.#now(), decidedBy: null, note: null, decidedAt: null };
    this.#db
      .prepare(
        `INSERT INTO proposals (id, ts, by_id, kind, title, text, usd, plan_id, status, routed_to, decided_by, note, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      .run(proposal.id, proposal.ts, proposal.by, proposal.kind, proposal.title, proposal.text, proposal.usd, proposal.planId, proposal.status, proposal.routedTo);
    return proposal;
  }

  get(id: string): Proposal {
    const row = this.#db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as unknown as ProposalRow | undefined;
    if (!row) throw new NotFoundError(`Öneri bulunamadı: ${id}`);
    return fromRow(row);
  }

  list(o: { statuses?: ProposalStatus[]; routedTo?: string; limit?: number } = {}): Proposal[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (o.statuses && o.statuses.length > 0) {
      where.push(`status IN (${o.statuses.map(() => '?').join(', ')})`);
      params.push(...o.statuses);
    }
    if (o.routedTo !== undefined) {
      where.push('routed_to = ?');
      params.push(o.routedTo);
    }
    const rows = this.#db
      .prepare(`SELECT * FROM proposals ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC, rowid DESC LIMIT ?`)
      .all(...params, o.limit ?? 200) as unknown as ProposalRow[];
    return rows.map(fromRow);
  }

  update(id: string, patch: ProposalPatch): Proposal {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE proposals SET status = ?, routed_to = ?, decided_by = ?, note = ?, decided_at = ? WHERE id = ?')
      .run(next.status, next.routedTo, next.decidedBy, next.note, next.decidedAt, id);
    return next;
  }
}
```

In `apps/office-server/src/company/store.ts` add to `PlanStore` (after `update`):

```ts
  /** A revision of an approved plan starts: keep the approved version until the owner decides (rule B). */
  saveApproved(id: string): void {
    this.#db.prepare('UPDATE plans SET approved_snapshot = ? WHERE id = ?').run(JSON.stringify(this.get(id)), id);
  }

  approvedSnapshot(id: string): Plan | null {
    const row = this.#db.prepare('SELECT approved_snapshot FROM plans WHERE id = ?').get(id) as unknown as { approved_snapshot: string | null } | undefined;
    return row?.approved_snapshot ? (JSON.parse(row.approved_snapshot) as Plan) : null;
  }

  /** The owner declined the revision: the plan goes on as it was approved. */
  restoreApproved(id: string): Plan {
    const snap = this.approvedSnapshot(id);
    if (!snap) throw new NotFoundError(`Bu planın saklanmış onaylı sürümü yok: ${id}`);
    const { id: _id, createdAt: _c, proposedBy: _p, updatedAt: _u, ...fields } = snap;
    const restored = this.update(id, fields);
    this.clearApproved(id);
    return restored;
  }

  clearApproved(id: string): void {
    this.#db.prepare('UPDATE plans SET approved_snapshot = NULL WHERE id = ?').run(id);
  }
```

(Destructuring with `_`-prefixed names drops those fields; if the lint rejects unused names, build `fields` with an explicit object instead.)

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @cc/office-server exec vitest run test/proposal-store.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/proposal-store.ts apps/office-server/src/company/store.ts apps/office-server/test/proposal-store.test.ts
git commit -m "feat(company): a proposal store, and plans that keep their approved version"
```

---

### Task 3: Proposals, leads and rule B in the company

**Files:**
- Modify: `apps/office-server/src/company/company.ts`, `apps/office-server/src/company/memory.ts`, `apps/office-server/test/company-helpers.ts`
- Test: `apps/office-server/test/proposals.test.ts`, `apps/office-server/test/company.test.ts`

**Interfaces:**
- Consumes: `ProposalStore`, `PlanStore` snapshots (Task 2), `Memory.recordDecision`.
- Produces:
  - `CompanyDeps.proposals?: ProposalStore`
  - `Company.openProposal(by, p: { kind: string; title: string; text: string; usd?: number | null; planId?: string | null }): Proposal`
  - `Company.decideProposal(by, id, d: { decision: string; note?: string }): Proposal` (`accept` | `decline` | `escalate`)
  - `Company.ownerDecideProposal(id, approve: boolean, note?: string): Proposal`
  - `Company.proposalsFor(id): Proposal[]` (open, routed to them; the coordinator also sees those routed to nobody)
  - `Company.appointLead(by, id, o?: { team?: string; lead?: boolean }): Employee`
  - `assign`/`reprioritize` accept a lead within their team; `hire` into a team with a lead reports to that lead
  - rule B: `revise` saves the approved version; `approve` forgets it; `decline` of a revision restores it (`plan.changed` `kept`)
  - `Memory.recordOwnerDecision(d: { title; chosen; reason; planId?: string | null }): Decision`
  - `companyFor` passes a `ProposalStore` and returns `proposals`

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/company-helpers.ts`: import `ProposalStore` from `../src/company/proposal-store.ts`, create `const proposals = new ProposalStore(s.db);`, pass `proposals` to the `Company`, and return it.

Create `apps/office-server/test/proposals.test.ts`:

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

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f);
  const coord = c.company.hireCoordinator();
  const ada = c.company.hire(coord.id, { name: 'Ada', role: 'r', team: 'İçerik' });
  const can = c.company.hire(coord.id, { name: 'Can', role: 'r', team: 'İçerik' });
  return { ...s, ...c, engine: f.engine, coord, ada, can };
}

describe('Proposals', () => {
  it('goes to the coordinator, who decides it into the decision log; the proposer hears', () => {
    const t = make();
    const p = t.company.openProposal(t.ada.id, { kind: 'idea', title: 'Haftalık blog', text: 'Her pazartesi bir yazı.' });
    expect(p).toMatchObject({ status: 'open', routedTo: t.coord.id, kind: 'idea' });
    expect(t.notices.pending(t.coord.id).at(-1)?.text).toContain('Haftalık blog');
    expect(t.company.proposalsFor(t.coord.id).map((x) => x.id)).toEqual([p.id]);
    const done = t.company.decideProposal(t.coord.id, p.id, { decision: 'accept', note: 'Başla.' });
    expect(done).toMatchObject({ status: 'accepted', decidedBy: t.coord.id, note: 'Başla.' });
    expect(t.notices.pending(t.ada.id).at(-1)?.text).toMatch(/kabul edildi: Başla\./);
    expect(t.memory.decisions().map((d) => d.title)).toContain('Öneri: Haftalık blog');
  });

  it('review focus: a purchase goes straight to the owner, and only the owner settles it', () => {
    const t = make();
    const p = t.company.openProposal(t.ada.id, { kind: 'purchase', title: 'Telefon hattı', text: 'Müşteriler arıyor.', usd: 12 });
    expect(p).toMatchObject({ status: 'owner', routedTo: null, usd: 12 });
    expect(t.notices.pending(t.coord.id).at(-1)?.text).toMatch(/sahibine bir satın alma talebi açtı/);
    expect(() => t.company.decideProposal(t.coord.id, p.id, { decision: 'accept' })).toThrow(/sahibinin kararını bekliyor/);
    const approved = t.company.ownerDecideProposal(p.id, true);
    expect(approved).toMatchObject({ status: 'accepted', decidedBy: OWNER });
    expect(t.notices.pending(t.ada.id).at(-1)?.text).toMatch(/satın alımını onayladı/);
    expect(t.notices.pending(t.coord.id).at(-1)?.text).toMatch(/satın alımını onayladı/);
    expect(t.memory.decisions()[0]).toMatchObject({ by: OWNER, chosen: 'Onaylandı' });
    expect(() => t.company.ownerDecideProposal(p.id, false)).toThrow(/sahibinin kararını beklemiyor/);
  });

  it('a lead decides their team’s proposals or escalates to the coordinator, who can escalate to the owner', () => {
    const t = make();
    t.company.appointLead(t.coord.id, t.ada.id, { team: 'İçerik' });
    const p = t.company.openProposal(t.can.id, { kind: 'objection', title: 'Yanlış yoldayız', text: 'Video yerine blog.' });
    expect(p.routedTo).toBe(t.ada.id);
    const up = t.company.decideProposal(t.ada.id, p.id, { decision: 'escalate', note: 'Plan değişir.' });
    expect(up).toMatchObject({ status: 'open', routedTo: t.coord.id });
    expect(t.company.decideProposal(t.coord.id, p.id, { decision: 'escalate' })).toMatchObject({ status: 'owner', routedTo: null });
    expect(t.company.ownerDecideProposal(p.id, false, 'Videoya devam.')).toMatchObject({ status: 'declined', note: 'Videoya devam.' });
    expect(t.notices.pending(t.can.id).at(-1)?.text).toMatch(/onaylamadı: Videoya devam\./);
  });

  it('review focus: deciding someone else’s or an already decided proposal fails and changes nothing', () => {
    const t = make();
    const p = t.company.openProposal(t.ada.id, { kind: 'need', title: 'Test ortamı', text: 'Bir staging sunucusu.' });
    expect(() => t.company.decideProposal(t.can.id, p.id, { decision: 'accept' })).toThrow(/sana gelmedi/);
    expect(() => t.company.decideProposal(t.coord.id, p.id, { decision: 'maybe' })).toThrow(/accept, decline ya da escalate/);
    t.company.decideProposal(t.coord.id, p.id, { decision: 'decline', note: 'Şimdi değil.' });
    expect(() => t.company.decideProposal(t.coord.id, p.id, { decision: 'accept' })).toThrow(/artık açık değil/);
    expect(t.proposals.get(p.id).status).toBe('declined');
    expect(() => t.company.openProposal(t.ada.id, { kind: 'wish', title: 'x', text: 'y' })).toThrow(/Bilinmeyen öneri türü/);
  });
});

describe('Team leads', () => {
  it('a lead runs their own team: members report to them, new hires too; ending it undoes that', () => {
    const t = make();
    const lead = t.company.appointLead(t.coord.id, t.ada.id, { team: 'İçerik' });
    expect(lead).toMatchObject({ kind: 'lead', team: 'İçerik' });
    expect(t.roster.get(t.can.id).reportsTo).toBe(t.ada.id);
    expect(t.reloaded).toContain(t.ada.id);
    const ece = t.company.hire(t.coord.id, { name: 'Ece', role: 'r', team: 'İçerik' });
    expect(ece.reportsTo).toBe(t.ada.id);
    t.company.appointLead(t.coord.id, t.ada.id, { lead: false });
    expect(t.roster.get(t.ada.id).kind).toBe('member');
    expect(t.roster.get(t.can.id).reportsTo).toBeNull();
    expect(() => t.company.appointLead(t.coord.id, t.coord.id, { team: 'x' })).toThrow(/Koordinatör ekip lideri yapılamaz/);
    expect(() => t.company.appointLead(t.coord.id, t.can.id, { team: '' })).toThrow(/ekibi olmalı/);
    expect(() => t.company.appointLead(t.can.id, t.ada.id, { team: 'İçerik' })).toThrow(/Yalnız koordinatör/);
  });

  it('review focus: a lead assigns and reprioritizes inside their team only', () => {
    const t = make();
    const bob = t.company.hire(t.coord.id, { name: 'Bob', role: 'r', team: 'Ürün' });
    t.company.appointLead(t.coord.id, t.ada.id, { team: 'İçerik' });
    const mine = t.company.createTask(t.coord.id, { assignee: t.can.id, title: 'içerik işi' });
    const theirs = t.company.createTask(t.coord.id, { assignee: bob.id, title: 'ürün işi' });
    expect(t.company.reprioritize(t.ada.id, mine.id, 1).priority).toBe(1);
    expect(t.company.assign(t.ada.id, mine.id, t.ada.id).assignee).toBe(t.ada.id);
    expect(() => t.company.reprioritize(t.ada.id, theirs.id, 1)).toThrow(/kendi ekibindeki/);
    expect(() => t.company.assign(t.ada.id, mine.id, bob.id)).toThrow(/kendi ekibindeki/);
    expect(() => t.company.assign(t.can.id, mine.id, t.can.id)).toThrow(/Yalnız koordinatör/);
  });
});

describe('Rule B — revisions', () => {
  it('review focus: declining a revision keeps the plan on its approved version with its tasks', () => {
    const t = make();
    const plan = t.company.propose(t.coord.id, { title: 'Video', goal: 'g', approach: 'a', usd: 20 });
    t.company.approve(plan.id);
    const task = t.company.createTask(t.coord.id, { assignee: t.ada.id, title: 'senaryo', planId: plan.id });
    const revision = t.company.revise(t.coord.id, plan.id, { title: 'Video ve blog', usd: 60 });
    expect(revision).toMatchObject({ status: 'draft', version: 2 });
    expect(() => t.company.createTask(t.coord.id, { assignee: t.ada.id, title: 'blog', planId: plan.id })).toThrow(/henüz onaylanmadı/);
    const kept = t.company.decline(plan.id);
    expect(kept).toMatchObject({ status: 'approved', version: 1, title: 'Video', usd: 20 });
    expect(t.tasks.get(task.id).planId).toBe(plan.id);
    expect(t.notices.pending(t.coord.id).at(-1)?.text).toMatch(/onaylı sürümüyle/);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'plan.changed' && e.event.change === 'kept')).toBe(true);
  });

  it('approving a revision forgets the old version; declining a plan never approved still declines it', () => {
    const t = make();
    const plan = t.company.propose(t.coord.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    t.company.revise(t.coord.id, plan.id, { days: 9 });
    t.company.revise(t.coord.id, plan.id, { days: 10 });
    t.company.approve(plan.id);
    expect(t.plans.approvedSnapshot(plan.id)).toBeNull();
    const fresh = t.company.propose(t.coord.id, { title: 'Q', goal: 'g', approach: 'a' });
    expect(t.company.decline(fresh.id).status).toBe('declined');
  });
});
```

(`t.memory`, `t.proposals`, `t.plans`, `t.notices`, `t.reloaded` come from `companyFor`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/proposals.test.ts`
Expected: FAIL — `openProposal` is not a function.

- [ ] **Step 3: The owner's decisions in the log**

In `apps/office-server/src/company/memory.ts`, after `revertDecision`, add:

```ts
  /** The owner's own decisions: approving a purchase, settling what was brought to them. */
  recordOwnerDecision(d: { title: string; chosen: string; reason: string; planId?: string | null }): Decision {
    const decision = this.#d.decisions.create({
      by: OWNER,
      title: clean(d.title, 'Karar başlığı', 160, true),
      chosen: clean(d.chosen, 'Seçilen', 2000, true),
      reason: clean(d.reason, 'Gerekçe', 4000, true),
      alternatives: [],
      planId: d.planId ?? null,
      reverts: null,
    });
    this.#emit(this.#coordinator()?.id ?? null, { type: 'decision.recorded', decision });
    return decision;
  }
```

- [ ] **Step 4: The company**

In `apps/office-server/src/company/company.ts`:
- imports: `PROPOSAL_KINDS` (value) and `type Proposal`, `type ProposalKind` from `@cc/shared`; `import type { ProposalStore } from './proposal-store.ts';`
- `CompanyDeps` gains `/** Proposals (absent in tests that do not care). */ proposals?: ProposalStore;`
- add after the plan methods (`decline`):

```ts
  // ── proposals ─────────────────────────────────────────────────────────────

  /**
   * Someone carries a need, an idea, an objection or a purchase upwards (spec §4.4): to their lead, else the
   * coordinator. A purchase always goes to the owner (the coordinator is told), as does anything the coordinator raises.
   */
  openProposal(by: string, p: { kind: string; title: string; text: string; usd?: number | null; planId?: string | null }): Proposal {
    const who = this.#d.roster.get(by);
    if (!(PROPOSAL_KINDS as readonly string[]).includes(p.kind)) {
      throw new ValidationError(`Bilinmeyen öneri türü: ${p.kind}. Türler: need (ihtiyaç), purchase (satın alma), idea (fikir), objection (itiraz).`);
    }
    const kind = p.kind as ProposalKind;
    const planId = p.planId ?? null;
    if (planId !== null) this.#d.plans.get(planId);
    const coordinator = this.coordinator();
    const lead = who.reportsTo ? this.#person(who.reportsTo) : null;
    const decider = lead && lead.kind === 'lead' && lead.lifecycle !== 'archived' ? lead : coordinator;
    const toOwner = kind === 'purchase' || !decider || decider.id === by;
    const proposal = this.#store().create({
      by,
      kind,
      title: clean(p.title, 'Başlık', 160, true),
      text: clean(p.text, 'Açıklama', 4000, true),
      usd: amount(p.usd, 'Tutar'),
      planId,
      status: toOwner ? 'owner' : 'open',
      routedTo: toOwner ? null : decider!.id,
    });
    const label = PROPOSAL_TR[kind];
    if (toOwner) {
      if (coordinator && coordinator.id !== by) {
        this.#d.notices.add(coordinator.id, `${who.name} sahibine bir ${label} talebi açtı: “${proposal.title}”${proposal.usd !== null ? ` ($${proposal.usd})` : ''}. Sahibi karar verince haber gelecek.`);
      }
    } else {
      this.#d.notices.add(decider!.id, `${who.name} bir ${label} açtı: “${proposal.title}” (no ${proposal.id}). proposalDecide ile karara bağla: accept, decline ya da büyükse escalate.`);
    }
    this.#emit(toOwner ? (coordinator?.id ?? by) : decider!.id, { type: 'proposal.changed', change: toOwner ? 'escalated' : 'opened', proposal });
    return proposal;
  }

  decideProposal(by: string, id: string, d: { decision: string; note?: string }): Proposal {
    const p = this.#store().get(id);
    if (p.status === 'owner') throw new ConflictError('Bu öneri sahibinin kararını bekliyor.');
    if (p.status !== 'open') throw new ConflictError('Bu öneri artık açık değil.');
    const me = this.#d.roster.get(by);
    if (p.routedTo !== by && me.kind !== 'coordinator') throw new ForbiddenError('Bu öneri sana gelmedi.');
    if (!['accept', 'decline', 'escalate'].includes(d.decision)) throw new ValidationError('Karar accept, decline ya da escalate olmalı.');
    const note = clean(d.note, 'Not', 2000, false) || null;
    if (d.decision === 'escalate') {
      const coordinator = this.coordinator();
      const toOwner = me.kind === 'coordinator' || !coordinator;
      const next = this.#store().update(id, toOwner ? { status: 'owner', routedTo: null, note } : { routedTo: coordinator!.id, note });
      if (!toOwner) this.#d.notices.add(coordinator!.id, `${me.name} bir öneriyi sana getirdi: “${p.title}” (no ${id})${note ? `: ${note}` : '.'} proposalDecide ile karara bağla.`);
      this.#emit(toOwner ? by : coordinator!.id, { type: 'proposal.changed', change: 'escalated', proposal: next });
      return next;
    }
    const accepted = d.decision === 'accept';
    const next = this.#store().update(id, { status: accepted ? 'accepted' : 'declined', decidedBy: by, note, decidedAt: this.#now() });
    this.#d.memory?.recordDecision(by, {
      title: `Öneri: ${p.title}`,
      chosen: accepted ? 'Kabul edildi' : 'Reddedildi',
      reason: note ?? (accepted ? 'Kabul edildi.' : 'Reddedildi.'),
      planId: p.planId,
    });
    if (p.by !== by) this.#d.notices.add(p.by, `“${p.title}” önerin ${accepted ? 'kabul edildi' : 'reddedildi'}${note ? `: ${note}` : '.'}`);
    this.#emit(by, { type: 'proposal.changed', change: accepted ? 'accepted' : 'declined', proposal: next });
    return next;
  }

  /** The owner settles what waits for them: every purchase, and what was escalated. */
  ownerDecideProposal(id: string, approve: boolean, note?: string): Proposal {
    const p = this.#store().get(id);
    if (p.status !== 'owner') throw new ConflictError('Bu öneri sahibinin kararını beklemiyor.');
    const why = clean(note, 'Not', 2000, false) || null;
    const next = this.#store().update(id, { status: approve ? 'accepted' : 'declined', decidedBy: OWNER, note: why, decidedAt: this.#now() });
    const label = PROPOSAL_TR[p.kind];
    this.#d.memory?.recordOwnerDecision({
      title: `${label[0]!.toLocaleUpperCase('tr')}${label.slice(1)}: ${p.title}`,
      chosen: approve ? 'Onaylandı' : 'Reddedildi',
      reason: why ?? (approve ? 'Sahibi onayladı.' : 'Sahibi onaylamadı.'),
      planId: p.planId,
    });
    const line = approve
      ? p.kind === 'purchase'
        ? `Sahibi “${p.title}” satın alımını onayladı; satın alıp kuracak, hazır olunca haber verecek.`
        : `Sahibi “${p.title}” önerisini onayladı${why ? `: ${why}` : '.'}`
      : `Sahibi “${p.title}” ${label} talebini onaylamadı${why ? `: ${why}` : '.'}`;
    const coordinator = this.coordinator();
    this.#d.notices.add(p.by, line);
    if (coordinator && coordinator.id !== p.by) this.#d.notices.add(coordinator.id, line);
    this.#emit(coordinator?.id ?? p.by, { type: 'proposal.changed', change: approve ? 'accepted' : 'declined', proposal: next });
    return next;
  }

  /** Open proposals this person decides now (the coordinator also sees those with nobody). */
  proposalsFor(id: string): Proposal[] {
    const me = this.#d.roster.get(id);
    return this.#store()
      .list({ statuses: ['open'] })
      .filter((p) => p.routedTo === id || (me.kind === 'coordinator' && p.routedTo === null));
  }

  #store(): ProposalStore {
    if (!this.#d.proposals) throw new ConflictError('Bu ofiste öneriler açık değil.');
    return this.#d.proposals;
  }

  // ── leads ─────────────────────────────────────────────────────────────────

  /** The coordinator makes someone lead of a team (or ends it): the team's members report to them (spec §3.1). */
  appointLead(by: string, id: string, o: { team?: string; lead?: boolean } = {}): Employee {
    this.#assertCoordinator(by);
    const target = this.#d.roster.get(id);
    if (target.lifecycle === 'archived') throw new ConflictError(`${target.name} işten çıkarıldı.`);
    if (target.kind === 'coordinator') throw new ConflictError('Koordinatör ekip lideri yapılamaz.');
    const makeLead = o.lead ?? true;
    const team = o.team === undefined ? target.team : clean(o.team, 'Ekip adı', 40, false);
    if (makeLead && !team) throw new ValidationError('Ekip liderinin bir ekibi olmalı (team).');
    const next = this.#d.roster.update(id, { kind: makeLead ? 'lead' : 'member', team, reportsTo: null });
    for (const m of this.#d.roster.list()) {
      if (m.id === id || m.kind !== 'member') continue;
      if (makeLead && m.team === team && m.reportsTo !== id) {
        this.#d.roster.update(m.id, { reportsTo: id });
        this.#d.notices.add(m.id, `${next.name} artık ${team} ekibinin lideri; önerilerin önce ona gider.`);
      } else if (!makeLead && m.reportsTo === id) this.#d.roster.update(m.id, { reportsTo: null });
    }
    writeRoleCard(this.#d.dataDir, next);
    this.#emit(id, { type: 'role.changed', kind: next.kind, title: next.title, team: next.team });
    this.#d.notices.add(
      id,
      makeLead
        ? `Artık ${team} ekibinin liderisin: ekibine taskCreate ile iş açar, taskAssign ve taskReprioritize ile dağıtır, önerilerini proposalDecide ile karara bağlarsın. Rol kartın ve araçların yenilendi.`
        : 'Ekip liderliğin bitti; ekipte çalışansın.',
    );
    this.#d.reload?.(id);
    return next;
  }
```

- add near the top (after `HANDOVER_DONE`):

```ts
const PROPOSAL_TR: Record<ProposalKind, string> = { need: 'ihtiyaç', purchase: 'satın alma', idea: 'fikir', objection: 'itiraz' };
```

- in `hire`, before `this.#assertRoom();`, route new team members to the team's lead:

```ts
    const lead = input.team ? this.#d.roster.list().find((e) => e.kind === 'lead' && e.team === input.team?.trim()) : undefined;
```

  and pass `reportsTo: lead?.id ?? input.reportsTo ?? null` in the object given to `this.#d.hire(...)`.
- replace `this.#assertCoordinator(by);` at the top of `assign` with `this.#assertManages(by, this.#d.tasks.get(taskId).assignee, assignee);` and at the top of `reprioritize` with `this.#assertManages(by, this.#d.tasks.get(taskId).assignee);`
- add the helper next to `#assertCoordinator`:

```ts
  /** The coordinator manages everyone; a lead their own team (spec §3.1). */
  #assertManages(by: string, ...ids: string[]): void {
    const me = this.#d.roster.get(by);
    if (me.kind === 'coordinator') return;
    if (me.kind === 'lead' && me.team && ids.every((id) => id === by || this.#person(id)?.team === me.team)) return;
    throw new ForbiddenError(me.kind === 'lead' ? 'Ekip lideri yalnız kendi ekibindeki işleri dağıtır.' : 'Yalnız koordinatör bunu yapabilir.');
  }
```

- rule B: in `revise`, before the `this.#d.plans.update(…)` line add:

```ts
    // Rule B: the approved version is kept until the owner decides on the revision (only the first revision saves it).
    if (current.status === 'approved' || current.status === 'done') this.#d.plans.saveApproved(planId);
```

  in `approve`, after the `plans.update` line add `this.#d.plans.clearApproved(planId);`
  in `decline`, right after the draft check add:

```ts
    if (this.#d.plans.approvedSnapshot(planId)) {
      const kept = this.#d.plans.restoreApproved(planId);
      const desk = this.#planDesk(kept);
      this.#d.notices.add(desk, `Sahibi “${current.title}” revizyonunu onaylamadı; plan onaylı sürümüyle (sürüm ${kept.version}) sürüyor.`);
      this.#emit(desk, { type: 'plan.changed', change: 'kept', plan: kept });
      return kept;
    }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/proposals.test.ts test/company.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/company/company.ts apps/office-server/src/company/memory.ts apps/office-server/test/company-helpers.ts apps/office-server/test/proposals.test.ts
git commit -m "feat(company): proposals, team leads, and revisions that keep the approved plan

Employees open needs, ideas, objections and purchases; their lead or the
coordinator decides (into the decision log) or escalates; purchases always go to
the owner. The coordinator appoints team leads, who run their own team. Declining
a revision returns the plan to its approved version instead of ending it."
```

---

### Task 4: The daily report reminder

**Files:**
- Modify: `apps/office-server/src/company/dispatcher.ts`
- Test: `apps/office-server/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `EventStore.latest(employeeId, type)`, `Company.coordinator()`, `TaskStore.list`.
- Produces: on each tick, if ≥ 24 h passed since the coordinator's last `company.report` (or its hire, or the last reminder) and a task finished since then or work is open, one notice "Günlük özet zamanı…" to the coordinator (waking it if asleep).

- [ ] **Step 1: Write the failing test**

Append to `apps/office-server/test/dispatcher.test.ts` inside `describe('Dispatcher — reserve and sleep', …)` (it has `makeBudgeted` with a movable clock):

```ts
  it('reminds the coordinator once a day to report when something happened', async () => {
    const t = makeBudgeted();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    const reminders = () => systemMessages(t.events.list({ limit: 5000 }), coord.id).filter((m) => m.includes('Günlük özet zamanı'));
    t.advance(25 * 3_600_000);
    await sleep(300);
    expect(reminders()).toHaveLength(0);
    const task = t.company.createTask(coord.id, { assignee: ada.id, title: 'iş' });
    await until(() => t.tasks.get(task.id).status === 'in_progress', 8000);
    await until(() => reminders().length === 1, 8000);
    await sleep(300);
    expect(reminders()).toHaveLength(1);
    t.advance(25 * 3_600_000);
    await until(() => reminders().length === 2, 8000);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/dispatcher.test.ts`
Expected: FAIL — no reminder.

- [ ] **Step 3: Implement**

In `apps/office-server/src/company/dispatcher.ts`:
- add `const DAY_MS = 24 * 60 * 60 * 1000;` near the prefixes and a field `readonly #reminded = new Map<string, number>();`
- in `start()`, inside the interval callback, add `this.#remindReport();` before `this.#scheduleSweep();`
- add:

```ts
  /** Spec §4.5: a short report a day — remind the coordinator when something happened since the last one. */
  #remindReport(): void {
    const c = this.#d.company.coordinator();
    if (!c) return;
    const now = this.#now();
    const last = Math.max(this.#d.events.latest(c.id, 'company.report')?.ts ?? 0, c.createdAt, this.#reminded.get(c.id) ?? 0);
    if (now - last < DAY_MS) return;
    const finished = this.#d.tasks.list({ statuses: ['done'], limit: 100_000 }).some((t) => (t.finishedAt ?? 0) > last);
    const open = this.#d.tasks.list({ statuses: ['waiting', 'in_progress', 'blocked'], limit: 1 }).length > 0;
    if (!finished && !open) return;
    this.#reminded.set(c.id, now);
    this.#d.notices.add(c.id, 'Günlük özet zamanı: bugün ne bitti, ne sürüyor, ne takıldı, ne harcandı — reportToOwner ile sahibine kısaca raporla.');
    this.#schedule(c.id);
  }
```

(`c.createdAt` and the event `ts` are wall-clock; the test's clock starts at `Date.now()`, so both are comparable.)

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/dispatcher.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS (three runs of `test/dispatcher.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/dispatcher.ts apps/office-server/test/dispatcher.test.ts
git commit -m "feat(company): remind the coordinator to report to the owner once a day"
```

---

### Task 5: Proposal, colleague and lead tools

**Files:**
- Modify: `apps/office-server/src/mcp/tools.ts`, `apps/office-server/src/company/roles.ts`
- Test: `apps/office-server/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: Task 3's company methods; `Engine.sideQuestion(id, text): Promise<{ ok: boolean; answer: string }>`.
- Produces: tools `propose`, `askColleague` (everyone); `proposalsOpen`, `proposalDecide` (lead + coordinator); `appointLead` (coordinator); `taskCreate`, `taskAssign`, `taskReprioritize` also for leads (team-limited); `officeTools`' `engine` gains `sideQuestion`.

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/mcp-tools.test.ts`:
- the expected lists in the first test become:

```ts
    expect(names('member')).toEqual([
      'askColleague', 'briefRead', 'decisionsRead', 'memorySearch', 'myTasks', 'noteWrite', 'officeStatus', 'playbookRead', 'propose', 'recordSpend',
      'taskFinish', 'taskPass', 'taskUpdate',
    ]);
    expect(names('lead').filter((n) => !names('member').includes(n))).toEqual(['decisionRecord', 'playbookUpdate', 'proposalDecide', 'proposalsOpen', 'taskAssign', 'taskCreate', 'taskReprioritize']);
    expect(names('coordinator').filter((n) => !names('lead').includes(n))).toEqual([
      'appointLead', 'briefUpdate', 'budgetStatus', 'editRoleCard', 'employeeNote', 'hire', 'planPropose', 'planRevise', 'reportToOwner', 'setModel', 'sleep', 'wake',
    ]);
```

- append inside the `describe`:

```ts
  it('lets anyone propose and the decider see and settle it; a purchase says it went to the owner', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    expect(await t.call(ada, 'propose', { kind: 'purchase', title: 'Telefon hattı', text: 'Müşteriler arıyor.', usd: 12 })).toMatch(/sahibine gitti/);
    expect(await t.call(ada, 'propose', { kind: 'idea', title: 'Blog', text: 'Haftalık yazı.' })).toMatch(/Koordinatör/);
    const open = await t.call(c, 'proposalsOpen');
    expect(open).toContain('Blog');
    expect(open).not.toContain('Telefon');
    const id = t.proposals.list({ statuses: ['open'] })[0]!.id;
    expect(await t.call(c, 'proposalDecide', { proposalId: id, decision: 'accept', note: 'Başla.' })).toMatch(/kabul/);
    await expect(t.call(ada, 'propose', { kind: 'gift', title: 'x', text: 'y' })).rejects.toThrow(/Bilinmeyen öneri türü/);
  });

  it('lets a lead create tasks for their own team only; the coordinator appoints the lead', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', team: 'İçerik' });
    const can = t.company.hire(c.id, { name: 'Can', role: 'r', team: 'İçerik' });
    const bob = t.company.hire(c.id, { name: 'Bob', role: 'r', team: 'Ürün' });
    expect(await t.call(c, 'appointLead', { employee: 'Ada', team: 'İçerik' })).toMatch(/lider/);
    expect(await t.call(ada, 'taskCreate', { assignee: 'Can', title: 'Slogan' })).toMatch(/Görev açıldı/);
    await expect(t.call(ada, 'taskCreate', { assignee: bob.id, title: 'x' })).rejects.toThrow(/kendi ekibine/);
    expect(t.tasks.list({ assignee: can.id }).map((x) => x.title)).toEqual(['Slogan']);
  });

  it('review focus: asks a colleague without interrupting them, and refuses yourself, strangers and the silent', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    await expect(t.call(ada, 'askColleague', { to: 'Can', question: 'NOTES.md nerede?' })).rejects.toThrow(/hiç konuşmadı/);
    t.engine.send(can.id, 'merhaba');
    await until(() => t.roster.get(can.id).sessionStarted && t.engine.ready(can.id), 8000);
    await t.engine.sleep(can.id);
    const answer = await t.call(ada, 'askColleague', { to: 'Can', question: 'NOTES.md nerede?' });
    expect(answer).toMatch(/^Can: /);
    expect(t.roster.get(can.id).lifecycle).toBe('sleeping');
    await expect(t.call(ada, 'askColleague', { to: 'Ada', question: 'x' })).rejects.toThrow(/Kendine soramazsın/);
    await expect(t.call(ada, 'askColleague', { to: 'kimse', question: 'x' })).rejects.toThrow(/bulunamadı/);
  });
```

(`t.proposals` comes from `companyFor`; `make()` already passes `engine: f.engine`, which has `sideQuestion`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/mcp-tools.test.ts`
Expected: FAIL — the tools are missing.

- [ ] **Step 3: The tools**

In `apps/office-server/src/mcp/tools.ts`:
- `engine` in the signature becomes `{ sleep(id: string): Promise<unknown>; wake(id: string): unknown; sideQuestion(id: string, text: string): Promise<{ ok: boolean; answer: string }> }`;
- add `ForbiddenError` to the `../errors.ts` import and `PROPOSAL_KINDS` to the `@cc/shared` value import;
- change `kinds: COORDINATOR` to `kinds: LEADS` for `taskCreate`, `taskAssign` and `taskReprioritize`;
- in `taskCreate`'s `run`, after `const to = findPerson(...)`, add:

```ts
        if (employee.kind === 'lead' && to.id !== employee.id && to.team !== employee.team) {
          throw new ForbiddenError('Ekip lideri taskCreate ile yalnız kendi ekibine görev açar; başkasına taskPass ile pasla.');
        }
```

- add to the returned array (after `wake`):

```ts
    {
      name: 'propose',
      description:
        'Carry something upwards: need (something the work requires), purchase (anything that costs money: a phone line, a subscription, a device), idea, or objection (we are on the wrong track). It goes to your lead or the coordinator; purchases go to the owner, who pays and buys.',
      inputSchema: object({ kind: { type: 'string', enum: [...PROPOSAL_KINDS] }, title: s('Short title.'), text: s('What, why, and what you suggest.'), usd: number('For a purchase: the price, USD.'), planId: s('The plan it concerns.') }, ['kind', 'title', 'text']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const p = company.openProposal(employee.id, { kind: str(args, 'kind'), title: str(args, 'title'), text: str(args, 'text'), usd: num(args, 'usd') ?? null, planId: optStr(args, 'planId') ?? null });
        return p.status === 'owner' ? `Talep açıldı (${p.id}) ve sahibine gitti; karar verince haber gelecek.` : `Öneri açıldı (${p.id}); ${company.nameOf(p.routedTo!)} karara bağlayacak.`;
      },
    },
    {
      name: 'proposalsOpen',
      description: 'List the proposals waiting for your decision (lead or coordinator).',
      inputSchema: object({}),
      kinds: LEADS,
      run: ({ employee }) => {
        const open = company.proposalsFor(employee.id);
        if (open.length === 0) return 'Kararını bekleyen öneri yok.';
        return open.map((p) => `• ${p.id} [${p.kind}] “${p.title}” — ${company.nameOf(p.by)}: ${p.text}`).join('\n');
      },
    },
    {
      name: 'proposalDecide',
      description: 'Decide a proposal that came to you (lead or coordinator): accept, decline, or escalate (a lead to the coordinator, the coordinator to the owner — do that for anything big). The decision goes to the decision log and the proposer hears.',
      inputSchema: object({ proposalId: s('The proposal id.'), decision: { type: 'string', enum: ['accept', 'decline', 'escalate'] }, note: s('Why, in a sentence.') }, ['proposalId', 'decision']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const p = company.decideProposal(employee.id, str(args, 'proposalId'), { decision: str(args, 'decision'), note: optStr(args, 'note') });
        return p.status === 'accepted' ? `“${p.title}” kabul edildi.` : p.status === 'declined' ? `“${p.title}” reddedildi.` : p.status === 'owner' ? `“${p.title}” sahibine götürüldü.` : `“${p.title}” koordinatöre götürüldü.`;
      },
    },
    {
      name: 'askColleague',
      description: 'Ask a colleague a quick question without interrupting them: a copy of their session answers from what they know and are doing. It cannot do work for you (use taskPass for that). Takes up to a couple of minutes.',
      inputSchema: object({ to: s('Colleague id or name.'), question: s('The question.') }, ['to', 'question']),
      kinds: EVERYONE,
      run: async ({ employee }, args) => {
        const question = str(args, 'question');
        const to = findPerson(str(args, 'to'));
        if (to.id === employee.id) throw new ValidationError('Kendine soramazsın.');
        const out = await engine.sideQuestion(to.id, `${employee.name}${employee.title ? ` (${employee.title})` : ''} soruyor; kısaca, bildiğin kadarıyla cevap ver: ${question}`);
        return out.ok ? `${to.name}: ${out.answer}` : `${to.name} şu an cevap veremedi: ${out.answer}`;
      },
    },
    {
      name: 'appointLead',
      description: 'Make an employee the lead of a team (coordinator) — do it when a team grows past 4–5 people. The team reports to them; they hand out and order its work and settle its proposals, but cannot hire. lead: false ends it.',
      inputSchema: object({ employee: s('Employee id or name.'), team: s('The team they lead.'), lead: { type: 'boolean', description: 'false ends the leadership (default true).' } }, ['employee']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const lead = bool(args, 'lead');
        const team = optStr(args, 'team');
        const who = findPerson(str(args, 'employee'));
        const next = company.appointLead(employee.id, who.id, { team, lead });
        return next.kind === 'lead' ? `${next.name} artık ${next.team} ekibinin lideri.` : `${next.name} artık ekip lideri değil.`;
      },
    },
```

(`Engine.sideQuestion` already refuses someone who never spoke ("henüz hiç konuşmadı") and works on a stopped or sleeping colleague: it forks the saved session.)

- [ ] **Step 4: The guide**

In `apps/office-server/src/company/roles.ts`:
- `MEMBER` gains, before `- Şirket özeti aşağıdadır…`:

```
- Bir ihtiyaç, fikir, itiraz ya da para gerektiren bir şey (telefon hattı, abonelik, cihaz) varsa \`propose\` ile aç:
  liderine ya da koordinatöre gider; satın almalar sahibine gider. Yanlış yolda olduğunu düşünüyorsan objection ile söyle.
- Bir arkadaşına kısa bir şey sormak için \`askColleague\` kullan: onu bölmeden, bildikleriyle cevap verir (iş
  yaptıramazsın; iş için \`taskPass\`).
```

- `LEAD` gains a line:

```
- Ekibinden gelen önerileri \`proposalsOpen\` ile gör, \`proposalDecide\` ile karara bağla (accept / decline; büyükse
  escalate ile koordinatöre). İşe alamazsın; gerekirse koordinatörden iste.
```

- `COORDINATOR` gains, before `- Bir plan bitince…`:

```
- Önerileri \`proposalsOpen\` / \`proposalDecide\` ile karara bağla: küçükse kabul ya da ret (karar defterine yazılır);
  büyükse escalate ile sahibine götür ya da plan revizyonuna kat. Satın almalar zaten sahibine gider.
- Bir ekip 4–5 kişiyi geçince \`appointLead\` ile içlerinden birini ekip lideri yap; gerekirse lead: false ile geri al.
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/mcp-tools.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/mcp/tools.ts apps/office-server/src/company/roles.ts apps/office-server/test/mcp-tools.test.ts
git commit -m "feat(mcp): proposal, colleague and lead tools

Everyone can propose (need, purchase, idea, objection) and ask a colleague
without interrupting them; leads and the coordinator see and settle proposals;
the coordinator appoints leads, who create and hand out work in their own team."
```
