import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION, HUB_SEATS, OWNER, SEAT_COUNT, roomOfSeat, roomSeats } from '@cc/shared';
import { ConflictError, ValidationError } from '../src/errors.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
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
  return { ...s, ...c, engine: f.engine, departments: c.departments!, seat, moves };
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

describe('Seats in the company — what the office decides and what it refuses', () => {
  it('a coordinator hire the roster would refuse moves nobody: the roster is asked before the beam’s desk is cleared', () => {
    const t = make();
    // An office of before: a member at the coordinator's desk.
    const ada = t.roster.create({ name: 'Ada', role: 'r' });
    expect(t.seat(ada.id)).toBe(0);
    expect(() => t.company.hireCoordinator('sonnet', 'bogus' as never)).toThrow(ValidationError);
    expect(t.company.coordinator()).toBeNull();
    expect(t.seat(ada.id)).toBe(0);
    expect(t.moves()).toEqual([]);
    // The same hire made right: now Ada walks to the hub and the coordinator sits under the beam.
    const coordinator = t.company.hireCoordinator('sonnet');
    expect([coordinator, ada].map((e) => t.seat(e.id))).toEqual([0, HUB_SEATS[0]]);
    expect(t.moves()).toEqual([['Ada', HUB_SEATS[0]]]);
  });

  it('a second coordinator is refused and nobody moves', () => {
    const t = make();
    const first = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect(() => t.company.hireCoordinator('sonnet')).toThrow('Ofiste zaten bir koordinatör var.');
    expect([first, ada].map((e) => t.seat(e.id))).toEqual([0, HUB_SEATS[0]]);
    expect(t.moves()).toEqual([]);
  });

  it('a coordinator is never seated at an arbitrary desk: seating finds none under the beam, so there is no hire', () => {
    const t = make();
    t.seating.forHire = () => null;
    expect(() => t.company.hireCoordinator('sonnet')).toThrow(ConflictError);
    expect(t.company.coordinator()).toBeNull();
    expect(t.roster.list()).toEqual([]);
  });

  it('a deskIndex in an owner’s POST body never chooses a seat: the office’s choice is set after the input', () => {
    const t = make();
    t.company.hireCoordinator('sonnet');
    const dep = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r', deskIndex: 5 } as never);
    const pelin = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: dep.id, deskIndex: 40 } as never);
    const sena = t.company.hire(OWNER, { name: 'Sena', role: 'r', team: 'Pazarlama', deskIndex: 0 } as never);
    expect([ada, pelin, sena].map((e) => t.seat(e.id))).toEqual([HUB_SEATS[0], roomSeats(0)[0], roomSeats(0)[1]]);
    expect(t.moves()).toEqual([]);
  });

  it('a stray deskIndex does not refuse a hire into a new free-text team either: the roster pre-check ignores it, the hire sits where seatFor puts it', () => {
    const t = make();
    t.company.hireCoordinator('sonnet');
    // 0 is the coordinator's (taken), 99 and -1 are no seat: none of them may refuse or place the hire.
    const people = [
      t.company.hire(OWNER, { name: 'Ada', role: 'r', team: 'Yeni', deskIndex: 0 } as never),
      t.company.hire(OWNER, { name: 'Bora', role: 'r', team: 'Başka', deskIndex: 99 } as never),
      t.company.hire(OWNER, { name: 'Cem', role: 'r', team: 'Üçüncü', deskIndex: -1 } as never),
    ];
    expect(people.map((e) => t.seat(e.id))).toEqual([roomSeats(0)[0], roomSeats(1)[0], roomSeats(2)[0]]);
    expect(t.departments.list({ status: 'open' }).map((d) => d.name)).toEqual(['Yeni', 'Başka', 'Üçüncü']);
    expect(t.moves()).toEqual([]);
  });

  it('an office without departments is not chosen for either: a stray deskIndex does not reach the roster', () => {
    const t = make({});
    const coordinator = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(coordinator.id, { name: 'Ada', role: 'r', deskIndex: 20 } as never);
    expect(t.seat(ada.id)).toBe(HUB_SEATS[0]);
  });
});

describe('Seats in the company — a freed room (review of task 5)', () => {
  it('seven adopted teams, six with rooms: closing one gives the roomless team the freed room, and its members move into it', () => {
    const t = make();
    // An office of before: seven teams, the seventh with two people.
    const people = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'G7'].map((team, i) => t.roster.create({ name: `Kişi${i}`, role: 'r', team }));
    t.departments.adoptTeams();
    t.seating.reseatAll();
    const open = (name: string) => t.departments.list({ status: 'open' }).find((d) => d.name === name)!;
    const g7 = people.slice(6);
    expect(open('G7').room).toBeNull();
    expect(g7.map((e) => HUB_SEATS.includes(t.seat(e.id)))).toEqual([true, true]);
    t.departments.close(OWNER, open('B2').id, 'bitti');
    expect(open('G7').room).toBe(1);
    expect(g7.map((e) => t.seat(e.id))).toEqual(roomSeats(1).slice(0, 2));
  });
});

describe('Seats in the company — the centre past the hub, and seats freed (final review I1, M1)', () => {
  it('(A) an office without departments at the default twelve: the coordinator under the beam, eight at the hub, the rest in the highest room; a new department takes room 0 and its people sit there', () => {
    const t = make();
    t.budget.setConstitution({ maxEmployees: DEFAULT_CONSTITUTION.maxEmployees });
    expect(DEFAULT_CONSTITUTION.maxEmployees).toBe(12);
    const coordinator = t.company.hireCoordinator('sonnet');
    const people = range(1, 11).map((i) => t.company.hire(coordinator.id, { name: `Kişi ${i}`, role: 'r' }));
    expect([coordinator, ...people].map((e) => t.seat(e.id))).toEqual([0, ...HUB_SEATS, ...roomSeats(5).slice(0, 3)]);
    expect(t.seating.reseatAll()).toBe(0);
    const dep = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    expect(dep.room).toBe(0);
    // One of the overflow and one of the hub join it: both walk into room 0, and the hub seat freed takes the earliest-hired of the overflow.
    t.departments.move(OWNER, people[9]!.id, dep.id);
    t.departments.move(OWNER, people[0]!.id, dep.id);
    expect([people[9], people[0]].map((e) => t.seat(e!.id))).toEqual(roomSeats(0).slice(0, 2));
    expect(t.seat(people[8]!.id)).toBe(HUB_SEATS[0]);
    expect(t.moves()).toEqual([['Kişi 10', 1], ['Kişi 1', 2], ['Kişi 9', HUB_SEATS[0]]]);
    expect(t.seating.reseatAll()).toBe(0);
  });

  it('(C) the coordinator, eight of the centre and a department of three: closing it sends the three out of the closed room to the highest room nobody holds; a restart moves nobody', () => {
    const t = make();
    t.budget.setConstitution({ maxEmployees: DEFAULT_CONSTITUTION.maxEmployees });
    const coordinator = t.company.hireCoordinator('sonnet');
    const dep = t.departments.create(OWNER, { name: 'Satış', mission: 'm' });
    const three = ['Ada', 'Bora', 'Cem'].map((name) => t.company.hire(OWNER, { name, role: 'r', departmentId: dep.id }));
    const centre = range(1, 8).map((i) => t.company.hire(coordinator.id, { name: `Merkez ${i}`, role: 'r' }));
    expect(three.map((e) => t.seat(e.id))).toEqual(roomSeats(0).slice(0, 3));
    expect(centre.map((e) => t.seat(e.id))).toEqual(HUB_SEATS);
    t.departments.close(OWNER, dep.id, 'bitti');
    expect(three.map((e) => t.seat(e.id))).toEqual(roomSeats(5).slice(0, 3));
    expect(t.roster.list().filter((e) => roomOfSeat(e.deskIndex) === 0)).toEqual([]);
    expect(t.seating.reseatAll()).toBe(0);
  });

  it('someone of the centre sitting in the room a new department gets moves out to a room nobody holds; the department’s hire sits in it', () => {
    const t = make();
    const coordinator = t.company.hireCoordinator('sonnet');
    for (const i of range(1, 8)) t.company.hire(coordinator.id, { name: `Merkez ${i}`, role: 'r' });
    // Ada sits on room 0's first seat (an office of before); with the hub full nothing moves her while no department holds it.
    const ada = t.roster.create({ name: 'Ada', role: 'r', deskIndex: 1 });
    expect(t.seating.reseatAll()).toBe(0);
    const dep = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    expect(dep.room).toBe(0);
    expect(t.seat(ada.id)).toBe(roomSeats(5)[0]);
    const pelin = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: dep.id });
    expect(t.seat(pelin.id)).toBe(roomSeats(0)[0]);
    expect(t.moves()).toEqual([['Ada', roomSeats(5)[0]]]);
  });

  function sevenInOne() {
    const t = make();
    t.company.hireCoordinator('sonnet');
    const dep = t.departments.create(OWNER, { name: 'Yazılım', mission: 'm' });
    const seven = ['Ada', 'Bora', 'Cem', 'Deniz', 'Ece', 'Filiz', 'Gül'].map((name) => t.company.hire(OWNER, { name, role: 'r', departmentId: dep.id }));
    expect(seven.map((e) => t.seat(e.id))).toEqual([...roomSeats(0), HUB_SEATS[0]]);
    return { t, dep, seven };
  }

  it('(M1) a department of seven: when one in the room leaves it, the seventh walks in from the hub at once', () => {
    const { t, seven } = sevenInOne();
    t.departments.move(OWNER, seven[2]!.id, null);
    expect(t.seat(seven[6]!.id)).toBe(roomSeats(0)[2]);
    expect(t.seat(seven[2]!.id)).toBe(HUB_SEATS[1]);
    expect(t.moves()).toEqual([['Cem', HUB_SEATS[1]], ['Gül', roomSeats(0)[2]]]);
    expect(t.seating.reseatAll()).toBe(0);
  });

  it('(M1) a department of seven: when one in the room is let go, the seventh walks in from the hub at once', async () => {
    const { t, seven } = sevenInOne();
    await t.engine.fire(seven[0]!.id);
    t.company.releaseTasksOf(seven[0]!.id);
    expect(t.seat(seven[6]!.id)).toBe(roomSeats(0)[0]);
    expect(t.moves()).toEqual([['Gül', roomSeats(0)[0]]]);
  });

  it('(M1) a department of seven: when one in the room is made another department’s head, the seventh walks in from the hub at once', () => {
    const { t, seven } = sevenInOne();
    const other = t.departments.create(OWNER, { name: 'Tasarım', mission: 'm' });
    t.departments.setHead(OWNER, other.id, seven[1]!.id);
    expect(t.seat(seven[1]!.id)).toBe(roomSeats(1)[0]);
    expect(t.seat(seven[6]!.id)).toBe(roomSeats(0)[1]);
    expect(t.moves()).toEqual([['Bora', roomSeats(1)[0]], ['Gül', roomSeats(0)[1]]]);
  });

  it('letting someone of the hub go seats the centre’s earliest overflow there at once', async () => {
    const t = make();
    const coordinator = t.company.hireCoordinator('sonnet');
    const people = range(1, 10).map((i) => t.company.hire(coordinator.id, { name: `Kişi ${i}`, role: 'r' }));
    expect(people.slice(8).map((e) => t.seat(e.id))).toEqual(roomSeats(5).slice(0, 2));
    await t.engine.fire(people[3]!.id);
    t.company.releaseTasksOf(people[3]!.id);
    expect(t.moves()).toEqual([['Kişi 9', HUB_SEATS[3]]]);
  });
});
