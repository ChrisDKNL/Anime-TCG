import { describe, expect, it } from "vitest";
import { ApiError, errorEnvelopeFor } from "./errors.js";

describe("errorEnvelopeFor", () => {
  it("maps an ApiError to its own status, code and message", () => {
    expect(errorEnvelopeFor(new ApiError(403, "bad_origin", "Cross-origin request rejected"))).toEqual({
      statusCode: 403,
      body: { error: { code: "bad_origin", message: "Cross-origin request rejected" } },
    });
  });

  it("carries retryAfterSeconds into the body and asks for the Retry-After header, only when set", () => {
    const blocked = new ApiError(429, "too_many_failures", "Wait a moment", 7);
    expect(errorEnvelopeFor(blocked)).toEqual({
      statusCode: 429,
      body: { error: { code: "too_many_failures", message: "Wait a moment", retryAfterSeconds: 7 } },
      retryAfterSeconds: 7,
    });
    const plain = errorEnvelopeFor(new ApiError(401, "bad_credentials", "Incorrect login or password"));
    expect(plain.retryAfterSeconds).toBeUndefined();
    expect(Object.keys(plain.body.error)).toEqual(["code", "message"]);
  });

  it("carries balance into the body of insufficient_funds, with no Retry-After, only when set (economy.md §11.1)", () => {
    const short = new ApiError(
      409,
      "insufficient_funds",
      "The balance does not cover the price",
      undefined,
      0,
    );
    expect(errorEnvelopeFor(short)).toEqual({
      statusCode: 409,
      body: {
        error: { code: "insufficient_funds", message: "The balance does not cover the price", balance: 0 },
      },
    });
    expect(Object.keys(errorEnvelopeFor(short).body.error)).toEqual(["code", "message", "balance"]);
  });

  it("turns a validation failure into 400 with the first failing path", () => {
    const err = {
      statusCode: 400,
      message: "ignored",
      validationContext: "body",
      validation: [
        { instancePath: "/login", message: "must NOT have fewer than 3 characters" },
        { instancePath: "/password", message: "is required" },
      ],
    };
    expect(errorEnvelopeFor(err)).toEqual({
      statusCode: 400,
      body: {
        error: { code: "validation_failed", message: "body/login must NOT have fewer than 3 characters" },
      },
    });
  });

  it("reports an additional-property failure at the object level", () => {
    const err = {
      message: "x",
      validation: [{ instancePath: "", message: "must NOT have additional properties" }],
    };
    expect(errorEnvelopeFor(err).body.error.message).toBe("body must NOT have additional properties");
  });

  it("falls back to 'is invalid' when a validation error has no message", () => {
    const err = { message: "x", validationContext: "querystring", validation: [{ instancePath: "/page" }] };
    expect(errorEnvelopeFor(err).body.error.message).toBe("querystring/page is invalid");
  });

  it.each([
    [413, "payload_too_large"],
    [431, "header_too_large"],
    [415, "unsupported_media_type"],
    [429, "rate_limited"],
  ])("maps a %s thrown by the framework to %s with a fixed message", (statusCode, code) => {
    const { body, statusCode: status } = errorEnvelopeFor({ statusCode, message: "internal detail here" });
    expect(status).toBe(statusCode);
    expect(body.error.code).toBe(code);
    expect(body.error.message).not.toContain("internal detail");
  });

  it("passes the framework's message through for a generic 400 (malformed JSON)", () => {
    const { statusCode, body } = errorEnvelopeFor({ statusCode: 400, message: "Body is not valid JSON" });
    expect(statusCode).toBe(400);
    expect(body.error).toEqual({ code: "validation_failed", message: "Body is not valid JSON" });
  });

  it("maps any other 4xx to bad_request without its message", () => {
    const { statusCode, body } = errorEnvelopeFor({ statusCode: 406, message: "not acceptable: cookie=abc" });
    expect(statusCode).toBe(406);
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).not.toContain("cookie");
  });

  it.each([
    ["an Error without status", new Error("ECONNREFUSED 127.0.0.1:5432")],
    ["a 5xx from the framework", { statusCode: 503, message: "upstream" }],
    ["a 3xx", { statusCode: 302, message: "moved" }],
    ["a string", "boom"],
    ["null", null],
    ["undefined", undefined],
  ])("hides %s behind a 500 'Something went wrong'", (_label, err) => {
    expect(errorEnvelopeFor(err)).toEqual({
      statusCode: 500,
      body: { error: { code: "internal", message: "Something went wrong" } },
    });
  });
});
