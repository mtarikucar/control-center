/**
 * The integration registry (B3): which connectors the office has, how each desk's session reported them, and what
 * the coordinator recorded by hand (spec 2026-10-08-integration-registry-design). Read-only: no connector is called.
 */

export const INTEGRATION_KINDS = ['office', 'claude_ai', 'plugin', 'local_mcp', 'adapter', 'cli'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
/**
 * In display order: the best first. `denied`: connected, but the session has none of its tools (the desk's settings
 * deny it). `closed` is the registry's word, never a desk's.
 */
export const INTEGRATION_STATUSES = ['connected', 'denied', 'needs_auth', 'pending', 'failed', 'closed', 'unknown'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
/** What one desk's session said. */
export type DeskConnection = Exclude<IntegrationStatus, 'closed'>;
/** Why a desk is shut: the server is not connected there, the desk's session has none of its tools, or the registry closed it. */
export type DeskShutBy = 'server' | 'desk' | 'registry';

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  connected: 'bağlı', denied: 'masada kapalı', needs_auth: 'yetki bekliyor', pending: 'bağlanıyor', failed: 'hata', closed: 'kapalı', unknown: 'bilinmiyor',
};
export const INTEGRATION_KIND_LABELS: Record<IntegrationKind, string> = {
  office: 'ofis', claude_ai: 'claude.ai bağlayıcısı', plugin: 'eklenti', local_mcp: 'yerel MCP', adapter: 'adaptör', cli: 'komut satırı',
};

export interface IntegrationDesk {
  employeeId: string;
  name: string;
  deskIndex: number;
  status: DeskConnection;
  /** As the session reported it ('needs-auth', or a value the office does not know). */
  raw: string;
  /** How many of its tools the session has; null for a session from before tool counts (then only the server state is known). */
  tools: number | null;
  /** When that session opened. */
  seenAt: number;
  /** Usable there: connected with tools in the session (or a count not known), and not closed in the registry. */
  open: boolean;
  /** Why it is shut there; null when open. 'registry' means the session still has the tools (B9 shuts them). */
  closedBy: DeskShutBy | null;
}

export interface Integration {
  name: string;
  kind: IntegrationKind;
  status: IntegrationStatus;
  /** Closed in the registry by the coordinator; the sessions keep its tools until B9 shuts them there. */
  registryClosed: boolean;
  /** The current desks whose latest session reported it, in desk order. */
  desks: IntegrationDesk[];
  capabilities: string[];
  authNeeded: string | null;
  costNote: string | null;
  note: string | null;
  /** Who registered it by hand; null when only seen in sessions. */
  registeredBy: string | null;
  registeredAt: number | null;
  /** First and last session that reported it; null when never seen. */
  firstSeen: number | null;
  lastSeen: number | null;
}
