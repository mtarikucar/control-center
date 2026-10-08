import type { IntegrationDesk, IntegrationKind, IntegrationStatus } from './integration.ts';

/**
 * The capability model (B7; spec 2026-10-08-capability-model-design): what a role or a task needs from outside the
 * office, in the product's own words, and which of the office's connectors give it.
 */

/** A capability of the vocabulary (product knowledge, shipped as craft/capabilities.json). */
export interface Capability {
  /** `area.action`, e.g. `email.send`. */
  id: string;
  title: string;
  summary: string;
  /** Goes outward and cannot be taken back: sending, publishing, paying, inviting (B9's gate looks at it). */
  outward: boolean;
  /** Claude Code's own tools that give it: every session has them, so it is open on every desk. */
  builtin: string[];
  /** Known connectors' tools that give it, by full name (`mcp__server__tool`); the connector is the name's prefix. */
  tools: string[];
}

/**
 * A connector the product knows by name only: sessions report it, but no tool of it is classified (it was never
 * authorised here, so no session listed its tools). Its rule in a closed mode is known; each of its tools counts as
 * outward — the vocabulary stays an allow-list.
 */
export interface KnownConnector {
  /** As sessions report it, e.g. `claude.ai Slack`. */
  name: string;
  /** Where the name was seen and why its tools are not classified. */
  source: string;
}

export interface CapabilityVocabulary {
  version: number;
  capabilities: Capability[];
  /** Connectors known by name only (absent in the file: none). */
  knownConnectors: KnownConnector[];
}

/**
 * In order, the first that holds wins. `open`: built in, or a provider open on the desk (for the office: on any desk).
 * `manual`: an adapter or a CLI recorded by hand, which sessions never show. `shut`: on the desk's latest session, but
 * not open there (for the office: providers known, open nowhere). `unseen`: the desk has had no session yet, a
 * provider is open on another. `missing`: none of these.
 */
export const COVERAGE_STATUSES = ['open', 'manual', 'shut', 'unseen', 'missing'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];
export const COVERAGE_STATUS_LABELS: Record<CoverageStatus, string> = {
  open: 'açık', manual: 'elle kayıtlı', shut: 'kapalı', unseen: 'bu masada görülmedi', missing: 'yok',
};

/** A connector of the registry that gives a capability. */
export interface CapabilityProvider {
  name: string;
  kind: IntegrationKind;
  /** How it counts: a tool of it is in the vocabulary, and/or the coordinator recorded the capability on it. */
  via: Array<'vocabulary' | 'registry'>;
  /** The connector's status in the office (B3). */
  status: IntegrationStatus;
  /** The asked desk's line for it; null when its latest session did not report it, or no desk was asked. */
  desk: IntegrationDesk | null;
  /** Names of the current desks where it is open. */
  openOn: string[];
}

/**
 * A connector's tools that no capability of the vocabulary names (B7, review round 1). The vocabulary is an allow-list:
 * no role's capability ever opens these, and B9's gate counts them outward.
 */
export interface UnclassifiedTools {
  server: string;
  kind: IntegrationKind;
  /** Its tools in the current desks' latest sessions: the names together, or the largest count when names are missing. */
  tools: number;
  /** The unclassified ones by full name, sorted; null when a session from before names leaves them unknown. */
  unclassified: string[] | null;
  /** How many at least: the names' count, or (names unknown) the session's count less the vocabulary's tools of it. */
  atLeast: number;
}

export interface CapabilityCoverage {
  id: string;
  status: CoverageStatus;
  builtin: string[];
  providers: CapabilityProvider[];
}
