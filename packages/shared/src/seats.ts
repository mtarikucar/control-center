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
