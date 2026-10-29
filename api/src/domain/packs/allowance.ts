import type { PackAllowance } from "@anime-tcg/shared/api";
import { PACK_CAP, PACK_INTERVAL_MINUTES } from "@anime-tcg/shared/economy";

const INTERVAL_MS = PACK_INTERVAL_MINUTES * 60_000;
const FULL_MS = PACK_CAP * INTERVAL_MS;

/** A null anchor is a full allowance: the clock reads as if the last pack arrived `PACK_CAP` intervals ago. */
function effectiveAnchor(anchor: Date | null, now: Date): number {
  return anchor === null ? now.getTime() - FULL_MS : anchor.getTime();
}

/**
 * The allowance at `now` from the account's anchor (collection-packs.md
 * §5.2). The server clock is the only clock: one set back delays packs and
 * never makes the count negative, one set forward grants at most the cap.
 */
export function allowanceAt(anchor: Date | null, now: Date): PackAllowance {
  const from = effectiveAnchor(anchor, now);
  const accrued = Math.floor((now.getTime() - from) / INTERVAL_MS);
  const available = Math.min(PACK_CAP, Math.max(0, accrued));
  const nextPackInSeconds =
    available === PACK_CAP
      ? null
      : Math.max(1, Math.ceil((from + (available + 1) * INTERVAL_MS - now.getTime()) / 1000));
  return { available, cap: PACK_CAP, intervalSeconds: INTERVAL_MS / 1000, nextPackInSeconds };
}

/**
 * The anchor after one pack is opened at `now`. Clamping to "full" first
 * means time beyond the cap is never banked, and opening while the timer
 * runs leaves the countdown where it was.
 */
export function anchorAfterOpening(anchor: Date | null, now: Date): Date {
  return new Date(Math.max(effectiveAnchor(anchor, now), now.getTime() - FULL_MS) + INTERVAL_MS);
}
