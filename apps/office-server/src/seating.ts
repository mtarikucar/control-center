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
