import type { AccountResponse, SignedIn } from "@anime-tcg/shared/api";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  changePassword,
  checkInvite,
  deleteAccount,
  isApiError,
  login,
  logout,
  register,
  renameLogin,
} from "../lib/api";
import { useSetSession } from "./useAccountSession";
import { useShellContext } from "./useShell";

/**
 * One mutation per api route. Each writes the server's answer into the session
 * query; the signed-in ones end the session on `unauthenticated` (§4.8) so no
 * form has to know about that case.
 */

function useEndSessionOnUnauthenticated(): (err: unknown) => void {
  const { sessionEnded } = useShellContext();
  return useCallback(
    (err: unknown) => {
      if (isApiError(err, "unauthenticated")) sessionEnded();
    },
    [sessionEnded],
  );
}

export function useCheckInviteMutation() {
  return useMutation({ mutationFn: checkInvite });
}

export function useRegisterMutation() {
  const setSession = useSetSession();
  return useMutation({ mutationFn: register, onSuccess: (signedIn: SignedIn) => setSession(signedIn) });
}

export function useLoginMutation() {
  const setSession = useSetSession();
  return useMutation({ mutationFn: login, onSuccess: (signedIn: SignedIn) => setSession(signedIn) });
}

export function useLogoutMutation() {
  const setSession = useSetSession();
  return useMutation({ mutationFn: logout, onSuccess: () => setSession({ signedIn: false }) });
}

export function useRenameMutation() {
  const setSession = useSetSession();
  const onError = useEndSessionOnUnauthenticated();
  return useMutation({
    mutationFn: renameLogin,
    onSuccess: ({ account }: AccountResponse) => setSession({ signedIn: true, account }),
    onError,
  });
}

export function useChangePasswordMutation() {
  const onError = useEndSessionOnUnauthenticated();
  return useMutation({ mutationFn: changePassword, onError });
}

export function useDeleteAccountMutation() {
  const setSession = useSetSession();
  const onError = useEndSessionOnUnauthenticated();
  return useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => setSession({ signedIn: false }),
    onError,
  });
}
