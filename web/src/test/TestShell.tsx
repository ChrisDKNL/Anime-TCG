import type { ReactNode } from "react";
import { ShellContext, useShell } from "../hooks/useShell";

/** The app shell's live region and context, enough for a form or dialog to run on its own in a test. */
export function TestShell({ children }: { children: ReactNode }) {
  const { state, context } = useShell();
  return (
    <ShellContext value={context}>
      <p role="status" aria-live="polite" data-notice={state.notice}>
        {state.announcement}
      </p>
      {children}
    </ShellContext>
  );
}
