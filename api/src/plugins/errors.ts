import fp from "fastify-plugin";
import { ApiError, errorEnvelopeFor } from "../domain/errors.js";

/**
 * Every non-2xx response is the envelope from `shared/errors`. Unexpected
 * errors are logged with their stack under the request id and leave as a
 * bare 500; 4xx are logged at info with just their code.
 */
export const errorsPlugin = fp(
  async (app) => {
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, async () => {
      throw new ApiError(404, "not_found", "Route not found");
    });

    app.setErrorHandler(async (err, req, reply) => {
      const { statusCode, body } = errorEnvelopeFor(err);
      if (statusCode >= 500) req.log.error({ err }, "request failed");
      else req.log.info({ code: body.error.code }, "request rejected");
      return reply.code(statusCode).send(body);
    });
  },
  { name: "errors", dependencies: ["security"] },
);
