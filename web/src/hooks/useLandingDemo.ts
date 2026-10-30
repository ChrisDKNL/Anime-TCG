import type { DemoResponse } from "@anime-tcg/shared/api";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { getDemo, NetworkError } from "../lib/api";
import { demoView, perVisit } from "../lib/demo";
import { demoCopy } from "../lib/navigationCopy";
import { useCountdown } from "./useCountdown";
import { useEntrance } from "./useEntrance";
import { DEMO_FACTS_KEY, useDemoVisit, type DemoOpenedFrom } from "./useDemoVisit";
import { useShellContext } from "./useShell";

/**
 * `/` and `/demo`, signed out (navigation-and-landing.md §3.7, §3.14, §4.5,
 * §4.9): the server's facts for the lede, the steps and the odds table, and
 * the demo pack. The facts are asked for once per page load; no answer raises
 * the app's unreachable banner, any other failure leaves every line in its
 * no-facts form. The visit (count, wait, cards, the opening) is the root
 * layout's and lasts for the page load (manager decision, 2026-10-30).
 * Nothing is written to storage or the address.
 */
export function useLandingDemo(from: DemoOpenedFrom) {
  const { announce, unreachable } = useShellContext();
  const facts = useQuery(
    queryOptions({
      queryKey: DEMO_FACTS_KEY,
      // Once per page load: a return to `/` or `/demo` shows the facts held; the banner's `Try again` and a
      // demo pack that answers after a failure still refetch them.
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
  const { visit, open: openVisit, shownPacks } = useDemoVisit();
  const wait = useCountdown(
    visit.waitUntil,
    useCallback(() => announce(demoCopy.waitOver), [announce]),
  );
  const view = demoView(visit, facts.data, wait);
  // The Join offer takes focus only when the last pack lands on this page, not when a return finds it there.
  const [revealedAtMount] = useState(visit.revealed);
  const finishedHere = view.control.kind === "done" && revealedAtMount < perVisit(facts.data);
  const entering = useEntrance(visit.pack, visit.pack?.landedShowing ?? false, shownPacks);

  const { control } = view;
  /** Opens a demo pack if the button is usable now; says whether it did, so `/` moves to `/demo` only then. */
  const open = useCallback((): boolean => {
    if (control.kind !== "button" || !control.enabled) return false;
    void openVisit(from);
    return true;
  }, [control, openVisit, from]);

  return {
    facts: facts.data,
    view,
    finishedHere,
    pack: visit.pack,
    entering,
    opening: visit.opening,
    open,
  };
}
