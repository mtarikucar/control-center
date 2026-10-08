import { INTEGRATION_STATUS_LABELS, type CapabilityCoverage, type CapabilityProvider, type StoredEvent, type Task } from '@cc/shared';
import { mcpToolPrefix } from '../claude/normalize.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import { capabilityVocabulary, coverage, toolClass } from './capabilities.ts';
import type { Company } from './company.ts';
import type { IntegrationRegistry } from './integrations.ts';
import type { ProposalStore } from './proposal-store.ts';
import type { TaskStore } from './store.ts';

/**
 * The capability precheck (B8; spec 2026-10-08-capability-precheck-design), behind a constitution switch that is off
 * by default: a task whose required capability its assignee's desk lacks (shut or missing) is held before it is handed
 * out, and goes back to the queue once the capability is there; the owner gets one need proposal per capability; a
 * connector tool's error raises the same proposal once.
 */

/** A note that starts so marks a task the precheck held: only the precheck lifts it. */
export const HOLD_NOTE = 'Yetenek ön-kontrolü:';
const NEED = 'Yetki gerekiyor:';
/** Only these hold a task: unseen (no session yet), manual (by hand, unverifiable) and open do not. */
const LACKING = new Set<CapabilityCoverage['status']>(['shut', 'missing']);
const STATUS_TR: Record<CapabilityCoverage['status'], string> = { open: 'açık', manual: 'elle kayıtlı', shut: 'kapalı', unseen: 'bu masada görülmedi', missing: 'yok' };

export interface PrecheckDeps {
  company: Company;
  tasks: TaskStore;
  roster: Roster;
  integrations: IntegrationRegistry;
  proposals: ProposalStore;
  events: EventStore;
  /** The constitution's switch (capabilityPrecheckEnabled). */
  enabled: () => boolean;
  /** Runs work after the current event has been handled (default setImmediate): no event is written inside another. */
  defer?: (fn: () => void) => void;
}

export class CapabilityPrecheck {
  readonly #d: PrecheckDeps;
  /** A connector tool call's name by its id, from tool.started until its tool.finished. */
  readonly #running = new Map<string, string>();

  constructor(d: PrecheckDeps) {
    this.#d = d;
    d.events.subscribe((e) => this.#onEvent(e));
  }

  /** Before a task is handed out: held (blocked, noted, the owner asked) when its assignee's desk lacks a capability it requires. */
  hold(task: Task): boolean {
    if (!this.#d.enabled() || !task.requires?.length) return false;
    const lacking = this.#lacking(task);
    if (lacking.length === 0) return false;
    const who = this.#d.roster.get(task.assignee);
    const why = `${who.name} masasında açık değil: ${lacking.map((c) => `${c.id} [${STATUS_TR[c.status]}]`).join(', ')}. Yetenek açılınca görev kendiliğinden sıraya döner.`;
    const asked = lacking.map((c) => this.#need(c, task.assignee, `“${task.title}” görevi (${who.name}) ${this.#named(c.id)} istiyor; ${who.name} masasında açık değil.`)).some(Boolean);
    this.#d.company.holdForCapabilities(task.id, `${HOLD_NOTE} ${why}`, `“${task.title}” görevi (${who.name}) bloklandı: ${why} ${asked ? 'Sahibine yetki önerisi açıldı.' : 'Sahibine bu yetenek için öneri zaten gitti.'}`);
    return true;
  }

  /** Every task the precheck held whose capabilities are now there goes back to the queue; switched off, every one does. */
  release(): void {
    const on = this.#d.enabled();
    for (const task of this.#d.tasks.list({ statuses: ['blocked'], limit: 100_000 })) {
      if (!task.note?.startsWith(HOLD_NOTE)) continue;
      if (on && this.#lacking(task).length > 0) continue;
      this.#d.company.releaseCapabilityHold(task.id);
    }
  }

  #lacking(task: Task): CapabilityCoverage[] {
    return coverage(this.#d.integrations.list(), task.requires ?? [], task.assignee).filter((c) => LACKING.has(c.status));
  }

  #named(id: string): string {
    const def = capabilityVocabulary().capabilities.find((c) => c.id === id);
    return def ? `${id} (${def.title})` : id;
  }

  /**
   * One need proposal for the capability, to the owner (opened by the coordinator, whose own proposal goes to them):
   * not while one waits, nor after the owner declined one; again after an accepted one. True when one was opened.
   */
  #need(c: CapabilityCoverage, employeeId: string, cause: string): boolean {
    const key = `${NEED} ${c.id} `;
    const asked = this.#d.proposals.list({ statuses: ['open', 'owner', 'declined'], limit: 100_000 }).some((p) => p.kind === 'need' && p.title.startsWith(key));
    if (asked) return false;
    const who = this.#d.roster.get(employeeId).name;
    const lines = c.providers.map((p) => `• ${p.name}: ${this.#state(p, who)}`);
    const registry = new Map(this.#d.integrations.list().map((i) => [i.name, i.authNeeded]));
    const notes = c.providers.flatMap((p) => (registry.get(p.name) ? [`Kayıttaki yetki notu (${p.name}): ${registry.get(p.name)}`] : []));
    const text = [
      cause,
      c.providers.length === 0 ? 'Bu yeteneği sağlayan bir bağlantı yok: bir bağlayıcı bağla ya da koordinatör integrationRegister ile kaydetsin.' : 'Sağlayan bağlantılar:',
      ...lines,
      ...notes,
      'Görev bloklu kalır, yetenek açılınca kendiliğinden sıraya döner (yetenek ön-kontrolü, anayasada açık).',
    ].join('\n');
    const by = this.#d.company.coordinator()?.id ?? employeeId;
    this.#d.company.openProposal(by, { kind: 'need', title: `${NEED} ${this.#named(c.id)}`, text });
    return true;
  }

  /** A provider's state on the desk, and what the owner can do about it. */
  #state(p: CapabilityProvider, who: string): string {
    const elsewhere = p.openOn.filter((n) => n !== who);
    const also = elsewhere.length ? ` Başka masada açık: ${elsewhere.join(', ')}.` : '';
    if (!p.desk) return elsewhere.length ? `${who} masasında yok; açık: ${elsewhere.join(', ')}` : `hiçbir masada açık değil (${INTEGRATION_STATUS_LABELS[p.status]})`;
    if (p.desk.open) return 'bu masada açık';
    if (p.desk.closedBy === 'registry') return `kayıtta kapalı — koordinatör integrationRegister ile kapattı; bilinçliyse görevi başka birine ver.${also}`;
    if (p.desk.closedBy === 'desk') return `masa ayarı: oturumda aracı yok — ${who} masasının .claude/settings.json dosyası bu sunucuyu kapatıyor; bilinçliyse görevi başka birine ver.${also}`;
    if (p.desk.status === 'needs_auth') return `yetki bekliyor — claude.ai bağlayıcı ayarlarından yetkilendir.${also}`;
    if (p.desk.status === 'failed') return `hata — bağlantıyı yeniden kur.${also}`;
    return `${INTEGRATION_STATUS_LABELS[p.desk.status]} — bir sonraki oturumda yeniden bakılır.${also}`;
  }

  /** A connector tool's error: its capability's need, once (spec §4). Deferred: no event is written inside another. */
  #onEvent(e: StoredEvent): void {
    const ev = e.event;
    if (ev.type === 'tool.started') {
      if (ev.name.startsWith('mcp__')) this.#running.set(ev.toolUseId, ev.name);
      return;
    }
    if (ev.type !== 'tool.finished') return;
    const name = this.#running.get(ev.toolUseId);
    this.#running.delete(ev.toolUseId);
    if (!name || !ev.isError || !e.employeeId || !this.#d.enabled()) return;
    const kind = toolClass(name);
    if (kind.kind !== 'classified') return;
    const employeeId = e.employeeId;
    const output = ev.output.replace(/\s+/g, ' ').trim().slice(0, 200);
    const failing = name.slice(0, name.lastIndexOf('__') + 2);
    (this.#d.defer ?? setImmediate)(() => {
      const who = this.#d.roster.get(employeeId);
      const [c] = coverage(this.#d.integrations.list(), [kind.capability], employeeId);
      // The desk still has the capability through something else — built-in tools, or another connector open there:
      // this connector's error is not a missing capability (K4: a closed browser page while WebFetch works).
      if (c!.builtin.length > 0 || c!.providers.some((p) => p.desk?.open && mcpToolPrefix(p.name) !== failing)) return;
      this.#need(c!, employeeId, `${who.name} masasında ${name.slice(name.lastIndexOf('__') + 2)} aracı hata verdi: “${output}”. Araç ${this.#named(kind.capability)} yeteneğine ait.`);
    });
  }
}
