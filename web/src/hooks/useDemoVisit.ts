import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useReducer, useState } from "react";
import { ApiError, openDemoPack } from "../lib/api";
import { type DemoPack, type DemoVisit, type DemoVisitAction, initialVisit, visitReducer } from "../lib/demo";
import { rethrowUnlessKnown } from "../lib/failures";
import { rateLimitWaitSeconds } from "../lib/game";
import { demoCopy } from "../lib/navigationCopy";
import type { ShellActions } from "./useShell";
import { useSingleFlight } from "./useSingleFlight";

const SECOND_MS = 1000;

/** The pool facts of `/` and `/demo`; the root layout's `Try again` refetches them while either page shows. */
export const DEMO_FACTS_KEY = ["demo"] as const;

/** Where a demo pack was opened: from `/` the page moves to `/demo`, which starts from empty slots (§3.14 steps 1, 3). */
export type DemoOpenedFrom = "landing" | "demo";

export interface DemoVisitStore {
  visit: DemoVisit;
  /** Opens a demo pack; one at a time across both pages, so a double click spends one (§3.14 step 1). */
  open: (from: DemoOpenedFrom) => Promise<void>;
  /** The demo packs `/demo` has already shown: Back and Forward show them without the entrance. */
  shownPacks: WeakSet<DemoPack>;
}

interface Options {
  /** A sign-in discards the visit, cards included (§3.10 item 5). */
  signedIn: boolean;
  shell: Pick<ShellActions, "announce" | "serverAnswered">;
  /**
   * Whether `/demo` is on screen or being navigated to: a reveal that lands elsewhere is counted and
   * held, and neither announced nor entered (§3.14 step 6).
   */
  demoShowing: () => boolean;
}

interface Held {
  /** Which visit this is: each sign-in or sign-out starts a new one, and an answer for an older one is dropped. */
  epoch: number;
  signedIn: boolean;
  visit: DemoVisit;
}

type HeldAction =
  { type: "reset"; signedIn: boolean } | { type: "visit"; epoch: number; action: DemoVisitAction };

function heldReducer(held: Held, action: HeldAction): Held {
  if (action.type === "reset")
    return { epoch: held.epoch + 1, signedIn: action.signedIn, visit: initialVisit };
  if (action.epoch !== held.epoch) return held;
  return { ...held, visit: visitReducer(held.visit, action.action) };
}

/**
 * The demo's visit (lib/demo.ts), held by the root layout, which is mounted
 * once per document, so it outlives every page change and only a reload or a
 * sign-in starts it over (manager decision, 2026-10-30). The opening runs
 * here too, so an answer that lands after the visitor moved from `/` to
 * `/demo`, or away from both, still counts. Memory only.
 */
export function useDemoVisitStore({ signedIn, shell, demoShowing }: Options): DemoVisitStore {
  const [stored, dispatchHeld] = useReducer(heldReducer, { epoch: 0, signedIn, visit: initialVisit });
  if (stored.signedIn !== signedIn) dispatchHeld({ type: "reset", signedIn });
  const { epoch } = stored;
  const visit = stored.signedIn === signedIn ? stored.visit : initialVisit;

  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({ mutationFn: openDemoPack });
  const singleFlight = useSingleFlight();
  const { announce, serverAnswered } = shell;

  const open = useCallback(
    async (from: DemoOpenedFrom) => {
      await singleFlight(async () => {
        const dispatch = (action: DemoVisitAction) => dispatchHeld({ type: "visit", epoch, action });
        dispatch({ type: "openStarted", clearCards: from === "landing" });
        try {
          const opened = await mutateAsync();
          const landedShowing = demoShowing();
          dispatch({ type: "opened", opened, landedShowing });
          if (landedShowing) announce(demoCopy.announce(opened.cards.map((card) => card.rarity)));
          // The server answered, so a banner the facts raised no longer holds, and the facts can come now.
          serverAnswered();
          if (queryClient.getQueryState(DEMO_FACTS_KEY)?.status === "error") {
            void queryClient.refetchQueries({ queryKey: DEMO_FACTS_KEY });
          }
        } catch (err) {
          if (err instanceof ApiError && err.code === "pool_unavailable") dispatch({ type: "unavailable" });
          else if (err instanceof ApiError && err.code === "rate_limited") {
            const seconds = rateLimitWaitSeconds(err.retryAfterSeconds);
            dispatch({
              type: "rateLimited",
              until: performance.now() + seconds * SECOND_MS,
              counted: err.retryAfterSeconds !== undefined,
            });
          } else {
            // No answer, a 400 or 403 (a client bug), any other envelope: the failure line and `Try again`.
            dispatch({ type: "failed" });
            rethrowUnlessKnown(err);
          }
        }
      });
    },
    [singleFlight, epoch, mutateAsync, demoShowing, announce, serverAnswered, queryClient],
  );

  const [shownPacks] = useState(() => new WeakSet<DemoPack>());
  return useMemo(() => ({ visit, open, shownPacks }), [visit, open, shownPacks]);
}

export const DemoVisitContext = createContext<DemoVisitStore | null>(null);

export function useDemoVisit(): DemoVisitStore {
  const store = useContext(DemoVisitContext);
  if (store === null) throw new Error("useDemoVisit needs the root layout's DemoVisitContext");
  return store;
}
