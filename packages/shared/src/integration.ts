/**
 * The integration registry (B3): which connectors the office has, how each desk's session reported them, and what
 * the coordinator recorded by hand (spec 2026-10-08-integration-registry-design). Read-only: no connector is called.
 */

export const INTEGRATION_KINDS = ['office', 'claude_ai', 'plugin', 'local_mcp', 'adapter', 'cli'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
/** In display order: the best first. */
export const INTEGRATION_STATUSES = ['connected', 'needs_auth', 'pending', 'failed', 'closed', 'unknown'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
/** What one desk's session said; `closed` is the registry's word, never a desk's. */
export type DeskConnection = Exclude<IntegrationStatus, 'closed'>;

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  connected: 'bağlı', needs_auth: 'yetki bekliyor', pending: 'bağlanıyor', failed: 'hata', closed: 'kapalı', unknown: 'bilinmiyor',
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
  /** When that session opened. */
  seenAt: number;
  /** Usable there: connected, and the registry has not closed it. */
  open: boolean;
}

export interface Integration {
  name: string;
  kind: IntegrationKind;
  status: IntegrationStatus;
  /** Closed in the registry (sessions keep it until B9 shuts it there). */
  closed: boolean;
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
