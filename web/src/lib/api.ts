import type {
  AccountResponse,
  ChangePasswordBody,
  CollectionResponse,
  DeleteBody,
  InviteBody,
  LoginBody,
  OpenPackBody,
  PackOpened,
  PacksResponse,
  RecycleBody,
  RecycleReceipt,
  RegisterBody,
  RenameBody,
  SessionResponse,
  ShopBuyBody,
  ShopReceipt,
  ShopResponse,
  SignedIn,
  Wallet,
} from "@anime-tcg/shared/api";
import { ERROR_CODES, type ErrorCode, type ErrorEnvelope } from "@anime-tcg/shared/errors";

/** The api answered with its error envelope: a decision the UI maps to copy (accounts-api spec §7). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  /**
   * How long the server asks the UI to wait, in seconds: the envelope's own
   * number (the sign-in breather's `too_many_failures`, `no_pack_available`),
   * else the `Retry-After` header, which is all a `rate_limited` answer from the
   * route rate limiter carries (accounts.md §4.4-D, packs-page.md §9, question 3).
   */
  readonly retryAfterSeconds: number | undefined;
  /** The acting account's balance under the lock, on `insufficient_funds` only (economy.md §11.1). */
  readonly balance: number | undefined;

  constructor(status: number, error: ErrorEnvelope["error"], retryAfterHeader?: number) {
    super(error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = error.code;
    this.retryAfterSeconds = error.retryAfterSeconds ?? retryAfterHeader;
    this.balance = error.balance;
  }
}

/**
 * No usable answer from the api: the connection failed, or what came back is
 * not the envelope (a proxy error page, an empty body). The UI shows the
 * unreachable banner for both; it never guesses an outcome.
 */
export class NetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
  }
}

export function isApiError(err: unknown, code?: ErrorCode): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}

type Method = "GET" | "POST" | "PATCH";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

/** A whole number of seconds of at least 1 that counts exactly (`1e300` and `Infinity` do not). */
function isWholeSeconds(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

/** A balance that counts exactly: a whole number of at least 0. */
function isBalance(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  const { code, message, retryAfterSeconds, balance } = value.error;
  const retryOk = retryAfterSeconds === undefined || isWholeSeconds(retryAfterSeconds);
  const balanceOk = balance === undefined || isBalance(balance);
  return isErrorCode(code) && typeof message === "string" && retryOk && balanceOk;
}

async function send(method: Method, path: string, body?: object): Promise<Response> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { accept: "application/json" } };
  if (body !== undefined) {
    init.headers = { accept: "application/json", "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  try {
    return await fetch(path, init);
  } catch (cause) {
    throw new NetworkError(`${method} ${path}: no answer`, { cause });
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch (cause) {
    throw new NetworkError(`${res.status} answer was not JSON`, { cause });
  }
}

/**
 * `Retry-After` as whole seconds, or `undefined` when it is absent or not a
 * positive delta-seconds value that counts exactly (400 nines is `Infinity`).
 * The api only sends delta-seconds, so the HTTP-date form is not read: a date
 * would need the device clock. The one reader for every caller; each caller
 * applies its own fallback and cap (`serverWait`, `rateLimitWaitSeconds`).
 */
export function readRetryAfter(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return isWholeSeconds(seconds) ? seconds : undefined;
}

function failure(res: Response, json: unknown): Error {
  return isErrorEnvelope(json)
    ? new ApiError(res.status, json.error, readRetryAfter(res.headers))
    : new NetworkError(`unexpected ${res.status} answer`);
}

/** A route whose success carries a JSON body of type `T` (the response schema is the server's contract). */
async function expectJson<T>(method: Method, path: string, body?: object): Promise<T> {
  const res = await send(method, path, body);
  const json = await readJson(res);
  if (res.ok) return json as T;
  throw failure(res, json);
}

/** A route whose success is 204. */
async function expectNoContent(method: Method, path: string, body?: object): Promise<void> {
  const res = await send(method, path, body);
  if (res.ok) return;
  throw failure(res, await readJson(res));
}

export function getSession(): Promise<SessionResponse> {
  return expectJson<SessionResponse>("GET", "/api/session");
}

export function checkInvite(body: InviteBody): Promise<void> {
  return expectNoContent("POST", "/api/accounts/check-invite", body);
}

export function register(body: RegisterBody): Promise<SignedIn> {
  return expectJson<SignedIn>("POST", "/api/accounts/register", body);
}

export function login(body: LoginBody): Promise<SignedIn> {
  return expectJson<SignedIn>("POST", "/api/session/login", body);
}

/** No body: the route rejects `{}` as an unknown field. */
export function logout(): Promise<void> {
  return expectNoContent("POST", "/api/session/logout");
}

export function renameLogin(body: RenameBody): Promise<AccountResponse> {
  return expectJson<AccountResponse>("PATCH", "/api/account/login", body);
}

export function changePassword(body: ChangePasswordBody): Promise<void> {
  return expectNoContent("POST", "/api/account/change-password", body);
}

export function deleteAccount(body: DeleteBody): Promise<void> {
  return expectNoContent("POST", "/api/account/delete", body);
}

export function getPacks(): Promise<PacksResponse> {
  return expectJson<PacksResponse>("GET", "/api/packs");
}

/** 201 for a new opening and 200 for a replay of `requestId` carry the same body. */
export function openPack(body: OpenPackBody): Promise<PackOpened> {
  return expectJson<PackOpened>("POST", "/api/packs/open", body);
}

export function getCollection(): Promise<CollectionResponse> {
  return expectJson<CollectionResponse>("GET", "/api/collection");
}

export function getWallet(): Promise<Wallet> {
  return expectJson<Wallet>("GET", "/api/wallet");
}

export function getShop(): Promise<ShopResponse> {
  return expectJson<ShopResponse>("GET", "/api/shop");
}

/** 201 for a purchase and 200 for a replay of `requestId` carry the same pack and price. */
export function buyShopPack(body: ShopBuyBody): Promise<ShopReceipt> {
  return expectJson<ShopReceipt>("POST", "/api/shop/buy", body);
}

/** 201 for a recycle and 200 for a replay of `requestId` carry the same receipt. */
export function recycleDuplicates(body: RecycleBody): Promise<RecycleReceipt> {
  return expectJson<RecycleReceipt>("POST", "/api/collection/recycle", body);
}
