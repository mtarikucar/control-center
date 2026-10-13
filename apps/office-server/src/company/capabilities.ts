import { readFileSync } from 'node:fs';
import {
  CAPABILITY_KINDS, COVERAGE_STATUS_LABELS, INTEGRATION_KIND_LABELS, INTEGRATION_STATUS_LABELS,
  type Capability, type CapabilityCoverage, type CapabilityKind, type CapabilityProvider, type CapabilityVocabulary, type CoverageStatus, type Integration, type IntegrationDesk,
  type KnownConnector, type UnclassifiedTools,
} from '@cc/shared';
import { mcpToolPrefix } from '../claude/normalize.ts';
import { NotFoundError, ValidationError } from '../errors.ts';

/**
 * The capability model (B7; spec 2026-10-08-capability-model-design): the vocabulary shipped with the product, the
 * lists roles and tasks declare in it, and how each capability is met by the integration registry (B3). Reading calls
 * no connector and writes nothing.
 */

const FILE = new URL('./craft/capabilities.json', import.meta.url);
const FIELDS = ['id', 'title', 'summary', 'kind', 'outward', 'builtin', 'tools'] as const;
const ID = /^[a-z]+\.[a-z]+$/;
/** A connector tool's full name (mcp__server__tool), as the vocabulary and a company capability write it. */
export const TOOL_NAME = /^mcp__[A-Za-z0-9_-]+__\S+$/;
/** Sessions never report these: the registry knows them only by hand. */
const BY_HAND = new Set(['adapter', 'cli']);

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function parseCapabilities(text: string): CapabilityVocabulary {
  const fail = (what: string) => new ValidationError(`Yetenek sözlüğü: ${what}`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw fail('JSON değil.');
  }
  const doc = raw as { version?: unknown; capabilities?: unknown; knownConnectors?: unknown };
  if (!Number.isInteger(doc.version) || (doc.version as number) < 1) throw fail('version pozitif bir tam sayı olmalı.');
  if (!Array.isArray(doc.capabilities)) throw fail('capabilities bir liste olmalı.');
  const seen = new Set<string>();
  const owner = new Map<string, string>();
  const capabilities = doc.capabilities.map((entry: Record<string, unknown>): Capability => {
    const id = entry.id;
    if (typeof id !== 'string' || !ID.test(id)) throw fail(`“${String(id)}”: kimlik alan.eylem biçiminde olmalı (ör. email.send).`);
    if (seen.has(id)) throw fail(`“${id}” iki kez geçiyor.`);
    seen.add(id);
    const extra = Object.keys(entry).find((k) => !(FIELDS as readonly string[]).includes(k));
    if (extra) throw fail(`${id}: “${extra}” bilinmeyen alan.`);
    for (const key of ['title', 'summary'] as const) if (typeof entry[key] !== 'string' || !entry[key].trim()) throw fail(`${id}: ${key} boş olamaz.`);
    if (typeof entry.kind !== 'string' || !(CAPABILITY_KINDS as readonly string[]).includes(entry.kind)) throw fail(`${id}: kind ${CAPABILITY_KINDS.join(', ')} olmalı.`);
    const kind = entry.kind as CapabilityKind;
    if (typeof entry.outward !== 'boolean') throw fail(`${id}: outward true ya da false olmalı.`);
    // Kept in the file for its reader; derived from the kind, so the two must agree.
    if (entry.outward !== (kind !== 'read')) throw fail(`${id}: outward türle uyuşmuyor (${kind} → ${kind !== 'read'}).`);
    for (const key of ['builtin', 'tools'] as const) if (!strings(entry[key])) throw fail(`${id}: ${key} metinlerden oluşan bir liste olmalı.`);
    const tools = entry.tools as string[];
    for (const tool of tools) {
      if (!TOOL_NAME.test(tool)) throw fail(`${id}: “${tool}” bir bağlayıcı aracı değil (mcp__sunucu__araç).`);
      const other = owner.get(tool);
      if (other) throw fail(`“${tool}” iki yetenekte geçiyor: ${other}, ${id}.`);
      owner.set(tool, id);
    }
    return { id, title: (entry.title as string).trim(), summary: (entry.summary as string).trim(), kind, outward: entry.outward, builtin: entry.builtin as string[], tools };
  });
  // Known by name only: never a tool name — what a connector offers is read from a session, not written here.
  const raw2 = doc.knownConnectors ?? [];
  if (!Array.isArray(raw2)) throw fail('knownConnectors bir liste olmalı.');
  const prefixes = new Set<string>();
  const knownConnectors = raw2.map((entry: Record<string, unknown>): KnownConnector => {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!name) throw fail('knownConnectors: ad boş olamaz.');
    if (typeof entry.source !== 'string' || !entry.source.trim()) throw fail(`knownConnectors: “${name}” için kaynak boş olamaz.`);
    const extra = Object.keys(entry).find((k) => k !== 'name' && k !== 'source');
    if (extra) throw fail(`knownConnectors: “${name}”: “${extra}” bilinmeyen alan.`);
    const prefix = mcpToolPrefix(name);
    if (prefixes.has(prefix)) throw fail(`knownConnectors: “${name}” iki kez geçiyor (araç ön eki ${prefix}).`);
    prefixes.add(prefix);
    const classified = capabilities.filter((c) => c.tools.some((t) => t.startsWith(prefix))).map((c) => c.id);
    if (classified.length) throw fail(`knownConnectors: “${name}” araçları sözlükte sınıflandırılmış (${classified.join(', ')}); adıyla bilinen listesinde olamaz.`);
    return { name, source: entry.source.trim() };
  });
  return { version: doc.version as number, capabilities, knownConnectors };
}

let product: CapabilityVocabulary | null = null;
/** The company's active capabilities (spec capabilities §4.1) as main.ts wires them; none until then, and in tests that do not. */
let companyCapabilities: () => Capability[] = () => [];
/** Bumped whenever the company's capabilities change: the next read builds the vocabulary and the tool table again. */
let generation = 0;
let built: { generation: number; vocabulary: CapabilityVocabulary; byTool: Map<string, Capability> } | null = null;

/** The product's vocabulary, read once from the file. */
export function productVocabulary(): CapabilityVocabulary {
  product ??= parseCapabilities(readFileSync(FILE, 'utf8'));
  return product;
}

/** Where the company's active capabilities come from (main.ts: the CustomCapabilities service); null: none (tests reset it). */
export function useCompanyCapabilities(source: (() => Capability[]) | null): void {
  companyCapabilities = source ?? (() => []);
  invalidateVocabulary();
}

/** The company's capabilities changed: the vocabulary and the tool table are built again on their next read. */
export function invalidateVocabulary(): void {
  generation += 1;
}

function current(): { vocabulary: CapabilityVocabulary; byTool: Map<string, Capability> } {
  if (built?.generation === generation) return built;
  const base = productVocabulary();
  // Taken before the source is read: an invalidate fired while it is read leaves this build stale, so the next read builds again.
  const gen = generation;
  const company = companyCapabilities();
  const capabilities = [...base.capabilities, ...company];
  const classified = (k: KnownConnector) => company.some((c) => c.tools.some((t) => t.startsWith(mcpToolPrefix(k.name))));
  built = {
    generation: gen,
    // A connector the company classified a tool of is known by that tool now, not by its name only.
    vocabulary: { version: base.version, capabilities, knownConnectors: base.knownConnectors.filter((k) => !classified(k)) },
    byTool: new Map(capabilities.flatMap((c) => c.tools.map((t) => [t, c] as const))),
  };
  return built;
}

/** The vocabulary: the product's capabilities and, after them, the company's active ones (spec capabilities §4.1). */
export function capabilityVocabulary(): CapabilityVocabulary {
  return current().vocabulary;
}

/** The product capability that names this tool, or null. */
export function productToolOwner(tool: string): string | null {
  return productVocabulary().capabilities.find((c) => c.tools.includes(tool))?.id ?? null;
}

const ids = () => capabilityVocabulary().capabilities.map((c) => c.id);

export function capability(id: string): Capability {
  const found = capabilityVocabulary().capabilities.find((c) => c.id === id);
  if (!found) throw new NotFoundError(`Bilinmeyen yetenek: ${id}. Sözlük: ${ids().join(', ')}.`);
  return found;
}

/** A capability's kind in the vocabulary; null for an id it does not have. */
export function capabilityKind(id: string): CapabilityKind | null {
  return capabilityVocabulary().capabilities.find((c) => c.id === id)?.kind ?? null;
}

/** A declared list: text only, each in the vocabulary, each once, in the given order. */
export function capabilityIds(value: unknown, label: string): string[] {
  if (!strings(value)) throw new ValidationError(`${label} metinlerden oluşan bir liste olmalı.`);
  const known = new Set(ids());
  const out: string[] = [];
  for (const raw of value) {
    const id = raw.trim();
    if (!known.has(id)) throw new ValidationError(`Bilinmeyen yetenek: ${id}. Sözlük: ${ids().join(', ')}.`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The registry's capabilities the vocabulary does not know: kept there (B3), used by no match. */
export function unknownCapabilities(list: string[]): string[] {
  const known = new Set(ids());
  return list.filter((c) => !known.has(c));
}

/**
 * How each capability is met: on one desk (employeeId), or in the office as a whole (none). The registry's current
 * list is the whole input (spec §4).
 */
export function coverage(integrations: Integration[], wanted: string[], employeeId?: string): CapabilityCoverage[] {
  const hasSession = employeeId !== undefined && integrations.some((i) => i.desks.some((d) => d.employeeId === employeeId));
  return wanted.map((id) => {
    // A stored id a later vocabulary dropped: no tools of its own; only the registry can still name it.
    const def = capabilityVocabulary().capabilities.find((c) => c.id === id) ?? { tools: [], builtin: [] };
    const providers = integrations.flatMap((i): CapabilityProvider[] => {
      const via: CapabilityProvider['via'] = [];
      if (def.tools.some((t) => t.startsWith(mcpToolPrefix(i.name)))) via.push('vocabulary');
      if (i.capabilities.includes(id)) via.push('registry');
      if (via.length === 0) return [];
      const desk = employeeId === undefined ? null : (i.desks.find((d) => d.employeeId === employeeId) ?? null);
      return [{ name: i.name, kind: i.kind, via, status: i.status, desk, openOn: i.desks.filter((d) => d.open).map((d) => d.name) }];
    });
    const byHand = providers.some((p) => BY_HAND.has(p.kind) && p.status !== 'closed');
    let status: CoverageStatus;
    if (employeeId === undefined) {
      if (def.builtin.length > 0 || providers.some((p) => p.openOn.length > 0)) status = 'open';
      else if (byHand) status = 'manual';
      else status = providers.length > 0 ? 'shut' : 'missing';
    } else if (def.builtin.length > 0 || providers.some((p) => p.desk?.open)) status = 'open';
    else if (byHand) status = 'manual';
    else if (providers.some((p) => p.desk !== null)) status = 'shut';
    else if (!hasSession && providers.some((p) => p.openOn.length > 0)) status = 'unseen';
    else status = 'missing';
    return { id, status, builtin: def.builtin, providers };
  });
}

function shutReason(d: IntegrationDesk): string {
  if (d.closedBy === 'registry') return 'kayıtta kapalı';
  if (d.closedBy === 'desk') return 'oturumda aracı yok (masa ayarı ya da rolün kapatması)';
  return INTEGRATION_STATUS_LABELS[d.status];
}

function providerText(p: CapabilityProvider, onDesk: boolean): string {
  if (BY_HAND.has(p.kind) && p.status !== 'closed') return `elle kayıtlı (${INTEGRATION_KIND_LABELS[p.kind]}), oturumlarda görünmez`;
  const elsewhere = p.openOn.length ? `açık: ${p.openOn.join(', ')}` : '';
  if (onDesk && p.desk) return p.desk.open ? 'bu masada açık' : `${shutReason(p.desk)}${elsewhere ? ` (${elsewhere})` : ''}`;
  return elsewhere || (onDesk ? `hiçbir masada açık değil (${INTEGRATION_STATUS_LABELS[p.status]})` : INTEGRATION_STATUS_LABELS[p.status]);
}

/** One line per capability: what it is, how it is met, and by which connectors (on the desk when `onDesk`). */
export function coverageLines(list: CapabilityCoverage[], onDesk: boolean): string[] {
  return list.map((c) => {
    const def = capabilityVocabulary().capabilities.find((x) => x.id === c.id);
    const parts = [
      ...(c.builtin.length ? [`yerleşik: ${c.builtin.join(', ')}`] : []),
      ...c.providers.map((p) => `${p.name}: ${providerText(p, onDesk)}`),
    ];
    const what = def ? `${def.title}${def.company ? ' (şirketin)' : ''}${def.outward ? ' (dışa dönük)' : ''}` : 'sözlükte yok';
    return `• ${c.id} — ${what} [${COVERAGE_STATUS_LABELS[c.status]}] ${parts.length ? parts.join('; ') : 'sağlayan bağlantı yok'}`;
  });
}

/** The short form a tool's reply carries: each capability and its status; what to do when one is not open. */
export function coverageBrief(list: CapabilityCoverage[], lead: string, anyway = ''): string {
  const short = list.map((c) => `${c.id} [${COVERAGE_STATUS_LABELS[c.status]}]`).join(', ');
  const lacking = list.some((c) => c.status === 'shut' || c.status === 'missing');
  const hint = lacking ? `${anyway ? `${anyway}; açık` : 'Açık'} olmayanlar için sahibinden yetki iste (propose). ` : '';
  return `${lead}: ${short}. ${hint}Ayrıntı: capabilitiesRead.`;
}

/**
 * What a tool is, by its name (spec §2, review round 1). The vocabulary is an allow-list: a connector's tool is
 * classified only if a capability — the product's or the company's active one — names it; any other is unclassified
 * and counts as outward — no capability of a role opens it, and B9's gate closes it unless the vocabulary or the owner
 * says otherwise. Claude Code's own tools are B9's other layers' business (shell, browser, files); the office's own are
 * not connectors.
 */
export type ToolClass = { kind: 'office' } | { kind: 'builtin' } | { kind: 'classified'; capability: string; outward: boolean } | { kind: 'unclassified'; outward: true };

export function toolClass(name: string): ToolClass {
  if (name.startsWith(mcpToolPrefix('office'))) return { kind: 'office' };
  if (!name.startsWith('mcp__')) return { kind: 'builtin' };
  const c = current().byTool.get(name);
  return c ? { kind: 'classified', capability: c.id, outward: c.outward } : { kind: 'unclassified', outward: true };
}

/**
 * Per connector, its tools in the current desks' latest sessions that no capability names: by name where the sessions
 * carry names, else a lower bound from the count. A desk whose session has none of its tools adds nothing; the office's
 * own server is never listed. Most first.
 */
export function unclassifiedTools(integrations: Integration[]): UnclassifiedTools[] {
  const out: UnclassifiedTools[] = [];
  for (const i of integrations) {
    if (i.kind === 'office') continue;
    const desks = i.desks.filter((d) => (d.tools ?? 0) > 0);
    if (desks.length === 0) continue;
    const named = desks.every((d) => d.toolNames !== null);
    const names = [...new Set(desks.flatMap((d) => d.toolNames ?? []))].sort();
    const unclassified = names.filter((n) => toolClass(n).kind === 'unclassified');
    const known = capabilityVocabulary().capabilities.flatMap((c) => c.tools).filter((t) => t.startsWith(mcpToolPrefix(i.name))).length;
    const tools = named ? names.length : Math.max(...desks.map((d) => d.tools ?? 0));
    const atLeast = named ? unclassified.length : Math.max(unclassified.length, tools - known);
    if (atLeast === 0) continue;
    out.push({ server: i.name, kind: i.kind, tools, unclassified: named ? unclassified : null, atLeast });
  }
  return out.sort((a, b) => b.atLeast - a.atLeast || a.server.localeCompare(b.server, 'tr'));
}

/**
 * The MCP server names the vocabulary's connectors go by — each classified tool's (mcp__<server>__…), each connector
 * known by name only, as its tools carry it — and the office's own: a project's .mcp.json may define none of them
 * (hardening round 2: the sessions' disabledMcpjsonServers), or its server would be taken for the connector.
 */
export function connectorServers(): string[] {
  const v = capabilityVocabulary();
  const servers = new Set(['office']);
  for (const tool of v.capabilities.flatMap((c) => c.tools)) {
    const cut = tool.indexOf('__', 5);
    if (tool.startsWith('mcp__') && cut > 5) servers.add(tool.slice(5, cut));
  }
  for (const k of v.knownConnectors) servers.add(mcpToolPrefix(k.name).slice(5, -2));
  return [...servers];
}

/** A connector's tool prefix the vocabulary knows: by a classified tool of it, or by its name only (knownConnectors). */
export function knownServer(prefix: string): boolean {
  const v = capabilityVocabulary();
  return v.capabilities.some((c) => c.tools.some((t) => t.startsWith(prefix))) || v.knownConnectors.some((k) => mcpToolPrefix(k.name) === prefix);
}

/** capabilitiesRead's line on the connectors known by name only. */
export function knownConnectorLines(): string[] {
  const names = capabilityVocabulary().knownConnectors.map((k) => k.name);
  return names.length ? ['', `## Adıyla bilinen bağlayıcılar — araçları sözlükte yok, hepsi dışa dönük sayılır: ${names.join(', ')}`] : [];
}

/** The section capabilitiesRead ends with: each connector's unclassified tools (the first six by name). */
export function unclassifiedLines(integrations: Integration[]): string[] {
  const reported = integrations.some((i) => i.kind !== 'office' && i.desks.some((d) => (d.tools ?? 0) > 0));
  if (!reported) return ['', '## Sınıflandırılmamış bağlayıcı araçları: henüz hiçbir oturum araç bildirmedi.'];
  const list = unclassifiedTools(integrations);
  if (list.length === 0) return ['', '## Sınıflandırılmamış bağlayıcı araçları: yok.'];
  const shown = (u: UnclassifiedTools) => {
    const short = u.unclassified!.map((t) => t.slice(mcpToolPrefix(u.server).length));
    return `${short.slice(0, 6).join(', ')}${short.length > 6 ? `, … +${short.length - 6}` : ''}`;
  };
  return [
    '',
    '## Sınıflandırılmamış bağlayıcı araçları — sözlük bir izin listesidir: bunlar hiçbir yeteneğe ait değil, hiçbir rolde açılmaz; B9 kapısı onları dışa dönük sayar.',
    ...list.map((u) => (u.unclassified ? `• ${u.server}: ${u.atLeast} (${shown(u)})` : `• ${u.server}: en az ${u.atLeast} (araç adları eski bir oturumdan; sayı = oturumdaki araç − sözlükteki)`)),
  ];
}
