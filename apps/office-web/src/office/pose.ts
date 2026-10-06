import type { ClipRole } from '../assets/manifest.ts';
import type { Activity } from './behavior.ts';

/**
 * What a character's body is doing between places: getting up, walking, stepping onto a sofa, sitting down. Pure, so
 * the scene only moves and animates what this says.
 */
export type Phase = 'standing' | 'standingUp' | 'walking' | 'toSeat' | 'sittingDown' | 'seated';

export interface Pose {
  phase: Phase;
  since: number;
}

export const STAND_UP_MS = 900;
export const SIT_DOWN_MS = 1100;
export const TO_SEAT_MS = 500;

export function initialPose(sits: boolean, now: number): Pose {
  return { phase: sits ? 'seated' : 'standing', since: now };
}

/** A new place to go: whoever sits gets up first. */
export function onGoal(p: Pose, now: number): Pose {
  if (p.phase === 'seated' || p.phase === 'sittingDown') return { phase: 'standingUp', since: now };
  if (p.phase === 'standingUp') return p;
  return { phase: 'walking', since: now };
}

export interface Progress {
  /** The walk to the place is over. */
  walkDone: boolean;
  /** The place has a seat to step onto (a sofa, an armchair). */
  hasSeat: boolean;
  /** What the person does there is done sitting (a desk, the lounge). */
  sits: boolean;
}

export function advance(p: Pose, now: number, o: Progress): Pose {
  const elapsed = now - p.since;
  const at = (phase: Phase): Pose => ({ phase, since: now });
  switch (p.phase) {
    case 'standingUp':
      return elapsed >= STAND_UP_MS ? at('walking') : p;
    case 'walking':
      if (!o.walkDone) return p;
      return o.hasSeat ? at('toSeat') : o.sits ? at('sittingDown') : at('standing');
    case 'toSeat':
      return elapsed >= TO_SEAT_MS ? (o.sits ? at('sittingDown') : at('standing')) : p;
    case 'sittingDown':
      return elapsed >= SIT_DOWN_MS ? at('seated') : p;
    case 'seated':
      return o.sits ? p : at('standing');
    case 'standing':
      return o.sits && o.walkDone ? at('sittingDown') : p;
  }
}

export function clipFor(p: Pose, activity: Activity): ClipRole | 'standUp' {
  switch (p.phase) {
    case 'walking':
    case 'toSeat':
      return 'walk';
    case 'standingUp':
      return 'standUp';
    case 'sittingDown':
      return 'sitDown';
    default:
      return activity;
  }
}
