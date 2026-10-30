import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { CopyText } from "../lib/loginText";
import { SESSION_QUERY_KEY } from "./useAccountSession";

/** The app-level banner above the main area (accounts.md §4.8). */
export type Notice = "none" | "unreachable" | "sessionEnded";

export interface ShellActions {
  /** Puts text in the single app-level live region (accounts.md §7 "Live region"). */
  announce: (text: CopyText) => void;
  /**
   * Any `unauthenticated` answer: signed out, the neutral banner, and the page
   * replaced by `/login` with the current page as the return path
   * (navigation-and-landing.md §3.5 step 8).
   */
  sessionEnded: () => void;
  /** A later call got no answer: the persistent red banner with `Try again` (§4.8). */
  unreachable: () => void;
  /** A read answered: the unreachable banner no longer holds; a session-ended banner stays. */
  serverAnswered: () => void;
  clearNotice: () => void;
}

/**
 * What the live region says, numbered: the same text announced twice is two
 * announcements, and the number lets the region write it as new nodes so a
 * screen reader reads it again (§7 "Live region").
 */
export interface Announcement {
  text: CopyText;
  id: number;
}

export interface ShellState {
  announcement: Announcement;
  notice: Notice;
}

/** The actions plus the notice, which the Log in page reads to hide its guard line under the banner (§3.3 step 4). */
export type ShellContextValue = ShellActions & { notice: Notice };

interface Options {
  /** Runs after the session query is signed out: the root layout replaces the page with `/login` here. */
  onSessionEnded?: () => void;
}

/**
 * Owns what every part of the UI reaches for: the live region text and the
 * app-level notice. Focus is not here: every page change moves it to the new
 * page's heading (router.tsx), and that covers every action that used to move
 * it across mount boundaries.
 */
export function useShell({ onSessionEnded }: Options = {}): {
  state: ShellState;
  context: ShellContextValue;
} {
  const queryClient = useQueryClient();
  const [announcement, setAnnouncement] = useState<Announcement>({ text: "", id: 0 });
  const [notice, setNotice] = useState<Notice>("none");

  const announce = useCallback(
    (text: CopyText) => setAnnouncement((previous) => ({ text, id: previous.id + 1 })),
    [],
  );
  const clearNotice = useCallback(() => setNotice("none"), []);
  const unreachable = useCallback(() => setNotice("unreachable"), []);
  const serverAnswered = useCallback(
    () => setNotice((previous) => (previous === "unreachable" ? "none" : previous)),
    [],
  );

  // The session is written first so the `/login` guard sees a signed-out visitor when the navigation runs.
  const sessionEnded = useCallback(() => {
    queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: false });
    setNotice("sessionEnded");
    onSessionEnded?.();
  }, [queryClient, onSessionEnded]);

  const context = useMemo<ShellContextValue>(
    () => ({ announce, sessionEnded, unreachable, serverAnswered, clearNotice, notice }),
    [announce, sessionEnded, unreachable, serverAnswered, clearNotice, notice],
  );

  return { state: { announcement, notice }, context };
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShellContext(): ShellContextValue {
  const value = useContext(ShellContext);
  if (value === null) throw new Error("useShellContext needs a ShellContext provider");
  return value;
}
