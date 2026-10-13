import {
  CAPABILITY_KIND_LABELS, CAPABILITY_KINDS, CUSTOM_CAPABILITY_STATUS_LABELS, OWNER,
  type Capability, type CapabilityChange, type CapabilityKind, type CustomCapability, type Employee,
} from '@cc/shared';
import { mcpToolPrefix } from '../claude/normalize.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import { invalidateVocabulary, productToolOwner, productVocabulary, TOOL_NAME } from './capabilities.ts';
import type { CustomCapabilityStore } from './custom-capability-store.ts';
import type { NoticeStore } from './store.ts';
import { clean } from './text.ts';

/**
 * The company's own capabilities (spec 2026-10-13-capabilities-autonomy §4): an employee proposes, the coordinator
 * decides — the coordinator's own proposal is the owner's —, the owner adds, overrules and retires. The vocabulary is
 * the product's and the active ones (capabilities.ts); every change to an active one rebuilds it.
 */

const ID = /^[a-z]+\.[a-z]+$/;
const MAX_TOOLS = 30;
/** How strict a kind is at the gate: read passes, the policy's kinds may be the system's, pay and delete are always the owner's. */
const STRICTNESS: Record<CapabilityKind, number> = { read: 0, send: 1, calendar: 1, call: 1, publish: 1, pay: 2, delete: 2 };

export interface CustomCapabilitiesDeps {
  store: CustomCapabilityStore;
  roster: Roster;
  events: EventStore;
  notices: NoticeStore;
  coordinator: () => Employee | null;
  now?: () => number;
}

/** A company capability as the vocabulary carries it; `confirmed` when the owner decided it last (final review I1). */
export function asCapability(c: CustomCapability): Capability {
  return { id: c.id, title: c.title, summary: c.summary, kind: c.kind, outward: c.kind !== 'read', builtin: [], tools: c.tools, company: true, ...(c.decidedBy === OWNER ? { confirmed: true as const } : {}) };
}

/**
 * The coordinator keeps a proposal's kind or makes it stricter: read → any outward kind, any kind → pay or delete. Pay
 * and delete never move; loosening (an outward kind → read, or sideways among the policy's kinds) is the owner's. Read
 * kept as read passes here, but accepting it so is the owner's alone too (decide refuses it: amendment #10).
 */
export function coordinatorMayChange(from: CapabilityKind, to: CapabilityKind): boolean {
  if (from === to) return true;
  if (STRICTNESS[from] === 2) return false;
  return STRICTNESS[to] === 2 || from === 'read';
}

function kindOf(value: unknown): CapabilityKind {
  if (typeof value !== 'string' || !(CAPABILITY_KINDS as readonly string[]).includes(value)) {
    throw new ValidationError(`Tür (kind) şunlardan biri olmalı: ${CAPABILITY_KINDS.join(', ')}.`);
  }
  return value as CapabilityKind;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const OUTWARD_KINDS = CAPABILITY_KINDS.filter((k) => k !== 'read');

export class CustomCapabilities {
  readonly #d: CustomCapabilitiesDeps;
  readonly #now: () => number;

  constructor(d: CustomCapabilitiesDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  list(): CustomCapability[] {
    return this.#d.store.list();
  }

  active(): CustomCapability[] {
    return this.#d.store.list({ statuses: ['active'] });
  }

  get(id: string): CustomCapability {
    return this.#d.store.get(id);
  }

  /** An employee's proposal: the coordinator hears and decides it — or, the coordinator's own, the owner. */
  propose(by: string, input: Record<string, unknown>): CustomCapability {
    const who = this.#d.roster.get(by);
    const c = this.#d.store.put({ ...this.#checked(input), status: 'proposed', proposedBy: who.id, decidedBy: null, note: null, createdAt: this.#now(), decidedAt: null });
    this.#emit(who.id, 'proposed', c);
    const coordinator = this.#d.coordinator();
    if (coordinator && coordinator.id !== who.id) {
      // A read tool is open in every session and passes the gate, so the coordinator is told up front that read is not its to give.
      const hint = c.kind === 'read'
        ? 'Okuma (read) olarak yalnız sahibi kabul eder: capabilityDecide ile dışa dönük bir türe (kind) sıkılaştırarak kabul edebilir, reddedebilir (note yaz) ya da sahibine bırakabilirsin.'
        : 'capabilityDecide ile karara bağla: kabul ederken türü aynı bırakabilir ya da sıkılaştırabilirsin; reddederken note yaz.';
      this.#d.notices.add(
        coordinator.id,
        'capability.proposed',
        `${who.name} sözlüğe yeni bir yetenek önerdi: ${c.id} — ${c.title} (${CAPABILITY_KIND_LABELS[c.kind]}; araçlar: ${c.tools.join(', ')}). Gerekçe: ${c.summary} ${hint}`,
      );
    }
    return c;
  }

  /** The owner adds one from the Yetenekler tab: active at once. */
  ownerAdd(input: Record<string, unknown>): CustomCapability {
    const at = this.#now();
    const c = this.#d.store.put({ ...this.#checked(input), status: 'active', proposedBy: OWNER, decidedBy: OWNER, note: null, createdAt: at, decidedAt: at });
    this.#changed(null, 'activated', c);
    this.#tellCoordinator(`Sahibi sözlüğe ${c.id} yeteneğini ekledi (${CAPABILITY_KIND_LABELS[c.kind]}; araçlar: ${c.tools.join(', ')}). Gereken rollere editRoleCard capabilities ile ekle; araçları o kişilerin bir sonraki oturumunda açılır.`);
    return c;
  }

  /** The coordinator (anyone else's proposal) or the owner (any) accepts — with a kind — or rejects with a note. */
  decide(by: string, id: string, d: { accept: boolean; kind?: unknown; note?: unknown }): CustomCapability {
    const current = this.#d.store.get(id);
    if (current.status !== 'proposed') throw new ConflictError(`${id} karar beklemiyor (${CUSTOM_CAPABILITY_STATUS_LABELS[current.status]}).`);
    const owner = by === OWNER;
    if (!owner) {
      const who = this.#d.roster.get(by);
      if (who.kind !== 'coordinator') throw new ForbiddenError('Yetenek önerilerini koordinatör ya da sahibi karara bağlar.');
      // The doer is not the checker: the coordinator's own proposal waits for the owner.
      if (current.proposedBy === who.id) throw new ForbiddenError('Kendi önerini karara bağlayamazsın; sahibi Yetenekler sekmesinden karar verir.');
    }
    const note = clean(text(d.note), 'Not', 500, !d.accept) || null;
    // A rejection activates nothing: the row keeps the kind it was proposed with, whatever kind came with it.
    const kind = !d.accept || d.kind === undefined || d.kind === null || d.kind === '' ? current.kind : kindOf(d.kind);
    if (!owner && !coordinatorMayChange(current.kind, kind)) {
      throw new ForbiddenError(
        STRICTNESS[current.kind] === 2
          ? `${CAPABILITY_KIND_LABELS[current.kind]} türündeki bir yetenek başka bir türe yalnız sahibince çekilir.`
          : `Koordinatör türü yalnız sıkılaştırır (okuma → dışa dönük bir tür; herhangi bir tür → ödeme ya da silme); ${current.kind} → ${kind} sahibinin kararıdır.`,
      );
    }
    // A read tool is open in every session and passes the gate (also with it off): an outward tool wrongly proposed as read
    // would be wide open without the owner. Only a kind the coordinator tightened to, or the owner's own, lets a proposal in.
    if (!owner && d.accept && kind === 'read') {
      throw new ForbiddenError(
        `Bir aracı okuma (read) olarak sınıflandırmak sahibinin kararı; dışa dönük bir türle kabul edebilirsin (kind: ${OUTWARD_KINDS.join(', ')}) ya da öneriyi sahibine bırakabilirsin — sahibi Yetenekler sekmesinden karar verir.`,
      );
    }
    // The product's vocabulary may have grown, or another capability become active, since the proposal: ids and tools still stand once.
    if (d.accept) {
      this.#assertNotProducts(current.id);
      this.#assertFree(current.tools, current.id);
    }
    const decided = this.#d.store.update(id, { status: d.accept ? 'active' : 'rejected', kind, decidedBy: owner ? OWNER : by, note, decidedAt: this.#now() });
    if (d.accept) this.#changed(owner ? null : by, 'activated', decided);
    else this.#emit(owner ? null : by, 'rejected', decided);
    const decider = owner ? 'Sahibi' : 'Koordinatör';
    if (decided.proposedBy !== OWNER) {
      this.#d.notices.add(
        decided.proposedBy,
        'capability.decided',
        d.accept
          ? `${decider} önerdiğin ${decided.id} yeteneğini kabul etti (${CAPABILITY_KIND_LABELS[decided.kind]}). Kullanılması için rollere eklenmesi gerekir (koordinatör: editRoleCard capabilities); araçları o kişilerin bir sonraki oturumunda açılır.`
          : `${decider} önerdiğin ${decided.id} yeteneğini reddetti: ${note}`,
      );
    }
    if (owner && d.accept) {
      this.#tellCoordinator(`Sahibi ${decided.id} yeteneğini etkinleştirdi (${CAPABILITY_KIND_LABELS[decided.kind]}; araçlar: ${decided.tools.join(', ')}). Gereken rollere editRoleCard capabilities ile ekle.`, decided.proposedBy);
    }
    return decided;
  }

  /** The owner takes an active one back: its tools are unclassified again (the gate holds them, sessions close them). */
  retire(id: string, note?: unknown): CustomCapability {
    const current = this.#d.store.get(id);
    if (current.status !== 'active') throw new ConflictError(`${id} etkin değil (${CUSTOM_CAPABILITY_STATUS_LABELS[current.status]}).`);
    const why = clean(text(note), 'Not', 500, false);
    const retired = this.#d.store.update(id, { status: 'retired', decidedBy: OWNER, note: why || current.note, decidedAt: this.#now() });
    this.#changed(null, 'retired', retired);
    this.#tellCoordinator(`Sahibi ${id} yeteneğini geri aldı${why ? ` (${why})` : ''}: araçları yeniden sınıflandırılmamış sayılır — kapı tutar, oturumlar kapatır; rollerdeki ${id} artık hiçbir aracı açmaz.`);
    return retired;
  }

  /**
   * The owner takes over an active one the coordinator activated, its kind as it is (final review I1): until then the
   * gate asks the owner for its calls whatever the outward policy says — the coordinator alone never hands a tool to
   * the system. One the owner decided already stays as it is.
   */
  confirm(id: string): CustomCapability {
    const current = this.#d.store.get(id);
    if (current.status !== 'active') throw new ConflictError(`${id} etkin değil (${CUSTOM_CAPABILITY_STATUS_LABELS[current.status]}).`);
    if (current.decidedBy === OWNER) return current;
    const confirmed = this.#d.store.update(id, { decidedBy: OWNER, decidedAt: this.#now() });
    this.#changed(null, 'confirmed', confirmed);
    return confirmed;
  }

  /** The owner changes a proposed or active one's kind, any way (the coordinator gives a kind with decide). */
  setKind(id: string, kind: unknown): CustomCapability {
    const current = this.#d.store.get(id);
    if (current.status !== 'proposed' && current.status !== 'active') throw new ConflictError(`${id} ${CUSTOM_CAPABILITY_STATUS_LABELS[current.status]}; türü değiştirilemez.`);
    const next = kindOf(kind);
    if (next === current.kind) return current;
    if (current.status === 'proposed') {
      const changed = this.#d.store.update(id, { kind: next });
      this.#emit(null, 'kind', changed);
      return changed;
    }
    const changed = this.#d.store.update(id, { kind: next, decidedBy: OWNER, decidedAt: this.#now() });
    this.#changed(null, 'kind', changed);
    return changed;
  }

  #checked(input: Record<string, unknown>): Pick<CustomCapability, 'id' | 'title' | 'summary' | 'kind' | 'tools'> {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!ID.test(id)) throw new ValidationError(`Kimlik alan.eylem biçiminde olmalı (küçük harf, ör. sms.send): “${id}”.`);
    this.#assertNotProducts(id);
    const existing = this.#d.store.find(id);
    if (existing && (existing.status === 'proposed' || existing.status === 'active')) throw new ConflictError(`${id} zaten ${CUSTOM_CAPABILITY_STATUS_LABELS[existing.status]}.`);
    const title = clean(text(input.title), 'Başlık (title)', 80, true);
    const summary = clean(text(input.summary), 'Açıklama (summary)', 300, true);
    const kind = kindOf(input.kind);
    if (!Array.isArray(input.tools) || input.tools.length === 0 || input.tools.some((t) => typeof t !== 'string')) {
      throw new ValidationError('Araçlar (tools) en az bir bağlayıcı aracının tam adından oluşan bir liste olmalı (mcp__sunucu__araç).');
    }
    const tools = [...new Set((input.tools as string[]).map((t) => t.trim()))];
    if (tools.length > MAX_TOOLS) throw new ValidationError(`Bir yetenekte en çok ${MAX_TOOLS} araç olur.`);
    for (const tool of tools) {
      if (!TOOL_NAME.test(tool)) throw new ValidationError(`“${tool}” bir bağlayıcı aracı değil (mcp__sunucu__araç).`);
      if (tool.startsWith(mcpToolPrefix('office'))) throw new ValidationError(`“${tool}” ofisin kendi aracı; yetenek sözlüğüne girmez.`);
    }
    this.#assertFree(tools, id);
    return { id, title, summary, kind, tools };
  }

  /** The vocabulary finds a capability by id: a company one named like a product's would be shadowed by it while its tools map to the company's. */
  #assertNotProducts(id: string): void {
    if (productVocabulary().capabilities.some((c) => c.id === id)) throw new ValidationError(`${id} ürünle gelen bir yetenek; başka bir kimlik seç.`);
  }

  /**
   * A tool stands in one capability only: not in the product's (whatever kind is proposed — the product's entry wins
   * the tool, so the company's would name it for nothing), not in another active company one.
   */
  #assertFree(tools: string[], id: string): void {
    const active = this.active();
    for (const tool of tools) {
      const product = productToolOwner(tool);
      if (product) throw new ValidationError(`“${tool}” ürünle gelen ${product} yeteneğinde; bir araç yalnız bir yetenekte durur.`);
      const other = active.find((c) => c.id !== id && c.tools.includes(tool));
      if (other) throw new ConflictError(`“${tool}” şirketin ${other.id} yeteneğinde; bir araç yalnız bir yetenekte durur.`);
    }
  }

  #tellCoordinator(line: string, except?: string): void {
    const coordinator = this.#d.coordinator();
    if (coordinator && coordinator.id !== except) this.#d.notices.add(coordinator.id, 'capability.decided', line);
  }

  /** An active capability changed: the vocabulary is built again on its next read. */
  #changed(by: string | null, change: CapabilityChange, c: CustomCapability): void {
    invalidateVocabulary();
    this.#emit(by, change, c);
  }

  #emit(by: string | null, change: CapabilityChange, c: CustomCapability): void {
    this.#d.events.append(by, { type: 'capability.changed', change, capability: c });
  }
}

/** capabilitiesRead's section on the company's own: those waiting for a decision and those active (spec §4.2). */
export function customCapabilityLines(list: CustomCapability[], nameOf: (id: string) => string): string[] {
  const shown = list.filter((c) => c.status === 'proposed' || c.status === 'active');
  if (shown.length === 0) return [];
  return [
    '',
    '## Şirketin eklediği yetenekler — öneren çalışan; karar koordinatörün (kendi önerisi sahibinin); para ve silme türünü yalnız sahibi değiştirir',
    ...shown.map(
      (c) => `• ${c.id} — ${c.title} [${CUSTOM_CAPABILITY_STATUS_LABELS[c.status]}] tür: ${CAPABILITY_KIND_LABELS[c.kind]}; araçlar: ${c.tools.join(', ')}; öneren ${nameOf(c.proposedBy)}${c.decidedBy ? `, karar ${nameOf(c.decidedBy)}` : ''}`,
    ),
  ];
}
