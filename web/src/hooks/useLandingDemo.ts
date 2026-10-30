import type { DemoResponse } from "@anime-tcg/shared/api";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useReducer, useState } from "react";
import { ApiError, getDemo, NetworkError, openDemoPack } from "../lib/api";
import { demoView, initialPage, pageReducer, perVisit } from "../lib/demo";
import { rateLimitWaitSeconds } from "../lib/game";
import { demoCopy } from "../lib/navigationCopy";
import { useCountdown } from "./useCountdown";
import { useDemoVisit } from "./useDemoVisit";
import { useShellContext } from "./useShell";
import { useSingleFlight } from "./useSingleFlight";

const SECOND_MS = 1000;

/** The landing page's facts; the root layout's `Try again` refetches them while the page shows. */
export const DEMO_FACTS_KEY = ["demo"] as const;

/**
 * `/` signed out (navigation-and-landing.md §3.7, §4.5): the server's facts
 * for the lede, the rows and the odds table, and the demo pack. The facts are
 * asked for once per page load; no answer raises the app's unreachable
 * banner, any other failure leaves every line in its no-facts form. The cards
 * live in this hook's state, so leaving the page discards them; the visit's
 * count and 429 wait are the root layout's and last for the page load
 * (manager decision, 2026-10-30). Nothing is written to storage or the address.
 */
export function useLandingDemo() {
  const { announce, unreachable, clearNotice } = useShellContext();
  const facts = useQuery(
    queryOptions({
      queryKey: DEMO_FACTS_KEY,
      // Once per page load: a return to `/` shows the facts held; the banner's `Try again` and a demo
      // pack that answers after a failure still refetch them.
      staleTime: Infinity,
      queryFn: async (): Promise<DemoResponse> => {
        try {
          return await getDemo();
        } catch (err) {
          if (err instanceof NetworkError) unreachable();
          throw err;
        }
      },
    }),
  );
  const { visit, dispatch: dispatchVisit } = useDemoVisit();
  const [page, dispatch] = useReducer(pageReducer, initialPage);
  const wait = useCountdown(
    visit.waitUntil,
    useCallback(() => announce(demoCopy.waitOver), [announce]),
  );
  const view = demoView(page, visit, facts.data, wait);
  // The Join offer takes focus only when the last pack lands here, not when a return to `/` finds it there.
  const [revealedAtMount] = useState(visit.revealed);
  const finishedHere = view.control.kind === "done" && revealedAtMount < perVisit(facts.data);

  const { mutateAsync } = useMutation({ mutationFn: openDemoPack });
  const singleFlight = useSingleFlight();
  const { isError: factsFailed, refetch: refetchFacts } = facts;

  const openNow = useCallback(async () => {
    await singleFlight(async () => {
      dispatch({ type: "openStarted" });
      try {
        const opened = await mutateAsync();
        // The visit counts every pack the server dealt, even one that lands after the page was left.
        dispatchVisit({ type: "revealed" });
        dispatch({ type: "opened", opened });
        announce(demoCopy.announce(opened.cards.map((card) => card.rarity)));
        // The server answered, so a banner the facts raised no longer holds, and the facts can come now.
        if (factsFailed) {
          clearNotice();
          void refetchFacts();
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === "pool_unavailable") dispatch({ type: "unavailable" });
        else if (err instanceof ApiError && err.code === "rate_limited") {
          const seconds = rateLimitWaitSeconds(err.retryAfterSeconds);
          dispatchVisit({
            type: "rateLimited",
            until: performance.now() + seconds * SECOND_MS,
            counted: err.retryAfterSeconds !== undefined,
          });
          dispatch({ type: "settled" });
        } else {
          // No answer, a 400 or 403 (a client bug), any other envelope: the failure line and `Try again`.
          dispatch({ type: "failed" });
          if (!(err instanceof ApiError) && !(err instanceof NetworkError)) throw err;
        }
      }
    });
  }, [singleFlight, mutateAsync, dispatchVisit, announce, factsFailed, clearNotice, refetchFacts]);

  const control = view.control;
  const open = useCallback(() => {
    if (control.kind === "button" && control.enabled) void openNow();
  }, [control, openNow]);

  return {
    facts: facts.data,
    view,
    finishedHere,
    pack: page.pack,
    opening: page.opening,
    open,
  };
}
