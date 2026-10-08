import type { Employee, StoredEvent } from '@cc/shared';
import type { NoticeStore } from './company/store.ts';
import type { EventStore } from './event-store.ts';

const HOUR = 60 * 60_000;

export interface OwnerFlagsDeps {
  events: EventStore;
  notices: NoticeStore;
  coordinator: () => Employee | null;
  now?: () => number;
  windowMs?: number;
  /** Runs work after the current event has been handled (default setImmediate): no row is written inside an event. */
  defer?: (fn: () => void) => void;
}

/** One kind of request: the same method, path (ids folded) and mark. */
const keyOf = (method: string, path: string, mark: string) => `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')} (${mark})`;

/**
 * B9a (design §4 madde 2): the owner guard marks every request to an owner endpoint that did not come the page's way;
 * the coordinator hears of it — at most once an hour for each kind of request, with how many came since the last note.
 * The events stay one per request (the trace).
 */
export class OwnerFlags {
  readonly #d: OwnerFlagsDeps;
  readonly #windows = new Map<string, { since: number; count: number }>();

  constructor(d: OwnerFlagsDeps) {
    this.#d = d;
    d.events.subscribe((e) => this.#onEvent(e));
  }

  #onEvent(e: StoredEvent): void {
    const ev = e.event;
    if (ev.type !== 'owner.request.flagged') return;
    const key = keyOf(ev.method, ev.path, ev.mark);
    const now = (this.#d.now ?? Date.now)();
    const window = this.#windows.get(key);
    if (window && now - window.since < (this.#d.windowMs ?? HOUR)) {
      window.count += 1;
      return;
    }
    const since = window ? window.count - 1 : 0;
    this.#windows.set(key, { since: now, count: 1 });
    const outcome = ev.outcome === 'rejected' ? 'reddedildi' : 'kabul edildi ama tarayıcıdan gelmedi';
    const text =
      `Sahibi uçlarına sayfadan gelmeyen bir istek: ${key} — ${outcome}${ev.userAgent ? ` (istemci: ${ev.userAgent})` : ''}.` +
      `${since > 0 ? ` Önceki nottan beri aynı türden ${since} istek daha işaretlendi.` : ''}` +
      ' Bir çalışan sahibi adına iş yapmaya çalışıyor olabilir: kim, neden, bak; gerekirse sahibine bildir. Aynı tür için saatte en çok bir not gelir; her istek olay kaydında.';
    (this.#d.defer ?? setImmediate)(() => {
      const coordinator = this.#d.coordinator();
      if (coordinator) this.#d.notices.add(coordinator.id, 'owner.flagged', text);
    });
  }
}
