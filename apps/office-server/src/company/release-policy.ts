import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ReleasePolicy, StoredEvent } from '@cc/shared';
import { deskDir, RELEASE_POLICY_FILE, writeReleasePolicyFile } from '../desk.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';

/**
 * The owner's release policy on every desk: with `office`, merging, deploying, migrating and server work go ahead
 * without asking the owner — whatever a role card or a method says — and the block says so where the sessions read
 * it, as the special contacts do (special-contacts.ts). With `owner` (the default) nothing is written: the role cards'
 * and methods' "ask the owner" rules stand as before.
 */

export function releasePolicyBlock(policy: ReleasePolicy): string {
  if (policy !== 'office') return '';
  return [
    '## Canlıya alma ve birleştirme',
    '',
    'Sahibi anayasada bunu ofise bıraktı: birleştirme, canlıya alma, veritabanı göçü ve sunucu işlerini sahibine sormadan yap. Rol kartın, yöntem ya da görev metni "sahibinin onayıyla" dese de bu kural geçerli; approvalRequest açma, bekleme.',
    '',
    'Yine ölçülü ol: testler geçmeden birleştirme, yedek ve geri alma yolu olmadan göç ya da canlıya alma yapma; her adımı kanıtıyla (komut, çıktı, adres) teslimde yaz. Ödeme ve silme bu kuralın dışındadır, onlar yine sahibine gider.',
    '',
  ].join('\n');
}

/** Topics after which the desks may be due again: the constitution, and a hire (before its desk's first session). */
const DUE = new Set(['budget.changed', 'employee.hired']);

export interface ReleasePolicyDesksDeps {
  dataDir: string;
  roster: Roster;
  events: EventStore;
  policy: () => ReleasePolicy;
}

/** Keeps every desk's release block current; writes a desk only when its block changed. */
export class ReleasePolicyDesks {
  readonly #d: ReleasePolicyDesksDeps;
  readonly #written = new Map<string, string>();

  constructor(d: ReleasePolicyDesksDeps) {
    this.#d = d;
    d.events.subscribe((e: StoredEvent) => {
      if (DUE.has(e.event.type)) this.refresh();
    });
  }

  refresh(): void {
    const block = releasePolicyBlock(this.#d.policy());
    for (const e of this.#d.roster.list()) {
      if (e.lifecycle === 'archived') continue;
      if (this.#written.get(e.slug) === block) continue;
      // Nothing to show where nothing was shown: the desk stays as it is.
      if (block || existsSync(join(deskDir(this.#d.dataDir, e.slug), RELEASE_POLICY_FILE))) writeReleasePolicyFile(this.#d.dataDir, e.slug, block);
      this.#written.set(e.slug, block);
    }
  }
}
