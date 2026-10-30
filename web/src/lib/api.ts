import type {
  AccountResponse,
  ChangePasswordBody,
  DeleteBody,
  InviteBody,
  LoginBody,
  RegisterBody,
  RenameBody,
  SessionResponse,
  SignedIn,
} from "@anime-tcg/shared/api";
import { ERROR_CODES, type ErrorCode, type ErrorEnvelope } from "@anime-tcg/shared/errors";

/** The api answered with its error envelope: a decision the UI maps to copy (accounts-api spec §7). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  /**
   * How long the server asks the UI to wait: the envelope's own seconds (the
   * sign-in breather), else the `Retry-After` header (the route rate limiter,
   * whose `rate_limited` envelope carries none).
   */
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, error: ErrorEnvelope["error"], retryAfterHeader?: number) {
    super(error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = error.code;
    this.retryAfterSeconds = error.retryAfterSeconds ?? retryAfterHeader;
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

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  const { code, message, retryAfterSeconds } = value.error;
  const retryOk =
    retryAfterSeconds === undefined ||
    (Number.isInteger(retryAfterSeconds) && Number(retryAfterSeconds) >= 1);
  return isErrorCode(code) && typeof message === "string" && retryOk;
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
 * positive delta-seconds value. The api only sends delta-seconds, so the
 * HTTP-date form is not read.
 */
function readRetryAfter(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds >= 1 ? seconds : undefined;
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
