import { useEffect } from "react";
import { Game } from "./components/Game";
import { LiveRegion } from "./components/LiveRegion";
import type { Frame } from "./components/PageFrame";
import { SignedOut } from "./components/SignedOut";
import { useAccountSession } from "./hooks/useAccountSession";
import { useCharacterPool } from "./hooks/useCharacterPool";
import { useDelayedFlag } from "./hooks/useDelayedFlag";
import { ShellContext, useShell, type Notice } from "./hooks/useShell";
import { documentTitle } from "./lib/copy";

/** `Loading…` only appears when the session check takes longer than this (accounts.md §4.1). */
const LOADING_DELAY_MS = 300;

export default function App() {
  const { session, retry } = useAccountSession();
  const shell = useShell();
  // The public character pool loads alongside the session check, so the pack button is ready when a player signs in.
  const pool = useCharacterPool();
  const showLoading = useDelayedFlag(session.status === "loading", LOADING_DELAY_MS);

  const login = session.status === "signedIn" ? session.account.login : null;
  useEffect(() => {
    document.title = documentTitle(login);
  }, [login]);

  // The boot check failing and a later call failing show the same banner; `Try again` repeats the session check.
  const notice: Notice = session.status === "unreachable" ? "unreachable" : shell.state.notice;
  const frame: Frame = {
    notice,
    retrying: session.status === "unreachable" && session.retrying,
    onRetry: () => {
      shell.context.clearNotice();
      retry();
    },
  };

  return (
    <ShellContext value={shell.context}>
      {session.status === "signedIn" ? (
        // Keyed by account: if the session ever names a different account, nothing of the last one's game state survives.
        <Game key={session.account.id} frame={frame} account={session.account} pool={pool} />
      ) : (
        <SignedOut frame={frame} loading={session.status === "loading"} showLoading={showLoading} />
      )}
      {/* Outside the signed-in/signed-out switch, so signing in or out writes into the same node (§7). */}
      <LiveRegion announcement={shell.state.announcement} />
    </ShellContext>
  );
}
