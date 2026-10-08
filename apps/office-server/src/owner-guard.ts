import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { OwnerRequestMark } from '@cc/shared';
import { ForbiddenError } from './errors.ts';
import type { EventStore } from './event-store.ts';

export const OWNER_NONCE_HEADER = 'x-owner-nonce';
/** How long a nonce the page fetched stays good; the page fetches a new one before then. */
export const OWNER_NONCE_TTL_MS = 60 * 60_000;
/** Nonces kept at once (tabs, refreshes); the oldest goes first. */
const MAX_NONCES = 50;

/**
 * The owner's endpoints (every /api/ request that changes something) answer only the office page: an allowed Origin
 * (checkRequest already refuses a foreign one) and a nonce the page fetched with a same-origin fetch. A try that does
 * not come the page's way is marked in the event log. This keeps naive or accidental calls out and leaves a trace; it
 * is not a boundary against a process of the same user, which can forge every header (see the task's document).
 */
export class OwnerGuard {
  readonly #events: EventStore;
  readonly #now: () => number;
  readonly #ttlMs: number;
  /** nonce → when it expires */
  readonly #nonces = new Map<string, number>();

  constructor(o: { events: EventStore; now?: () => number; ttlMs?: number }) {
    this.#events = o.events;
    this.#now = o.now ?? Date.now;
    this.#ttlMs = o.ttlMs ?? OWNER_NONCE_TTL_MS;
  }

  /** GET /api/owner/nonce: only for the page's own fetch, which the browser marks Sec-Fetch-Site: same-origin. */
  issue(req: IncomingMessage, path: string): { nonce: string; expiresAt: number } {
    if (req.headers['sec-fetch-site'] !== 'same-origin') {
      this.#flag(req, path, 'owner-endpoint, no fetch metadata', 'rejected');
      throw new ForbiddenError('Bu anahtar yalnız ofis sayfasının kendi isteğine verilir.', 'owner_fetch');
    }
    const now = this.#now();
    for (const [nonce, expiresAt] of this.#nonces) if (expiresAt <= now) this.#nonces.delete(nonce);
    while (this.#nonces.size >= MAX_NONCES) this.#nonces.delete(this.#nonces.keys().next().value!);
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = now + this.#ttlMs;
    this.#nonces.set(nonce, expiresAt);
    return { nonce, expiresAt };
  }

  /** Every owner request that changes something: Origin, then a live nonce; let through without fetch metadata, marked. */
  check(req: IncomingMessage, path: string): void {
    if (req.headers.origin === undefined) {
      this.#flag(req, path, 'owner-endpoint, origin-less', 'rejected');
      throw new ForbiddenError('Bu işlem yalnız ofis sayfasından yapılabilir (Origin başlığı yok).', 'owner_origin');
    }
    const nonce = req.headers[OWNER_NONCE_HEADER];
    const expiresAt = typeof nonce === 'string' ? this.#nonces.get(nonce) : undefined;
    if (expiresAt === undefined || expiresAt <= this.#now()) {
      this.#flag(req, path, 'owner-endpoint, nonce-less', 'rejected');
      throw new ForbiddenError('Sayfanın anahtarı yok ya da süresi geçmiş; sayfayı yenile.', 'owner_nonce');
    }
    if (req.headers['sec-fetch-site'] === undefined) this.#flag(req, path, 'owner-endpoint, no fetch metadata', 'accepted');
  }

  #flag(req: IncomingMessage, path: string, mark: OwnerRequestMark, outcome: 'rejected' | 'accepted'): void {
    const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 200);
    this.#events.append(null, { type: 'owner.request.flagged', mark, outcome, method: req.method ?? '', path, userAgent });
  }
}
