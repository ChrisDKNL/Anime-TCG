import { Type } from "@sinclair/typebox";

/** Routes that take no query parameters declare it, so `?x=1` is a 400 like any other unknown field. */
export const NoQuery = Type.Object({}, { additionalProperties: false });
