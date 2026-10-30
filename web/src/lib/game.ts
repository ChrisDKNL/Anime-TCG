import type { PackAllowance, PackOpened, PacksResponse, PublishedOdds, Wallet } from "@anime-tcg/shared/api";
import {
  controlsReducer,
  DEFAULT_CONTROLS,
  type ControlsAction,
  type OverviewControls,
} from "./collectionView";
import { MAX_WAIT_SECONDS } from "./failures";

/**
 * The signed-in account's game state, held by the root layout so it survives
 * every page change (navigation-and-landing.md §3.10): the opening in flight,
 * its idempotency key, the last reveal and what the last opening answered.
 * Everything here is a cache of what the server said; the browser decides no
 * outcome (collection-packs.md §8). It belongs to one session of one account:
 * every action names the account and the session it was started in, and an
 * action for any other (a pack that lands after a log-out, a session end or an
 * account switch, even once the same account has signed in again) changes
 * nothing. Nothing is persisted; the pre-accounts `anime-tcg:inventory:v1` key
 * is neither read nor touched (accounts.md §3.1.3).
 */

/**
 * Every request that returns an allowance is numbered when it is sent. The
 * page applies an allowance only from an answer sent after the one it last
 * applied (packs-page.md §3.1 step 5), so a `GET` that overtakes an opening
 * never steps the count back.
 */
export interface Stamped {
  seq: number;
  /** `performance.now()` when the answer arrived: a countdown runs from here, never from the device clock. */
  receivedAt: number;
}

/** A `GET /api/packs` answer as the packs query holds it. */
export interface PacksAnswer extends Stamped {
  answer: PacksResponse;
}

/** A `GET /api/wallet` answer as the wallet query holds it, numbered like every answer that carries a balance. */
export interface WalletAnswer {
  seq: number;
  wallet: Wallet;
}

/** A balance some other answer carried: a receipt, or `insufficient_funds` (market-and-shop.md §3.1 step 2). */
export interface HeldBalance {
  seq: number;
  value: number;
}

/** The allowance and pity count the page shows: the newest answer that carried them. */
export interface Held extends Stamped {
  allowance: PackAllowance;
  packsUntilGuarantee: number | null;
}

/** The lines under the pack button (packs-page.md §4.1); at most one shows. */
export type OpeningLine =
  /** 409: shown while the row stays the one the answer left (no pack ready). */
  | { kind: "noneLeft" }
  /** No answer: shown while the key it kept is held. */
  | { kind: "noAnswer" }
  /** 400, 403, 500, other envelopes: shown while the row stays the one it was opened from. */
  | { kind: "failed"; row: Row }
  /** 429: shown while the wait runs. */
  | { kind: "wait" };

export interface GameState {
  accountId: string | null;
  /** Counts the resets: each sign-in, sign-out and account change starts a new session of the game. */
  session: number;
  opening: boolean;
  /** The `requestId` of an opening that has had no answer yet; resent on the next click (§3.3 step 4). */
  key: string | null;
  /** The last pack the server dealt, shown on `/packs` until the next one. */
  reveal: PackOpened | null;
  /** How many packs have landed; a reveal that lands while `/packs` is showing runs its entrance, one found on return does not. */
  reveals: number;
  /** The allowance of the last opening the server dealt (201 or 200). */
  opened: Held | null;
  /** The last 409: no pack was left, and the next one is `retryAfterSeconds` away. */
  noneLeft: (Stamped & { retryAfterSeconds: number | null }) | null;
  /** The request number of the last 503: cards are unavailable until a newer `GET` has odds. */
  unavailableSince: number | null;
  line: OpeningLine | null;
  /** `performance.now()` at which the last 429's wait ends. */
  waitUntil: number | null;
  /** The collection overview's search, filters, sort, view and page, kept across pages (collection-overview.md §2). */
  overview: OverviewControls;
  /** The newest balance a receipt or a refusal carried; the header shows it when it is newer than the wallet's. */
  balance: HeldBalance | null;
}

/** Whose game an action is for: the account and the session it was started in. */
export interface GameOwner {
  accountId: string;
  session: number;
}

export type GameAction =
  | { type: "reset"; accountId: string | null }
  | ({ type: "openStarted"; key: string } & GameOwner)
  | ({ type: "opened"; seq: number; receivedAt: number; pack: PackOpened } & GameOwner)
  | ({ type: "noneLeft"; seq: number; receivedAt: number; retryAfterSeconds: number | null } & GameOwner)
  | ({ type: "unavailable"; seq: number } & GameOwner)
  | ({ type: "rateLimited"; until: number } & GameOwner)
  | ({ type: "failed"; row: Row } & GameOwner)
  | ({ type: "noAnswer" } & GameOwner)
  | ({ type: "overview"; action: ControlsAction } & GameOwner)
  | ({ type: "balance"; balance: HeldBalance } & GameOwner);

export function initialGame(accountId: string | null, session = 0): GameState {
  return {
    accountId,
    session,
    opening: false,
    key: null,
    reveal: null,
    reveals: 0,
    opened: null,
    noneLeft: null,
    unavailableSince: null,
    line: null,
    waitUntil: null,
    overview: DEFAULT_CONTROLS,
    balance: null,
  };
}

/** The state a reset leads to: empty, for `accountId`, in the next session. */
export function nextGame(state: GameState, accountId: string | null): GameState {
  return initialGame(accountId, state.session + 1);
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  if (action.type === "reset") return nextGame(state, action.accountId);
  if (action.accountId !== state.accountId || action.session !== state.session) return state;
  switch (action.type) {
    case "openStarted":
      return { ...state, opening: true, key: action.key };
    case "opened": {
      const { pack, seq, receivedAt } = action;
      return {
        ...state,
        opening: false,
        key: null,
        reveal: pack,
        reveals: state.reveals + 1,
        opened: { seq, receivedAt, allowance: pack.allowance, packsUntilGuarantee: pack.packsUntilGuarantee },
        line: null,
      };
    }
    case "noneLeft": {
      const { seq, receivedAt, retryAfterSeconds } = action;
      return {
        ...state,
        opening: false,
        key: null,
        noneLeft: { seq, receivedAt, retryAfterSeconds },
        line: { kind: "noneLeft" },
      };
    }
    case "unavailable":
      return { ...state, opening: false, key: null, unavailableSince: action.seq, line: null };
    case "rateLimited":
      // A 429 comes from the rate limiter before the route reads the key, so the key is kept (§9, question 2).
      return { ...state, opening: false, waitUntil: action.until, line: { kind: "wait" } };
    case "failed":
      return { ...state, opening: false, key: null, line: { kind: "failed", row: action.row } };
    case "noAnswer":
      return { ...state, opening: false, line: { kind: "noAnswer" } };
    case "overview":
      return { ...state, overview: controlsReducer(state.overview, action.action) };
    case "balance":
      return state.balance !== null && state.balance.seq >= action.balance.seq
        ? state
        : { ...state, balance: action.balance };
  }
}

/**
 * The balance the header shows (market-and-shop.md §3.1): the newest of the
 * last `GET /api/wallet` answer and the last balance another answer carried,
 * by when each request was sent, so a wallet read that overtakes a purchase
 * never steps the balance back. Null before the first of them.
 */
export function heldBalance(wallet: WalletAnswer | undefined, state: GameState): number | null {
  const { balance } = state;
  if (wallet === undefined) return balance?.value ?? null;
  if (balance === null || wallet.seq > balance.seq) return wallet.wallet.balance;
  return balance.value;
}

function newest<T extends Stamped>(candidates: ReadonlyArray<T | null | undefined>): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (candidate != null && (best === null || candidate.seq > best.seq)) best = candidate;
  }
  return best;
}

/**
 * The allowance and pity count from the newest answer (§3.1 step 5): the last
 * `GET`, the last opening, or a 409, which shows no pack ready and counts down
 * from its `retryAfterSeconds` over what was held before it.
 */
export function heldAllowance(packs: PacksAnswer | undefined, state: GameState): Held | null {
  const fromGet: Held | null =
    packs === undefined
      ? null
      : {
          seq: packs.seq,
          receivedAt: packs.receivedAt,
          allowance: packs.answer.allowance,
          packsUntilGuarantee: packs.answer.packsUntilGuarantee,
        };
  const base = newest([fromGet, state.opened]);
  const { noneLeft } = state;
  if (noneLeft === null || base === null || noneLeft.seq < base.seq) return base;
  return {
    seq: noneLeft.seq,
    receivedAt: noneLeft.receivedAt,
    allowance: { ...base.allowance, available: 0, nextPackInSeconds: noneLeft.retryAfterSeconds },
    packsUntilGuarantee: base.packsUntilGuarantee,
  };
}

/** The odds the page shows, or null when cards are unavailable: no snapshot, or a 503 newer than the last `GET`. */
export function heldOdds(packs: PacksAnswer | undefined, state: GameState): PublishedOdds | null {
  if (packs === undefined) return null;
  if (state.unavailableSince !== null && state.unavailableSince > packs.seq) return null;
  return packs.answer.odds;
}

/** The wait after a 429 without `Retry-After`: the window of `PACK_RATE_LIMIT` (packs-page.md §9, question 3). */
export const RATE_LIMIT_FALLBACK_SECONDS = 60;
/**
 * How long a 429 keeps `Open pack` waiting, from its `Retry-After` (as
 * `readRetryAfter` in `api.ts` reads it for every caller). The wait is capped
 * at the account forms' `MAX_WAIT_SECONDS` (packs-page.md §4.1): a wait of
 * hours reads as broken, and the next activation asks the server again anyway.
 */
export function rateLimitWaitSeconds(retryAfterSeconds: number | undefined): number {
  return Math.min(retryAfterSeconds ?? RATE_LIMIT_FALLBACK_SECONDS, MAX_WAIT_SECONDS);
}

/** The pack control's row (§4.1), from the held allowance and whether cards are available. */
export type Row = "unavailable" | "atCap" | "ready" | "waiting";

export function controlRow(held: Held, odds: PublishedOdds | null): Row {
  if (odds === null) return "unavailable";
  const { available, cap } = held.allowance;
  if (available >= cap) return "atCap";
  return available >= 1 ? "ready" : "waiting";
}

/** The line under the button, if it still applies: each kind clears on its own rule (§4.1). */
export function visibleLine(state: GameState, row: Row, waiting: boolean): OpeningLine["kind"] | null {
  const { line } = state;
  if (line === null) return null;
  switch (line.kind) {
    case "noneLeft":
      return row === "waiting" ? "noneLeft" : null;
    case "failed":
      return row === line.row ? "failed" : null;
    case "noAnswer":
      return state.key !== null ? "noAnswer" : null;
    case "wait":
      return waiting ? "wait" : null;
  }
}
