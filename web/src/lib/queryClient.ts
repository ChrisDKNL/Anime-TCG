import { QueryClient } from "@tanstack/react-query";

/**
 * One client for the app and one per test. Nothing retries on its own: the
 * session check either answers or the UI shows the unreachable banner, and a
 * mutation that failed is the user's to repeat (accounts.md §3.7).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
      mutations: { retry: false },
    },
  });
}
