import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { createQueryClient } from "./lib/queryClient";
import { createAppRouter } from "./router";

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element to mount the app in");

const queryClient = createQueryClient();
const router = createAppRouter({ queryClient });

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
