# Office rooms — sub-project 2 (3D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office becomes one 32 × 24 m floor: a hub with the coordinator's desk under a light beam, the meeting table, coffee, lounge, a server corner and eight hub desks, and six glass department rooms around it. Each open department gets a room (its carpet in its colour, lamps and screens on, its name and head on the door sign); an empty room is dark. People sit by "room + seat" (45 seats) and walk to their new place when their department or role changes. The employee limit defaults to 12, at most 45.

**Architecture:** A seat is still the employee's `deskIndex` (same column, same API); its meaning is shared by server and web in `@cc/shared` (`seats.ts`). On the server a pure `seatFor` and a `Seating` service choose and move seats (`Roster.create` with a seat, `Roster.setDesk`), called by `Company` (hire, hireCoordinator, appointCoordinator), by the `Departments` service (every placement and adoption) and by `main.ts` (`reseatAll` at every start), each move announced as `seat.changed`. A department's room is a `room` column added to the unreleased departments migration (lowest free room on opening, freed on closing, unique among open departments). On the web `layout.ts` draws the new plan (`rooms: RoomGeometry[]`, `beam`), `RoomsLayer` draws the rooms' carpets and canvas door signs from the store's departments, `FurnitureLayer` and `DeskDressing` turn an empty room's lamps and screens off, `Beam` follows the coordinator's lifecycle, and the camera, controls and sun shadow are sized from the floor.

**Tech Stack:** Node 24 (type stripping, `node:sqlite`), TypeScript 5.9, vitest 3, React 19 + @react-three/fiber 9 + drei 10 + three 0.186 + zustand 5 (office-web), @react-three/test-renderer 9, pnpm 9 workspace.

**Spec:** `docs/superpowers/specs/2026-10-13-office-rooms-design.md` (whole document). Background: `docs/superpowers/specs/2026-10-13-departments-design.md` Ek B and `docs/superpowers/plans/2026-10-13-departments.md` (the `Departments` service, `companyFor(…, { departments: true })`, the store's `departments`).

**Base:** branch `feat/departments` with all of sub-project 1's plan done (Tasks 1–15). Worktree `~/Projects/control-center-departments`. The departments migration is **v24** (it is **v25** if sub-project 1's Task 15 Step 5 renumbered it: then read every `v24`, `upTo(24)` and `migrateDown(db, 23)` below one higher; find it by its name `departments: the rooms, their heads, an employee’s department and the notes on plan streams`).

## Global Constraints

- Node 24 type stripping: no enums, no parameter properties, `import type` for types, `.ts` extensions in imports.
- Every migration is reversible: `up` + `down`; `down` removes exactly what `up` added; round trip (up → down → up) tested. **No new migration in this sub-project:** the room is a column of the unreleased departments migration (spec §4.1), amended in place (its `down` already drops the table; it also drops the new index). A database that applied the migration before the amendment exists only in temporary test or development data folders of this branch; delete such a folder, never patch it (the live office never ran v24).
- Tool descriptions in English; tool results, errors, notices, guides and UI text in Turkish.
- Code comments in English, in the repository's voice (why, not what), as dense as the surrounding code.
- Commits: plain conventional commits as the user (`tarik`), **no AI trailer, no "Generated with", no Claude/Anthropic marker anywhere** (message, body, author, branch name).
- Work only in the worktree. Never touch `~/Projects/control-center` (the live office runs from it), never use port 4319 (also not through `pnpm --filter @cc/office-web dev`: its proxy goes to 4319), never run real-claude tests (`*.real.test.ts`, `OFFICE_SMOKE=1`).
- `assets/2d/` is the owner's reference images (untracked): never touched. No new 3D models: only asset ids already in `assets/3d/manifest.json`; a missing model falls back to the voxel box.
- Seats (`@cc/shared`): `SEAT_COUNT = 45`; seat **0** the coordinator's desk (under the beam); room r's six seats **1 + 6r … 6 + 6r** (r = 0…5); the hub's eight **37 … 44**. `config.deskCount = SEAT_COUNT`. `DEFAULT_CONSTITUTION.maxEmployees = 12`, at most `SEAT_COUNT`; a value the owner saved stays.
- Floor: **32 × 24 m**, cell 0.5 m. Rooms north z 0–7 and south z 17–24, three a row at x 0 – 10.67 – 21.33 – 32 (`32 / 3`); hub z 7–17; doors 1.4 m in each room's hub-facing glass; the beam point **(16, 12)**. North and west outer walls full height, south and east low (the camera turns only between them).
- An office without departments seats everyone at the hub, the coordinator at 0; its rooms are dark. The only new event is `seat.changed`, sent only when someone moves (never for a hire), so the economy scenario's log stays main's.
- Test offices keep `setup()`'s eight desks: `seatFor` counts only the seats the roster has (`Roster.deskCount`), so older tests still see desks 0 … 7.
- Lights: at most a dozen lamps cast light (point lights cost every pixel); the rooms' desk lamps only glow (`bulbOnly`). A light is never added or removed when a room changes: its intensity goes to 0 (adding or removing a light recompiles every material's shader).

## Spec rulings (decided here)

- **Wandering spots by order, not by raw seat number.** 45 seats map onto 24 coffee/lounge spots, so "up to 24 people never share a spot" (§2) can hold for every office only if the spot is chosen by the person's place among the people at work in seat order (`wanderOrder`): coffee and lounge alternate along it, each taking every other spot. The order comes from the seat numbers, so "koltuk numarasından seçilir" holds; a hire or a move may give someone another spot. The guarantee is 24 for coffee + lounge, 12 for the server corner and 6 for the meeting table (their spot counts). A desk is still chosen by seat number, wrapping for an unknown one (§7).
- **Rule 4 ("ilk boş koltuk")** takes seats 1 … 44 first and the coordinator's desk last; whoever sits at seat 0 is moved off it when a coordinator needs it (an office of before, or a full one).
- **"Stays where they can"** (§3): someone keeps their seat when it lies in the first place (own room → hub → anywhere → the coordinator's desk) that has room for them. A department's overflow member at the hub therefore moves into the room when a seat frees there — at their next reseat or the next start.
- **`seat.changed` for every move** (never for a hire), also when `role.changed` goes out for the same person: one rule, no coupling to which callers announce roles; the page applies it at once (no snapshot needed).
- **Rooms in the database:** `room INTEGER CHECK (room IS NULL OR room BETWEEN 0 AND 5)` and a partial unique index on the open departments' rooms — two open departments can never share a room. Closing sets the room to NULL. A seventh team adopted at a start (no room free) gets none: its people sit at the hub.
- **Seating is wired in every office** (`main.ts` and `companyFor`), not opt-in like the departments: an office without departments seats everyone at the hub. `companyFor`'s Budget gets `deskCount: SEAT_COUNT` (the owner's form now sends 12; eight desks would refuse it).
- **Door sign "çift yüzlü":** two faces back to back, so the text reads the right way from the hub and from inside (one double-sided plane shows mirrored text from behind).
- **Wall art:** the north rooms get a framed picture on the north wall; the south rooms have no wall to hang one on (glass and the low south wall), so they get a low credenza against the south wall instead.
- **Room lamps:** one pendant per room casts light (intensity 0 when the room is empty); its desk lamps only glow. Twelve lamps cast light in all, as today.
- **Beam states the spec's table does not name:** `interrupted` and `in_terminal` are dim; `archived` is no coordinator (no beam).
- **Pan limits** (§6 asks them from the floor; today there are none): the view's centre stays within the floor ± 1 m; the camera moves back with its target, so the view stops at the edge without turning.
- **Hub desks** "iki sıra halinde koordinatörün iki yanında": two clusters of 2 × 2, west and east of the coordinator. **Meeting spot 0** (where the planning coordinator stands) is on the table's north side, facing the camera.
- **Coffee counter** stands against the west windows (turned a quarter); the **server racks** keep facing south (`ServerLights` puts their LEDs on +z), in a row behind an oak slat partition at z 13.4.

## Review Focus

1. **An office of before** (eight desks, the coordinator at any desk, teams not yet departments) opens with everyone in their place — the coordinator under the beam, an adopted team in its room, the rest at the hub — and a second start moves nobody — Task 4 (`Seating.reseatAll`) and Task 6 (`main.ts`, the real process) pin it.
2. **Two departments in one room, or a closed department's room never coming back:** rooms are the lowest free, freed on closing, reused by the next, unique in the database — Task 5 pins it.
3. **A department's seventh member** sits at a hub desk — never on someone's chair, never "Ofis dolu" while seats are free — Task 4 (`seatFor`) and Task 6 (through `Company.hire`) pin it.
4. **Someone stuck in a room or walking through glass:** from every seat of every room there is a path to every coffee, lounge, server and meeting spot, and it leaves through the room's 1.4 m door — Task 7 pins it.
5. **An empty room that looks lit, or a working room that looks empty:** a room with an open department has its colour, its lamp and screens on and its name and head on the sign; every other room is dark grey, its pendant at 0, its screens off, the sign "Boş oda" — and a closed department's room goes dark — Task 9 pins it.

---

### Task 1: Shared — the seats and the `seat.changed` event

**Files:**
- Create: `packages/shared/src/seats.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/events.ts`

**Interfaces:**
- Consumes: `MAX_DEPARTMENTS` (`packages/shared/src/department.ts`).
- Produces: `COORDINATOR_SEAT = 0`, `ROOM_COUNT = 6`, `ROOM_SEATS = 6`, `HUB_SEATS: readonly number[]` (37 … 44), `SEAT_COUNT = 45`, `roomSeats(room: number): number[]`, `roomOfSeat(seat: number): number | null`; event `{ type: 'seat.changed'; deskIndex: number }`. (Their tests are in Task 4's `seating.test.ts`: `@cc/shared` has no test runner.)

- [ ] **Step 1: Create `packages/shared/src/seats.ts`**

```ts
import { MAX_DEPARTMENTS } from './department.ts';

/**
 * The office's seats (spec 2026-10-13-office-rooms §3), numbered as an employee's deskIndex: the coordinator's desk
 * under the beam, six rooms of six around the hub (one for each department that can be open), and the hub's eight.
 */
export const COORDINATOR_SEAT = 0;
export const ROOM_COUNT = MAX_DEPARTMENTS;
export const ROOM_SEATS = 6;
/** The hub's desks beside the coordinator: the centre's people, and a full room's overflow. */
export const HUB_SEATS: readonly number[] = Array.from({ length: 8 }, (_, i) => 1 + ROOM_COUNT * ROOM_SEATS + i);
/** 45: the desks the server gives out (config deskCount) and the constitution's ceiling for maxEmployees. */
export const SEAT_COUNT = 1 + ROOM_COUNT * ROOM_SEATS + HUB_SEATS.length;

/** Room r's six seats, 1 + 6r … 6 + 6r. */
export function roomSeats(room: number): number[] {
  return Array.from({ length: ROOM_SEATS }, (_, i) => 1 + ROOM_SEATS * room + i);
}

/** The room a seat is in; null: the coordinator's desk or the hub. */
export function roomOfSeat(seat: number): number | null {
  return Number.isInteger(seat) && seat >= 1 && seat <= ROOM_COUNT * ROOM_SEATS ? Math.floor((seat - 1) / ROOM_SEATS) : null;
}
```

- [ ] **Step 2: Export it and add the event**

`packages/shared/src/index.ts` — add after `export * from './proposal.ts';`:

```ts
export * from './seats.ts';
```

`packages/shared/src/events.ts` — in the `OfficeEvent` union, right after the `role.changed` member:

```ts
  /** Someone sat down elsewhere (spec office rooms §3): their department or role changed, or the office reseated everyone at its start; never sent for a hire. */
  | { type: 'seat.changed'; deskIndex: number }
```

- [ ] **Step 3: Typecheck the workspace**

Run: `cd ~/Projects/control-center-departments && pnpm -r typecheck`
Expected: PASS (nothing uses the new names yet).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/seats.ts packages/shared/src/index.ts packages/shared/src/events.ts
git commit -m "feat(shared): the office's 45 seats (the coordinator's, six rooms of six, the hub's eight) and the seat.changed event"
```

---

### Task 2: Roster — a chosen seat on hire, moving someone's seat

**Files:**
- Modify: `apps/office-server/src/roster.ts`
- Test: `apps/office-server/test/roster.test.ts`

**Interfaces:**
- Consumes: `SEAT_COUNT` (Task 1).
- Produces: `NewEmployee.deskIndex?: number`; `Roster.deskCount: number` (getter); `Roster.setDesk(id: string, deskIndex: number): Employee`; `create` and `validate` take a given seat only when it is an integer in `0 … deskCount − 1` (else `ValidationError('Masa 0 ile 44 arasında bir tam sayı olmalı.')`) that nobody at work has (else `ConflictError('Masa 37 dolu (Ada).')`); without one, the lowest free desk as before.

- [ ] **Step 1: Write the failing tests** — in `test/roster.test.ts` add `import { SEAT_COUNT } from '@cc/shared';` and, inside `describe('Roster', …)`:

```ts
  it('takes the seat the office chose when it is free and one of the office’s; without one, the lowest free as before (spec office rooms §5)', () => {
    const { db } = setup();
    const roster = new Roster(db, SEAT_COUNT);
    expect(roster.deskCount).toBe(45);
    expect(roster.create({ name: 'Ada', role: 'r', deskIndex: 37 }).deskIndex).toBe(37);
    expect(roster.create({ name: 'Can', role: 'r' }).deskIndex).toBe(0);
    expect(() => roster.create({ name: 'Ece', role: 'r', deskIndex: 37 })).toThrow('Masa 37 dolu (Ada).');
    expect(() => roster.create({ name: 'Ece', role: 'r', deskIndex: 45 })).toThrow('Masa 0 ile 44 arasında bir tam sayı olmalı.');
    expect(() => roster.create({ name: 'Ece', role: 'r', deskIndex: 1.5 })).toThrow(ValidationError);
    expect(() => roster.validate({ name: 'Ece', role: 'r', deskIndex: 37 })).toThrow(ConflictError);
    expect(roster.list().map((e) => e.name)).toEqual(['Can', 'Ada']);
  });

  it('moves someone to a free seat; a taken or unknown seat is refused and nothing changes; an archived one’s seat is free', () => {
    const { db } = setup();
    const roster = new Roster(db, SEAT_COUNT);
    const ada = roster.create({ name: 'Ada', role: 'r' });
    const can = roster.create({ name: 'Can', role: 'r' });
    expect(roster.setDesk(ada.id, 13)).toMatchObject({ id: ada.id, deskIndex: 13 });
    expect(roster.get(ada.id).deskIndex).toBe(13);
    expect(roster.setDesk(ada.id, 13).deskIndex).toBe(13);
    expect(() => roster.setDesk(ada.id, can.deskIndex)).toThrow(ConflictError);
    expect(() => roster.setDesk(ada.id, -1)).toThrow(ValidationError);
    expect(roster.get(ada.id).deskIndex).toBe(13);
    roster.update(can.id, { lifecycle: 'archived' });
    expect(roster.setDesk(ada.id, can.deskIndex).deskIndex).toBe(1);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/roster.test.ts`
Expected: FAIL — `roster.deskCount` is undefined and Ada gets desk 0, not 37; `roster.setDesk is not a function`.

- [ ] **Step 3: Implement in `src/roster.ts`**

(Sub-project 1 moved the field checks into `checkNewEmployee`, added `validate(input)` and the lowest-free search `#freeDesk()`; the code below builds on that shape. If `create` still searches the desks inline, first move that loop, unchanged, into `#freeDesk(): number` — the lowest desk below `#deskCount` nobody at work has, else `ConflictError(\`Ofis dolu: ${this.#deskCount} masanın hepsi dolu.\`)`.)

Replace the `NewEmployee` type with:

```ts
export type NewEmployee = HireInput & {
  templateRef?: TemplateRef | null;
  capabilityIds?: string[];
  deskDeny?: string[];
  /** The seat the office chose (Seating, spec office rooms §3): free and one of the office's; absent: the lowest free one. */
  deskIndex?: number;
};
```

In `class Roster`, after the constructor:

```ts
  /** The seats this office has (SEAT_COUNT in main.ts; a test office may have fewer). */
  get deskCount(): number {
    return this.#deskCount;
  }
```

In `validate(input)` replace `this.#freeDesk();` with `this.#deskOf(input);`, and in `create(input)` replace `const deskIndex = this.#freeDesk();` with `const deskIndex = this.#deskOf(input);`.

After `update(…)`, add:

```ts
  /** Someone to another seat (Seating): one of the office's that nobody else at work has. */
  setDesk(id: string, deskIndex: number): Employee {
    this.get(id);
    this.#checkDesk(deskIndex, id);
    this.#db.prepare('UPDATE employees SET desk_index = ? WHERE id = ?').run(deskIndex, id);
    return this.get(id);
  }
```

and next to `#freeDesk()`:

```ts
  /** A newcomer's seat: the one the office chose (checked), else the lowest free. */
  #deskOf(input: NewEmployee): number {
    return input.deskIndex === undefined ? this.#freeDesk() : this.#checkDesk(input.deskIndex, null);
  }

  /** `deskIndex`, when it is one of the office's seats and nobody at work but `self` has it. */
  #checkDesk(deskIndex: number, self: string | null): number {
    if (!Number.isInteger(deskIndex) || deskIndex < 0 || deskIndex >= this.#deskCount) {
      throw new ValidationError(`Masa 0 ile ${this.#deskCount - 1} arasında bir tam sayı olmalı.`);
    }
    const holder = this.list().find((e) => e.deskIndex === deskIndex && e.id !== self);
    if (holder) throw new ConflictError(`Masa ${deskIndex} dolu (${holder.name}).`);
    return deskIndex;
  }
```

- [ ] **Step 4: Run the roster tests, then the whole server suite**

Run: `pnpm vitest run test/roster.test.ts && pnpm vitest run`
Expected: PASS (nobody passes a seat yet; every other hire takes the lowest free desk as before).

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/roster.ts apps/office-server/test/roster.test.ts
git commit -m "feat(roster): a hire may take the seat the office chose; setDesk moves someone to a free seat"
```

---

### Task 3: 45 seats — the server's desks and the constitution's limit

**Files:**
- Modify: `apps/office-server/src/config.ts`, `packages/shared/src/budget.ts`, `apps/office-server/test/company-helpers.ts`, `apps/office-web/src/ui/BudgetTabs.tsx`
- Test: `apps/office-server/test/config.test.ts`, `apps/office-server/test/budget.test.ts`

**Interfaces:**
- Consumes: `SEAT_COUNT` (Task 1).
- Produces: `loadConfig().deskCount === SEAT_COUNT`; `DEFAULT_CONSTITUTION.maxEmployees === 12` (validated `1 … deskCount`, i.e. 45 in main.ts); `companyFor`'s Budget has `deskCount: SEAT_COUNT`.

- [ ] **Step 1: Write the failing tests**

`test/config.test.ts` — add `import { SEAT_COUNT } from '@cc/shared';` and in the first test replace `expect(c.deskCount).toBe(8);` with:

```ts
    expect(c.deskCount).toBe(SEAT_COUNT);
    expect(SEAT_COUNT).toBe(45);
```

`test/budget.test.ts` — add `SEAT_COUNT` to the `@cc/shared` import. In `'review focus: refuses wrong types, out-of-range values and unknown keys, changing nothing'` replace `{ maxEmployees: 9 }` with `{ maxEmployees: 46 }`. In `'W3: no notice when nothing changed …'` replace `expect(t.budget.constitution().maxEmployees).toBe(8);` with `expect(t.budget.constitution().maxEmployees).toBe(DEFAULT_CONSTITUTION.maxEmployees);`. Inside `describe('Budget — constitution', …)` add:

```ts
  it('allows twelve by default and up to the office’s 45 seats; a limit the owner saved before stays (spec office rooms §5)', () => {
    const t = make();
    expect(DEFAULT_CONSTITUTION.maxEmployees).toBe(12);
    expect(t.budget.constitution().maxEmployees).toBe(12);
    expect(t.budget.setConstitution({ maxEmployees: SEAT_COUNT }).maxEmployees).toBe(45);
    expect(() => t.budget.setConstitution({ maxEmployees: SEAT_COUNT + 1 })).toThrow('Anayasa: Çalışan sınırı 1 ile 45 arasında bir tam sayı olmalı.');
    // The owner's form saved 8 while the office had eight desks: the owner's choice, so it stays 8.
    const before = setup();
    cleanups.push(before.cleanup);
    new ConstitutionStore(before.db).set({ maxEmployees: 8 });
    expect(new ConstitutionStore(before.db).get().maxEmployees).toBe(8);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/config.test.ts test/budget.test.ts`
Expected: FAIL — `deskCount` is 8; the default limit is 8, not 12; `setConstitution({ maxEmployees: 45 })` is refused (companyFor's Budget still has 8 desks).

- [ ] **Step 3: Implement**

`src/config.ts` — add `import { SEAT_COUNT } from '@cc/shared';`; in `interface OfficeConfig` replace `deskCount: number;` with:

```ts
  /** Seats in the office (spec office rooms §3): what the roster gives out and the constitution's ceiling. */
  deskCount: number;
```

and in the returned object replace `deskCount: 8` with `deskCount: SEAT_COUNT`.

`packages/shared/src/budget.ts` — in `interface Constitution` the comment of `maxEmployees` becomes `/** Employees at most, the coordinator included (12 by default; never more than the seats, 45). */`; in `DEFAULT_CONSTITUTION` `maxEmployees: 8,` becomes `maxEmployees: 12,`.

`test/company-helpers.ts` — add `SEAT_COUNT` to the `@cc/shared` import and in the `Budget` deps replace `deskCount: 8` with `deskCount: SEAT_COUNT` (with the comment `// The office's seats bound the constitution, as main.ts's config.deskCount; a test office's roster may have fewer desks (setup).` on the line above `const budget = new Budget({`).

`apps/office-web/src/ui/BudgetTabs.tsx` — add `SEAT_COUNT` to its `@cc/shared` import (`import { MODEL_ALIASES, SEAT_COUNT, type BudgetSummary, type Constitution } from '@cc/shared';`) and make the `maxEmployees` field's hint:

```ts
  { key: 'maxEmployees', label: 'Çalışan sınırı', hint: `Koordinatör dahil; en çok ${SEAT_COUNT} (ofisteki koltuk sayısı).` },
```

- [ ] **Step 4: Run the tests, then both suites**

Run: `pnpm vitest run test/config.test.ts test/budget.test.ts && pnpm vitest run && cd ../office-web && pnpm vitest run`
Expected: PASS. A test that pinned the default 8 without setting it reads `DEFAULT_CONSTITUTION.maxEmployees`; a test that sets `maxEmployees` itself stays as it is.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-server/src/config.ts packages/shared/src/budget.ts apps/office-server/test/company-helpers.ts apps/office-server/test/config.test.ts apps/office-server/test/budget.test.ts apps/office-web/src/ui/BudgetTabs.tsx
git commit -m "feat(budget): the office has 45 seats — config deskCount and the constitution's ceiling; twelve employees by default"
```

---

### Task 4: `seatFor` and the Seating service

**Files:**
- Create: `apps/office-server/src/seating.ts`
- Test: `apps/office-server/test/seating.test.ts`

**Interfaces:**
- Consumes: Task 1's seats and event, `Roster.deskCount`, `Roster.setDesk`, `Roster.create({ deskIndex })` (Task 2), `EventStore.append`.
- Produces:
  - `interface Seatee { kind: EmployeeKind; room: number | null }`
  - `seatFor(who: Seatee, current: number | null, taken: ReadonlySet<number>, seatCount?: number): number | null`
  - `interface SeatingDeps { roster: Roster; events: EventStore; roomOf?: (employeeId: string) => number | null }`
  - `class Seating { constructor(d: SeatingDeps); forHire(who: Seatee): number | null; reseat(employeeId: string): Employee; reseatAll(): number }`

- [ ] **Step 1: Write the failing tests** — `test/seating.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { COORDINATOR_SEAT, HUB_SEATS, SEAT_COUNT, roomOfSeat, roomSeats } from '@cc/shared';
import { Seating, seatFor } from '../src/seating.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const taken = (...seats: number[]) => new Set(seats);
const member = (room: number | null) => ({ kind: 'member' as const, room });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A 45-seat office on a clock that ticks once per write (hire order is creation order); rooms are set by hand. */
function office() {
  let clock = 0;
  const s = setup(SEAT_COUNT, () => (clock += 1));
  cleanups.push(s.cleanup);
  const rooms = new Map<string, number>();
  const seating = new Seating({ roster: s.roster, events: s.events, roomOf: (id) => rooms.get(id) ?? null });
  const seatEvents = () =>
    s.events.list({ limit: 1000 }).filter((e) => e.event.type === 'seat.changed').map((e) => [s.roster.get(e.employeeId!).name, (e.event as { deskIndex: number }).deskIndex]);
  return { ...s, rooms, seating, seatEvents };
}

describe('the seats (spec office rooms §3)', () => {
  it('numbers them: the coordinator 0, room r 1 + 6r … 6 + 6r, the hub 37 … 44', () => {
    expect(SEAT_COUNT).toBe(45);
    expect(COORDINATOR_SEAT).toBe(0);
    expect(roomSeats(0)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(roomSeats(5)).toEqual([31, 32, 33, 34, 35, 36]);
    expect(HUB_SEATS).toEqual(range(37, 44));
    expect([0, 1, 6, 7, 36, 37, 44].map(roomOfSeat)).toEqual([null, 0, 0, 1, 5, null, null]);
  });
});

describe('seatFor', () => {
  it('the coordinator sits at 0 and nowhere else', () => {
    expect(seatFor({ kind: 'coordinator', room: null }, null, taken())).toBe(0);
    expect(seatFor({ kind: 'coordinator', room: 3 }, 20, taken(1))).toBe(0);
    expect(seatFor({ kind: 'coordinator', room: null }, null, taken(0))).toBeNull();
  });

  it('a department’s member takes its room’s first free seat; a full room sends them to the hub (a department has no size limit)', () => {
    expect(seatFor(member(2), null, taken())).toBe(13);
    expect(seatFor(member(2), null, taken(13, 14))).toBe(15);
    expect(seatFor(member(2), null, taken(...roomSeats(2)))).toBe(37);
    expect(seatFor(member(2), null, taken(...roomSeats(2), 37, 38))).toBe(39);
  });

  it('the centre sits at the hub; with the hub full, the first free seat, the coordinator’s desk last; none free, none', () => {
    expect(seatFor(member(null), null, taken())).toBe(37);
    expect(seatFor(member(null), null, taken(...HUB_SEATS))).toBe(1);
    expect(seatFor(member(null), null, taken(...range(1, 44)))).toBe(0);
    expect(seatFor(member(null), null, taken(...range(0, 44)))).toBeNull();
  });

  it('whoever may stay where they sit stays; someone in the wrong place moves to their own', () => {
    expect(seatFor(member(2), 15, taken())).toBe(15);
    expect(seatFor(member(null), 40, taken())).toBe(40);
    // A room's overflow at the hub goes into the room once a seat frees there; a centre person in a room goes to the hub.
    expect(seatFor(member(2), 38, taken(13))).toBe(14);
    expect(seatFor(member(null), 3, taken())).toBe(37);
    // With nowhere better the seat one has is kept.
    expect(seatFor(member(null), 3, taken(...HUB_SEATS))).toBe(3);
    // A new department: the old room is left for the new one.
    expect(seatFor(member(4), 2, taken())).toBe(25);
  });

  it('counts only the seats a smaller (test) office has', () => {
    expect(seatFor(member(null), null, taken(0), 8)).toBe(1);
    expect(seatFor(member(1), null, taken(...range(0, 6)), 8)).toBe(7);
    expect(seatFor(member(1), null, taken(...range(0, 7)), 8)).toBeNull();
  });
});

describe('Seating', () => {
  it('seats a newcomer and walks someone whose department changed; a seat that stays sends nothing', () => {
    const t = office();
    const ada = t.roster.create({ name: 'Ada', role: 'r', deskIndex: t.seating.forHire(member(null))! });
    expect(ada.deskIndex).toBe(37);
    t.rooms.set(ada.id, 1);
    expect(t.seating.reseat(ada.id).deskIndex).toBe(7);
    expect(t.seating.reseat(ada.id).deskIndex).toBe(7);
    expect(t.seatEvents()).toEqual([['Ada', 7]]);
  });

  it('the coordinator’s desk is theirs: whoever sits there moves first', () => {
    const t = office();
    const can = t.roster.create({ name: 'Can', role: 'r', deskIndex: 0 });
    expect(t.seating.forHire({ kind: 'coordinator', room: null })).toBe(0);
    expect(t.roster.get(can.id).deskIndex).toBe(37);
    expect(t.seatEvents()).toEqual([['Can', 37]]);
  });

  it('review focus 1: an office of before (eight desks, the coordinator fourth) is reseated at its start, and a second time moves nobody', () => {
    const t = office();
    const names = ['Ada', 'Bora', 'Cem', 'Koordinatör', 'Deniz', 'Ece', 'Filiz', 'Gül'];
    const people = names.map((name) => t.roster.create({ name, role: 'r', kind: name === 'Koordinatör' ? 'coordinator' : 'member' }));
    expect(people.map((e) => e.deskIndex)).toEqual(range(0, 7));
    // Bora and Deniz are in room 0's department (a team adopted at the start), Ece in room 2's; the rest the centre.
    for (const [name, room] of [['Bora', 0], ['Deniz', 0], ['Ece', 2]] as const) t.rooms.set(people[names.indexOf(name)]!.id, room);
    expect(t.seating.reseatAll()).toBe(6);
    // Bora and Deniz may stay (their desks are room 0's seats); Ada leaves the coordinator's desk for the hub.
    expect(Object.fromEntries(t.roster.list().map((e) => [e.name, e.deskIndex]))).toEqual({ Koordinatör: 0, Ada: 37, Bora: 1, Cem: 38, Deniz: 4, Ece: 13, Filiz: 39, Gül: 40 });
    const sent = t.seatEvents().length;
    expect(sent).toBe(6);
    expect(t.seating.reseatAll()).toBe(0);
    expect(t.seatEvents()).toHaveLength(sent);
  });

  it('review focus 3: a department of seven — the room’s six, the seventh at the hub, nobody on another’s chair', () => {
    const t = office();
    const seats = range(1, 7).map((i) => t.roster.create({ name: `Kişi ${i}`, role: 'r', deskIndex: t.seating.forHire(member(4))! }).deskIndex);
    expect(seats).toEqual([...roomSeats(4), 37]);
  });

  it('a full office has no seat to give: the roster then refuses with “Ofis dolu”', () => {
    const t = office();
    for (const i of range(0, 44)) t.roster.create({ name: `K${i}`, role: 'r', deskIndex: i });
    expect(t.seating.forHire(member(null))).toBeNull();
    expect(() => t.roster.create({ name: 'Son', role: 'r' })).toThrow('Ofis dolu: 45 masanın hepsi dolu.');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/seating.test.ts`
Expected: FAIL — `Cannot find module '../src/seating.ts'`.

- [ ] **Step 3: Implement `src/seating.ts`**

```ts
import { COORDINATOR_SEAT, HUB_SEATS, SEAT_COUNT, roomSeats, type Employee, type EmployeeKind } from '@cc/shared';
import type { EventStore } from './event-store.ts';
import type { Roster } from './roster.ts';

/** Who is being seated: their kind, and their department's room (null: the centre, or a department without a room). */
export interface Seatee {
  kind: EmployeeKind;
  room: number | null;
}

/** Every seat but the coordinator's: where anyone may sit when their own place is full. */
const ANY_SEAT: readonly number[] = Array.from({ length: SEAT_COUNT - 1 }, (_, i) => i + 1);

/**
 * Where someone sits (spec 2026-10-13-office-rooms §3), pure. The coordinator at seat 0. A department's member in its
 * room's first free seat, at the hub when the room is full (a department has no size limit). The centre at the hub.
 * Then any free seat, the coordinator's desk last. Someone whose seat (`current`) lies in the first of those places that
 * has room for them keeps it: nobody is moved for nothing. `taken`: everyone else's seats; `seatCount`: the seats this
 * office has (a test office may have fewer). Null: no free seat (a hire is then refused with "Ofis dolu").
 */
export function seatFor(who: Seatee, current: number | null, taken: ReadonlySet<number>, seatCount: number = SEAT_COUNT): number | null {
  const free = (seat: number) => seat >= 0 && seat < seatCount && !taken.has(seat);
  if (who.kind === 'coordinator') return free(COORDINATOR_SEAT) ? COORDINATOR_SEAT : null;
  const places: Array<readonly number[]> = [...(who.room === null ? [] : [roomSeats(who.room)]), HUB_SEATS, ANY_SEAT, [COORDINATOR_SEAT]];
  for (const seats of places) {
    if (current !== null && seats.includes(current) && free(current)) return current;
    const seat = seats.find(free);
    if (seat !== undefined) return seat;
  }
  return null;
}

export interface SeatingDeps {
  roster: Roster;
  events: EventStore;
  /** The room of someone's department (Departments.roomOf); absent: an office without departments (everyone at the hub). */
  roomOf?: (employeeId: string) => number | null;
}

/** Who sits where (spec office rooms §3): a newcomer's seat, someone walked to theirs after a change, everyone at the start. */
export class Seating {
  readonly #d: SeatingDeps;

  constructor(d: SeatingDeps) {
    this.#d = d;
  }

  /** A newcomer's seat (they are not in the roster yet); null: none free (the roster then says "Ofis dolu"). */
  forHire(who: Seatee): number | null {
    if (who.kind === 'coordinator') this.#clearCoordinatorDesk(null);
    return seatFor(who, null, this.#taken(null), this.#d.roster.deskCount);
  }

  /** Someone to the seat the rules give them, when it is not the one they have; the page hears it (seat.changed). */
  reseat(employeeId: string): Employee {
    const e = this.#d.roster.get(employeeId);
    if (e.lifecycle === 'archived') return e;
    if (e.kind === 'coordinator') this.#clearCoordinatorDesk(e.id);
    const seat = seatFor(this.#seatee(e), e.deskIndex, this.#taken(e.id), this.#d.roster.deskCount);
    return seat === null || seat === e.deskIndex ? e : this.#move(e, seat);
  }

  /**
   * Everyone to their seat, at every start (idempotent): how an office of eight desks moves into the rooms and the hub.
   * Repeated until nobody moves, as a move can free a better seat for someone already passed (every move is to a better
   * place, so it ends). Returns how many sit elsewhere than before.
   */
  reseatAll(): number {
    const before = new Map(this.#d.roster.list().map((e) => [e.id, e.deskIndex]));
    const coordinator = this.#d.roster.list().find((e) => e.kind === 'coordinator');
    if (coordinator) this.reseat(coordinator.id);
    for (let pass = 0; pass <= SEAT_COUNT; pass += 1) {
      // The earlier hired choose first, so the outcome does not depend on the order desks happen to be in.
      const order = this.#d.roster.list().filter((e) => e.kind !== 'coordinator').sort((a, b) => a.createdAt - b.createdAt || a.deskIndex - b.deskIndex);
      let moved = false;
      for (const e of order) if (this.reseat(e.id).deskIndex !== e.deskIndex) moved = true;
      if (!moved) break;
    }
    return this.#d.roster.list().filter((e) => before.get(e.id) !== e.deskIndex).length;
  }

  #seatee(e: Employee): Seatee {
    return { kind: e.kind, room: e.kind === 'coordinator' ? null : (this.#d.roomOf?.(e.id) ?? null) };
  }

  /** The seats of everyone at work but `except`. */
  #taken(except: string | null): Set<number> {
    return new Set(this.#d.roster.list().filter((e) => e.id !== except).map((e) => e.deskIndex));
  }

  /** The coordinator's desk is theirs: someone else sitting there (an office of before, or a full one) moves off first. */
  #clearCoordinatorDesk(coordinatorId: string | null): void {
    const sitter = this.#d.roster.list().find((e) => e.deskIndex === COORDINATOR_SEAT && e.id !== coordinatorId);
    if (!sitter) return;
    const seat = seatFor(this.#seatee(sitter), null, new Set([...this.#taken(sitter.id), COORDINATOR_SEAT]), this.#d.roster.deskCount);
    if (seat !== null) this.#move(sitter, seat);
  }

  #move(e: Employee, seat: number): Employee {
    const moved = this.#d.roster.setDesk(e.id, seat);
    this.#d.events.append(e.id, { type: 'seat.changed', deskIndex: seat });
    return moved;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run test/seating.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/seating.ts apps/office-server/test/seating.test.ts
git commit -m "feat(seating): who sits where — the coordinator under the beam, a department in its room, the rest at the hub; reseat and reseatAll"
```

---

### Task 5: A room for every open department

**Files:**
- Modify: `apps/office-server/src/migrations.ts` (the departments migration, amended), `packages/shared/src/department.ts`, `apps/office-server/src/company/department-store.ts`, `apps/office-server/src/company/departments.ts`
- Test: `apps/office-server/test/db.test.ts`, `apps/office-server/test/department-store.test.ts`, `apps/office-server/test/departments.test.ts`; every `Department` literal the typecheck names (Step 7)

**Interfaces:**
- Consumes: `ROOM_COUNT` (Task 1); the `Departments` service and `DepartmentStore` of sub-project 1.
- Produces: column `departments.room INTEGER` (0–5, NULL) and index `departments_room` (unique among open departments); `Department.room: number | null`; `NewDepartment.room?: number | null`; `DepartmentStore.close` clears the room; `Departments.create` and `adoptTeams` give the lowest free room; `Departments.roomOf(employeeId: string): number | null`; `DepartmentsDeps.reseat?: (employeeId: string) => void`, called for everyone placed in or out of a department (`#place`) and everyone adopted.

- [ ] **Step 1: Write the failing tests**

`test/db.test.ts`, in the v24 test (`it('v24 adds the departments, the stream notes and an employee’s department, …')`): the `departments` columns become

```ts
    expect(columns(db, 'departments')).toEqual(['id', 'name', 'mission', 'scope', 'template', 'template_version', 'head_id', 'status', 'created_at', 'closed_at', 'room']);
```

after the line that expects the `'gone'` status insert to throw, add

```ts
    // Office rooms (sub-project 2): a room is 0–5, and two open departments never share one; a closed one may keep its number.
    db.prepare("INSERT INTO departments (id, name, created_at, room) VALUES ('d3', 'Y', 1, 0)").run();
    expect(() => db.prepare("INSERT INTO departments (id, name, created_at, room) VALUES ('d4', 'Z', 1, 0)").run()).toThrow();
    expect(() => db.prepare("INSERT INTO departments (id, name, created_at, room) VALUES ('d5', 'Z', 1, 6)").run()).toThrow();
    db.prepare("INSERT INTO departments (id, name, status, created_at, room) VALUES ('d6', 'W', 'closed', 1, 0)").run();
```

and right after `expect(migrateDown(db, 23)).toBe(23);`

```ts
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'departments_room'").get()).toBeUndefined();
```

`test/department-store.test.ts` — in the first test the expected department `a` gains `room: null` (`…, status: 'open', createdAt: 1000, closedAt: null, room: null }`); add inside `describe('DepartmentStore', …)`:

```ts
  it('keeps a department’s room; closing gives it up (spec office rooms §4.1)', () => {
    const s = setup();
    const store = new DepartmentStore(s.db);
    const a = store.create({ name: 'A', mission: 'm', scope: '', template: null, headId: null, room: 2 });
    const b = store.create({ name: 'B', mission: 'm', scope: '', template: null, headId: null });
    expect([a.room, b.room]).toEqual([2, null]);
    expect(store.update(a.id, { name: 'A2' }).room).toBe(2);
    expect(store.close(a.id).room).toBeNull();
  });
```

`test/departments.test.ts` — in `make()`, before `const departments = new Departments({…})` add `const reseated: string[] = [];`, add `reseat: (id) => void reseated.push(id)` to the Departments deps, and return `reseated` with the rest. In the `departmentBlock` test's department literal add `room: null`. Then add:

```ts
describe('Departments — rooms (spec office rooms §4.1)', () => {
  it('review focus 2: a department gets the lowest free room; closing frees it for the next; two open never share one', () => {
    const t = make();
    const [a, b, c] = ['A', 'B', 'C'].map((name) => t.departments.create(OWNER, { name, mission: 'm' }));
    expect([a, b, c].map((d) => d.room)).toEqual([0, 1, 2]);
    expect(t.departments.close(OWNER, b.id, 'bitti').room).toBeNull();
    expect(t.departments.create(OWNER, { name: 'D', mission: 'm' }).room).toBe(1);
    expect(t.departments.create(OWNER, { name: 'E', mission: 'm' }).room).toBe(3);
    const rooms = t.departments.list({ status: 'open' }).map((d) => d.room);
    expect(new Set(rooms).size).toBe(rooms.length);
    // The page draws a room from department.changed: the event carries it.
    const last = t.events.list({ limit: 1000 }).filter((e) => e.event.type === 'department.changed').at(-1)!.event as { department: { room: number } };
    expect(last.department.room).toBe(3);
  });

  it('adopted teams get rooms in order; someone’s room is their open department’s, the centre and the coordinator none', () => {
    const t = make();
    const deniz = t.hire('Deniz', { team: 'Keşif' });
    const mert = t.hire('Mert', { team: 'Geliştirme' });
    const ada = t.hire('Ada');
    t.departments.adoptTeams();
    expect(t.departments.list().map((d) => [d.name, d.room])).toEqual([['Keşif', 0], ['Geliştirme', 1]]);
    expect([deniz, mert, ada, t.coordinator].map((e) => t.departments.roomOf(e.id))).toEqual([0, 1, null, null]);
  });

  it('walks everyone whose department changed to their seat (reseat): made head, moved, closed out, adopted', () => {
    const t = make();
    const [a, b] = [t.hire('Ada'), t.hire('Bora')];
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    expect(t.reseated).toEqual([a.id]);
    t.departments.move(OWNER, b.id, x.id);
    expect(t.reseated).toEqual([a.id, b.id]);
    t.departments.close(OWNER, x.id, 'bitti');
    expect(t.reseated.slice(2).sort()).toEqual([a.id, b.id].sort());
    const c = t.hire('Cem', { team: 'Keşif' });
    t.departments.adoptTeams();
    expect(t.reseated.at(-1)).toBe(c.id);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/db.test.ts test/department-store.test.ts test/departments.test.ts`
Expected: FAIL — no `room` column; `room` undefined on departments; `t.departments.roomOf is not a function`; `reseated` stays empty.

- [ ] **Step 3: Amend the departments migration** — in `src/migrations.ts`, in the departments migration (version 24; its `name` unchanged), the `CREATE TABLE IF NOT EXISTS departments (…)` statement ends

```sql
        created_at INTEGER NOT NULL, closed_at INTEGER,
        room INTEGER CHECK (room IS NULL OR room BETWEEN 0 AND 5)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS departments_room ON departments (room) WHERE status = 'open' AND room IS NOT NULL;
```

(replacing `created_at INTEGER NOT NULL, closed_at INTEGER\n      );`), and its `down` starts with `DROP INDEX IF EXISTS departments_room;` before the existing statements. Add above the entry: `// room: office rooms (sub-project 2), added to this unreleased migration rather than a new one (spec office rooms §4.1).`

- [ ] **Step 4: The type** — in `packages/shared/src/department.ts`, `interface Department`, after `closedAt: number | null;`:

```ts
  /** The room it works in (spec office rooms §4.1), 0–5: the lowest free one when it opened; null once closed (or none was free). */
  room: number | null;
```

- [ ] **Step 5: The store** — in `src/company/department-store.ts`:

```ts
export type NewDepartment = Pick<Department, 'name' | 'mission' | 'scope' | 'template' | 'headId'> & { room?: number | null };
```

`interface DepartmentRow` gains `room: number | null;`; the `department(r)` mapper gains `room: r.room ?? null` after `closedAt: r.closed_at`; `create` writes it:

```ts
      .prepare('INSERT INTO departments (id, name, mission, scope, template, template_version, head_id, status, created_at, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, d.name, d.mission, d.scope, d.template?.id ?? null, d.template?.version ?? null, d.headId, 'open', this.#now(), d.room ?? null);
```

and `close` gives it up:

```ts
  /** Closed for good: no head, no members (the service moves them first), no room. */
  close(id: string): Department {
    this.#db.prepare("UPDATE departments SET status = 'closed', closed_at = ?, head_id = NULL, room = NULL WHERE id = ?").run(this.#now(), id);
    return this.get(id);
  }
```

(`update` does not write the room: a room changes only by opening and closing.)

- [ ] **Step 6: The service** — in `src/company/departments.ts`:

Add `ROOM_COUNT` to the `@cc/shared` import. In `interface DepartmentsDeps`, after `reload?`:

```ts
  /** Walks someone to their seat after their department changed (Seating.reseat, spec office rooms §3); absent: seats stay. */
  reseat?: (employeeId: string) => void;
```

In `create`, the store call gets the room: `this.#d.store.create({ name, mission, scope, template: template ? { id: template.id, version: template.version } : null, headId: null, room: this.#freeRoom() })`. In `adoptTeams`, the store call gets `room: this.#freeRoom()` as well, and right after `const adopted = this.#d.roster.update(e.id, { departmentId: dep.id, … });` add `this.#d.reseat?.(e.id);`.

After `responsible(id)` add:

```ts
  /** The room someone works in: their open department's (spec office rooms §4.1); null: the centre, or a department with no room. */
  roomOf(employeeId: string): number | null {
    return this.of(employeeId)?.room ?? null;
  }
```

Replace `#place` with:

```ts
  /** Puts someone in a department (or the centre) as its head or a member, keeping the invariants (spec §3); their seat follows. */
  #place(e: Employee, dep: Department | null, head: boolean): Employee {
    if (e.kind === 'coordinator') throw new ConflictError('Koordinatörün departmanı olmaz.');
    const placed = this.#d.roster.update(e.id, { departmentId: dep?.id ?? null, team: dep?.name ?? '', kind: head ? 'lead' : 'member', reportsTo: !dep || head ? null : dep.headId });
    this.#d.reseat?.(placed.id);
    return this.#d.roster.get(placed.id);
  }
```

and add, with the other internals:

```ts
  /** The lowest room no open department has; null: none (a team adopted past the six rooms sits at the hub). */
  #freeRoom(): number | null {
    const used = new Set(this.list({ status: 'open' }).map((d) => d.room));
    for (let room = 0; room < ROOM_COUNT; room += 1) if (!used.has(room)) return room;
    return null;
  }
```

- [ ] **Step 7: Every `Department` literal gets its room**

Run: `cd ~/Projects/control-center-departments && pnpm -r typecheck`
Expected at first: FAIL in the test files that build a `Department` by hand (sub-project 1's `departments.test.ts` is fixed above; `apps/office-web/src/store/reducers.test.ts` and any other the output names). Add `room: null` to each such literal (a test that means a room gives that number), then run it again.
Expected: PASS.

- [ ] **Step 8: Run the tests, then both suites**

Run: `cd apps/office-server && pnpm vitest run test/db.test.ts test/department-store.test.ts test/departments.test.ts && pnpm vitest run && cd ../office-web && pnpm vitest run`
Expected: PASS (including "numbers the migrations 1, 2, 3 …", "round-trips up → down → up", "is a no-op when run twice").

- [ ] **Step 9: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-server/src/migrations.ts packages/shared/src/department.ts apps/office-server/src/company/department-store.ts apps/office-server/src/company/departments.ts apps/office-server/test apps/office-web/src
git commit -m "feat(departments): every open department has a room — the lowest free one, given up when it closes; the departments migration gains departments.room"
```

---

### Task 6: Seats follow the company

**Files:**
- Modify: `apps/office-server/src/company/company.ts`, `apps/office-server/test/company-helpers.ts`, `apps/office-server/src/main.ts`
- Create: `apps/office-server/test/company-seating.test.ts`
- Test: `apps/office-server/test/main.test.ts`

**Interfaces:**
- Consumes: `Seating` (Task 4); `Departments.roomOf`, `DepartmentsDeps.reseat`, `Department.room` (Task 5).
- Produces: `CompanyDeps.seating?: Seating`; `Company.hire` seats a hire in its department's room (else the hub); `hireCoordinator` at seat 0; `appointCoordinator` walks the former coordinator to their place and the new one to seat 0; `companyFor(…)` returns `seating` and wires it in every test office; `main.ts` runs `seating.reseatAll()` at every start, after the teams are adopted.

- [ ] **Step 1: Write the failing tests** — `test/company-seating.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { HUB_SEATS, OWNER, SEAT_COUNT, roomSeats } from '@cc/shared';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(o: { departments?: boolean } = { departments: true }) {
  const s = setup(SEAT_COUNT);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder', 'designer', 'manager'], undefined, undefined, o);
  c.budget.setConstitution({ maxEmployees: SEAT_COUNT });
  const seat = (id: string) => s.roster.get(id).deskIndex;
  const moves = () =>
    s.events.list({ limit: 2000 }).filter((e) => e.event.type === 'seat.changed').map((e) => [s.roster.get(e.employeeId!).name, (e.event as { deskIndex: number }).deskIndex]);
  return { ...s, ...c, departments: c.departments!, seat, moves };
}

describe('Seats in the company (spec office rooms §3)', () => {
  it('the coordinator sits under the beam, a department’s hire in its room, a hire to the centre at the hub; a hire sends no seat.changed', () => {
    const t = make();
    const coordinator = t.company.hireCoordinator('sonnet');
    const marketing = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    const sales = t.departments.create(OWNER, { name: 'Satış', mission: 'm' });
    const pelin = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: marketing.id, head: true });
    const sena = t.company.hire(OWNER, { name: 'Sena', role: 'r', departmentId: sales.id });
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect([coordinator, pelin, sena, ada].map((e) => t.seat(e.id))).toEqual([0, roomSeats(0)[0], roomSeats(1)[0], HUB_SEATS[0]]);
    expect(t.moves()).toEqual([]);
  });

  it('review focus 2: moving someone walks them to the new room; closing sends the room to the hub, and the next department takes that room', () => {
    const t = make();
    t.company.hireCoordinator('sonnet');
    const a = t.departments.create(OWNER, { name: 'A', mission: 'm' });
    const b = t.departments.create(OWNER, { name: 'B', mission: 'm' });
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r', departmentId: a.id });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r', departmentId: a.id });
    t.departments.move(OWNER, ada.id, b.id);
    expect(t.seat(ada.id)).toBe(roomSeats(1)[0]);
    t.departments.close(OWNER, a.id, 'bitti');
    expect(t.seat(can.id)).toBe(HUB_SEATS[0]);
    const c = t.departments.create(OWNER, { name: 'C', mission: 'm' });
    expect(c.room).toBe(0);
    t.departments.move(OWNER, can.id, c.id);
    expect(t.seat(can.id)).toBe(roomSeats(0)[0]);
    expect(t.moves()).toEqual([['Ada', 7], ['Can', 37], ['Can', 1]]);
  });

  it('review focus 3: a department of seven fills its room and seats the seventh at the hub', () => {
    const t = make();
    t.company.hireCoordinator('sonnet');
    const dep = t.departments.create(OWNER, { name: 'Yazılım', mission: 'm' });
    const seven = ['Ada', 'Bora', 'Cem', 'Deniz', 'Ece', 'Filiz', 'Gül'].map((name) => t.company.hire(OWNER, { name, role: 'r', departmentId: dep.id }));
    expect(seven.map((e) => t.seat(e.id))).toEqual([...roomSeats(0), HUB_SEATS[0]]);
  });

  it('a new coordinator takes the beam’s desk; the one before goes to the hub', () => {
    const t = make();
    const old = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect(t.company.appointCoordinator(ada.id).deskIndex).toBe(0);
    expect(t.seat(old.id)).toBe(HUB_SEATS[1]);
    expect(t.moves()).toEqual([['Koordinatör', HUB_SEATS[1]], ['Ada', 0]]);
  });

  it('an office without departments seats everyone at the hub and the coordinator under the beam', () => {
    const t = make({});
    const coordinator = t.company.hireCoordinator('sonnet');
    const people = ['Ada', 'Can'].map((name) => t.company.hire(coordinator.id, { name, role: 'r' }));
    expect([coordinator, ...people].map((e) => t.seat(e.id))).toEqual([0, 37, 38]);
  });
});
```

`test/main.test.ts` — inside `describe('main.ts wiring: the office process', …)`:

```ts
  it('rooms: an office of before (eight desks) is reseated at its start — the coordinator under the beam, an adopted team in its room, the rest at the hub', async () => {
    const dir = tempDir();
    const db = openDb(join(dir, 'office.db'));
    migrateUp(db);
    // Desks by hire order as before rooms, the coordinator third; Bora's team becomes a department (room 0) at the start.
    const roster = new Roster(db, 8);
    const ada = roster.create({ name: 'Ada', role: 'r' });
    const bora = roster.create({ name: 'Bora', role: 'r', team: 'Keşif' });
    const coordinator = roster.create({ name: 'Koordinatör', role: 'r', kind: 'coordinator' });
    expect([ada, bora, coordinator].map((e) => e.deskIndex)).toEqual([0, 1, 2]);
    db.close();
    const office = startOffice(dir);
    const port = await portOf(office);
    const snapshot: { employees: Array<{ id: string; deskIndex: number }>; departments: Array<{ name: string; room: number }> } = await call(port, 'GET', '/api/office');
    const seat = (id: string) => snapshot.employees.find((e) => e.id === id)!.deskIndex;
    expect([seat(coordinator.id), seat(bora.id), seat(ada.id)]).toEqual([0, 1, 37]);
    expect(snapshot.departments.map((d) => [d.name, d.room])).toEqual([['Keşif', 0]]);
    await stop(office);
  }, 30_000);
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-server && pnpm vitest run test/company-seating.test.ts test/main.test.ts`
Expected: FAIL — Sena takes the lowest free desk 2, not 7; Ada stays at desk 0 and the coordinator at 2 in the process.

- [ ] **Step 3: Implement in `src/company/company.ts`**

Add `import type { Seating } from '../seating.ts';` and to `CompanyDeps`:

```ts
  /** Who sits where (spec 2026-10-13-office-rooms §3); absent: the roster's lowest free desk, as before rooms. */
  seating?: Seating;
```

In `hire`, replace the line `const hired = this.#d.hire({ ...resolved, ...placement, kind: 'member', characterId, ...(o.deny?.length ? { deskDeny: o.deny } : {}) });` with:

```ts
    // Their seat (spec office rooms §3): their department's room, else the hub; none free, the roster's "Ofis dolu".
    // Always set, so a deskIndex in the request body never chooses one.
    const deskIndex = this.#d.seating?.forHire({ kind: 'member', room: department?.room ?? null }) ?? undefined;
    const hired = this.#d.hire({ ...resolved, ...placement, kind: 'member', characterId, deskIndex, ...(o.deny?.length ? { deskDeny: o.deny } : {}) });
```

In `hireCoordinator`, replace the `this.#d.hire({ name: 'Koordinatör', … })` call with:

```ts
    // Under the beam (spec office rooms §3): whoever sits at seat 0 moves off it first.
    const deskIndex = this.#d.seating?.forHire({ kind: 'coordinator', room: null }) ?? undefined;
    const hired = this.#d.hire({ name: 'Koordinatör', role: COORDINATOR_ROLE, model, provider, title: 'Koordinatör', kind: 'coordinator', characterId, deskIndex });
```

In `appointCoordinator`, inside `if (previous && previous.id !== id) { … }` add as its last line `this.#d.seating?.reseat(previous.id);`; right after `const next = this.#d.roster.update(id, { kind: 'coordinator', reportsTo: null });` add `this.#d.seating?.reseat(id);`; and replace the method's final `return next;` with `return this.#d.roster.get(id);` (the seat it now has).

- [ ] **Step 4: Wire it in `test/company-helpers.ts`**

Add `import { Seating } from '../src/seating.ts';`. Add `reseat: (id) => seating.reseat(id)` to the `Departments` deps, and right after the `const departments = …` statement:

```ts
  // Who sits where (spec 2026-10-13-office-rooms §3), wired like main.ts in every office; the rooms come from the departments.
  const seating = new Seating({ roster: s.roster, events: s.events, ...(departments ? { roomOf: (id: string) => departments.roomOf(id) } : {}) });
```

Pass `seating` in the `Company` deps and return it with the rest (`…, departments, streamNotes, seating,`).

- [ ] **Step 5: Wire it in `src/main.ts`**

Add `import { Seating } from './seating.ts';`. Add `reseat: (id) => seating.reseat(id)` to the `new Departments({…})` deps, and right after that statement:

```ts
// Who sits where (spec 2026-10-13-office-rooms §3): the coordinator under the beam, a department in its room, the rest at the hub.
const seating = new Seating({ roster, events, roomOf: (id) => departments.roomOf(id) });
```

Add `seating` to the `new Company({…})` deps. Right after `departments.refreshDesks();` (the start's adoption block):

```ts
// Everyone to their seat (idempotent): on the first start the eight desks of before become the rooms and the hub.
seating.reseatAll();
```

- [ ] **Step 6: Run the tests, then the whole suite and the typecheck**

Run: `pnpm vitest run test/company-seating.test.ts test/main.test.ts test/company.test.ts test/company-departments.test.ts test/departments.test.ts && pnpm vitest run && pnpm --filter @cc/office-server typecheck`
Expected: PASS. The economy scenario keeps main's log (it hires the coordinator first; every later hire takes desks 1 … 7 as before and nobody moves). If an older test counts every event after `appointCoordinator`, it now sees the two `seat.changed` too — add them there; do not suppress the event.

- [ ] **Step 7: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-server/src/company/company.ts apps/office-server/src/main.ts apps/office-server/test/company-helpers.ts apps/office-server/test/company-seating.test.ts apps/office-server/test/main.test.ts
git commit -m "feat(seating): hires, department changes and a new coordinator move people to their seats; the office reseats everyone at its start"
```

---

### Task 7: The new floor plan

**Files:**
- Modify: `apps/office-web/src/office/layout.ts` (rewritten), `apps/office-web/src/office/behavior.ts` (a comment), `apps/office-web/src/scene/CharactersLayer.tsx`, `apps/office-web/src/scene/FurnitureLayer.tsx`
- Test: `apps/office-web/src/office/layout.test.ts` (rewritten), `apps/office-web/src/scene/CharactersLayer.test.tsx`

**Interfaces:**
- Consumes: `COORDINATOR_SEAT`, `HUB_SEATS`, `ROOM_COUNT`, `SEAT_COUNT`, `roomSeats` (Task 1); `buildGrid` (grid.ts, unchanged).
- Produces (layout.ts): `Wall.faces?: { x: number; z: number }`; `Placement.room?: number`, `Placement.bulbOnly?: boolean`; `Desk.room?: number`; `interface RoomGeometry { index: number; rect: { x1: number; z1: number; x2: number; z2: number }; door: { x1: number; x2: number; z: number }; sign: { x: number; y: number; z: number; rotY: number }; carpet: Carpet; seats: number[] }`; `Layout.rooms: RoomGeometry[]`, `Layout.beam: { x: number; z: number }`; `ROOM_COLORS`; `LAYOUT.seats[n]` and `LAYOUT.desks[n]` are seat n's (45 each); `spotFor(layout, zone, seat, order = seat)`; `wanderOrder(people): Record<string, number>`. FurnitureLayer: a `bulbOnly` lamp has no point light.

- [ ] **Step 1: Rewrite the failing layout tests** — `src/office/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COORDINATOR_SEAT, HUB_SEATS, SEAT_COUNT, roomSeats } from '@cc/shared';
import { behaviorOf, IDLE_WANDER_MS } from './behavior.ts';
import { cellOf, findPath, isFreeAt, type Grid, type Pt } from './grid.ts';
import { COUNTER_TOP, GRID, LAYOUT, spotFor, wanderOrder, type Placement } from './layout.ts';

const places = [...LAYOUT.coffeeSpots, ...LAYOUT.loungeSpots, ...LAYOUT.serverSpots, ...LAYOUT.meetingSpots];
const key = (s: Pt) => `${s.x},${s.z}`;
const inside = (p: Pt, r: { x1: number; z1: number; x2: number; z2: number }) => p.x > r.x1 && p.x < r.x2 && p.z > r.z1 && p.z < r.z2;
/** An item's footprint on the floor: a quarter turn swaps its width and depth. */
const footprint = (p: Placement) => (Math.abs(Math.round(p.rotY / (Math.PI / 2))) % 2 === 1 ? { w: p.d, d: p.w } : { w: p.w, d: p.d });

/**
 * The free cells reachable from `from`, 4-way: A* moves 8-way without cutting corners, which reaches exactly these.
 * (findPath falls back to a straight line when there is no route, so its result alone does not prove one.)
 */
function reachable(g: Grid, from: Pt): (p: Pt) => boolean {
  const seen = new Uint8Array(g.nx * g.nz);
  const [i0, k0] = cellOf(g, from);
  const queue = [k0 * g.nx + i0];
  seen[queue[0]!] = 1;
  while (queue.length > 0) {
    const c = queue.pop()!;
    const i = c % g.nx;
    const k = Math.floor(c / g.nx);
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nk = k + dk;
      const n = nk * g.nx + ni;
      if (ni < 0 || nk < 0 || ni >= g.nx || nk >= g.nz || seen[n] || g.blocked[n]) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return (p) => {
    const [i, k] = cellOf(g, p);
    return seen[k * g.nx + i] === 1;
  };
}

describe('office layout (spec office rooms §2)', () => {
  it('is 32 × 24 m: three rooms north (z 0–7) and three south (z 17–24) around the hub, the beam on the coordinator’s desk', () => {
    expect([LAYOUT.width, LAYOUT.depth, LAYOUT.cell]).toEqual([32, 24, 0.5]);
    expect(LAYOUT.rooms.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(LAYOUT.rooms.map((r) => [r.rect.z1, r.rect.z2])).toEqual([[0, 7], [0, 7], [0, 7], [17, 24], [17, 24], [17, 24]]);
    for (const r of LAYOUT.rooms) expect(r.rect.x2 - r.rect.x1).toBeCloseTo(32 / 3);
    // The doors are on the hub's side: the north rooms' in their south glass, the south rooms' in their north glass.
    expect(LAYOUT.rooms.map((r) => r.door.z)).toEqual([7, 7, 7, 17, 17, 17]);
    expect(LAYOUT.beam).toEqual({ x: 16, z: 12 });
    const desk = LAYOUT.desks[COORDINATOR_SEAT]!;
    expect([desk.x, desk.z]).toEqual([LAYOUT.beam.x, LAYOUT.beam.z]);
    // The far walls are full height, the two facing the camera low (camera.ts turns only between them).
    expect(LAYOUT.walls.filter((w) => w.kind === 'low').map((w) => [w.x1, w.z1, w.x2, w.z2])).toEqual([[32, 0, 32, 24], [0, 24, 32, 24]]);
  });

  it('has 45 seats with a desk each, and every seat and place stands on a free cell', () => {
    expect(LAYOUT.seats).toHaveLength(SEAT_COUNT);
    expect(LAYOUT.desks).toHaveLength(SEAT_COUNT);
    for (const s of [...LAYOUT.seats, ...places]) expect(isFreeAt(GRID, s), key(s)).toBe(true);
  });

  it('seats each room’s six inside it, and the coordinator’s and the hub’s outside every room; the sign hangs over the door', () => {
    for (const room of LAYOUT.rooms) {
      expect(room.seats).toEqual(roomSeats(room.index));
      for (const n of room.seats) {
        expect(inside(LAYOUT.seats[n]!, room.rect), `seat ${n}`).toBe(true);
        expect(LAYOUT.desks[n]!.room).toBe(room.index);
      }
      expect(room.sign.x).toBeGreaterThan(room.door.x1);
      expect(room.sign.x).toBeLessThan(room.door.x2);
      expect(room.sign.z).toBe(room.door.z);
    }
    for (const n of [COORDINATOR_SEAT, ...HUB_SEATS]) {
      expect(LAYOUT.rooms.some((r) => inside(LAYOUT.seats[n]!, r.rect)), `seat ${n}`).toBe(false);
      expect(LAYOUT.desks[n]!.room).toBeUndefined();
    }
  });

  it('review focus 4: every seat reaches every place — coffee, lounge, the server corner, the meeting table — through free cells only', () => {
    const reached = reachable(GRID, LAYOUT.seats[COORDINATOR_SEAT]!);
    for (const s of [...LAYOUT.seats, ...places]) expect(reached(s), `${key(s)} is cut off`).toBe(true);
    for (const seat of LAYOUT.seats) {
      for (const target of places) {
        const path = findPath(GRID, seat, target);
        expect(path.at(-1)).toEqual({ x: target.x, z: target.z });
        expect(path.every((p) => isFreeAt(GRID, p)), `${key(seat)} → ${key(target)}`).toBe(true);
      }
    }
  });

  it('review focus 4: every room is left through its 1.4 m door, never through its glass', () => {
    for (const room of LAYOUT.rooms) {
      expect(room.door.x2 - room.door.x1).toBeCloseTo(1.4);
      for (const n of room.seats) {
        const from = LAYOUT.seats[n]!;
        const pts = [from, ...findPath(GRID, from, LAYOUT.seats[COORDINATOR_SEAT]!)];
        let crossings = 0;
        for (let i = 1; i < pts.length; i += 1) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          if ((a.z - room.door.z) * (b.z - room.door.z) >= 0) continue;
          const x = a.x + ((room.door.z - a.z) / (b.z - a.z)) * (b.x - a.x);
          crossings += 1;
          expect(x, `room ${room.index}, seat ${n}: through the glass at x ${x}`).toBeGreaterThan(room.door.x1);
          expect(x).toBeLessThan(room.door.x2);
        }
        expect(crossings, `room ${room.index}, seat ${n}`).toBe(1);
      }
    }
  });

  it('lounge places are seats: walk to a free spot just in front, then sit on the sofa, armchair or pouf', () => {
    for (const s of LAYOUT.loungeSpots) {
      expect(s.seat, key(s)).toBeDefined();
      expect(Math.hypot(s.seat!.x - s.x, s.seat!.z - s.z)).toBeLessThan(1);
    }
  });

  it('lights the office with lamps that glow; a dozen cast light — one pendant per room, the rooms’ desk lamps only glow', () => {
    const lamps = LAYOUT.furniture.filter((p) => (p.glow ?? 0) > 0);
    expect(lamps.length).toBeGreaterThanOrEqual(30);
    expect(lamps.filter((p) => !p.bulbOnly).length).toBeLessThanOrEqual(12);
    for (const r of LAYOUT.rooms) expect(lamps.filter((p) => p.room === r.index && !p.bulbOnly), `room ${r.index}`).toHaveLength(1);
  });

  it('gives every room its own carpet colour', () => {
    expect(new Set(LAYOUT.rooms.map((r) => r.carpet.color)).size).toBe(6);
    for (const r of LAYOUT.rooms) for (const n of r.seats) expect(inside(LAYOUT.seats[n]!, r.carpet), `seat ${n} on its room's carpet`).toBe(true);
  });

  it('maps zones to spots: a desk by seat number (an unknown one wraps), the rest by wandering order', () => {
    expect(spotFor(LAYOUT, 'desk', 37)).toBe(LAYOUT.seats[37]);
    expect(spotFor(LAYOUT, 'desk', 37, 2)).toBe(LAYOUT.seats[37]);
    expect(spotFor(LAYOUT, 'desk', SEAT_COUNT + 3)).toBe(LAYOUT.seats[3]);
    expect(spotFor(LAYOUT, 'coffee', 13, 4)).toBe(LAYOUT.coffeeSpots[2]);
    expect(spotFor(LAYOUT, 'lounge', 13, 5)).toBe(LAYOUT.loungeSpots[2]);
    expect(spotFor(LAYOUT, 'server', 13, 5)).toBe(LAYOUT.serverSpots[5]);
    expect(spotFor(LAYOUT, 'meeting', 0, 0)).toBe(LAYOUT.meetingSpots[0]);
    // Without an order the seat is the order (as before).
    expect(spotFor(LAYOUT, 'server', 5)).toBe(LAYOUT.serverSpots[5]);
  });

  it('review focus: never puts two people on one spot — 45 seats, up to 24 wanderers, 12 at the server corner, 6 at the meeting table', () => {
    expect([LAYOUT.coffeeSpots, LAYOUT.loungeSpots, LAYOUT.serverSpots, LAYOUT.meetingSpots].map((l) => l.length)).toEqual([12, 12, 12, 6]);
    expect(new Set(LAYOUT.seats.map(key)).size).toBe(SEAT_COUNT);
    const wanderers = Array.from({ length: 24 }, (_, order) => {
      const { zone } = behaviorOf({ lifecycle: 'idle', openToolSince: null, idleSince: 0, ownerTypingAt: null, now: IDLE_WANDER_MS * 2, wanderSeed: order });
      return `${zone}:${key(spotFor(LAYOUT, zone, 37, order))}`;
    });
    expect(new Set(wanderers).size).toBe(24);
    expect(new Set(Array.from({ length: 12 }, (_, o) => key(spotFor(LAYOUT, 'server', 0, o)))).size).toBe(12);
    expect(new Set(Array.from({ length: 6 }, (_, o) => key(spotFor(LAYOUT, 'meeting', 0, o)))).size).toBe(6);
  });

  it('orders the people at work by seat, so wanderers spread whatever seats they have', () => {
    const p = (id: string, deskIndex: number, createdAt = 1) => ({ id, deskIndex, createdAt });
    expect(wanderOrder([p('hub', 37), p('coord', 0), p('room', 13), p('room2', 14)])).toEqual({ coord: 0, room: 1, room2: 2, hub: 3 });
  });

  it('stands the coffee machine on the counter top, inside the counter (turned with it)', () => {
    const counter = LAYOUT.furniture.find((p) => p.assetId === 'coffee_counter_sink')!;
    const machine = LAYOUT.furniture.find((p) => p.assetId === 'espresso_machine')!;
    expect(machine.y).toBeCloseTo(counter.y + COUNTER_TOP * counter.h);
    expect(Math.abs(machine.x - counter.x) + footprint(machine).w / 2).toBeLessThan(footprint(counter).w / 2);
    expect(Math.abs(machine.z - counter.z) + footprint(machine).d / 2).toBeLessThan(footprint(counter).d / 2);
  });

  it('keeps everything that stands on the floor: nothing standing is hung in the air', () => {
    for (const p of LAYOUT.furniture.filter((q) => ['server_rack', 'coffee_counter_sink', 'meeting_table_chairs', 'low_credenza', 'work_desk'].includes(q.assetId))) {
      expect(p.y, p.assetId).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-web && pnpm vitest run src/office/layout.test.ts`
Expected: FAIL — `wanderOrder` is not exported; the floor is 18 × 14 with 8 seats and no rooms.

- [ ] **Step 3: Rewrite `src/office/layout.ts`**

```ts
import { COORDINATOR_SEAT, HUB_SEATS, ROOM_COUNT, roomSeats, type Employee } from '@cc/shared';
import type { Zone } from './behavior.ts';
import { buildGrid, type Rect } from './grid.ts';

export interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  /** `slats`: a wall clad in vertical oak slats (a feature wall or partition). */
  kind: 'solid' | 'window' | 'glass' | 'low' | 'slats';
  /** The centre of the room this wall bounds: its inside face looks there (Room.tsx); absent: at the floor's middle. */
  faces?: { x: number; z: number };
}

/** w/d/h are the item's own size before rotation; (x, z) is its centre on the floor, y lifts it onto a surface. */
export interface Placement {
  assetId: string;
  x: number;
  z: number;
  y: number;
  rotY: number;
  w: number;
  d: number;
  h: number;
  color: string;
  blocks: boolean;
  /** A lamp: the strength of its warm light, which sits at `glowAt` of its height (0 = bottom, 1 = top). */
  glow?: number;
  glowAt?: number;
  /** The bulb glows but casts no light: the rooms' many desk lamps (every point light costs every pixel). */
  bulbOnly?: boolean;
  /** Leaves that move a little in the air. */
  sway?: boolean;
  /** `box`: stretch the model to w × h × d (for models drawn with the wrong proportions); otherwise fit its height. */
  fit?: 'box';
  /** The department room it stands in: its lamp is off while the room is empty (FurnitureLayer). */
  room?: number;
}

export interface Spot {
  x: number;
  z: number;
  rotY: number;
  /**
   * Where to sit once at the spot (a sofa, an armchair): the spot itself is the free floor just in front of it.
   * `height` is the seat's surface (metres, measured from the model); a desk chair's is CHAIR_SEAT.
   */
  seat?: { x: number; z: number; height: number };
}

/** A desk's own things: monitors, keyboard, a mug. (x, z) is the desk's centre, rotY the way its person faces. */
export interface Desk {
  x: number;
  z: number;
  rotY: number;
  monitors: 1 | 2;
  /** The department room it stands in: its screens are off while the room is empty (DeskDressing). */
  room?: number;
}

/** A framed picture on a wall: (x, y, z) is its centre, rotY the way it faces; `seed` picks the art. */
export interface Frame {
  x: number;
  y: number;
  z: number;
  rotY: number;
  w: number;
  h: number;
  seed: number;
}

export interface Carpet {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  color: string;
}

/** A department room (spec office rooms §4): where it is, its door and sign on the hub's side, its carpet, its seats. */
export interface RoomGeometry {
  index: number;
  rect: { x1: number; z1: number; x2: number; z2: number };
  /** The gap in the hub-facing glass. */
  door: { x1: number; x2: number; z: number };
  /** The door sign's centre; rotY turns its front to the hub. */
  sign: { x: number; y: number; z: number; rotY: number };
  /** Its carpet, in its colour when a department works there (RoomsLayer). */
  carpet: Carpet;
  seats: number[];
}

export interface Layout {
  width: number;
  depth: number;
  cell: number;
  walls: Wall[];
  furniture: Placement[];
  carpets: Carpet[];
  frames: Frame[];
  /** Seat n's desk (deskIndex n). */
  desks: Desk[];
  /** Seat n's chair. */
  seats: Spot[];
  coffeeSpots: Spot[];
  loungeSpots: Spot[];
  serverSpots: Spot[];
  meetingSpots: Spot[];
  rooms: RoomGeometry[];
  /** Where the light beam comes down: the coordinator's desk. */
  beam: { x: number; z: number };
}

const PI = Math.PI;
/**
 * The kitchenette model carries its own hutch of shelves: its counter top is at 48% of the model's height (measured
 * from the model), so things that stand on the counter go there, not on top of the whole model.
 */
export const COUNTER_TOP = 0.48;
/** The desk chairs' seat height (measured from the model): the seated clips are set for it. */
export const CHAIR_SEAT = 0.5;
const KITCHEN_H = 2.0;
const item = (assetId: string, x: number, z: number, rotY: number, w: number, d: number, h: number, color: string, extra: Partial<Placement> = {}): Placement => ({
  assetId, x, z, y: 0, rotY, w, d, h, color, blocks: true, ...extra,
});
const decor = (assetId: string, x: number, y: number, z: number, rotY: number, w: number, d: number, h: number, color: string, extra: Partial<Placement> = {}) =>
  item(assetId, x, z, rotY, w, d, h, color, { y, blocks: false, ...extra });
const plant = (assetId: string, x: number, z: number, h: number, size = 0.6) => item(assetId, x, z, 0, size, size, h, '#5f9a4a', { sway: true });

const WIDTH = 32;
const DEPTH = 24;
const ROOM_W = WIDTH / 3;
/** The hub-facing glass: the north rooms' south wall and the south rooms' north wall. */
const NORTH_Z = 7;
const SOUTH_Z = 17;
const GLASS_H = 2.6;
const DOOR_W = 1.4;
/**
 * Where each column's doors start: 0.1 m before a cell line, so two cell columns stay walkable between the glass's
 * 0.35 m margins (the walkers' grid, obstaclesOf).
 */
const DOOR_X1 = [4.4, 15.4, 25.9];
/** The rooms' carpets when a department works there, one per room (an empty room's is dark grey: RoomsLayer). */
export const ROOM_COLORS = ['#3f7f86', '#c9783f', '#6b7fb0', '#7d9a55', '#b0605e', '#c9a94f'] as const;

const furniture: Placement[] = [];
const desks: Desk[] = [];
const seats: Spot[] = [];
const walls: Wall[] = [];
const rooms: RoomGeometry[] = [];
const frames: Frame[] = [];

/**
 * Desks back to back like the reference, a planter along the join: row 0 sits north of its desk facing south (the
 * camera), row 1 south facing north. `seatNos` numbers row 0 west to east, then row 1.
 */
function cluster(xs: number[], z0: number, seatNos: readonly number[], room?: number) {
  const tag = room === undefined ? {} : { room };
  let k = 0;
  for (const row of [0, 1] as const) {
    xs.forEach((x, col) => {
      const deskZ = row === 0 ? z0 : z0 + 0.8;
      const rotY = row === 0 ? 0 : PI;
      const chairZ = row === 0 ? deskZ - 0.85 : deskZ + 0.85;
      const seat = seatNos[k]!;
      k += 1;
      furniture.push(item('work_desk', x, deskZ, rotY, 1.4, 0.75, 0.75, '#d9b07a', tag));
      furniture.push(item('ergonomic_chair', x, chairZ, rotY, 0.6, 0.6, 1.0, '#3a3f47', { blocks: false, ...tag }));
      const s = row === 0 ? 1 : -1;
      if ((col + row) % 2 === 0) furniture.push(decor('desk_plant', x + s * 0.52, 0.75, deskZ - s * 0.18, 0, 0.2, 0.2, 0.26, '#6a9a4a', { sway: true, ...tag }));
      else furniture.push(decor('desk_lamp', x + s * 0.56, 0.75, deskZ + s * 0.2, rotY + PI, 0.2, 0.2, 0.4, '#2d3138', { glow: 0.7, glowAt: 0.85, bulbOnly: true, ...tag }));
      desks[seat] = { x, z: deskZ, rotY, monitors: (seat + col) % 3 === 0 ? 2 : 1, ...tag };
      seats[seat] = { x, z: chairZ, rotY };
    });
  }
  furniture.push(decor('desk_planter', xs[Math.floor(xs.length / 2)]!, 0.75, z0 + 0.4, 0, 1.33, 0.43, 0.34, '#6a9a4a', { sway: true, ...tag }));
}

// The six department rooms (spec office rooms §2): three north of the hub, three south, glass between them and towards the hub.
for (let r = 0; r < ROOM_COUNT; r += 1) {
  const north = r < 3;
  const x1 = (r % 3) * ROOM_W;
  const x2 = x1 + ROOM_W;
  const z1 = north ? 0 : SOUTH_Z;
  const z2 = north ? NORTH_Z : DEPTH;
  const cx = (x1 + x2) / 2;
  const centre = { x: cx, z: (z1 + z2) / 2 };
  const wallZ = north ? NORTH_Z : SOUTH_Z;
  const door = { x1: DOOR_X1[r % 3]!, x2: DOOR_X1[r % 3]! + DOOR_W, z: wallZ };
  const z0 = north ? 3.1 : 20.1;
  cluster([cx - 1.5, cx, cx + 1.5], z0, roomSeats(r), r);
  // The room's own light over its desks: off while it is empty.
  furniture.push(decor('pendant_lamp', cx, 2.2, z0 + 0.4, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.0, glowAt: 0.08, room: r }));
  // A picture on the north rooms' outer wall; the south rooms have only glass and a low wall, so a low credenza instead.
  if (north) frames.push({ x: cx + 3.4, y: 1.6, z: 0.15, rotY: 0, w: 0.8, h: 0.6, seed: r + 1 });
  else furniture.push(item('low_credenza', cx + 3.2, 23.4, PI, 1.8, 0.45, 0.7, '#cfa36d', { room: r }));
  walls.push({ x1, z1: wallZ, x2: door.x1, z2: wallZ, height: GLASS_H, kind: 'glass', faces: centre });
  walls.push({ x1: door.x2, z1: wallZ, x2, z2: wallZ, height: GLASS_H, kind: 'glass', faces: centre });
  if (r % 3 < 2) walls.push({ x1: x2, z1, x2, z2, height: GLASS_H, kind: 'glass', faces: centre });
  rooms.push({
    index: r,
    rect: { x1, z1, x2, z2 },
    door,
    sign: { x: (door.x1 + door.x2) / 2, y: 2.3, z: wallZ, rotY: north ? 0 : PI },
    carpet: { x1: cx - 3.0, z1: z0 - 1.7, x2: cx + 3.0, z2: z0 + 2.5, color: ROOM_COLORS[r]! },
    seats: roomSeats(r),
  });
}

// The coordinator's desk under the beam, facing south (the camera).
furniture.push(
  item('work_desk', 16, 12, 0, 1.4, 0.75, 0.75, '#d9b07a'),
  item('ergonomic_chair', 16, 11.15, 0, 0.6, 0.6, 1.0, '#3a3f47', { blocks: false }),
  decor('desk_lamp', 16.56, 0.75, 12.2, PI, 0.2, 0.2, 0.4, '#2d3138', { glow: 0.9, glowAt: 0.85 }),
);
desks[COORDINATOR_SEAT] = { x: 16, z: 12, rotY: 0, monitors: 2 };
seats[COORDINATOR_SEAT] = { x: 16, z: 11.15, rotY: 0 };
// The hub's eight desks, two rows on each side of the coordinator: north rows first, so the first hires spread over both.
cluster([10.5, 12.0], 11.6, [HUB_SEATS[0]!, HUB_SEATS[1]!, HUB_SEATS[4]!, HUB_SEATS[5]!]);
cluster([20.0, 21.5], 11.6, [HUB_SEATS[2]!, HUB_SEATS[3]!, HUB_SEATS[6]!, HUB_SEATS[7]!]);

furniture.push(
  // The meeting table, north of the coordinator.
  item('meeting_table_chairs', 16, 9.4, 0, 3.0, 1.8, 1.0, '#c99a5b'),
  decor('pendant_lamp', 15.4, 2.2, 9.4, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.4, glowAt: 0.08 }),
  decor('pendant_lamp', 16.6, 2.2, 9.4, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.4, glowAt: 0.08 }),

  // The coffee corner (west), its counter against the windows, facing the hub.
  item('coffee_counter_sink', 0.9, 9.4, PI / 2, 2.58, 1.02, KITCHEN_H, '#e9e4dc'),
  decor('espresso_machine', 0.85, COUNTER_TOP * KITCHEN_H, 9.9, PI / 2, 0.3, 0.58, 0.45, '#454a52'),
  decor('orange_bar_stool', 1.75, 0, 8.7, 0, 0.45, 0.45, 0.75, '#e07a3a'),
  decor('orange_bar_stool', 1.75, 0, 9.4, 0, 0.45, 0.45, 0.75, '#e07a3a'),
  decor('orange_bar_stool', 1.75, 0, 10.1, 0, 0.45, 0.45, 0.75, '#e07a3a'),
  decor('pendant_lamp', 1.2, 2.35, 8.8, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.2, glowAt: 0.08 }),
  decor('pendant_lamp', 1.2, 2.35, 10.0, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.2, glowAt: 0.08 }),
  item('water_cooler', 0.6, 11.6, PI / 2, 0.4, 0.4, 1.3, '#dfe9f3'),
  plant('large_plant_pot', 0.8, 7.8, 1.3),

  // The server corner (south-west), behind an oak slat partition; the racks face south (their lights are on +z).
  item('server_rack', 0.9, 14.25, 0, 1.03, 0.87, 1.9, '#23262c'),
  item('server_rack', 1.95, 14.25, 0, 1.03, 0.87, 1.9, '#23262c'),
  item('server_rack', 3.0, 14.25, 0, 1.03, 0.87, 1.9, '#23262c'),
  item('server_rack', 4.05, 14.25, 0, 1.03, 0.87, 1.9, '#23262c'),

  // The lounge (east): two sofas facing each other over two tables, armchairs, poufs and a reading lamp.
  item('teal_lounge_sofa', 28.6, 8.1, 0, 2.4, 1.0, 0.85, '#3d8a8f'),
  item('lounge_coffee_table', 28.6, 10.2, 0, 1.28, 1.11, 0.45, '#c9a06a'),
  item('teal_lounge_sofa', 28.6, 15.9, PI, 2.4, 1.0, 0.85, '#3d8a8f'),
  item('lounge_coffee_table', 28.6, 13.8, 0, 1.28, 1.11, 0.45, '#c9a06a'),
  item('armchair', 30.8, 10.2, -PI / 2, 0.95, 0.95, 0.85, '#e07a3a'),
  item('armchair', 30.8, 13.8, -PI / 2, 0.95, 0.95, 0.85, '#e07a3a'),
  item('pouf', 26.5, 9.85, 0, 0.5, 0.5, 0.42, '#e07a3a', { fit: 'box' }),
  item('pouf', 26.5, 10.6, 0, 0.5, 0.5, 0.42, '#2f7c83', { fit: 'box' }),
  item('pouf', 26.5, 13.4, 0, 0.5, 0.5, 0.42, '#2f7c83', { fit: 'box' }),
  item('pouf', 26.5, 14.15, 0, 0.5, 0.5, 0.42, '#e07a3a', { fit: 'box' }),
  item('low_credenza', 31.35, 12.0, -PI / 2, 1.8, 0.45, 0.7, '#cfa36d'),
  item('floor_lamp', 31.2, 8.0, 0, 0.4, 0.4, 1.7, '#efe7d2', { glow: 1.8, glowAt: 0.88 }),
  plant('fiddle_plant', 31.2, 16.1, 1.6, 0.6),

  // Plants by the hub's south doors.
  plant('snake_plant', 13.6, 16.1, 1.0, 0.5),
  plant('large_plant_pot', 18.6, 16.1, 1.3),
);

walls.push(
  // Cutaway like the reference: the far walls (north, west) are full height, the two facing the camera are low.
  { x1: 0, z1: 0, x2: WIDTH, z2: 0, height: 3.2, kind: 'solid' },
  { x1: 0, z1: 0, x2: 0, z2: NORTH_Z, height: 3.2, kind: 'window', faces: { x: ROOM_W / 2, z: NORTH_Z / 2 } },
  { x1: 0, z1: NORTH_Z, x2: 0, z2: SOUTH_Z, height: 3.2, kind: 'window' },
  { x1: 0, z1: SOUTH_Z, x2: 0, z2: DEPTH, height: 3.2, kind: 'window', faces: { x: ROOM_W / 2, z: (SOUTH_Z + DEPTH) / 2 } },
  { x1: WIDTH, z1: 0, x2: WIDTH, z2: DEPTH, height: 0.5, kind: 'low' },
  { x1: 0, z1: DEPTH, x2: WIDTH, z2: DEPTH, height: 0.5, kind: 'low' },
  // The server corner's partition.
  { x1: 0, z1: 13.4, x2: 4.8, z2: 13.4, height: 2.2, kind: 'slats' },
);

/** Standing spots in a grid, all facing one way. */
const grid = (xs: number[], zs: number[], rotY: number): Spot[] => xs.flatMap((x) => zs.map((z) => ({ x, z, rotY })));
/** A sofa's three places: the free floor in front, the seat behind it (seat height measured from the model: 0.425). */
const sofa = (x: number, seatZ: number, spotZ: number, rotY: number): Spot[] =>
  [-0.75, 0, 0.75].map((dx) => ({ x: x + dx, z: spotZ, rotY, seat: { x: x + dx, z: seatZ, height: 0.425 } }));

export const LAYOUT: Layout = {
  width: WIDTH,
  depth: DEPTH,
  cell: 0.5,
  walls,
  furniture,
  carpets: [
    { x1: 13.2, z1: 8.0, x2: 18.8, z2: 13.4, color: '#dccdb4' },
    { x1: 25.4, z1: 8.9, x2: 31.4, z2: 15.1, color: '#e8dcc6' },
    { x1: 1.9, z1: 7.8, x2: 4.5, z2: 11.0, color: '#cdb293' },
  ],
  frames,
  desks,
  seats,
  // Wanderers alternate between coffee and lounge along their order (wanderOrder), so 12 each keep 24 apart.
  coffeeSpots: grid([2.3, 3.1, 3.9], [8.2, 9.0, 9.8, 10.6], -PI / 2),
  loungeSpots: [
    ...sofa(28.6, 8.3, 9.05, 0),
    ...sofa(28.6, 15.7, 14.95, PI),
    // Seat heights measured from the models: armchair 0.41, pouf 0.42.
    { x: 29.95, z: 10.2, rotY: -PI / 2, seat: { x: 30.85, z: 10.2, height: 0.41 } },
    { x: 29.95, z: 13.8, rotY: -PI / 2, seat: { x: 30.85, z: 13.8, height: 0.41 } },
    { x: 25.85, z: 9.85, rotY: PI / 2, seat: { x: 26.5, z: 9.85, height: 0.42 } },
    { x: 25.85, z: 10.6, rotY: PI / 2, seat: { x: 26.5, z: 10.6, height: 0.42 } },
    { x: 25.85, z: 13.4, rotY: PI / 2, seat: { x: 26.5, z: 13.4, height: 0.42 } },
    { x: 25.85, z: 14.15, rotY: PI / 2, seat: { x: 26.5, z: 14.15, height: 0.42 } },
  ],
  // In front of the racks, facing them.
  serverSpots: grid([0.9, 1.6, 2.3, 3.0, 3.7, 4.4], [15.3, 16.1], PI),
  // Around the meeting table, facing it; the first (the planning coordinator's) on its north side, facing the camera.
  meetingSpots: [
    { x: 15.25, z: 8.05, rotY: 0 },
    { x: 16.75, z: 8.05, rotY: 0 },
    { x: 14.0, z: 9.4, rotY: PI / 2 },
    { x: 18.0, z: 9.4, rotY: -PI / 2 },
    { x: 15.25, z: 10.75, rotY: PI },
    { x: 16.75, z: 10.75, rotY: PI },
  ],
  rooms,
  beam: { x: 16, z: 12 },
};

const WALL_MARGIN = 0.35;
const ITEM_MARGIN = 0.2;

export function obstaclesOf(layout: Layout): Rect[] {
  const rects: Rect[] = layout.walls.map((w) => ({
    x1: Math.min(w.x1, w.x2) - WALL_MARGIN,
    z1: Math.min(w.z1, w.z2) - WALL_MARGIN,
    x2: Math.max(w.x1, w.x2) + WALL_MARGIN,
    z2: Math.max(w.z1, w.z2) + WALL_MARGIN,
  }));
  for (const p of layout.furniture) {
    if (!p.blocks) continue;
    const quarter = Math.abs(Math.round(p.rotY / (PI / 2))) % 2 === 1;
    const w = quarter ? p.d : p.w;
    const d = quarter ? p.w : p.d;
    rects.push({ x1: p.x - w / 2 - ITEM_MARGIN, z1: p.z - d / 2 - ITEM_MARGIN, x2: p.x + w / 2 + ITEM_MARGIN, z2: p.z + d / 2 + ITEM_MARGIN });
  }
  return rects;
}

export const GRID = buildGrid(LAYOUT.width, LAYOUT.depth, LAYOUT.cell, obstaclesOf(LAYOUT));

/**
 * Each person's place in the wandering order: the people at work by seat (then hire time). Coffee and lounge alternate
 * along it and each takes every other place, so up to 24 never share a spot whatever seats they have (spec office rooms
 * §2); a hire or a move may give someone another spot.
 */
export function wanderOrder(people: ReadonlyArray<Pick<Employee, 'id' | 'deskIndex' | 'createdAt'>>): Record<string, number> {
  const sorted = [...people].sort((a, b) => a.deskIndex - b.deskIndex || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return Object.fromEntries(sorted.map((e, i) => [e.id, i]));
}

/**
 * Someone's place in `zone`: their own desk by seat number; elsewhere by their wandering `order` (coffee and lounge each
 * every other one, see behaviorOf). An unknown seat (an older server's) wraps onto a known one.
 */
export function spotFor(layout: Layout, zone: Zone, seat: number, order: number = seat): Spot {
  const list = zone === 'desk' ? layout.seats : zone === 'coffee' ? layout.coffeeSpots : zone === 'lounge' ? layout.loungeSpots : zone === 'meeting' ? layout.meetingSpots : layout.serverSpots;
  const index = zone === 'desk' ? seat : zone === 'coffee' || zone === 'lounge' ? Math.floor(order / 2) : order;
  return list[((index % list.length) + list.length) % list.length]!;
}
```

(These coordinates were checked against the walkers' grid while this plan was written: every seat and spot free, every room left through its door, 1890 paths in about 0.2 s.)

- [ ] **Step 4: A desk lamp only glows** — in `src/scene/FurnitureLayer.tsx`, in `Glow`, replace the `<pointLight … />` line with:

```tsx
      {p.bulbOnly ? null : <pointLight color={PALETTE.lampLight} intensity={p.glow} distance={5} decay={1.6} />}
```

and its comment becomes `/** A lamp's bulb glows (and blooms) and, unless it is a desk lamp in a room, lights its corner of the room. */`.

- [ ] **Step 5: Wanderers by order** — in `src/office/behavior.ts`, the `wanderSeed` comment becomes `/** Stable per employee: their place in the wandering order (wanderOrder), so the same person keeps going to the same place. */`.

In `src/scene/CharactersLayer.tsx`, import `wanderOrder` with `LAYOUT, spotFor`, and replace the `placed` computation with:

```tsx
  const working = Object.values(views).filter((v) => v.employee.lifecycle !== 'archived');
  // By their order among the people at work, so wanderers never share a spot whatever seats they have.
  const order = wanderOrder(working.map((v) => v.employee));
  const placed = working.map((v) => {
    const e = v.employee;
    const rank = order[e.id] ?? e.deskIndex;
    const behavior = behaviorOf({
      lifecycle: e.lifecycle,
      openToolSince: openToolSince(v),
      idleSince: v.idleSince ?? e.createdAt,
      ownerTypingAt: typingAt[e.id] ?? null,
      now,
      wanderSeed: rank,
      planning: e.kind === 'coordinator' && Object.values(plans).some((p) => p.status === 'draft' && p.proposedBy === e.id),
    });
    return { view: v, behavior, spot: spotFor(LAYOUT, behavior.zone, e.deskIndex, rank) };
  });
```

and add to `src/scene/CharactersLayer.test.tsx`, inside `describe('CharactersLayer', …)`:

```tsx
  it('review focus: two idle people whose seats would share a lounge spot (13 and 37) go to two places, by their order', async () => {
    const long = Date.now() - 10 * 60_000;
    office({ ...person('ada', 13), createdAt: long }, { ...person('can', 37), createdAt: long });
    const r = await ReactThreeTestRenderer.create(<CharactersLayer />);
    expect(drawn.get('ada')?.spot).toBe(LAYOUT.coffeeSpots[0]);
    expect(drawn.get('can')?.spot).toBe(LAYOUT.loungeSpots[0]);
    await r.unmount();
  });
```

- [ ] **Step 6: Run the tests, the web suite and the typecheck**

Run: `pnpm vitest run src/office src/scene/CharactersLayer.test.tsx && pnpm vitest run && pnpm --filter @cc/office-web typecheck`
Expected: PASS (`CharactersLayer.test`'s planning coordinator still meets at `spotFor(LAYOUT, 'meeting', 0)`: seat 0 is order 0).

- [ ] **Step 7: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-web/src/office apps/office-web/src/scene/CharactersLayer.tsx apps/office-web/src/scene/CharactersLayer.test.tsx apps/office-web/src/scene/FurnitureLayer.tsx
git commit -m "feat(office): the 32 × 24 m floor — six glass department rooms around the hub, 45 seats, the beam's place; wanderers spread by their order"
```

---

### Task 8: Walls face their own room

**Files:**
- Create: `apps/office-web/src/scene/wallFrame.ts`, `apps/office-web/src/scene/wallFrame.test.ts`
- Modify: `apps/office-web/src/scene/Room.tsx`

**Interfaces:**
- Consumes: `Wall.faces` (Task 7).
- Produces: `interface WallFrame { len: number; inside: 1 | -1; cx: number; cz: number; rot: number }`, `frameOf(wall: Wall, centre: { x: number; z: number }): WallFrame` (moved out of Room.tsx; the inside face looks at `wall.faces`, else at `centre`).

- [ ] **Step 1: Write the failing tests** — `src/scene/wallFrame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LAYOUT, type Wall } from '../office/layout.ts';
import { frameOf } from './wallFrame.ts';

const CENTRE = { x: LAYOUT.width / 2, z: LAYOUT.depth / 2 };
/** The world direction a wall's inside face looks. */
const inward = (w: Wall) => {
  const f = frameOf(w, CENTRE);
  return { x: Math.sin(f.rot) * f.inside, z: Math.cos(f.rot) * f.inside };
};

describe('frameOf (spec office rooms §6)', () => {
  it('turns an outer wall’s inside to the floor’s middle', () => {
    expect(inward({ x1: 0, z1: 0, x2: 32, z2: 0, height: 3.2, kind: 'solid' }).z).toBeCloseTo(1);
    expect(inward({ x1: 0, z1: 7, x2: 0, z2: 17, height: 3.2, kind: 'window' }).x).toBeCloseTo(1);
  });

  it('turns a room’s own wall into the room, not to the floor’s middle: a south room’s north wall looks south', () => {
    const wall: Wall = { x1: 0, z1: 17, x2: 4.4, z2: 17, height: 2.6, kind: 'solid' };
    expect(inward(wall).z).toBeCloseTo(-1);
    expect(inward({ ...wall, faces: { x: 16 / 3, z: 20.5 } }).z).toBeCloseTo(1);
  });

  it('every wall of the plan that bounds a room looks into it', () => {
    for (const w of LAYOUT.walls.filter((x) => x.faces)) {
      const f = frameOf(w, CENTRE);
      const n = inward(w);
      expect(n.x * (w.faces!.x - f.cx) + n.z * (w.faces!.z - f.cz), `${w.x1},${w.z1} → ${w.x2},${w.z2}`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-web && pnpm vitest run src/scene/wallFrame.test.ts`
Expected: FAIL — `Cannot find module './wallFrame.ts'`.

- [ ] **Step 3: Implement** — `src/scene/wallFrame.ts`:

```ts
import type { Wall } from '../office/layout.ts';

export interface WallFrame {
  len: number;
  /** +1 when the wall's local +z faces into its room, −1 otherwise. */
  inside: 1 | -1;
  cx: number;
  cz: number;
  rot: number;
}

/**
 * Where a wall stands and which of its faces is inside: the one looking at `wall.faces` (the centre of the room it
 * bounds, spec office rooms §6), else at `centre` (the floor's middle: right for the outer walls).
 */
export function frameOf(wall: Wall, centre: { x: number; z: number }): WallFrame {
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const rot = -Math.atan2(dz, dx);
  const cx = (wall.x1 + wall.x2) / 2;
  const cz = (wall.z1 + wall.z2) / 2;
  // Local +z in world space after rotating by `rot` about y.
  const nx = Math.sin(rot);
  const nz = Math.cos(rot);
  const towards = wall.faces ?? centre;
  const inside = nx * (towards.x - cx) + nz * (towards.z - cz) >= 0 ? 1 : -1;
  return { len: Math.hypot(dx, dz), inside, cx, cz, rot };
}
```

In `src/scene/Room.tsx`: delete the local `interface Frame` and `function frameOf`; add `import { frameOf, type WallFrame } from './wallFrame.ts';`; every `f: Frame` becomes `f: WallFrame`; in `WallMesh`, `const f = frameOf(wall);` becomes `const f = frameOf(wall, CENTER);`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm vitest run src/scene && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-web/src/scene/wallFrame.ts apps/office-web/src/scene/wallFrame.test.ts apps/office-web/src/scene/Room.tsx
git commit -m "feat(scene): a wall's inside face looks into the room it bounds, not always at the floor's middle"
```

---

### Task 9: Rooms on screen — carpets, door signs, dark empty rooms

**Files:**
- Create: `apps/office-web/src/scene/rooms.ts`, `apps/office-web/src/scene/rooms.test.ts`, `apps/office-web/src/scene/RoomsLayer.tsx`, `apps/office-web/src/scene/RoomsLayer.test.tsx`, `apps/office-web/src/scene/FurnitureLayer.test.tsx`, `apps/office-web/src/scene/DeskDressing.test.tsx`
- Modify: `apps/office-web/src/scene/FurnitureLayer.tsx`, `apps/office-web/src/scene/DeskDressing.tsx`, `apps/office-web/src/scene/OfficeScene.tsx`

**Interfaces:**
- Consumes: `LAYOUT.rooms`, `Placement.room`, `Desk.room` (Task 7); the store's `departments: Record<string, Department>` (sub-project 1 Task 13) with `Department.room` (Task 5).
- Produces (rooms.ts): `EMPTY_CARPET`, `interface SignText { title: string; subtitle: string | null }`, `interface RoomState { room: RoomGeometry; department: Department | null; lit: boolean; carpet: string; sign: SignText }`, `signText(department, head): SignText`, `roomStates(rooms, departments, people): RoomState[]`, `useRoomStates(): RoomState[]`, `useDarkRooms(): ReadonlySet<number>`. Component `RoomsLayer` (meshes named `room-carpet-<r>`, groups `room-sign-<r>`). A dark room's pendant has intensity 0 and a dark bulb; a dark room's monitor screens (meshes named `screen`) are dark glass without a map.

- [ ] **Step 1: Write the failing tests**

`src/scene/rooms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Department, Employee } from '@cc/shared';
import { LAYOUT } from '../office/layout.ts';
import { EMPTY_CARPET, roomStates, signText } from './rooms.ts';

const dep = (id: string, name: string, room: number | null, o: Partial<Department> = {}): Department => ({
  id, name, mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room, ...o,
});
const person = (id: string, name: string) => ({ id, name }) as Employee;

describe('signText (spec office rooms §4.2)', () => {
  it('names the department and its head; a headless one says so; an empty room says “Boş oda”', () => {
    expect(signText(dep('d', 'Pazarlama', 0), person('p', 'Pelin'))).toEqual({ title: 'Pazarlama', subtitle: 'Başkan: Pelin' });
    expect(signText(dep('d', 'Satış', 1), null)).toEqual({ title: 'Satış', subtitle: 'Başkan yok' });
    expect(signText(null, null)).toEqual({ title: 'Boş oda', subtitle: null });
  });
});

describe('roomStates', () => {
  it('review focus 5: a room with an open department is lit in its colour with its sign; the rest are dark — a closed department leaves its room', () => {
    const states = roomStates(
      LAYOUT.rooms,
      { a: dep('a', 'Pazarlama', 2, { headId: 'p' }), b: dep('b', 'Satış', 0), c: dep('c', 'Eski', null, { status: 'closed', closedAt: 5 }) },
      [person('p', 'Pelin')],
    );
    expect(states.map((s) => s.lit)).toEqual([true, false, true, false, false, false]);
    expect(states.map((s) => s.carpet)).toEqual([LAYOUT.rooms[0]!.carpet.color, EMPTY_CARPET, LAYOUT.rooms[2]!.carpet.color, EMPTY_CARPET, EMPTY_CARPET, EMPTY_CARPET]);
    expect(states[2]!.sign).toEqual({ title: 'Pazarlama', subtitle: 'Başkan: Pelin' });
    expect(states[0]!.sign).toEqual({ title: 'Satış', subtitle: 'Başkan yok' });
    expect(states[1]!.sign).toEqual({ title: 'Boş oda', subtitle: null });
  });

  it('an office without departments has six dark rooms; a department from a server without rooms lights none', () => {
    expect(roomStates(LAYOUT.rooms, {}, []).every((s) => !s.lit)).toBe(true);
    const { room: _none, ...old } = dep('x', 'X', 0);
    expect(roomStates(LAYOUT.rooms, { x: old as Department }, []).every((s) => !s.lit)).toBe(true);
  });
});
```

`src/scene/RoomsLayer.test.tsx`:

```tsx
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial } from 'three';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { EMPTY_CARPET } from './rooms.ts';
import { RoomsLayer } from './RoomsLayer.tsx';

// test-renderer drives React through act(); tell React this is a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => useOffice.setState({ departments: {}, views: {} }));

describe('RoomsLayer', () => {
  it('lays each room’s carpet in its department’s colour, dark grey when empty, and hangs a sign over every door', async () => {
    useOffice.setState({ views: {}, departments: { d: { id: 'd', name: 'Pazarlama', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room: 4 } } });
    const r = await ReactThreeTestRenderer.create(<RoomsLayer />);
    const colour = (i: number) => `#${((r.scene.findByProps({ name: `room-carpet-${i}` }).instance as Mesh).material as MeshStandardMaterial).color.getHexString()}`;
    expect(LAYOUT.rooms.map((x) => colour(x.index))).toEqual(LAYOUT.rooms.map((x) => (x.index === 4 ? x.carpet.color : EMPTY_CARPET)));
    expect(LAYOUT.rooms.map((x) => r.scene.findAllByProps({ name: `room-sign-${x.index}` }).length)).toEqual([1, 1, 1, 1, 1, 1]);
    await r.unmount();
  });
});
```

`src/scene/FurnitureLayer.test.tsx`:

```tsx
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { PointLight } from 'three';
import { EMPTY_MANIFEST } from '../assets/manifest.ts';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { FurnitureLayer } from './FurnitureLayer.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => useOffice.setState({ departments: {} }));

describe('FurnitureLayer', () => {
  it('review focus 5: an empty room’s lamp is off, a working room’s on; a desk lamp has no light of its own', async () => {
    useOffice.setState({ manifest: EMPTY_MANIFEST, departments: { d: { id: 'd', name: 'Satış', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room: 1 } } });
    const r = await ReactThreeTestRenderer.create(<FurnitureLayer />);
    const lights = r.scene.findAll((n) => n.type === 'PointLight').map((n) => n.instance as PointLight);
    const casting = LAYOUT.furniture.filter((p) => p.glow && !p.bulbOnly);
    expect(lights).toHaveLength(casting.length);
    // Every lamp outside the rooms, and room 1's pendant; the five empty rooms' pendants stay, at 0.
    expect(lights.filter((l) => l.intensity > 0)).toHaveLength(casting.filter((p) => p.room === undefined || p.room === 1).length);
    expect(lights.filter((l) => l.intensity === 0)).toHaveLength(5);
    await r.unmount();
  });
});
```

`src/scene/DeskDressing.test.tsx`:

```tsx
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { Mesh, Texture } from 'three';
import { LAYOUT, type Desk } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { DeskDressing } from './DeskDressing.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => useOffice.setState({ departments: {} }));

describe('DeskDressing', () => {
  it('review focus 5: the screens of an empty room are off; a working room’s, the hub’s and the coordinator’s are on', async () => {
    useOffice.setState({ departments: { d: { id: 'd', name: 'Yazılım', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room: 0 } } });
    const r = await ReactThreeTestRenderer.create(<DeskDressing />);
    const screens = r.scene.findAll((n) => n.props.name === 'screen').map((n) => (n.instance as Mesh).material as unknown as { map: Texture | null });
    const monitors = (pick: (d: Desk) => boolean) => LAYOUT.desks.filter(pick).reduce((n, d) => n + d.monitors, 0);
    expect(screens).toHaveLength(monitors(() => true));
    expect(screens.filter((m) => m.map).length).toBe(monitors((d) => d.room === undefined || d.room === 0));
    await r.unmount();
  });
});
```

(jsdom has no 2D canvas: the code and sign textures are blank in these tests, and its "Not implemented: HTMLCanvasElement.prototype.getContext" line in the output is expected.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-web && pnpm vitest run src/scene/rooms.test.ts src/scene/RoomsLayer.test.tsx src/scene/FurnitureLayer.test.tsx src/scene/DeskDressing.test.tsx`
Expected: FAIL — `./rooms.ts` and `./RoomsLayer.tsx` do not exist; every room pendant shines; every screen has a map.

- [ ] **Step 3: Implement `src/scene/rooms.ts`**

```ts
import { useMemo } from 'react';
import type { Department, Employee } from '@cc/shared';
import { LAYOUT, type RoomGeometry } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';

/** An empty room's carpet: dark grey, the room asleep (spec office rooms §4.2). */
export const EMPTY_CARPET = '#45474c';

export interface SignText {
  title: string;
  subtitle: string | null;
}

export interface RoomState {
  room: RoomGeometry;
  /** The open department working here; null: an empty room. */
  department: Department | null;
  /** A department works here: its carpet in its colour, its lamp lit, its screens on. */
  lit: boolean;
  carpet: string;
  sign: SignText;
}

/** What a door sign says: the department and its head, or "Boş oda". */
export function signText(department: Department | null, head: Employee | null): SignText {
  if (!department) return { title: 'Boş oda', subtitle: null };
  return { title: department.name, subtitle: head ? `Başkan: ${head.name}` : 'Başkan yok' };
}

/** Each room as the scene draws it, from the open departments (by their room) and the people at work (pure). */
export function roomStates(rooms: readonly RoomGeometry[], departments: Readonly<Record<string, Department>>, people: readonly Employee[]): RoomState[] {
  const open = Object.values(departments).filter((d) => d.status === 'open');
  return rooms.map((room) => {
    const department = open.find((d) => d.room === room.index) ?? null;
    const head = department?.headId ? (people.find((e) => e.id === department.headId) ?? null) : null;
    return { room, department, lit: department !== null, carpet: department ? room.carpet.color : EMPTY_CARPET, sign: signText(department, head) };
  });
}

/** The rooms as they are now, from the store. */
export function useRoomStates(): RoomState[] {
  const departments = useOffice((s) => s.departments);
  const views = useOffice((s) => s.views);
  return useMemo(
    () => roomStates(LAYOUT.rooms, departments ?? {}, Object.values(views).map((v) => v.employee).filter((e) => e.lifecycle !== 'archived')),
    [departments, views],
  );
}

/** The rooms nobody works in: their lamp and screens are off (FurnitureLayer, DeskDressing). */
export function useDarkRooms(): ReadonlySet<number> {
  const departments = useOffice((s) => s.departments);
  return useMemo(() => new Set(roomStates(LAYOUT.rooms, departments ?? {}, []).filter((r) => !r.lit).map((r) => r.room.index)), [departments]);
}
```

- [ ] **Step 4: Implement `src/scene/RoomsLayer.tsx`**

```tsx
import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { useRoomStates, type RoomState, type SignText } from './rooms.ts';

const SIGN_W = 1.3;
const SIGN_H = 0.4;

/** A sign's text drawn on a canvas here (no font is downloaded: the office runs offline); dim for an empty room. */
function signTexture(text: SignText, lit: boolean): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 520;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = lit ? '#2b2f36' : '#1c1e22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // The name as large as fits: a department's name runs to 40 characters.
    let size = 64;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    while (size > 28 && ctx.measureText(text.title).width > canvas.width - 40) {
      size -= 4;
      ctx.font = `600 ${size}px system-ui, sans-serif`;
    }
    ctx.fillStyle = lit ? '#f6efe2' : '#8a8d93';
    ctx.fillText(text.title, canvas.width / 2, text.subtitle ? 62 : 80, canvas.width - 40);
    if (text.subtitle) {
      ctx.font = '400 34px system-ui, sans-serif';
      ctx.fillStyle = lit ? '#d9b07a' : '#6d7076';
      ctx.fillText(text.subtitle, canvas.width / 2, 124, canvas.width - 40);
    }
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Over the door, for the hub and the room alike: two faces back to back, so both read the right way round. */
function DoorSign({ state }: { state: RoomState }) {
  const { title, subtitle } = state.sign;
  const texture = useMemo(() => signTexture({ title, subtitle }, state.lit), [title, subtitle, state.lit]);
  useEffect(() => () => texture.dispose(), [texture]);
  const { x, y, z, rotY } = state.room.sign;
  return (
    <group name={`room-sign-${state.room.index}`} position={[x, y, z]} rotation={[0, rotY, 0]}>
      <mesh castShadow>
        <boxGeometry args={[SIGN_W + 0.06, SIGN_H + 0.06, 0.03]} />
        <meshStandardMaterial color="#2b2f36" roughness={0.6} />
      </mesh>
      {[0, Math.PI].map((turn) => (
        <mesh key={turn} position={[0, 0, turn === 0 ? 0.016 : -0.016]} rotation={[0, turn, 0]}>
          <planeGeometry args={[SIGN_W, SIGN_H]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** The six rooms' carpets (the department's colour, dark grey when empty) and door signs (spec office rooms §4.2). */
export function RoomsLayer() {
  const states = useRoomStates();
  return (
    <group>
      {states.map((s) => {
        const c = s.room.carpet;
        return (
          <group key={s.room.index}>
            <mesh name={`room-carpet-${s.room.index}`} position={[(c.x1 + c.x2) / 2, 0.012, (c.z1 + c.z2) / 2]} receiveShadow>
              <boxGeometry args={[c.x2 - c.x1, 0.022, c.z2 - c.z1]} />
              <meshStandardMaterial color={s.carpet} roughness={1} />
            </mesh>
            <DoorSign state={s} />
          </group>
        );
      })}
    </group>
  );
}
```

- [ ] **Step 5: Dark rooms in `FurnitureLayer.tsx` and `DeskDressing.tsx`**

`src/scene/FurnitureLayer.tsx` — add `import { useDarkRooms } from './rooms.ts';`; next to `BULB` add `const BULB_OFF = new Color('#3a3328');`; replace `Glow` with:

```tsx
/** A lamp's bulb glows (and blooms) and, unless it is a desk lamp in a room, lights its corner; an empty room's lamps are off. */
function Glow({ p, off }: { p: Placement; off: boolean }) {
  const y = p.h * (p.glowAt ?? 0.5);
  return (
    <group position={[0, y, 0]}>
      <mesh>
        <sphereGeometry args={[0.07, 12, 8]} />
        <meshBasicMaterial color={off ? BULB_OFF : BULB} toneMapped={false} />
      </mesh>
      {/* Kept at 0 rather than removed: adding or taking away a light recompiles every material's shader. */}
      {p.bulbOnly ? null : <pointLight color={PALETTE.lampLight} intensity={off ? 0 : p.glow} distance={5} decay={1.6} />}
    </group>
  );
}
```

In `FurnitureLayer()` add `const dark = useDarkRooms();` and render `{p.glow ? <Glow p={p} off={p.room !== undefined && dark.has(p.room)} /> : null}`.

`src/scene/DeskDressing.tsx` — add `import { useDarkRooms } from './rooms.ts';`. `Monitor` takes `screen: CanvasTexture | null`, and its screen mesh becomes:

```tsx
      {/* The screen faces the person (local −z); dark glass in an empty room. */}
      <mesh name="screen" position={[0, 0.34, -0.019]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.52, 0.3]} />
        {screen ? <meshBasicMaterial map={screen} color={[1.7, 1.7, 1.7]} toneMapped={false} /> : <meshStandardMaterial color="#0d0f12" roughness={0.3} />}
      </mesh>
```

`DeskThings` takes `off: boolean` and picks its screens as `const screen = off ? null : screens[index % screens.length]!;` and `const second = off ? null : screens[(index + 1) % screens.length]!;` (the dual monitor's second uses `second`). `DeskDressing()` adds `const dark = useDarkRooms();` and renders `<DeskThings key={i} desk={desk} index={i} screens={screens} off={desk.room !== undefined && dark.has(desk.room)} />`.

- [ ] **Step 6: Into the scene** — in `src/scene/OfficeScene.tsx` import `RoomsLayer` and render `<RoomsLayer />` right after `<Room />`.

- [ ] **Step 7: Run the tests, the web suite and the typecheck**

Run: `pnpm vitest run src/scene && pnpm vitest run && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-web/src/scene
git commit -m "feat(scene): a room shows its department — its colour, a door sign with its name and head; an empty room is dark, its lamp and screens off"
```

---

### Task 10: The light beam over the coordinator

**Files:**
- Create: `apps/office-web/src/scene/Beam.tsx`, `apps/office-web/src/scene/Beam.test.tsx`
- Modify: `apps/office-web/src/scene/OfficeScene.tsx`

**Interfaces:**
- Consumes: `LAYOUT.beam` (Task 7); the store's `views`.
- Produces: `type BeamLevel = 'pulse' | 'calm' | 'dim' | 'off'`, `PULSE_SECONDS = 2.5`, `BEAM_TOP = 6`, `beamLevel(lifecycle: Lifecycle | null): BeamLevel`, `beamBrightness(level: BeamLevel, seconds: number): number` (0–1), `coordinatorLifecycle(views): Lifecycle | null`, component `Beam` (a mesh named `beam-cone`, one spot light; nothing without a coordinator).

- [ ] **Step 1: Write the failing tests** — `src/scene/Beam.test.tsx`:

```tsx
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import type { Employee, EmployeeKind, Lifecycle } from '@cc/shared';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import type { EmployeeView } from '../store/reducers.ts';
import { Beam, PULSE_SECONDS, beamBrightness, beamLevel, coordinatorLifecycle } from './Beam.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => useOffice.setState({ views: {} }));

const someone = (id: string, kind: EmployeeKind, lifecycle: Lifecycle): Employee => ({
  id, slug: id, name: id, role: 'r', model: 'sonnet', characterId: 'manager', title: '', team: '', kind, reportsTo: null, deskIndex: 0,
  sessionId: `s-${id}`, sessionStarted: true, lifecycle, limitResetsAt: null, lastError: null, createdAt: 1,
});
const view = (employee: Employee): EmployeeView => ({ employee, events: [], openTools: {}, idleSince: null, eventsLoaded: true });

describe('the beam’s brightness (spec office rooms §4.3)', () => {
  it('pulses while the coordinator works, is calm when idle or starting, dim in every other state, gone without a coordinator', () => {
    expect(beamLevel('working')).toBe('pulse');
    expect([beamLevel('idle'), beamLevel('starting')]).toEqual(['calm', 'calm']);
    expect((['sleeping', 'stopped', 'limited', 'error', 'interrupted', 'in_terminal'] as const).map(beamLevel)).toEqual(Array(6).fill('dim'));
    expect(beamLevel(null)).toBe('off');
    expect(beamLevel('archived')).toBe('off');
  });

  it('a working beam breathes every 2.5 s between half and full; calm is steady and brighter than dim', () => {
    const at = (t: number) => beamBrightness('pulse', t);
    expect(PULSE_SECONDS).toBe(2.5);
    expect(at(0)).toBeCloseTo(at(PULSE_SECONDS));
    expect(at(PULSE_SECONDS / 4)).toBeCloseTo(1);
    expect(at((3 * PULSE_SECONDS) / 4)).toBeCloseTo(0.5);
    expect(beamBrightness('calm', 0)).toBe(beamBrightness('calm', 1.3));
    expect(beamBrightness('calm', 0)).toBeGreaterThan(beamBrightness('dim', 0));
    expect(beamBrightness('dim', 0)).toBeGreaterThan(0);
    expect(beamBrightness('off', 0)).toBe(0);
  });

  it('follows the coordinator, never someone else', () => {
    expect(coordinatorLifecycle({ a: view(someone('a', 'member', 'working')), k: view(someone('k', 'coordinator', 'sleeping')) })).toBe('sleeping');
    expect(coordinatorLifecycle({ a: view(someone('a', 'member', 'working')) })).toBeNull();
    expect(coordinatorLifecycle({ k: view(someone('k', 'coordinator', 'archived')) })).toBeNull();
  });
});

describe('Beam', () => {
  it('stands over the coordinator’s desk while there is a coordinator, with one spot light; without one it is gone', async () => {
    useOffice.setState({ views: { k: view(someone('k', 'coordinator', 'working')) } });
    const r = await ReactThreeTestRenderer.create(<Beam />);
    const cone = r.scene.findByProps({ name: 'beam-cone' }).instance as Mesh;
    expect([cone.position.x, cone.position.z]).toEqual([LAYOUT.beam.x, LAYOUT.beam.z]);
    expect(r.scene.findAll((n) => n.type === 'SpotLight')).toHaveLength(1);
    await r.unmount();
    useOffice.setState({ views: {} });
    const none = await ReactThreeTestRenderer.create(<Beam />);
    expect(none.scene.children).toHaveLength(0);
    await none.unmount();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-web && pnpm vitest run src/scene/Beam.test.tsx`
Expected: FAIL — `Cannot find module './Beam.tsx'`.

- [ ] **Step 3: Implement `src/scene/Beam.tsx`**

```tsx
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, Color, DoubleSide, Object3D, type MeshBasicMaterial, type SpotLight } from 'three';
import type { Lifecycle } from '@cc/shared';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import type { EmployeeView } from '../store/reducers.ts';

export type BeamLevel = 'pulse' | 'calm' | 'dim' | 'off';
/** One breath of the working beam, seconds. */
export const PULSE_SECONDS = 2.5;
/** The beam comes down from the ceiling (y ≈ 6) onto the coordinator's desk. */
export const BEAM_TOP = 6;
const RADIUS = 1.4;
const CONE_OPACITY = 0.22;
const SPOT_INTENSITY = 30;
const LIGHT = new Color('#ffe2b0');
/** The fixture at the top is the beam's bright part: above the bloom's threshold (0.92), so it glows a little. */
const FIXTURE = new Color('#ffe9c4').multiplyScalar(4);

/** What the beam says about the coordinator (spec office rooms §4.3): working pulses, idle or starting is calm, any other state dim; no coordinator, no beam. */
export function beamLevel(lifecycle: Lifecycle | null): BeamLevel {
  if (lifecycle === null || lifecycle === 'archived') return 'off';
  if (lifecycle === 'working') return 'pulse';
  if (lifecycle === 'idle' || lifecycle === 'starting') return 'calm';
  return 'dim';
}

/** The beam's brightness (0–1) at `seconds`: a slow breath while working, steady otherwise. */
export function beamBrightness(level: BeamLevel, seconds: number): number {
  if (level === 'pulse') return 0.75 + 0.25 * Math.sin((2 * Math.PI * seconds) / PULSE_SECONDS);
  if (level === 'calm') return 0.5;
  if (level === 'dim') return 0.15;
  return 0;
}

/** The coordinator's lifecycle; null: no coordinator at work. */
export function coordinatorLifecycle(views: Readonly<Record<string, EmployeeView>>): Lifecycle | null {
  return Object.values(views).map((v) => v.employee).find((e) => e.kind === 'coordinator' && e.lifecycle !== 'archived')?.lifecycle ?? null;
}

/**
 * The light over the coordinator's desk: a see-through cone (added light that writes no depth, so the coordinator shows
 * through it) and a spot light on the desk, both as bright as the coordinator's state says.
 */
export function Beam() {
  const level = beamLevel(useOffice((s) => coordinatorLifecycle(s.views)));
  const cone = useRef<MeshBasicMaterial>(null);
  const fixture = useRef<MeshBasicMaterial>(null);
  const spot = useRef<SpotLight>(null);
  const target = useMemo(() => {
    const o = new Object3D();
    o.position.set(LAYOUT.beam.x, 0, LAYOUT.beam.z);
    return o;
  }, []);
  useFrame(({ clock }) => {
    const b = beamBrightness(level, clock.getElapsedTime());
    if (cone.current) cone.current.opacity = CONE_OPACITY * b;
    if (fixture.current) fixture.current.opacity = b;
    if (spot.current) spot.current.intensity = SPOT_INTENSITY * b;
  });
  if (level === 'off') return null;
  const { x, z } = LAYOUT.beam;
  const start = beamBrightness(level, 0);
  return (
    <group name="beam">
      <primitive object={target} />
      <mesh name="beam-cone" position={[x, BEAM_TOP / 2, z]}>
        <coneGeometry args={[RADIUS, BEAM_TOP, 48, 1, true]} />
        <meshBasicMaterial ref={cone} color={LIGHT} transparent opacity={CONE_OPACITY * start} blending={AdditiveBlending} depthWrite={false} side={DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[x, BEAM_TOP, z]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.28, 32]} />
        <meshBasicMaterial ref={fixture} color={FIXTURE} transparent opacity={start} side={DoubleSide} toneMapped={false} />
      </mesh>
      <spotLight ref={spot} position={[x, BEAM_TOP, z]} target={target} color={LIGHT} intensity={SPOT_INTENSITY * start} angle={0.3} penumbra={0.7} distance={9} decay={1.2} />
    </group>
  );
}
```

- [ ] **Step 4: Into the scene** — in `src/scene/OfficeScene.tsx` import `Beam` and render `<Beam />` right before `<CharactersLayer />`.

- [ ] **Step 5: Run the tests, the web suite and the typecheck**

Run: `pnpm vitest run src/scene/Beam.test.tsx && pnpm vitest run && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-web/src/scene/Beam.tsx apps/office-web/src/scene/Beam.test.tsx apps/office-web/src/scene/OfficeScene.tsx
git commit -m "feat(scene): a light beam over the coordinator's desk — it breathes while the coordinator works, is calm when idle, dim otherwise"
```

---

### Task 11: The view sized from the floor; a seat change seen at once

**Files:**
- Modify: `apps/office-web/src/scene/camera.ts`, `apps/office-web/src/scene/Lighting.tsx`, `apps/office-web/src/scene/OfficeScene.tsx`, `apps/office-web/src/store/reducers.ts`
- Test: `apps/office-web/src/scene/camera.test.ts`, `apps/office-web/src/store/reducers.test.ts`

**Interfaces:**
- Consumes: `LAYOUT.width/depth` (Task 7); `seat.changed` (Task 1).
- Produces (camera.ts): `MAX_ZOOM = 160`, `startZoom(width, depth)`, `minZoom(width, depth)`, `panLimits(width, depth): { x: number; z: number }`, `clampTarget(p, limits)`, `interface Pannable`, `keepInView(c: Pannable, limits): void`, `sceneOrigin(width, depth): [number, number, number]`, `shadowExtent(width, depth)`; `CAMERA_ZOOM` is removed. The store applies `seat.changed` to the employee's `deskIndex` (no snapshot needed).

- [ ] **Step 1: Write the failing tests**

`src/scene/camera.test.ts` — replace the import with

```ts
import { LAYOUT } from '../office/layout.ts';
import { AZIMUTH, CAMERA_POSITION, MAX_ZOOM, clampTarget, keepInView, minZoom, panLimits, sceneOrigin, shadowExtent, startZoom } from './camera.ts';
```

(keeping `describe`, `expect`, `it` from vitest) and add inside `describe('camera', …)`:

```ts
  it('starts with the whole floor in view and zooms out a little beyond it, both from the floor’s size (42 and 22 for 18 × 14 m, as by hand)', () => {
    expect([startZoom(18, 14), minZoom(18, 14)]).toEqual([42, 22]);
    expect(startZoom(LAYOUT.width, LAYOUT.depth)).toBe(24);
    expect(minZoom(LAYOUT.width, LAYOUT.depth)).toBeLessThan(startZoom(LAYOUT.width, LAYOUT.depth));
    expect(MAX_ZOOM).toBe(160);
  });

  it('keeps the view’s centre over the floor: dragging stops at its edge, the camera moving back with its target', () => {
    const limits = panLimits(LAYOUT.width, LAYOUT.depth);
    expect(limits).toEqual({ x: 17, z: 13 });
    const c = { target: { x: 30, z: -2 }, object: { position: { x: 52, z: 20 } } };
    keepInView(c, limits);
    expect(c).toEqual({ target: { x: 17, z: -2 }, object: { position: { x: 39, z: 20 } } });
    keepInView(c, limits);
    expect(c.target).toEqual({ x: 17, z: -2 });
    expect(clampTarget({ x: -40, z: 40 }, limits)).toEqual({ x: -17, z: 13 });
  });

  it('sizes the scene from the floor: its middle near the origin, the sun’s shadow over all of it (as by hand for 18 × 14 m)', () => {
    const [x, y, z] = sceneOrigin(18, 14);
    expect(x).toBeCloseTo(-7.9, 1);
    expect(y).toBe(0);
    expect(z).toBeCloseTo(-5.9, 1);
    expect(shadowExtent(18, 14)).toBe(14);
    expect(shadowExtent(LAYOUT.width, LAYOUT.depth)).toBeGreaterThanOrEqual(Math.hypot(LAYOUT.width, LAYOUT.depth) / 2);
  });
```

`src/store/reducers.test.ts` — inside `describe('applyEvent', …)`:

```ts
  it('walks someone to their new seat at once (seat.changed), without waiting for a snapshot', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot({ employees: [employee({ deskIndex: 37 })] }));
    const ev = stored({ type: 'seat.changed', deskIndex: 13 });
    d = applyEvent(d, ev);
    expect(d.views.e1?.employee.deskIndex).toBe(13);
    expect(needsRefresh(ev, d)).toBe(false);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/Projects/control-center-departments/apps/office-web && pnpm vitest run src/scene/camera.test.ts src/store/reducers.test.ts`
Expected: FAIL — `startZoom` etc. are not exported; `deskIndex` stays 37.

- [ ] **Step 3: Implement `src/scene/camera.ts`**

```ts
/** Isometric view from the south-east, where the office's near walls are cut away (low). */
export const CAMERA_POSITION = [22, 26, 22] as const;

/**
 * How far the owner may turn the view (OrbitControls azimuth: 0 = from the south, π/2 = from the east). The north
 * and west walls are full height, so turning further would put a wall between the camera and the office.
 */
export const AZIMUTH = { min: 0, max: Math.PI / 2 } as const;

/** The closest the owner may zoom, pixels per metre: a desk fills the view. */
export const MAX_ZOOM = 160;

/** Pixels per metre at the start, so the whole floor is in view: 42 for the first 18 × 14 m office, scaled by the floor's size. */
export function startZoom(width: number, depth: number): number {
  return Math.round((42 * (18 + 14)) / (width + depth));
}

/** The farthest the owner may zoom out: a little beyond the whole floor (22 for 18 × 14 m, as before). */
export function minZoom(width: number, depth: number): number {
  return Math.round(startZoom(width, depth) * 0.53);
}

/** How far the view's centre may be dragged from the floor's middle, metres: to the floor's edge and a step beyond. */
export function panLimits(width: number, depth: number): { x: number; z: number } {
  return { x: width / 2 + 1, z: depth / 2 + 1 };
}

/** A view centre kept within the limits (the scene's origin is the floor's middle). */
export function clampTarget(p: { x: number; z: number }, limits: { x: number; z: number }): { x: number; z: number } {
  return { x: Math.min(limits.x, Math.max(-limits.x, p.x)), z: Math.min(limits.z, Math.max(-limits.z, p.z)) };
}

/** What the owner drags: the controls' target and their camera. */
export interface Pannable {
  target: { x: number; z: number };
  object: { position: { x: number; z: number } };
}

/** Holds the view over the floor: the camera moves back with its target, so dragging stops at the edge without turning the view. */
export function keepInView(c: Pannable, limits: { x: number; z: number }): void {
  const next = clampTarget(c.target, limits);
  const dx = next.x - c.target.x;
  const dz = next.z - c.target.z;
  if (dx === 0 && dz === 0) return;
  c.target.x += dx;
  c.target.z += dz;
  c.object.position.x += dx;
  c.object.position.z += dz;
}

/**
 * Where the floor's corner goes: its middle at the origin (the camera, light and controls all aim there), nudged
 * towards the camera so the far corner clears the top bar (1.1 m for 18 × 14 m, as tuned by hand).
 */
export function sceneOrigin(width: number, depth: number): [number, number, number] {
  const nudge = (width + depth) / 29;
  return [-width / 2 + nudge, 0, -depth / 2 + nudge];
}

/** Half the sun's shadow box, metres: the floor's half-diagonal and a margin (14 for 18 × 14 m). */
export function shadowExtent(width: number, depth: number): number {
  return Math.ceil(Math.hypot(width, depth) / 2) + 2;
}
```

- [ ] **Step 4: Use them**

`src/scene/Lighting.tsx` — add `import { LAYOUT } from '../office/layout.ts';` and `import { shadowExtent } from './camera.ts';`, a module constant `const SHADOW = shadowExtent(LAYOUT.width, LAYOUT.depth);`, and the sun's `shadow-camera-left={-SHADOW}`, `shadow-camera-right={SHADOW}`, `shadow-camera-top={SHADOW}`, `shadow-camera-bottom={-SHADOW}` (replacing ±14).

`src/scene/OfficeScene.tsx`:

```tsx
import { MapControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { ArtFrames } from './ArtFrames.tsx';
import { Beam } from './Beam.tsx';
import { AZIMUTH, CAMERA_POSITION, MAX_ZOOM, keepInView, minZoom, panLimits, sceneOrigin, startZoom, type Pannable } from './camera.ts';
import { CharactersLayer } from './CharactersLayer.tsx';
import { DeskDressing, ServerLights } from './DeskDressing.tsx';
import { Effects } from './Effects.tsx';
import { FurnitureLayer } from './FurnitureLayer.tsx';
import { Backdrop, Lighting } from './Lighting.tsx';
import { Room } from './Room.tsx';
import { RoomsLayer } from './RoomsLayer.tsx';

// The view sized from the floor (spec office rooms §6): start zoom, zoom-out limit, where the floor sits, how far it drags.
const ORIGIN = sceneOrigin(LAYOUT.width, LAYOUT.depth);
const PAN = panLimits(LAYOUT.width, LAYOUT.depth);

export function OfficeScene() {
  const select = useOffice((s) => s.select);
  return (
    <Canvas
      className="scene"
      orthographic
      shadows="percentage"
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: [...CAMERA_POSITION], zoom: startZoom(LAYOUT.width, LAYOUT.depth), near: -200, far: 400 }}
      onPointerMissed={() => select(null)}
    >
      <Backdrop />
      <Lighting />
      <group position={ORIGIN}>
        <Room />
        <RoomsLayer />
        <FurnitureLayer />
        <ArtFrames />
        <DeskDressing />
        <ServerLights />
        <Beam />
        <CharactersLayer />
      </group>
      <MapControls
        makeDefault
        target={[0, 0, 0]}
        enableDamping
        maxPolarAngle={Math.PI / 2.6}
        minPolarAngle={Math.PI / 6}
        minAzimuthAngle={AZIMUTH.min}
        maxAzimuthAngle={AZIMUTH.max}
        minZoom={minZoom(LAYOUT.width, LAYOUT.depth)}
        maxZoom={MAX_ZOOM}
        onChange={(e) => {
          if (e?.target) keepInView(e.target as Pannable, PAN);
        }}
      />
      <Effects />
    </Canvas>
  );
}
```

`src/store/reducers.ts` — in `applyEvent`'s `switch (ev.type)`, after the `model.changed` case:

```ts
    case 'seat.changed':
      // Their character walks to the new seat now (spec office rooms §3); the next snapshot says the same.
      v = { ...v, employee: { ...v.employee, deskIndex: ev.deskIndex } };
      break;
```

- [ ] **Step 5: Run the tests, the web suite and the typecheck**

Run: `pnpm vitest run src/scene/camera.test.ts src/store/reducers.test.ts && pnpm vitest run && pnpm --filter @cc/office-web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/control-center-departments
git add apps/office-web/src/scene/camera.ts apps/office-web/src/scene/camera.test.ts apps/office-web/src/scene/Lighting.tsx apps/office-web/src/scene/OfficeScene.tsx apps/office-web/src/store/reducers.ts apps/office-web/src/store/reducers.test.ts
git commit -m "feat(scene): the view, its limits and the sun's shadow sized from the floor; a seat change walks the character at once"
```

---

### Task 12: README and final verification

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-13-office-rooms-design.md` (only if the implementation had to differ)

- [ ] **Step 1: README** — add, right after the section `## Departmanlar ve öneriler` (sub-project 1's), this section in the README's voice:

```markdown
## Ofis odaları

Ofis 32 × 24 m'lik tek bir kat: ortada **merkez**, kuzeyinde ve güneyinde üçer cam duvarlı **departman odası**.

- **Merkez:** koordinatörün masası ışık hüzmesinin altında; kuzeyinde toplantı masası, batıda kahve köşesi,
  güneybatıda sunucu köşesi, doğuda lounge, koordinatörün iki yanında sekiz merkez masası.
- **Işık hüzmesi** koordinatörün durumunu gösterir: çalışırken nabız gibi parlar, boştayken sakin, uyurken ya da
  dururken sönük; koordinatör yoksa hüzme de yok.
- **Odalar:** bir departman açılınca en küçük boş odayı alır, kapanınca oda boşalır. Dolu odanın halısı departmanın
  renginde, lambası ve ekranları açık; kapısının üstündeki tabelada departmanın ve başkanının adı yazar. Boş oda
  karanlıktır, tabelasında "Boş oda" yazar.
- **Koltuklar (45):** koordinatör 0'da, oda r'nin altı masası 1 + 6r … 6 + 6r, merkez masaları 37 … 44. Departman
  üyesi kendi odasına oturur; oda doluysa (departmanda kişi sınırı yok) merkezdeki bir masaya, departmansızlar
  merkeze. Departmanı ya da koordinatörlüğü değişen kişi yeni yerine yürür; ofis her açılışta herkesi yerine
  oturtur (sekiz masalı eski ofis de böyle taşınır).
- **Çalışan sınırı:** Anayasa'da varsayılan 12, en çok 45 (koltuk sayısı); kayıtlı bir değerin varsa o kalır.
```

- [ ] **Step 2: Full verification**

Run, from the worktree root:

```bash
pnpm -r typecheck
pnpm test
```

Expected: typecheck clean; office-server and office-web all passing (each suite's count before this plan plus the new tests; the real-claude tests skipped). Paste the summary lines into the final report.

- [ ] **Step 3: Optional — look at it (a manual check before release, not an automatic test)**

Build the page and start a throwaway office on a free port that is **not** 4319, with a temporary data folder and the fake claude (never the vite dev server: its proxy goes to the live office):

```bash
cd ~/Projects/control-center-departments
export OFFICE_DATA_DIR="$(mktemp -d /tmp/cc-rooms-XXXXXX)" FAKE_CLAUDE_STATE="$(mktemp -d /tmp/cc-fake-XXXXXX)"
OFFICE_PORT=4391 OFFICE_CLAUDE_COMMAND="[\"node\",\"$PWD/apps/office-server/test/fake-claude.mjs\"]" pnpm office
```

Open http://127.0.0.1:4391. Hire a coordinator (Şirket), open two departments (Şirket → Departmanlar → Departman aç), hire three people into one and one into the other, two to the centre; send the coordinator a message. Take a screenshot (by hand, or with the Playwright tools at a 1600 × 1000 window) and check: the whole floor in view at the start; coffee, lounge and the server corner in the hub; two rooms lit in their colours with their names and heads on the door signs, four dark with "Boş oda"; the beam over the coordinator's desk, breathing while the coordinator works and calm after; moving someone to the other department (Departmanlar → Kişi ekle) walks them to that room through the doors; dragging the view stops at the floor's edge; the frame rate stays smooth. Tune only the beam's `CONE_OPACITY`/`SPOT_INTENSITY` or a carpet colour if the picture asks for it (tests unchanged). Stop the office with Ctrl+C and remove the folders: `rm -rf "$OFFICE_DATA_DIR" "$FAKE_CLAUDE_STATE"`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs
git commit -m "docs(rooms): README — the office's rooms, the beam and the 45 seats"
```
