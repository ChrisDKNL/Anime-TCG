import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { SESSION_QUERY_KEY } from "./useAccountSession";

/** Elements the spec moves focus to from somewhere else in the tree (accounts.md §7). */
export type FocusTarget = "accountHeading" | "packButton" | "accountControl";

/** The app-level banner above the main area (§4.8). */
export type Notice = "none" | "unreachable" | "sessionEnded";

export interface ShellActions {
  /** Puts text in the single app-level live region (§7 "Live region"). */
  announce: (text: string) => void;
  /** Focuses the target now if it is mounted, or as soon as it mounts. */
  requestFocus: (target: FocusTarget) => void;
  /** Any `unauthenticated` answer: signed out, neutral banner, focus to the Account screen heading (§4.8). */
  sessionEnded: () => void;
  /** A later call got no answer: the persistent red banner with `Try again` (§4.8). */
  unreachable: () => void;
  clearNotice: () => void;
}

export interface ShellState {
  announcement: string;
  notice: Notice;
}

interface Registry {
  register: (target: FocusTarget, element: HTMLElement) => () => void;
}

export type ShellContextValue = ShellActions & Registry;

/**
 * Owns the three things every part of the UI reaches for: the live region
 * text, the app-level notice, and focus moves across mount boundaries. Focus
 * works as a registry rather than state so a target that mounts later picks
 * up the pending request exactly once and a remount never steals focus.
 */
export function useShell(): { state: ShellState; context: ShellContextValue } {
  const queryClient = useQueryClient();
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState<Notice>("none");
  const elements = useRef(new Map<FocusTarget, HTMLElement>());
  const pending = useRef<FocusTarget | null>(null);

  const announce = useCallback((text: string) => setAnnouncement(text), []);
  const clearNotice = useCallback(() => setNotice("none"), []);
  const unreachable = useCallback(() => setNotice("unreachable"), []);

  const requestFocus = useCallback((target: FocusTarget) => {
    const element = elements.current.get(target);
    if (element === undefined) {
      pending.current = target;
      return;
    }
    pending.current = null;
    element.focus();
  }, []);

  const register = useCallback((target: FocusTarget, element: HTMLElement) => {
    elements.current.set(target, element);
    if (pending.current === target) {
      pending.current = null;
      element.focus();
    }
    return () => {
      if (elements.current.get(target) === element) elements.current.delete(target);
    };
  }, []);

  const sessionEnded = useCallback(() => {
    queryClient.setQueryData(SESSION_QUERY_KEY, { signedIn: false });
    setNotice("sessionEnded");
    requestFocus("accountHeading");
  }, [queryClient, requestFocus]);

  const context = useMemo<ShellContextValue>(
    () => ({ announce, requestFocus, sessionEnded, unreachable, clearNotice, register }),
    [announce, requestFocus, sessionEnded, unreachable, clearNotice, register],
  );

  return { state: { announcement, notice }, context };
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShellContext(): ShellContextValue {
  const value = useContext(ShellContext);
  if (value === null) throw new Error("useShellContext needs a ShellContext provider");
  return value;
}

/** Makes `ref`'s element the place `requestFocus(target)` lands while it is mounted. */
export function useFocusTarget(target: FocusTarget, ref: RefObject<HTMLElement | null>): void {
  const { register } = useShellContext();
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    return register(target, element);
  }, [register, target, ref]);
}
