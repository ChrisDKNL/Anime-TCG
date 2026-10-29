import type { ReactNode } from "react";
import { LiveRegion } from "../components/LiveRegion";
import { ShellContext, useShell } from "../hooks/useShell";

/** The app shell's live region and context, enough for a form or dialog to run on its own in a test. */
export function TestShell({ children }: { children: ReactNode }) {
  const { state, context } = useShell();
  return (
    <ShellContext value={context}>
      <LiveRegion announcement={state.announcement} data-notice={state.notice} />
      {children}
    </ShellContext>
  );
}
