import { useCallback, useState } from "react";
import { common } from "../lib/copy";
import type { ServerWait, WaitReason } from "../lib/failures";
import { useRetryWait } from "./useRetryWait";
import { useShellContext } from "./useShell";

const STATUS_LINE: Record<WaitReason, string> = {
  misses: common.breather,
  rateLimited: common.rateLimited,
};

/**
 * A form's server-enforced wait (accounts.md §4.4 "wait"): the status line for
 * why, the countdown for the button, and `You can try again now.` announced
 * when it ends. The status line stays until the next submit clears it.
 */
export function useServerWait() {
  const { announce } = useShellContext();
  const onEnd = useCallback(() => announce(common.waitOver), [announce]);
  const { remaining, start } = useRetryWait(onEnd);
  const [reason, setReason] = useState<WaitReason | null>(null);

  const begin = useCallback(
    (wait: ServerWait) => {
      setReason(wait.reason);
      if (wait.seconds !== undefined) start(wait.seconds);
    },
    [start],
  );
  const clear = useCallback(() => setReason(null), []);

  return { remaining, statusLine: reason === null ? null : STATUS_LINE[reason], begin, clear };
}
