import { isOutwardPolicyKind, OWNER, type CustomCapability } from '@cc/shared';

/**
 * An active company capability the owner has not yet opened to the system (final review I1): someone else activated
 * it, and its kind is one the outward policy governs — until the owner confirms it, the gate asks about its calls.
 * Read passes the gate anyway, and pay and delete are always the owner's, so confirming those would change nothing.
 */
export const needsConfirm = (c: CustomCapability): boolean => c.status === 'active' && c.decidedBy !== null && c.decidedBy !== OWNER && isOutwardPolicyKind(c.kind);

/**
 * A proposal only the owner can decide (spec capabilities §4.2): the coordinator's own (the doer is not the checker) or
 * one proposed as read (accepting it as read is the owner's alone).
 */
export const ownerAlone = (c: CustomCapability, coordinatorId: string | null): boolean =>
  c.status === 'proposed' && (c.kind === 'read' || (coordinatorId !== null && c.proposedBy === coordinatorId));

/** What waits for the owner in the Yetenekler tab: their proposals to decide, and the activations to open to the system. */
export const waitingForOwner = (list: readonly CustomCapability[], coordinatorId: string | null): number =>
  list.filter((c) => ownerAlone(c, coordinatorId) || needsConfirm(c)).length;
