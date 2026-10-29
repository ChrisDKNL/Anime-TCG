import { createContext, useContext } from "react";
import type { Notice } from "./useShell";

/** What every page shows around its main area: the app-level notice (accounts.md §4.8). */
export interface Frame {
  notice: Notice;
  retrying: boolean;
  onRetry: () => void;
}

/** Provided by the root layout; the boot screen renders before it exists and shows no banner. */
export const FrameContext = createContext<Frame | null>(null);

export function useFrame(): Frame | null {
  return useContext(FrameContext);
}
