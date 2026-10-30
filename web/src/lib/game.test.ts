import { describe, expect, it } from "vitest";
import {
  makeAllowance,
  makeOdds,
  makePackOpened,
  makePacks,
  makeUnavailablePacks,
  makeWallet,
} from "../test/fixtures";
import {
  controlRow,
  gameReducer,
  heldAllowance,
  heldBalance,
  heldOdds,
  initialGame,
  RATE_LIMIT_FALLBACK_SECONDS,
  rateLimitWaitSeconds,
  visibleLine,
  type GameAction,
  type GameState,
  type PacksAnswer,
} from "./game";
import { MAX_WAIT_SECONDS } from "./failures";

const CHRIS = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const owner = { accountId: CHRIS, session: 0 };
const REQUEST_ID = "0b8f3c1e-6a3d-4c55-9a47-2f0d8a6b1c11";

function run(state: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce(gameReducer, state);
}

const packsAnswer = (seq: number, overrides = {}): PacksAnswer => ({
  seq,
  receivedAt: 1_000 * seq,
  answer: makePacks(overrides),
});

describe("gameReducer", () => {
  it("an opening holds its key until an answer settles it", () => {
    const started = run(initialGame(CHRIS), { type: "openStarted", ...owner, key: REQUEST_ID });
    expect(started).toMatchObject({ opening: true, key: REQUEST_ID });

    const pack = makePackOpened();
    const landed = run(started, { type: "opened", ...owner, seq: 2, receivedAt: 50, pack });
    expect(landed).toMatchObject({ opening: false, key: null, reveal: pack, reveals: 1, line: null });
    expect(landed.opened).toEqual({
      seq: 2,
      receivedAt: 50,
      allowance: pack.allowance,
      packsUntilGuarantee: pack.packsUntilGuarantee,
    });
  });

  it("keeps the key after no answer and after a 429, and discards it on every other answer", () => {
    const started = run(initialGame(CHRIS), { type: "openStarted", ...owner, key: REQUEST_ID });
    expect(run(started, { type: "noAnswer", ...owner })).toMatchObject({
      key: REQUEST_ID,
      opening: false,
      line: { kind: "noAnswer" },
    });
    expect(run(started, { type: "rateLimited", ...owner, until: 9_000 })).toMatchObject({
      key: REQUEST_ID,
      waitUntil: 9_000,
      line: { kind: "wait" },
    });
    expect(
      run(started, { type: "noneLeft", ...owner, seq: 3, receivedAt: 10, retryAfterSeconds: 60 }),
    ).toMatchObject({ key: null, line: { kind: "noneLeft" } });
    expect(run(started, { type: "unavailable", ...owner, seq: 3 })).toMatchObject({
      key: null,
      unavailableSince: 3,
      line: null,
    });
    expect(run(started, { type: "failed", ...owner, row: "ready" })).toMatchObject({
      key: null,
      line: { kind: "failed", row: "ready" },
    });
  });

  it("a retry with a held key keeps it, and the reveal stays until the answer replaces it", () => {
    const pack = makePackOpened();
    const state = run(
      initialGame(CHRIS),
      { type: "openStarted", ...owner, key: "a" },
      { type: "opened", ...owner, seq: 1, receivedAt: 0, pack },
      { type: "openStarted", ...owner, key: REQUEST_ID },
    );
    expect(state).toMatchObject({ opening: true, key: REQUEST_ID, reveal: pack });
  });

  it("drops an action of another account or an earlier session", () => {
    const state = initialGame(CHRIS, 2);
    const pack = makePackOpened();
    expect(run(state, { type: "opened", accountId: CHRIS, session: 1, seq: 1, receivedAt: 0, pack })).toBe(
      state,
    );
    expect(run(state, { type: "openStarted", accountId: "someone-else", session: 2, key: REQUEST_ID })).toBe(
      state,
    );
  });

  it("keeps the collection overview's controls, for this session only", () => {
    const state = run(initialGame(CHRIS), {
      type: "overview",
      ...owner,
      action: { type: "query", query: "spike" },
    });
    expect(state.overview).toMatchObject({ query: "spike", page: 1 });
    expect(
      run(state, { type: "overview", accountId: CHRIS, session: 1, action: { type: "query", query: "x" } }),
    ).toBe(state);
  });

  it("a reset starts the next session empty, the overview's controls included", () => {
    const state = run(
      initialGame(CHRIS),
      { type: "overview", ...owner, action: { type: "toggleRarity", rarity: "epic" } },
      { type: "openStarted", ...owner, key: REQUEST_ID },
      { type: "reset", accountId: CHRIS },
    );
    expect(state).toEqual(initialGame(CHRIS, 1));
  });

  it("never touches browser storage", () => {
    localStorage.setItem("anime-tcg:inventory:v1", "[]");
    run(initialGame(CHRIS), { type: "opened", ...owner, seq: 1, receivedAt: 0, pack: makePackOpened() });
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("anime-tcg:inventory:v1")).toBe("[]");
  });
});

describe("heldAllowance: the newest request wins (packs-page.md §3.1 step 5)", () => {
  it("is null before any answer", () => {
    expect(heldAllowance(undefined, initialGame(CHRIS))).toBeNull();
  });

  it("an opening's answer beats an older GET, and a newer GET beats the opening", () => {
    const pack = makePackOpened({ allowance: { available: 1 }, packsUntilGuarantee: 298 });
    const state = run(initialGame(CHRIS), { type: "opened", ...owner, seq: 5, receivedAt: 70, pack });

    // A GET sent before the opening (seq 4) that answers after it is ignored.
    const overtaken = heldAllowance(packsAnswer(4, { allowance: makeAllowance({ available: 3 }) }), state);
    expect(overtaken).toMatchObject({ seq: 5, receivedAt: 70, packsUntilGuarantee: 298 });
    expect(overtaken?.allowance.available).toBe(1);

    const newer = heldAllowance(packsAnswer(6, { allowance: makeAllowance({ available: 2 }) }), state);
    expect(newer).toMatchObject({ seq: 6, packsUntilGuarantee: 300 });
    expect(newer?.allowance.available).toBe(2);
  });

  it("a 409 shows no pack ready and counts down from its retryAfterSeconds over what was held", () => {
    const state = run(initialGame(CHRIS), {
      type: "noneLeft",
      ...owner,
      seq: 7,
      receivedAt: 800,
      retryAfterSeconds: 420,
    });
    const held = heldAllowance(
      packsAnswer(6, {
        allowance: makeAllowance({ available: 2, nextPackInSeconds: 30 }),
        packsUntilGuarantee: 250,
      }),
      state,
    );
    expect(held).toEqual({
      seq: 7,
      receivedAt: 800,
      allowance: { available: 0, cap: 3, intervalSeconds: 600, nextPackInSeconds: 420 },
      packsUntilGuarantee: 250,
    });
    // The one GET after the 409 replaces it.
    expect(heldAllowance(packsAnswer(8), state)?.seq).toBe(8);
  });
});

describe("heldOdds", () => {
  it("is the last GET's odds, null without a snapshot", () => {
    const state = initialGame(CHRIS);
    expect(heldOdds(undefined, state)).toBeNull();
    expect(heldOdds(packsAnswer(1), state)).toEqual(makeOdds());
    expect(heldOdds({ seq: 1, receivedAt: 0, answer: makeUnavailablePacks() }, state)).toBeNull();
  });

  it("a 503 makes cards unavailable until a newer GET answers with odds", () => {
    const state = run(initialGame(CHRIS), { type: "unavailable", ...owner, seq: 4 });
    expect(heldOdds(packsAnswer(3), state)).toBeNull();
    expect(heldOdds(packsAnswer(5), state)).toEqual(makeOdds());
  });
});

describe("rateLimitWaitSeconds", () => {
  it("waits as long as Retry-After says, up to the cap", () => {
    expect(rateLimitWaitSeconds(1)).toBe(1);
    expect(rateLimitWaitSeconds(42)).toBe(42);
    expect(rateLimitWaitSeconds(3599)).toBe(3599);
    expect(rateLimitWaitSeconds(3600)).toBe(3600);
  });

  it("caps a longer Retry-After at 3600 s, however large", () => {
    expect(MAX_WAIT_SECONDS).toBe(3600);
    expect(rateLimitWaitSeconds(3601)).toBe(3600);
    expect(rateLimitWaitSeconds(86_400)).toBe(3600);
    expect(rateLimitWaitSeconds(Infinity)).toBe(3600);
  });

  it("without Retry-After waits the rate limit's 60 s window", () => {
    expect(RATE_LIMIT_FALLBACK_SECONDS).toBe(60);
    expect(rateLimitWaitSeconds(undefined)).toBe(60);
  });
});

describe("controlRow and visibleLine (§4.1)", () => {
  const held = (available: number) => ({
    seq: 1,
    receivedAt: 0,
    allowance: makeAllowance({ available, nextPackInSeconds: available === 3 ? null : 60 }),
    packsUntilGuarantee: 300,
  });

  it("reads the row from the count and the odds", () => {
    const odds = makeOdds();
    expect(controlRow(held(3), odds)).toBe("atCap");
    expect(controlRow(held(1), odds)).toBe("ready");
    expect(controlRow(held(0), odds)).toBe("waiting");
    expect(controlRow(held(2), null)).toBe("unavailable");
  });

  it("clears each line by its own rule", () => {
    const base = initialGame(CHRIS);
    const noneLeft: GameState = { ...base, line: { kind: "noneLeft" } };
    expect(visibleLine(noneLeft, "waiting", false)).toBe("noneLeft");
    expect(visibleLine(noneLeft, "ready", false)).toBeNull();

    const failed: GameState = { ...base, line: { kind: "failed", row: "ready" } };
    expect(visibleLine(failed, "ready", false)).toBe("failed");
    expect(visibleLine(failed, "waiting", false)).toBeNull();

    const noAnswer: GameState = { ...base, key: REQUEST_ID, line: { kind: "noAnswer" } };
    expect(visibleLine(noAnswer, "waiting", false)).toBe("noAnswer");
    expect(visibleLine({ ...noAnswer, key: null }, "ready", false)).toBeNull();

    const wait: GameState = { ...base, line: { kind: "wait" } };
    expect(visibleLine(wait, "ready", true)).toBe("wait");
    expect(visibleLine(wait, "ready", false)).toBeNull();
    expect(visibleLine(base, "ready", true)).toBeNull();
  });
});

describe("the balance the header shows (market-and-shop.md §3.1)", () => {
  const wallet = (seq: number, balance: number) => ({ seq, wallet: makeWallet(balance) });
  const carried = (seq: number, value: number): GameAction => ({
    type: "balance",
    ...owner,
    balance: { seq, value },
  });

  it("is null before any answer, then the wallet's", () => {
    expect(heldBalance(undefined, initialGame(CHRIS))).toBeNull();
    expect(heldBalance(wallet(1, 1_240), initialGame(CHRIS))).toBe(1_240);
  });

  it("a receipt's balance replaces an older wallet read, and a newer wallet read replaces it", () => {
    const state = run(initialGame(CHRIS), carried(2, 840));
    expect(heldBalance(undefined, state)).toBe(840);
    expect(heldBalance(wallet(1, 1_240), state)).toBe(840);
    expect(heldBalance(wallet(3, 900), state)).toBe(900);
  });

  it("keeps the newest carried balance by when its request was sent, whatever order the answers came in", () => {
    const state = run(initialGame(CHRIS), carried(5, 400), carried(4, 800));
    expect(state.balance).toEqual({ seq: 5, value: 400 });
    expect(run(state, carried(6, 0)).balance).toEqual({ seq: 6, value: 0 });
  });

  it("drops a balance of another session, and a reset forgets it", () => {
    const state = run(initialGame(CHRIS), carried(2, 840));
    expect(run(state, { type: "balance", accountId: CHRIS, session: 1, balance: { seq: 9, value: 1 } })).toBe(
      state,
    );
    expect(run(state, { type: "reset", accountId: CHRIS }).balance).toBeNull();
  });
});
