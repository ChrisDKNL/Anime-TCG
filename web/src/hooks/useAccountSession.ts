import type { AccountPublic, SessionResponse } from "@anime-tcg/shared/api";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getSession } from "../lib/api";

export const SESSION_QUERY_KEY = ["session"] as const;

/** What the server last said about the session; the UI's only memory of who is signed in (accounts.md §3.7). */
export type SessionState =
  | { status: "loading" }
  | { status: "unreachable"; retrying: boolean }
  | { status: "signedOut" }
  | { status: "signedIn"; account: AccountPublic };

/**
 * The boot question (§3.1): does the cookie belong to a live session? Asked
 * once; afterwards every mutation writes the server's answer into the same
 * query, so there is exactly one place the session lives.
 */
export function useAccountSession(): {
  session: SessionState;
  retry: () => Promise<SessionResponse | undefined>;
} {
  // Every component that asks shares the one answer. A failed check is not repeated when another
  // component mounts (the router's root layout does, once the check has failed): that would loop
  // against an unreachable server. Only `Try again` repeats it.
  const query = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: getSession,
    staleTime: Infinity,
    retryOnMount: false,
  });

  let session: SessionState;
  if (query.data !== undefined) {
    session = query.data.signedIn
      ? { status: "signedIn", account: query.data.account }
      : { status: "signedOut" };
  } else if (query.errorUpdateCount > 0) {
    // A retry puts a query without data back to `pending`; it is still unreachable until an answer
    // arrives, so the page and its banner stay up instead of returning to the boot screen.
    session = { status: "unreachable", retrying: query.isFetching };
  } else {
    session = { status: "loading" };
  }

  const { refetch } = query;
  /** Repeats the check and hands back the answer, so `Try again` can leave `/login` once it names a session (§3.2 step 4). */
  const retry = useCallback(async () => (await refetch()).data, [refetch]);
  return { session, retry };
}

/**
 * The router's guards ask this (ADR 0012): the session query's last answer.
 * No answer, or none yet after an unreachable boot, counts as signed out
 * (accounts.md §3.1).
 */
export function isSignedIn(queryClient: QueryClient): boolean {
  return queryClient.getQueryData<SessionResponse>(SESSION_QUERY_KEY)?.signedIn === true;
}

/** Writes a server answer into the session query (register, login, logout, rename, delete). */
export function useSetSession(): (next: SessionResponse) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (next: SessionResponse) => queryClient.setQueryData(SESSION_QUERY_KEY, next),
    [queryClient],
  );
}
