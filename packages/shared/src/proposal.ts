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
