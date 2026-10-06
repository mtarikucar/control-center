import { randomBytes } from 'node:crypto';

/** Bearer tokens for the office tools: one per running session, so a token from a past session stops working. */
export class TokenRegistry {
  readonly #byToken = new Map<string, string>();
  readonly #byEmployee = new Map<string, string>();

  issue(employeeId: string): string {
    this.revoke(employeeId);
    const token = randomBytes(24).toString('hex');
    this.#byToken.set(token, employeeId);
    this.#byEmployee.set(employeeId, token);
    return token;
  }

  resolve(token: string): string | null {
    return this.#byToken.get(token) ?? null;
  }

  revoke(employeeId: string): void {
    const token = this.#byEmployee.get(employeeId);
    if (token) this.#byToken.delete(token);
    this.#byEmployee.delete(employeeId);
  }
}
