import type { AccountPublic, SessionResponse } from "@anime-tcg/shared/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
export function useAccountSession(): { session: SessionState; retry: () => void } {
  const query = useQuery({ queryKey: SESSION_QUERY_KEY, queryFn: getSession, staleTime: Infinity });

  let session: SessionState;
  if (query.data !== undefined) {
    session = query.data.signedIn
      ? { status: "signedIn", account: query.data.account }
      : { status: "signedOut" };
  } else if (query.isError) {
    session = { status: "unreachable", retrying: query.isFetching };
  } else {
    session = { status: "loading" };
  }

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  return { session, retry };
}

/** Writes a server answer into the session query (register, login, logout, rename, delete). */
export function useSetSession(): (next: SessionResponse) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (next: SessionResponse) => queryClient.setQueryData(SESSION_QUERY_KEY, next),
    [queryClient],
  );
}
