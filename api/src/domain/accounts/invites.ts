import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The owner types a code into an env file and a player into a form; neither
 * should fail on a capital letter or a stray space, so both sides are compared
 * trimmed and case-folded.
 */
export function normalizeInviteCode(code: string): string {
  return code.trim().toLowerCase();
}

/** SHA-256 (hex) of the normalised code: what an account row keeps as the audit trail of which code admitted it. */
export function hashInviteCode(code: string): string {
  return digest(code).toString("hex");
}

function digest(code: string): Buffer {
  return createHash("sha256").update(normalizeInviteCode(code), "utf8").digest();
}

/** The configured codes, kept only as digests so the list itself never holds a code in memory for longer than start-up. */
export class InviteList {
  private readonly digests: readonly Buffer[];

  constructor(codes: readonly string[]) {
    this.digests = codes.map(digest);
  }

  /** True when registration is closed because no code is configured. */
  get isEmpty(): boolean {
    return this.digests.length === 0;
  }

  /**
   * Compares the candidate's digest with every configured digest, each in
   * constant time and always all of them, so neither the response time nor
   * its variance tells which code matched or how many exist.
   */
  accepts(candidate: string): boolean {
    const probe = digest(candidate);
    let matches = 0;
    for (const known of this.digests) matches += timingSafeEqual(probe, known) ? 1 : 0;
    return matches > 0;
  }
}

/** The cap is a row count: with `count` accounts, a registration is refused once `count` has reached `cap`. */
export function isCapReached(count: number, cap: number): boolean {
  return count >= cap;
}
