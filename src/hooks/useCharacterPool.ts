import { useCallback, useEffect, useState } from "react";
import { fetchCharacterPool } from "../lib/anilist";
import type { Character } from "../types";

type PoolState =
  | { status: "loading"; characters: [] }
  | { status: "ready"; characters: Character[] }
  | { status: "error"; characters: []; error: string };

/**
 * Loads the character pool once on mount. Exposes `reload(force)` so the UI
 * can retry after an error or bypass the 24h cache.
 */
export function useCharacterPool() {
  const [state, setState] = useState<PoolState>({ status: "loading", characters: [] });
  const [reloadToken, setReloadToken] = useState(0);
  const [force, setForce] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", characters: [] });

    fetchCharacterPool({ signal: controller.signal, force })
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
  }, [reloadToken, force]);

  const reload = useCallback((bypassCache = false) => {
    setForce(bypassCache);
    setReloadToken((n) => n + 1);
  }, []);

  return { ...state, reload };
}
