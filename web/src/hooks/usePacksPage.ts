import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { controlRow, heldAllowance, heldOdds, visibleLine, type Held } from "../lib/game";
import { packControlView, type ControlView } from "../lib/packControl";
import { packControlCopy } from "../lib/packsCopy";
import { useCountdown } from "./useCountdown";
import { useDelayedFlag } from "./useDelayedFlag";
import { useGame } from "./useGame";
import { useShellContext } from "./useShell";

/** The pack control area stays blank this long before the loading state shows (packs-page.md §4.1). */
const LOADING_DELAY_MS = 300;
const SECOND_MS = 1000;

function countdownEnd(held: Held | null): number | null {
  const seconds = held?.allowance.nextPackInSeconds ?? null;
  return held === null || seconds === null ? null : held.receivedAt + seconds * SECOND_MS;
}

/**
 * The packs query as a page observes it: one `GET /api/packs` each time the
 * page is shown (packs-page.md §3.1 step 2), except while an opening is in
 * flight. That opening's answer carries the allowance, and a `GET` sent
 * after it could still be answered from before it on the server and show
 * the count before the pack (manager decision, 2026-10-30).
 */
export function useShownPacks() {
  const game = useGame();
  const [fetchOnShow] = useState(!game.state.opening);
  return useQuery({ ...game.packsQuery, refetchOnMount: fetchOnShow });
}

/**
 * `/packs` while it is on screen: its own `GET /api/packs` each time it is
 * shown, the countdown to the next pack with its one `GET` at zero, and the
 * 429 wait. Nothing here runs or fetches while another page shows (§3.2 step
 * 6); the opening itself and its result live in the layout's game. Opening a
 * pack moves to `/packs/open` (§3.3 step 2).
 */
export function usePacksPage() {
  const game = useGame();
  const { announce } = useShellContext();
  const packs = useShownPacks();
  const navigate = useNavigate();
  const { state } = game;
  const held = heldAllowance(packs.data, state);
  const odds = heldOdds(packs.data, state);
  const showLoading = useDelayedFlag(held === null && !packs.isError, LOADING_DELAY_MS);
  /**
   * The held answer's `seq` when a zero-time check failed. The failure line belongs to that answer:
   * any newer one (a `GET`, an opening's 201 or 200) replaces it, and its countdown shows again.
   */
  const [checkFailedAt, setCheckFailedAt] = useState<number | null>(null);

  const { refetch } = packs;
  /**
   * The countdown reached zero, or `Check again` after that check failed:
   * exactly one `GET`, and no timer until it answers. No answer or an error
   * envelope (a 500) both show the failure line and `Check again`. When it brings the
   * first pack while the count was 0, the live region says so once (§7).
   */
  const checkNextPack = useCallback(async () => {
    const before = held;
    const result = await refetch();
    // An error envelope is no answer to the question either: the page cannot tell when the pack comes.
    setCheckFailedAt(before !== null && result.isError ? before.seq : null);
    const after = result.data;
    if (before === null || after === undefined || after.seq <= before.seq) return;
    const { available, cap } = after.answer.allowance;
    if (before.allowance.available === 0 && available >= 1) announce(packControlCopy.ready(available, cap));
  }, [held, refetch, announce]);

  const reload = useCallback(() => void refetch(), [refetch]);
  const countdown = useCountdown(
    countdownEnd(held),
    useCallback(() => void checkNextPack(), [checkNextPack]),
  );
  const wait = useCountdown(
    state.waitUntil,
    useCallback(() => announce(packControlCopy.waitOver), [announce]),
  );

  const view: ControlView = packControlView({
    held,
    odds,
    loadFailed: packs.isError && held === null,
    showLoading,
    opening: state.opening,
    keyHeld: state.key !== null,
    countdown,
    checkFailed: held !== null && held.seq === checkFailedAt,
    wait,
    line: held === null ? null : visibleLine(state, controlRow(held, odds), wait !== null && wait > 0),
  });

  const { openPack } = game;
  // The request and the page change in one task, so the opening shows on `/packs/open` from its first frame.
  const open = useCallback(() => {
    if (view.kind !== "control" || !view.button.enabled) return;
    void openPack(view.row, "packs");
    void navigate({ to: "/packs/open" });
  }, [view, openPack, navigate]);

  return {
    view,
    odds,
    /** `See your latest pack` while the current opening's cards are held (§3.1 step 3). */
    cardsHeld: state.reveal !== null,
    open,
    checkNextPack: () => void checkNextPack(),
    reload,
  };
}
