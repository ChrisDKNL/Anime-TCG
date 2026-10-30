import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { PacksResponse, SessionResponse } from "@anime-tcg/shared/api";
import { PACK_CAP, PACK_SIZE } from "@anime-tcg/shared/economy";
import { PITY_PACKS } from "@anime-tcg/shared/rarity";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { describeReset, main } from "../src/cli/reset-collection.js";
import { accounts, cards, packOpenings } from "../src/db/schema.js";
import { ResetCollectionError, resetCollection } from "../src/domain/collection/reset.js";
import { standardPool } from "./fixtures/pool.js";
import {
  body,
  currentSnapshotId,
  deleteAccounts,
  deleteSnapshots,
  getPacks,
  loadSnapshot,
  newPlayer,
  openPack,
} from "./pool-support.js";
import { createTestApp, send, type SignedInClient, testConfig, testDatabaseUrl } from "./support.js";

const apiDir = fileURLToPath(new URL("..", import.meta.url));

/** collection-packs.md §5.6 and §7.2: the owner's collection reset, as a function and as a command. */
describe("reset-collection", () => {
  let app: App;
  const made: string[] = [];
  const snapshots: number[] = [];
  const player = async () => {
    const client = await newPlayer(app, "rc");
    made.push(client.account.id);
    return client;
  };
  const holdings = async (accountId: string) => ({
    cards: (await app.db.select().from(cards).where(eq(cards.accountId, accountId))).length,
    openings: (await app.db.select().from(packOpenings).where(eq(packOpenings.accountId, accountId))).length,
  });
  const anchorOf = async (accountId: string) =>
    (
      await app.db.select({ anchor: accounts.packsAnchorAt }).from(accounts).where(eq(accounts.id, accountId))
    )[0]?.anchor;
  const countersOf = async (accountId: string) =>
    (
      await app.db
        .select({ packsSinceMythic: accounts.packsSinceMythic, freePacksOpened: accounts.freePacksOpened })
        .from(accounts)
        .where(eq(accounts.id, accountId))
    )[0];
  async function playerWithPacks(opened: number): Promise<SignedInClient> {
    const client = await player();
    for (let i = 0; i < opened; i += 1) expect((await openPack(app, client.cookie)).statusCode).toBe(201);
    return client;
  }

  beforeAll(async () => {
    app = await createTestApp({ config: testConfig({ ACCOUNT_CAP: "1000" }) });
    const current = await currentSnapshotId(app.db);
    if (current !== null)
      throw new Error(`snapshot ${current} is current; a previous test run left it behind`);
    snapshots.push((await loadSnapshot(app.db, standardPool())).version);
  });
  afterAll(async () => {
    await deleteAccounts(app.db, made);
    await deleteSnapshots(snapshots);
    await app.close();
  });

  it("only counts without --confirm and changes nothing", async () => {
    const { account } = await playerWithPacks(2);
    const anchor = await anchorOf(account.id);
    expect(await resetCollection(app.db, account.login.toUpperCase(), { confirm: false })).toEqual({
      accountId: account.id,
      login: account.login,
      cards: 2 * PACK_SIZE,
      recycledCards: 0,
      openings: 2,
      balance: 0,
      keepKarma: false,
      applied: false,
    });
    expect(await holdings(account.id)).toEqual({ cards: 2 * PACK_SIZE, openings: 2 });
    expect(await anchorOf(account.id)).toEqual(anchor);
    expect((await countersOf(account.id))?.freePacksOpened).toBe(2);
  });

  it("with --confirm removes the cards and openings, fills the allowance and zeroes both counters, touching nobody else", async () => {
    const target = await playerWithPacks(PACK_CAP);
    const bystander = await playerWithPacks(1);
    await app.db.update(accounts).set({ packsSinceMythic: 123 }).where(eq(accounts.id, target.account.id));
    const bystanderCounters = await countersOf(bystander.account.id);
    expect(await resetCollection(app.db, target.account.login, { confirm: true })).toMatchObject({
      cards: PACK_CAP * PACK_SIZE,
      openings: PACK_CAP,
      applied: true,
    });
    expect(await holdings(target.account.id)).toEqual({ cards: 0, openings: 0 });
    expect(await anchorOf(target.account.id)).toBeNull();
    expect(await countersOf(target.account.id)).toEqual({ packsSinceMythic: 0, freePacksOpened: 0 });
    const packs = body<PacksResponse>(await getPacks(app, target.cookie));
    expect(packs.allowance.available).toBe(PACK_CAP);
    expect(packs.packsUntilGuarantee).toBe(PITY_PACKS);
    expect(await holdings(bystander.account.id)).toEqual({ cards: PACK_SIZE, openings: 1 });
    expect(await countersOf(bystander.account.id)).toEqual(bystanderCounters);

    // The session survives: the player sees the empty collection on the next fetch.
    const session = body<SessionResponse>(
      await send(app, { method: "GET", url: "/api/session", cookie: target.cookie }),
    );
    expect(session).toMatchObject({ signedIn: true, account: { id: target.account.id, cards: 0 } });
  });

  it("refuses an unknown login", async () => {
    await expect(resetCollection(app.db, "nobody-here", { confirm: true })).rejects.toThrow(
      ResetCollectionError,
    );
    await expect(resetCollection(app.db, "nobody-here", { confirm: false })).rejects.toThrow(
      'No account has the login "nobody-here"',
    );
  });

  it("serialises with a racing opening: the opening's cards are all removed or all kept, never some", async () => {
    for (let round = 0; round < 6; round += 1) {
      const { cookie, account } = await playerWithPacks(1);
      const [opened] = await Promise.all([
        openPack(app, cookie),
        resetCollection(app.db, account.login, { confirm: true }),
      ]);
      expect(opened.statusCode).toBe(201);
      const after = await holdings(account.id);
      // The reset ran first (the new pack survives) or second (nothing survives).
      expect([0, 1]).toContain(after.openings);
      expect(after.cards).toBe(after.openings * PACK_SIZE);
      // The counters are 0 or match the surviving opening.
      expect((await countersOf(account.id))?.freePacksOpened).toBe(after.openings);
    }
  });

  describe("as a command", () => {
    const sink = () => {
      const chunks: string[] = [];
      return { text: () => chunks.join(""), write: (chunk: string) => chunks.push(chunk) };
    };
    const quiet = new Writable({ write: (_chunk, _encoding, done) => done() });
    async function run(argv: string[], databaseUrl: string | undefined = testDatabaseUrl()) {
      const stdout = sink();
      const stderr = sink();
      const code = await main(argv, databaseUrl, { stdout, stderr, logDestination: quiet });
      return { code, stdout: stdout.text(), stderr: stderr.text() };
    }

    it("prints what it would remove, then what it removed", async () => {
      const { account } = await playerWithPacks(2);
      expect(await run([account.login])).toEqual({
        code: 0,
        stdout: `Would reset "${account.login}": 10 cards, 2 openings; pity and Enchanted counters to zero; balance 0 to 0.\n`,
        stderr: "",
      });
      expect(await run([account.login, "--confirm"])).toEqual({
        code: 0,
        stdout: `Collection reset for "${account.login}": 10 cards and 2 openings removed; packs full; counters reset; balance 0 set to 0.\n`,
        stderr: "",
      });
      expect(await holdings(account.id)).toEqual({ cards: 0, openings: 0 });
    });

    it("prints the login quoted, with C0, C1 and format characters escaped", () => {
      const counts = {
        accountId: "id",
        login: "a\u001b[2Jb\n\u009b2J\u202e",
        cards: 1,
        recycledCards: 0,
        openings: 1,
        balance: 0,
        keepKarma: false,
      };
      expect(describeReset({ ...counts, applied: false })).toBe(
        'Would reset "a\\u001b[2Jb\\n\\u009b2J\\u202e": 1 cards, 1 openings; pity and Enchanted counters to zero; balance 0 to 0.',
      );
      expect(describeReset({ ...counts, applied: true })).toMatch(/^Collection reset for "a\\u001b\[2Jb/);
    });

    it("counts the recycled cards apart from the held ones, and only when there are some (economy.md §13.4)", () => {
      const counts = { accountId: "id", login: "p", cards: 8, openings: 2, balance: 5, keepKarma: false };
      expect(describeReset({ ...counts, recycledCards: 2, applied: false })).toBe(
        'Would reset "p": 8 cards, 2 recycled cards, 2 openings; pity and Enchanted counters to zero; balance 5 to 0.',
      );
      expect(describeReset({ ...counts, recycledCards: 2, applied: true })).toBe(
        'Collection reset for "p": 8 cards, 2 recycled cards and 2 openings removed; packs full; counters reset; balance 5 set to 0.',
      );
      expect(describeReset({ ...counts, recycledCards: 0, applied: false })).toBe(
        'Would reset "p": 8 cards, 2 openings; pity and Enchanted counters to zero; balance 5 to 0.',
      );
    });

    it("exits 1 with a one-line reason for an unknown login", async () => {
      expect(await run(["nobody-here", "--confirm"])).toEqual({
        code: 1,
        stdout: "",
        stderr: 'No account has the login "nobody-here"\n',
      });
    });

    it.each([
      [[]],
      [["a", "b"]],
      [["--confirm"]],
      [["a", "--confirm", "--confirm"]],
      [["--force", "a"]],
      [["a", "--keep-karma", "--keep-karma"]],
      [["--keep-karma"]],
    ])("exits 1 with usage for %j", async (argv) => {
      const result = await run(argv);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/^Usage: /);
    });

    it("exits 1 when DATABASE_URL is not set", async () => {
      const stdout = sink();
      const stderr = sink();
      expect(await main(["someone"], undefined, { stdout, stderr })).toBe(1);
      expect(stderr.text()).toBe("DATABASE_URL is not set\n");
    });

    it("runs as a process and exits 1 for an unknown login", async () => {
      const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
      await promisify(execFile)(process.execPath, [tsc, "-b", "../shared"], { cwd: apiDir });
      const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "src/cli/reset-collection.ts", "nobody-here"],
          {
            cwd: apiDir,
            env: { DATABASE_URL: testDatabaseUrl() },
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("exit", (code) => resolve({ code, stderr }));
      });
      expect(result).toEqual({ code: 1, stderr: 'No account has the login "nobody-here"\n' });
    }, 60_000);
  });
});
