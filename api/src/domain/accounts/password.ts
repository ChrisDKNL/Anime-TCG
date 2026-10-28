import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(argon2);

/**
 * OWASP's minimum for Argon2id: 19 MiB, 2 passes, 1 lane. Raising any value
 * makes `needsRehash` true for every stored hash, which the login path then
 * rewrites after a successful verification (docs/design/accounts-api.md §6.1).
 */
export const PASSWORD_HASH_PARAMETERS = { memoryKiB: 19456, passes: 2, parallelism: 1 } as const;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

/**
 * A real hash of a random throwaway password, so a login attempt for an
 * unknown login can still pay for one verification and take as long as a
 * wrong password for a known one. Nothing verifies against it.
 */
export const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$05jkupgj2Cq190TgKBWdWA$fu6mhx+znVx55S4LXmY7Hj8eY9AFHiwHunbRgOeUIkE";

interface Argon2idHash {
  memoryKiB: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
}

/**
 * PHC string format as the Argon2 reference implementation writes it:
 * `$argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<tag>`, with both
 * binary fields in standard base64 without padding. Only this exact layout is
 * ours; `v=19` (0x13) is the one version Node implements.
 */
const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d{1,10}),t=(\d{1,10}),p=(\d{1,10})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

// The ranges `crypto.argon2` accepts; a string outside them is unverifiable, not an exception.
const MAX_UINT32 = 4_294_967_295;
const MAX_PARALLELISM = 16_777_215;
const MIN_SALT_BYTES = 8;
const MIN_TAG_BYTES = 4;

function encodeField(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/, "");
}

/** Decodes a PHC base64 field, refusing anything that does not round-trip to the same text. */
function decodeField(text: string): Buffer | null {
  const bytes = Buffer.from(text, "base64");
  return encodeField(bytes) === text ? bytes : null;
}

function parsePhc(phc: string): Argon2idHash | null {
  const match = PHC_PATTERN.exec(phc);
  if (match === null) return null;
  const [, memoryText = "", passesText = "", parallelismText = "", saltText = "", tagText = ""] = match;
  const memoryKiB = Number(memoryText);
  const passes = Number(passesText);
  const parallelism = Number(parallelismText);
  const salt = decodeField(saltText);
  const tag = decodeField(tagText);
  if (salt === null || tag === null) return null;
  const inRange =
    parallelism >= 1 &&
    parallelism <= MAX_PARALLELISM &&
    passes >= 1 &&
    passes <= MAX_UINT32 &&
    memoryKiB >= 8 * parallelism &&
    memoryKiB <= MAX_UINT32 &&
    salt.length >= MIN_SALT_BYTES &&
    tag.length >= MIN_TAG_BYTES;
  return inRange ? { memoryKiB, passes, parallelism, salt, tag } : null;
}

function formatPhc({ memoryKiB, passes, parallelism, salt, tag }: Argon2idHash): string {
  return `$argon2id$v=19$m=${memoryKiB},t=${passes},p=${parallelism}$${encodeField(salt)}$${encodeField(tag)}`;
}

/** Passwords are the UTF-8 bytes as typed: never trimmed, never normalised. */
function derive(password: string, hash: Omit<Argon2idHash, "tag">, tagLength: number): Promise<Buffer> {
  return deriveKey("argon2id", {
    message: Buffer.from(password, "utf8"),
    nonce: hash.salt,
    parallelism: hash.parallelism,
    tagLength,
    memory: hash.memoryKiB,
    passes: hash.passes,
  });
}

/** Argon2id with the current parameters and a fresh random salt, as a PHC string for `password_hash`. */
export async function hashPassword(password: string): Promise<string> {
  const current = { ...PASSWORD_HASH_PARAMETERS, salt: randomBytes(SALT_BYTES) };
  const tag = await derive(password, current, TAG_BYTES);
  return formatPhc({ ...current, tag });
}

/**
 * Re-derives with the stored salt and parameters and compares in constant
 * time. A stored string this module cannot read is simply a non-match, so a
 * corrupt row signs nobody in and throws nothing.
 */
export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const stored = parsePhc(phc);
  if (stored === null) return false;
  const tag = await derive(password, stored, stored.tag.length);
  return timingSafeEqual(tag, stored.tag);
}

/**
 * True when the stored hash costs less than the current parameters in any
 * dimension (or is unreadable), so the login path can rewrite it. A different
 * lane count counts as not current: at equal memory it changes the cost profile.
 */
export function needsRehash(phc: string): boolean {
  const stored = parsePhc(phc);
  if (stored === null) return true;
  return (
    stored.memoryKiB < PASSWORD_HASH_PARAMETERS.memoryKiB ||
    stored.passes < PASSWORD_HASH_PARAMETERS.passes ||
    stored.parallelism !== PASSWORD_HASH_PARAMETERS.parallelism ||
    stored.salt.length < SALT_BYTES ||
    stored.tag.length < TAG_BYTES
  );
}
