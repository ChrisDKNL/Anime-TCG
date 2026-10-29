import { randomInt } from "node:crypto";

/**
 * A uniform integer in `[min, max)`, as `crypto.randomInt` returns it. Every
 * roll with stakes goes through this type (C10), so the game always runs on
 * `cryptoRng` and a unit test can script the outcome.
 */
export type Rng = (min: number, max: number) => number;

export const cryptoRng: Rng = (min, max) => randomInt(min, max);
