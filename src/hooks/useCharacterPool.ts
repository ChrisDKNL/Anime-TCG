import { useCallback, useEffect, useState } from "react";
import { fetchCharacterPool } from "../lib/anilist";
import type { Character } from "../types";

type PoolState =
  | { status: "loading"; characters: [] }
  | { status: "ready"; characters: Character[] }
  | { status: "error"; characters: []; error: string };

interface Request {
  /** Bumped on every reload so the effect re-runs even with identical options. */
  seq: number;
  force: boolean;
}

/**
 * Loads the character pool once on mount. Exposes `reload(force)` so the UI
 * can retry after an error or bypass the 24h cache.
 */
export function useCharacterPool() {
  const [state, setState] = useState<PoolState>({ status: "loading", characters: [] });
  const [request, setRequest] = useState<Request>({ seq: 0, force: false });

  useEffect(() => {
    const controller = new AbortController();

    fetchCharacterPool({ signal: controller.signal, force: request.force })
      .then((characters) => {
        if (controller.signal.aborted) return;
        if (characters.length < 5) {
          setState({ status: "error", characters: [], error: "Pool too small to open a pack." });
          return;
        }
        setState({ status: "ready", characters });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          characters: [],
          error: err instanceof Error ? err.message : "Unknown error",
        });
      });

    return () => controller.abort();
  }, [request]);

  // Transition to "loading" happens in the event handler, not the effect, so the
  // effect only talks to the external system (the API) and never cascades renders.
  const reload = useCallback((bypassCache = false) => {
    setState({ status: "loading", characters: [] });
    setRequest((prev) => ({ seq: prev.seq + 1, force: bypassCache }));
  }, []);

  return { ...state, reload };
}
