import { randomUUID } from 'node:crypto';
import type { Onboarding, OnboardingRound } from '@cc/shared';
import type { Db } from '../db.ts';

interface OnboardingRow {
  id: string;
  description: string;
  status: string;
  started_by: string;
  started_at: number;
  finished_at: number | null;
}

/** The onboardings and the rounds of questions each asked (spec 2026-10-08-onboarding-design §4). */
export class OnboardingStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(description: string, by: string): Onboarding {
    const id = randomUUID();
    this.#db.prepare("INSERT INTO onboarding (id, description, status, started_by, started_at, finished_at) VALUES (?, ?, 'active', ?, ?, NULL)").run(id, description, by, this.#now());
    return this.#get(id);
  }

  active(): Onboarding | null {
    const row = this.#db.prepare("SELECT * FROM onboarding WHERE status = 'active' ORDER BY started_at DESC, rowid DESC LIMIT 1").get() as unknown as OnboardingRow | undefined;
    return row ? this.#from(row) : null;
  }

  /** The running one, else the last one. */
  latest(): Onboarding | null {
    const row = this.#db.prepare("SELECT * FROM onboarding ORDER BY status = 'active' DESC, started_at DESC, rowid DESC LIMIT 1").get() as unknown as OnboardingRow | undefined;
    return row ? this.#from(row) : null;
  }

  /** A block of questions asked in one message, with the seq of the event that announced it. */
  addRound(id: string, round: OnboardingRound, seq: number): void {
    this.#db.prepare('INSERT INTO onboarding_rounds (onboarding_id, round, questions, asked_at, seq) VALUES (?, ?, ?, ?, ?)').run(id, round.round, JSON.stringify(round.questions), round.askedAt, seq);
  }

  finish(id: string): Onboarding {
    this.#db.prepare("UPDATE onboarding SET status = 'done', finished_at = ? WHERE id = ?").run(this.#now(), id);
    return this.#get(id);
  }

  #get(id: string): Onboarding {
    return this.#from(this.#db.prepare('SELECT * FROM onboarding WHERE id = ?').get(id) as unknown as OnboardingRow);
  }

  #rounds(o: OnboardingRow): OnboardingRound[] {
    const rows = this.#db.prepare('SELECT round, questions, asked_at, seq FROM onboarding_rounds WHERE onboarding_id = ? ORDER BY round').all(o.id) as unknown as Array<{ round: number; questions: string; asked_at: number; seq: number }>;
    return rows.map((r) => ({ round: r.round, questions: JSON.parse(r.questions) as string[], askedAt: r.asked_at, replied: this.#repliedAfter(o, r.seq) }));
  }

  /**
   * The owner replied after the event `seq`: a chat message of theirs to the one running the onboarding, or their
   * answers on screen to this onboarding. System messages and the owner's words to anyone else do not count.
   */
  #repliedAfter(o: OnboardingRow, seq: number): boolean {
    return (
      this.#db
        .prepare(
          `SELECT 1 FROM events WHERE seq > ? AND (
             (type = 'message.user' AND employee_id = ? AND json_extract(payload, '$.source') = 'owner')
             OR (type = 'onboarding.changed' AND json_extract(payload, '$.change') = 'answered' AND json_extract(payload, '$.onboarding.id') = ?)
           ) LIMIT 1`,
        )
        .get(seq, o.started_by, o.id) !== undefined
    );
  }

  #from(r: OnboardingRow): Onboarding {
    return {
      id: r.id, description: r.description, status: r.status as Onboarding['status'], startedBy: r.started_by, startedAt: r.started_at, finishedAt: r.finished_at,
      rounds: this.#rounds(r),
    };
  }
}
