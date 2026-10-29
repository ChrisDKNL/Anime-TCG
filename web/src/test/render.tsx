import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { createQueryClient } from "../lib/queryClient";
import { TestShell } from "./TestShell";

/** Renders under a fresh QueryClient and the test shell (live region + ShellContext). */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  const queryClient = createQueryClient();
  const result = render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <TestShell>{children}</TestShell>
      </QueryClientProvider>
    ),
  });
  return { ...result, queryClient };
}
