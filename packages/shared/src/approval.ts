/**
 * The gate for work that cannot be taken back (B9a): a tool call the gate holds waits for the owner's approval, asked
 * for with approvalRequest and given on the office page only.
 */

/** What a held call would do: publish, send, pay or spend, delete, act in a browser, touch the office itself, other. */
export const APPROVAL_KINDS = ['publish', 'send', 'pay', 'delete', 'browser', 'self', 'other'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  publish: 'yayın',
  send: 'gönderim',
  pay: 'ödeme/harcama',
  delete: 'silme',
  browser: 'tarayıcı',
  self: 'ofisin kendisi',
  other: 'diğer',
};

/** 'call': one call, once; 'task': every call of the same kind and tool family while the task is open. */
export const APPROVAL_SCOPES = ['call', 'task'] as const;
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'used' | 'expired';
export type ApprovalChange = 'requested' | 'approved' | 'denied' | 'used' | 'expired';

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'onay bekliyor',
  approved: 'onaylandı',
  denied: 'reddedildi',
  used: 'kullanıldı',
  expired: 'süresi doldu',
};

export interface Approval {
  id: string;
  employeeId: string;
  /** The task the asker was on (always set for scope 'task'). */
  taskId: string | null;
  kind: ApprovalKind;
  /** The tool as the hook sees it: Bash, Write, mcp__… */
  tool: string;
  /** The coarse target the owner reads and the gate matches: `git push origin`, `curl api.x.com`, a path, a tool. */
  target: string;
  fingerprint: string;
  /** Why the asker needs it. */
  summary: string;
  scope: ApprovalScope;
  status: ApprovalStatus;
  requestedAt: number;
  decidedAt: number | null;
  /** 'owner', the only one who decides. */
  decidedBy: string | null;
  /** 'page': the decision came through the owner guard (Origin and the page's nonce). */
  decidedVia: string | null;
  expiresAt: number | null;
  usedAt: number | null;
  note: string | null;
}

/** The office's answer to the hook: allow lets the call run; deny stops it and the reason reaches the model. */
export interface GateDecision {
  decision: 'allow' | 'deny';
  reason: string;
  kind?: ApprovalKind;
  target?: string;
  approvalId?: string;
}

/**
 * Said wherever the gate is explained (the owner's card, the working rules, the hand-in): what it stops and what it
 * does not, while the employees run as the owner's own user.
 */
export const GATE_LIMIT_TEXT = 'Kapı kazara ve sıradan yolları kapatır; aynı kullanıcıdaki kararlı bir atlatmayı durdurmaz; sahibi onayı yalnız ofis sayfasından sayılır.';
