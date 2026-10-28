import fp from "fastify-plugin";
import { ApiError, errorEnvelopeFor } from "../domain/errors.js";

/**
 * Every non-2xx response is the envelope from `shared/errors`. Unexpected
 * errors are logged with their stack under the request id and leave as a
 * bare 500; 4xx are logged at info with just their code.
 */
export const errorsPlugin = fp(
  async (app) => {
    // The instance-wide hooks (rate limit, CSRF) run for unknown routes as well.
    app.setNotFoundHandler(async () => {
      throw new ApiError(404, "not_found", "Route not found");
    });

    app.setErrorHandler(async (err, req, reply) => {
      const { statusCode, body, retryAfterSeconds } = errorEnvelopeFor(err);
      if (statusCode >= 500) req.log.error({ err }, "request failed");
      else req.log.info({ code: body.error.code }, "request rejected");
      if (retryAfterSeconds !== undefined) reply.header("retry-after", String(retryAfterSeconds));
      return reply.code(statusCode).send(body);
    });
  },
  { name: "errors", dependencies: ["security"] },
);
