import { QueryClient } from "@tanstack/react-query";

/**
 * One client for the app and one per test. Nothing retries on its own: the
 * session check either answers or the UI shows the unreachable banner, and a
 * mutation that failed is the user's to repeat (accounts.md §3.7).
 *
 * `networkMode: "always"`: TanStack's default pauses a request after a browser
 * `offline` event and sends it on reconnect, so a Delete started offline and
 * left with Escape would fire later and sign the user out, and the unreachable
 * banner would never show. Every call runs now and fails visibly instead.
 * Mutations keep nothing after their form unmounts (`gcTime: 0`): their
 * variables hold passwords.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: "always",
      },
      mutations: { retry: false, networkMode: "always", gcTime: 0 },
    },
  });
}
