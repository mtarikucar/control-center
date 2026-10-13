import { afterEach, describe, expect, it } from 'vitest';
import { HUB_SEATS, OWNER, SEAT_COUNT, roomSeats } from '@cc/shared';
import { ConflictError, ValidationError } from '../src/errors.ts';
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
