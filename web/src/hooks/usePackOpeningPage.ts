import { useCallback } from "react";
import { controlRow, heldAllowance, heldOdds } from "../lib/game";
import { openingControlView } from "../lib/packControl";
import { packControlCopy } from "../lib/packsCopy";
import { useCountdown } from "./useCountdown";
import { useEntrance } from "./useEntrance";
import { useGame } from "./useGame";
import { useShownPacks } from "./usePacksPage";
import { useShellContext } from "./useShell";

/**
 * `/packs/open` while it is on screen (packs-page.md §3.7): the current
 * opening held in the layout's game, the count line from the newest answer,
 * one `GET /api/packs` when it is shown again, and `Open pack`, which opens
 * the next pack in place. A 429 wait still counts down here when the page is
 * reached during one. There is no countdown to the next pack: that is `/packs`'s.
 */
export function usePackOpeningPage() {
  const game = useGame();
  const { announce } = useShellContext();
  const packs = useShownPacks();
  const { state, openPack } = game;
  const held = heldAllowance(packs.data, state);
  const odds = heldOdds(packs.data, state);
  const wait = useCountdown(
    state.waitUntil,
    useCallback(() => announce(packControlCopy.waitOver), [announce]),
  );
  const control = openingControlView({
    held,
    odds,
    opening: state.opening,
    keyHeld: state.key !== null,
    wait,
  });

  const enabled = control.button.enabled;
  const open = useCallback(() => {
    // Usable with no allowance held only for a held key's retry; its failure line then needs a row to stand on.
    if (enabled) void openPack(held === null ? "ready" : controlRow(held, odds), "opening");
  }, [enabled, openPack, held, odds]);

  const entering = useEntrance(state.reveal, state.revealLandedShowing, game.shownReveals);

  return {
    control,
    /** Nothing in flight and no cards: the page replaces itself with `/packs` (navigation-and-landing.md §3.13 step 3). */
    nothingHeld: !state.opening && state.reveal === null,
    reveal: state.reveal,
    /** The last `GET`'s odds even while a 503 marks cards unavailable: the reveal's lines and rank chips read them. */
    lastOdds: packs.data?.answer.odds ?? null,
    entering,
    opening: state.opening,
    open,
  };
}
