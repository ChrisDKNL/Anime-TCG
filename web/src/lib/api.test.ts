import { afterEach, describe, expect, it, vi } from "vitest";
import { envelope, makeAccount, mockFetch, noContent, rateLimited, sentBody } from "../test/api";
import {
  ApiError,
  changePassword,
  checkInvite,
  deleteAccount,
  getSession,
  isApiError,
  login,
  logout,
  NetworkError,
  register,
  renameLogin,
} from "./api";

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("GET /api/session returns the session with same-origin credentials", async () => {
    const fetchMock = mockFetch({ "GET /api/session": { status: 200, body: { signedIn: false } } });
    await expect(getSession()).resolves.toEqual({ signedIn: false });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/session");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.body).toBeUndefined();
  });

  it("checkInvite posts the code and resolves on 204", async () => {
    const fetchMock = mockFetch({ "POST /api/accounts/check-invite": noContent });
    await expect(checkInvite({ inviteCode: "local-dev-invite" })).resolves.toBeUndefined();
    expect(sentBody(fetchMock)).toEqual({ inviteCode: "local-dev-invite" });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("content-type")).toBe("application/json");
  });

  it("register returns the signed-in body of a 201", async () => {
    const account = makeAccount();
    const fetchMock = mockFetch({
      "POST /api/accounts/register": { status: 201, body: { signedIn: true, account } },
    });
    await expect(register({ inviteCode: "c", login: "Chris", password: "longenough" })).resolves.toEqual({
      signedIn: true,
      account,
    });
    expect(sentBody(fetchMock)).toEqual({ inviteCode: "c", login: "Chris", password: "longenough" });
  });

  it("login returns the signed-in body", async () => {
    const account = makeAccount();
    mockFetch({ "POST /api/session/login": { status: 200, body: { signedIn: true, account } } });
    await expect(login({ login: "chris", password: "pw" })).resolves.toEqual({ signedIn: true, account });
  });

  it("logout sends no body at all", async () => {
    const fetchMock = mockFetch({ "POST /api/session/logout": noContent });
    await expect(logout()).resolves.toBeUndefined();
    const init = fetchMock.mock.calls[0]![1];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
  });

  it("renameLogin PATCHes and returns the account", async () => {
    const account = makeAccount({ login: "Chris2" });
    const fetchMock = mockFetch({ "PATCH /api/account/login": { status: 200, body: { account } } });
    await expect(renameLogin({ login: "Chris2" })).resolves.toEqual({ account });
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("PATCH");
  });

  it("changePassword and deleteAccount resolve on 204", async () => {
    mockFetch({
      "POST /api/account/change-password": noContent,
      "POST /api/account/delete": noContent,
    });
    await expect(
      changePassword({ currentPassword: "a", newPassword: "longenough" }),
    ).resolves.toBeUndefined();
    await expect(deleteAccount({ password: "a" })).resolves.toBeUndefined();
  });

  it("maps an error envelope to ApiError with status and code", async () => {
    mockFetch({ "POST /api/session/login": envelope(401, "bad_credentials") });
    const err = await login({ login: "x", password: "y" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: "bad_credentials", retryAfterSeconds: undefined });
    expect(isApiError(err, "bad_credentials")).toBe(true);
    expect(isApiError(err, "unauthenticated")).toBe(false);
  });

  it("passes retryAfterSeconds through on too_many_failures", async () => {
    mockFetch({ "POST /api/account/delete": envelope(429, "too_many_failures", 7) });
    const err = await deleteAccount({ password: "x" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, code: "too_many_failures", retryAfterSeconds: 7 });
  });

  it("takes a rate_limited answer's seconds from Retry-After", async () => {
    mockFetch({ "POST /api/session/login": rateLimited("42") });
    const err = await login({ login: "x", password: "y" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", retryAfterSeconds: 42 });
  });

  it("a rate_limited answer without Retry-After carries no seconds", async () => {
    mockFetch({ "POST /api/session/login": rateLimited() });
    const err = await login({ login: "x", password: "y" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", retryAfterSeconds: undefined });
  });

  it("reads Retry-After only as whole positive seconds", async () => {
    for (const header of ["0", "-5", "1.5", "soon", "Fri, 30 Oct 2026 12:00:00 GMT", ""]) {
      mockFetch({ "POST /api/account/change-password": rateLimited(header) });
      const err = await changePassword({ currentPassword: "a", newPassword: "b" }).catch((e: unknown) => e);
      expect(err, header).toMatchObject({ code: "rate_limited", retryAfterSeconds: undefined });
    }
    mockFetch({ "POST /api/account/change-password": rateLimited(" 7 ") });
    const err = await changePassword({ currentPassword: "a", newPassword: "b" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ retryAfterSeconds: 7 });
  });

  it("reads a Retry-After too large to count exactly as no seconds, and passes a large exact one on", async () => {
    mockFetch({ "POST /api/session/login": rateLimited("9".repeat(400)) });
    const huge = await login({ login: "x", password: "y" }).catch((e: unknown) => e);
    expect(huge).toMatchObject({ code: "rate_limited", retryAfterSeconds: undefined });

    mockFetch({ "POST /api/session/login": rateLimited("86400") });
    const day = await login({ login: "x", password: "y" }).catch((e: unknown) => e);
    expect(day).toMatchObject({ code: "rate_limited", retryAfterSeconds: 86400 });
  });

  it("an envelope whose seconds do not count exactly is not the envelope", async () => {
    mockFetch({ "POST /api/session/login": envelope(429, "too_many_failures", 1e300) });
    await expect(login({ login: "x", password: "y" })).rejects.toBeInstanceOf(NetworkError);
  });

  it("the envelope's own seconds win over the header", async () => {
    mockFetch({
      "POST /api/account/delete": {
        ...envelope(429, "too_many_failures", 7),
        headers: { "retry-after": "30" },
      },
    });
    const err = await deleteAccount({ password: "x" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "too_many_failures", retryAfterSeconds: 7 });
  });

  it("a non-JSON failure answer is a NetworkError, not an ApiError", async () => {
    mockFetch({ "GET /api/session": { status: 502, raw: "<html>Bad Gateway</html>" } });
    await expect(getSession()).rejects.toBeInstanceOf(NetworkError);
  });

  it("JSON that is not the envelope is a NetworkError", async () => {
    mockFetch({ "GET /api/session": { status: 500, body: { message: "boom" } } });
    await expect(getSession()).rejects.toBeInstanceOf(NetworkError);
    mockFetch({ "GET /api/session": { status: 500, body: { error: { code: "made_up", message: "x" } } } });
    await expect(getSession()).rejects.toBeInstanceOf(NetworkError);
  });

  it("a rejected fetch is a NetworkError carrying the cause", async () => {
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(cause)),
    );
    const err = await getSession().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).cause).toBe(cause);
  });

  it("a success answer without JSON is a NetworkError", async () => {
    mockFetch({ "GET /api/session": { status: 200, raw: "" } });
    await expect(getSession()).rejects.toBeInstanceOf(NetworkError);
  });
});
