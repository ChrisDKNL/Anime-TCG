import { describe, expect, it } from "vitest";
import {
  DUMMY_HASH,
  hashPassword,
  needsRehash,
  PASSWORD_HASH_PARAMETERS,
  verifyPassword,
} from "./password.js";

const CURRENT_PHC = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/;

/** The salt and tag fields of the committed dummy, reused to build well-formed strings with other parameters. */
const [, DUMMY_SALT = "", DUMMY_TAG = ""] = CURRENT_PHC.exec(DUMMY_HASH) ?? [];
const withParameters = (parameters: string) => `$argon2id$v=19$${parameters}$${DUMMY_SALT}$${DUMMY_TAG}`;

describe("hashPassword", () => {
  it("writes the OWASP-minimum parameters as a PHC string with a 16-byte salt and a 32-byte tag", async () => {
    expect(PASSWORD_HASH_PARAMETERS).toEqual({ memoryKiB: 19456, passes: 2, parallelism: 1 });
    const phc = await hashPassword("correct horse battery staple");
    const match = CURRENT_PHC.exec(phc);
    expect(match).not.toBeNull();
    expect(Buffer.from(match?.[1] ?? "", "base64")).toHaveLength(16);
    expect(Buffer.from(match?.[2] ?? "", "base64")).toHaveLength(32);
  });

  it("salts every hash differently, and each verifies on its own", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(a).not.toBe(b);
    expect(CURRENT_PHC.exec(a)?.[1]).not.toBe(CURRENT_PHC.exec(b)?.[1]);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });
});

describe("verifyPassword", () => {
  it("round-trips the exact password and rejects a wrong one", async () => {
    const phc = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", phc)).toBe(true);
    expect(await verifyPassword("correct horse battery stable", phc)).toBe(false);
    expect(await verifyPassword("", phc)).toBe(false);
  });

  it("compares bytes as typed: no trimming, no case folding, no unicode normalisation", async () => {
    const phc = await hashPassword("pässwörd 🔑");
    expect(await verifyPassword("pässwörd 🔑", phc)).toBe(true);
    expect(await verifyPassword(" pässwörd 🔑", phc)).toBe(false);
    expect(await verifyPassword("pässwörd 🔑 ", phc)).toBe(false);
    expect(await verifyPassword("PÄSSWÖRD 🔑", phc)).toBe(false);
    // The same glyphs in decomposed form are different bytes, so a different password.
    expect(await verifyPassword("pässwörd 🔑".normalize("NFD"), phc)).toBe(false);
  });

  it("handles the longest password the API accepts", async () => {
    const long = "λ".repeat(64).concat("9".repeat(64));
    expect(long).toHaveLength(128);
    const phc = await hashPassword(long);
    expect(await verifyPassword(long, phc)).toBe(true);
    expect(await verifyPassword(long.slice(0, 127), phc)).toBe(false);
  });

  it.each([
    ["an empty string", ""],
    ["prose", "not a hash"],
    ["a bcrypt string", "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW"],
    ["argon2i", withParameters("m=19456,t=2,p=1").replace("argon2id", "argon2i")],
    ["argon2d", withParameters("m=19456,t=2,p=1").replace("argon2id", "argon2d")],
    ["version 16", withParameters("m=19456,t=2,p=1").replace("v=19", "v=16")],
    ["parameters in another order", withParameters("t=2,m=19456,p=1")],
    ["a missing tag", `$argon2id$v=19$m=19456,t=2,p=1$${DUMMY_SALT}`],
    ["base64 padding", `$argon2id$v=19$m=19456,t=2,p=1$${DUMMY_SALT}==$${DUMMY_TAG}=`],
    ["base64url characters", `$argon2id$v=19$m=19456,t=2,p=1$${DUMMY_SALT.replace(/./, "-")}$${DUMMY_TAG}`],
    [
      "a non-canonical salt encoding",
      `$argon2id$v=19$m=19456,t=2,p=1$${DUMMY_SALT.slice(0, -1)}B$${DUMMY_TAG}`,
    ],
    ["memory below Node's minimum", withParameters("m=7,t=2,p=1")],
    ["memory below 8 KiB per lane", withParameters("m=15,t=2,p=2")],
    ["zero passes", withParameters("m=19456,t=0,p=1")],
    ["zero lanes", withParameters("m=19456,t=2,p=0")],
    ["too many lanes", withParameters("m=19456,t=2,p=16777216")],
    ["a salt under 8 bytes", `$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAA$${DUMMY_TAG}`],
    ["a tag under 4 bytes", `$argon2id$v=19$m=19456,t=2,p=1$${DUMMY_SALT}$AAAA`],
    ["trailing whitespace", `${DUMMY_HASH}\n`],
  ])("is false, without throwing, for %s", async (_label, stored) => {
    await expect(verifyPassword("password", stored)).resolves.toBe(false);
  });
});

describe("needsRehash", () => {
  it("is false for a hash made with the current parameters", async () => {
    expect(needsRehash(await hashPassword("anything"))).toBe(false);
  });

  it.each([
    ["less memory", "m=8192,t=2,p=1"],
    ["fewer passes", "m=19456,t=1,p=1"],
    ["more lanes at the same memory", "m=19456,t=2,p=2"],
  ])("is true for %s", (_label, parameters) => {
    expect(needsRehash(withParameters(parameters))).toBe(true);
  });

  it("is false for parameters stronger than the current ones", () => {
    expect(needsRehash(withParameters("m=65536,t=3,p=1"))).toBe(false);
  });

  it("is true for a short salt or tag", () => {
    expect(needsRehash(`$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAA$${DUMMY_TAG}`)).toBe(true);
    expect(needsRehash(`$argon2id$v=19$m=19456,t=2,p=1$${DUMMY_SALT}$AAAAAAAAAAAAAAAAAAAAAA`)).toBe(true);
  });

  it("is true for anything it cannot read", () => {
    expect(needsRehash("")).toBe(true);
    expect(needsRehash("$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW")).toBe(true);
    expect(needsRehash(withParameters("m=19456,t=2,p=1").replace("argon2id", "argon2i"))).toBe(true);
  });
});

describe("DUMMY_HASH", () => {
  it("is a current-parameter hash that verifies nothing anyone would type", async () => {
    expect(DUMMY_HASH).toMatch(CURRENT_PHC);
    expect(needsRehash(DUMMY_HASH)).toBe(false);
    expect(await verifyPassword("", DUMMY_HASH)).toBe(false);
    expect(await verifyPassword("password", DUMMY_HASH)).toBe(false);
  });
});
