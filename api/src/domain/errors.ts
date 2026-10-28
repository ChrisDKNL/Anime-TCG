import type { ErrorCode, ErrorEnvelope } from "@anime-tcg/shared/errors";

/** The one error type domain code throws; the error plugin maps it to the envelope. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface EnvelopeResponse {
  statusCode: number;
  body: ErrorEnvelope;
}

/**
 * What Fastify and its plugins throw, described structurally so this module
 * stays free of Fastify imports and unit-testable with plain objects.
 */
interface ThrownError {
  statusCode?: number;
  message: string;
  validation?: { instancePath: string; message?: string }[];
  validationContext?: string;
}

const FIXED_MESSAGES: Partial<Record<number, { code: ErrorCode; message: string }>> = {
  413: { code: "payload_too_large", message: "Request body is too large" },
  415: { code: "unsupported_media_type", message: "Unsupported content type" },
  429: { code: "rate_limited", message: "Too many requests; slow down" },
};

/**
 * Maps anything thrown during a request to a status and envelope body.
 * Everything unexpected becomes a 500 that says nothing about the cause;
 * the caller logs the real error under the request id.
 */
export function errorEnvelopeFor(err: unknown): EnvelopeResponse {
  if (err instanceof ApiError) return { statusCode: err.statusCode, body: envelope(err.code, err.message) };
  if (!isThrownError(err)) return internal();

  const [first] = err.validation ?? [];
  if (first) {
    const where = `${err.validationContext ?? "body"}${first.instancePath}`;
    return {
      statusCode: 400,
      body: envelope("validation_failed", `${where} ${first.message ?? "is invalid"}`),
    };
  }

  const status = err.statusCode;
  if (status === undefined || status < 400 || status >= 500) return internal();
  const fixed = FIXED_MESSAGES[status];
  if (fixed) return { statusCode: status, body: envelope(fixed.code, fixed.message) };
  if (status === 400) return { statusCode: 400, body: envelope("validation_failed", err.message) };
  return { statusCode: status, body: envelope("bad_request", "Request could not be processed") };
}

function isThrownError(err: unknown): err is ThrownError {
  return (
    typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string"
  );
}

function envelope(code: ErrorCode, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

function internal(): EnvelopeResponse {
  return { statusCode: 500, body: envelope("internal", "Something went wrong") };
}
