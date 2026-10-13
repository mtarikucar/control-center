import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isOutwardPolicyKind, type Employee, type StoredEvent } from '@cc/shared';
import { deskDir, SPECIAL_CONTACTS_FILE, writeSpecialContactsFile } from '../desk.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import { capabilityKind } from './capabilities.ts';

/**
 * The owner's special contacts where the senders read them (final review I4.2): the rule "ask the owner before a call
 * to or about one of them" holds with the gate off too, and the gate itself matches only what a call's input writes —
 * so whoever may send, publish, call or invite sees the list on their desk, as the department block reaches every desk
 * (desk.ts). An empty list writes nothing.
 */

/** Whether someone's declared capabilities send, publish, call or invite (the outward policy's kinds). */
export function sendsOutward(e: Pick<Employee, 'capabilities'>): boolean {
  return (e.capabilities ?? []).some((id) => {
    const kind = capabilityKind(id);
    return kind !== null && isOutwardPolicyKind(kind);
  });
}

/** The desk's block: the rule and the list, each contact a code span (Claude Code takes `@…` outside one for a file to import). */
export function specialContactsBlock(contacts: readonly string[]): string {
  const shown = contacts.map((c) => `- \`${c.replace(/\s+/g, ' ').replaceAll('`', "'")}\``);
  return [
    '## Özel kişiler',
    '',
    'Sahibi bu kişileri özel tuttu: onlara giden ya da onları anan bir gönderimi, yayını, aramayı ya da daveti yapmadan önce approvalRequest ile sahibine sor (aracın adı ve yapacağın çağrının girdisi) — kapı açık da olsa kapalı da.',
    '',
    'Kapı listedekileri (adres, telefon, ad, kişinin aday ya da konuşma kimliği) yalnız çağrının kendi girdisinde arar. Olağan bir yanıtın alıcılarını girdiye yaz: kapı açıkken bir taslağı kimliğiyle göndermek ya da herkese yanıtlamak tutulur ("alıcılar girdide yok"). Kimlikle yanıtlarken kime gittiğine kendin bak.',
    '',
    ...shown,
    '',
  ].join('\n');
}

/** Topics after which a desk's block may be due again: the constitution, someone's role card or hiring, a company capability's kind. */
const DUE = new Set(['budget.changed', 'role.changed', 'capability.changed']);

export interface SpecialContactsDesksDeps {
  dataDir: string;
  roster: Roster;
  events: EventStore;
  /** The constitution's list, as the owner keeps it. */
  contacts: () => readonly string[];
}

/** Keeps every desk's special-contacts block current; writes a desk only when its block changed. */
export class SpecialContactsDesks {
  readonly #d: SpecialContactsDesksDeps;
  /** What each desk was last given ('' : nothing to show). */
  readonly #written = new Map<string, string>();

  constructor(d: SpecialContactsDesksDeps) {
    this.#d = d;
    d.events.subscribe((e: StoredEvent) => {
      if (DUE.has(e.event.type)) this.refresh();
    });
  }

  refresh(): void {
    const contacts = this.#d.contacts();
    const block = contacts.length ? specialContactsBlock(contacts) : '';
    for (const e of this.#d.roster.list()) {
      const text = block && sendsOutward(e) ? block : '';
      if (this.#written.get(e.slug) === text) continue;
      // Nothing to show where nothing was shown: the desk stays as it is (an office without the list, as before it).
      if (text || existsSync(join(deskDir(this.#d.dataDir, e.slug), SPECIAL_CONTACTS_FILE))) writeSpecialContactsFile(this.#d.dataDir, e.slug, text);
      this.#written.set(e.slug, text);
    }
  }
}
