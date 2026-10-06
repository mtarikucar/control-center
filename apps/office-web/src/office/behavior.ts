import type { Lifecycle } from '@cc/shared';

export type Zone = 'desk' | 'server' | 'coffee' | 'lounge' | 'meeting';
export type Activity = 'typing' | 'sit' | 'talkSeated' | 'idle' | 'drink';
export type Marker = 'none' | 'alert' | 'faded' | 'terminal';

export interface Behavior {
  zone: Zone;
  activity: Activity;
  marker: Marker;
}

export const LONG_TOOL_MS = 30_000;
export const IDLE_WANDER_MS = 60_000;
export const TYPING_FRESH_MS = 5_000;

export interface BehaviorInput {
  lifecycle: Lifecycle;
  /** Start of the oldest tool still running, if any. */
  openToolSince: number | null;
  /** When the employee last became idle: the last finished turn, or when they were hired. */
  idleSince: number;
  ownerTypingAt: number | null;
  now: number;
  /** Stable per employee (desk index) so the same person keeps wandering to the same place. */
  wanderSeed: number;
  /** The coordinator is discussing a plan with the owner (a draft of theirs waits): it stands at the meeting table. */
  planning?: boolean;
}

const at = (zone: Zone, activity: Activity, marker: Marker = 'none'): Behavior => ({ zone, activity, marker });

/** Spec §6: what the character does for a given employee state. Pure, so the scene only renders it. */
export function behaviorOf(i: BehaviorInput): Behavior {
  if (i.planning && (i.lifecycle === 'working' || i.lifecycle === 'idle')) return at('meeting', 'idle');
  const ownerTyping = i.ownerTypingAt !== null && i.now - i.ownerTypingAt < TYPING_FRESH_MS;
  switch (i.lifecycle) {
    case 'working':
      if (ownerTyping) return at('desk', 'talkSeated');
      if (i.openToolSince !== null && i.now - i.openToolSince > LONG_TOOL_MS) return at('server', 'idle');
      return at('desk', 'typing');
    case 'idle':
    case 'starting':
      if (ownerTyping) return at('desk', 'talkSeated');
      if (i.now - i.idleSince < IDLE_WANDER_MS) return at('desk', 'sit');
      return i.wanderSeed % 2 === 0 ? at('coffee', 'drink') : at('lounge', 'sit');
    case 'limited':
    case 'error':
    case 'interrupted':
      return at('desk', 'sit', 'alert');
    case 'in_terminal':
      return at('desk', 'sit', 'terminal');
    default:
      return at('desk', 'sit', 'faded');
  }
}
