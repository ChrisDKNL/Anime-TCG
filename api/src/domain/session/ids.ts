import { createHash, createHmac, randomBytes } from "node:crypto";

const ID_BYTES = 32;
/** 32 bytes in base64url is 43 characters with no padding. */
const WELL_FORMED_ID = /^[A-Za-z0-9_-]{43}$/;

/** The value that goes in the cookie. Only ever generated here, never taken from a client. */
export function newSessionId(): string {
  return randomBytes(ID_BYTES).toString("base64url");
}

/** Cheap pre-check so garbage cookies never reach the database. */
export function isWellFormedSessionId(value: string): boolean {
  return WELL_FORMED_ID.test(value);
}

/** What is stored: a keyed hash, so a database read does not yield usable cookies. */
export function hashSessionId(secret: string, cookieValue: string): string {
  return createHmac("sha256", secret).update(cookieValue).digest("hex");
}

export function hashUserAgent(userAgent: string | undefined): string {
  return createHash("sha256")
    .update(userAgent ?? "")
    .digest("hex");
}
