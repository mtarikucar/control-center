import {
  INTEGRATION_KINDS, INTEGRATION_KIND_LABELS, INTEGRATION_STATUSES, INTEGRATION_STATUS_LABELS,
  type DeskConnection, type Integration, type IntegrationDesk, type IntegrationKind, type IntegrationStatus, type OfficeEvent,
} from '@cc/shared';
import type { Db } from '../db.ts';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import { mcpToolPrefix } from '../claude/normalize.ts';
import { clean, lines } from './text.ts';

/**
 * The integration registry (B3; spec 2026-10-08-integration-registry-design): what each current desk's latest session
 * reported, read from the session.started events every time, merged with what the coordinator recorded by hand.
 * Reading calls no connector and writes nothing.
 */

export interface IntegrationInput {
  name: unknown;
  kind?: unknown;
  capabilities?: unknown;
  authNeeded?: unknown;
  costNote?: unknown;
  note?: unknown;
  closed?: unknown;
}

interface ManualRow {
  name: string;
  kind: string;
  closed: number;
  capabilities: string;
  auth_needed: string | null;
  cost_note: string | null;
  note: string | null;
  registered_by: string;
  registered_at: number;
  updated_at: number;
}

/** A session's raw status as the office reads it; anything it does not know is unknown (the raw value is kept). */
const RAW: Record<string, DeskConnection> = { connected: 'connected', 'needs-auth': 'needs_auth', pending: 'pending', failed: 'failed' };
const rank = (s: IntegrationStatus) => INTEGRATION_STATUSES.indexOf(s);

/** The kind a reported name tells: the office's own server, a claude.ai connector, a plugin's server, else a local MCP. */
export function kindOf(name: string): IntegrationKind {
  if (name === 'office') return 'office';
  if (name.startsWith('claude.ai ')) return 'claude_ai';
  if (name.startsWith('plugin:')) return 'plugin';
  return 'local_mcp';
}

export class IntegrationRegistry {
  readonly #db: Db;
  readonly #roster: Roster;
  readonly #events: EventStore;
  readonly #now: () => number;

  constructor(d: { db: Db; roster: Roster; events: EventStore; now?: () => number }) {
    this.#db = d.db;
    this.#roster = d.roster;
    this.#events = d.events;
    this.#now = d.now ?? Date.now;
  }

  /** Best first, then by name; `status` keeps one status, `employee` keeps what that desk reports (and only its line). */
  list(o: { status?: IntegrationStatus; employee?: string } = {}): Integration[] {
    const { seen, desks } = this.#observed();
    const manual = new Map((this.#db.prepare('SELECT * FROM integrations').all() as unknown as ManualRow[]).map((r) => [r.name, r]));
    const names = new Set([...seen.keys(), ...manual.keys()]);
    const all = [...names].map((name) => this.#build(name, seen.get(name) ?? null, desks.get(name) ?? [], manual.get(name) ?? null));
    return all
      .map((i) => (o.employee === undefined ? i : { ...i, desks: i.desks.filter((d) => d.employeeId === o.employee) }))
      .filter((i) => (o.employee === undefined || i.desks.length > 0) && (o.status === undefined || i.status === o.status))
      .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, 'tr'));
  }

  get(name: string): Integration {
    const found = this.list().find((i) => i.name === name);
    if (!found) throw new NotFoundError(`Bağlantı bulunamadı: ${name}`);
    return found;
  }

  /** The coordinator records a connector by hand; the fields given are written, the others kept. */
  register(by: string, input: IntegrationInput): Integration {
    if (this.#roster.get(by).kind !== 'coordinator') throw new ForbiddenError('Yalnız koordinatör bunu yapabilir.');
    if (input.name !== undefined && typeof input.name !== 'string') throw new ValidationError('Bağlantı adı metin olmalı.');
    const name = clean(input.name as string | undefined, 'Bağlantı adı', 120, true);
    const current = this.#db.prepare('SELECT * FROM integrations WHERE name = ?').get(name) as unknown as ManualRow | undefined;
    let kind: IntegrationKind;
    if (input.kind !== undefined) {
      if (!(INTEGRATION_KINDS as readonly unknown[]).includes(input.kind)) throw new ValidationError(`Bağlantı: tür (kind) ${INTEGRATION_KINDS.slice(0, -1).join(', ')} ya da ${INTEGRATION_KINDS.at(-1)} olmalı.`);
      kind = input.kind as IntegrationKind;
    } else if (current) kind = current.kind as IntegrationKind;
    else if (this.#observed().seen.has(name)) kind = kindOf(name);
    else throw new ValidationError(`“${name}” hiçbir oturumda görünmedi: tür (kind) gerekli (adapter, cli …).`);
    let capabilities = current ? (JSON.parse(current.capabilities) as string[]) : [];
    if (input.capabilities !== undefined) {
      if (!Array.isArray(input.capabilities) || input.capabilities.some((c) => typeof c !== 'string')) throw new ValidationError('Yetenekler metinlerden oluşan bir liste olmalı.');
      capabilities = lines(input.capabilities as string[], 'Yetenekler', 20, 60);
    }
    const text = (value: unknown, label: string, keep: string | null): string | null => {
      if (value === undefined) return keep;
      if (value === null) return null;
      if (typeof value !== 'string') throw new ValidationError(`${label} metin olmalı.`);
      return clean(value, label, 500, false) || null;
    };
    const authNeeded = text(input.authNeeded, 'Yetki notu', current?.auth_needed ?? null);
    const costNote = text(input.costNote, 'Maliyet notu', current?.cost_note ?? null);
    const note = text(input.note, 'Not', current?.note ?? null);
    if (input.closed !== undefined && typeof input.closed !== 'boolean') throw new ValidationError('closed true ya da false olmalı.');
    const closed = input.closed === undefined ? current?.closed === 1 : input.closed;
    const now = this.#now();
    this.#db
      .prepare(
        `INSERT INTO integrations (name, kind, closed, capabilities, auth_needed, cost_note, note, registered_by, registered_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET kind = excluded.kind, closed = excluded.closed, capabilities = excluded.capabilities, auth_needed = excluded.auth_needed,
           cost_note = excluded.cost_note, note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(name, kind, closed ? 1 : 0, JSON.stringify(capabilities), authNeeded, costNote, note, by, now, now);
    const integration = this.get(name);
    this.#events.append(by, { type: 'integration.changed', integration } satisfies OfficeEvent);
    return integration;
  }

  /** Every name any session reported (first and last time), and per name the current desks' latest reports. */
  #observed(): { seen: Map<string, { first: number; last: number }>; desks: Map<string, IntegrationDesk[]> } {
    const rows = this.#db.prepare("SELECT employee_id, ts, payload FROM events WHERE type = 'session.started' ORDER BY seq").all() as unknown as Array<{ employee_id: string | null; ts: number; payload: string }>;
    const seen = new Map<string, { first: number; last: number }>();
    const latest = new Map<string, { ts: number; mcp: Array<{ name: string; status: string; tools?: number; toolNames?: string[] }> }>();
    for (const row of rows) {
      const mcp = (JSON.parse(row.payload) as { mcp?: Array<{ name: string; status: string; tools?: number; toolNames?: string[] }> }).mcp ?? [];
      for (const m of mcp) {
        const s = seen.get(m.name);
        seen.set(m.name, { first: s?.first ?? row.ts, last: row.ts });
      }
      if (row.employee_id) latest.set(row.employee_id, { ts: row.ts, mcp });
    }
    const desks = new Map<string, IntegrationDesk[]>();
    // Current desks only, in desk order: someone let go no longer has a desk.
    for (const e of this.#roster.list()) {
      const session = latest.get(e.id);
      for (const m of session?.mcp ?? []) {
        // Connected but none of its tools in the session: the desk's settings deny it (Pilot 0's closed mode).
        const status: DeskConnection = m.status === 'connected' && m.tools === 0 ? 'denied' : (RAW[m.status] ?? 'unknown');
        const desk: IntegrationDesk = {
          employeeId: e.id, name: e.name, deskIndex: e.deskIndex, status, raw: m.status, tools: m.tools ?? null,
          toolNames: m.toolNames ? m.toolNames.map((t) => `${mcpToolPrefix(m.name)}${t}`) : null, seenAt: session!.ts,
          open: status === 'connected', closedBy: status === 'connected' ? null : status === 'denied' ? 'desk' : 'server',
        };
        desks.set(m.name, [...(desks.get(m.name) ?? []), desk]);
      }
    }
    return { seen, desks };
  }

  #build(name: string, seen: { first: number; last: number } | null, reported: IntegrationDesk[], manual: ManualRow | null): Integration {
    const registryClosed = manual?.closed === 1;
    // A desk open as far as its session goes is shut by the registry's word; otherwise its own reason stays.
    const desks = reported.map((d) => (registryClosed && d.open ? { ...d, open: false, closedBy: 'registry' as const } : d));
    // Closed in the registry first; no current desk reporting it: unknown; else the best a desk reports.
    const status: IntegrationStatus = registryClosed ? 'closed' : desks.length === 0 ? 'unknown' : desks.map((d) => d.status as IntegrationStatus).sort((a, b) => rank(a) - rank(b))[0]!;
    return {
      name, kind: (manual?.kind as IntegrationKind | undefined) ?? kindOf(name), status, registryClosed, desks,
      capabilities: manual ? (JSON.parse(manual.capabilities) as string[]) : [], authNeeded: manual?.auth_needed ?? null, costNote: manual?.cost_note ?? null, note: manual?.note ?? null,
      registeredBy: manual?.registered_by ?? null, registeredAt: manual?.registered_at ?? null, firstSeen: seen?.first ?? null, lastSeen: seen?.last ?? null,
    };
  }
}

const REASON: Record<DeskConnection, string> = {
  connected: 'bağlı', denied: 'masa ayarı: oturumda aracı yok', needs_auth: 'yetki bekliyor', pending: 'bağlanıyor', failed: 'hata', unknown: 'bilinmeyen durum',
};

function line(i: Integration): string {
  const parts: string[] = [];
  if (i.desks.length === 0) parts.push(`güncel hiçbir masada yok${i.lastSeen ? ` (son görülme: ${new Date(i.lastSeen).toLocaleString('tr-TR')})` : ' (hiçbir oturumda görülmedi)'}`);
  else {
    const open = i.desks.filter((d) => d.open).map((d) => d.name);
    const shut = i.desks.filter((d) => !d.open).map((d) => `${d.name} (${d.closedBy === 'registry' ? 'kayıtta kapalı' : d.status === 'unknown' ? `bilinmeyen durum: ${d.raw}` : REASON[d.status]})`);
    parts.push([open.length ? `açık: ${open.join(', ')}` : '', shut.length ? `kapalı: ${shut.join(', ')}` : ''].filter(Boolean).join('; '));
  }
  if (i.registryClosed) parts.push('kayıtta kapalı, oturumlarda kapatma B9’da');
  if (i.capabilities.length) parts.push(`yetenekler: ${i.capabilities.join(', ')}`);
  if (i.authNeeded) parts.push(`yetki: ${i.authNeeded}`);
  if (i.costNote) parts.push(`maliyet: ${i.costNote}`);
  if (i.note) parts.push(`not: ${i.note}`);
  return `• ${i.name} [${INTEGRATION_STATUS_LABELS[i.status]}] (${INTEGRATION_KIND_LABELS[i.kind]}) — ${parts.join('; ')}`;
}

/** What integrationsList shows: the count per status, then one line per connector with where it is open or shut and why. */
export function integrationsText(list: Integration[], filtered: boolean): string {
  if (list.length === 0) return filtered ? 'Süzgece uyan bağlantı yok.' : 'Henüz hiçbir masa bağlantı bildirmedi ve elle kayıt yok.';
  const counts = INTEGRATION_STATUSES.map((s) => [s, list.filter((i) => i.status === s).length] as const).filter(([, n]) => n > 0);
  return [
    `# Bağlantılar (${list.length}: ${counts.map(([s, n]) => `${INTEGRATION_STATUS_LABELS[s]} ${n}`).join(', ')}) — salt okunur; hiçbir bağlayıcı çağrılmadı.`,
    ...list.map(line),
  ].join('\n');
}
