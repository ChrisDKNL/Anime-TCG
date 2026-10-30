import { createContext, useContext, useMemo, useReducer, type ActionDispatch } from "react";
import { type DemoVisit, type DemoVisitAction, initialVisit, visitReducer } from "../lib/demo";

export interface DemoVisitStore {
  visit: DemoVisit;
  dispatch: ActionDispatch<[DemoVisitAction]>;
}

/**
 * The landing demo's visit (lib/demo.ts): held by the root layout, which is
 * mounted once per document, so it outlives every page change and only a
 * reload starts it over (manager decision, 2026-10-30). Memory only.
 */
export function useDemoVisitStore(): DemoVisitStore {
  const [visit, dispatch] = useReducer(visitReducer, initialVisit);
  return useMemo(() => ({ visit, dispatch }), [visit]);
}

export const DemoVisitContext = createContext<DemoVisitStore | null>(null);

export function useDemoVisit(): DemoVisitStore {
  const store = useContext(DemoVisitContext);
  if (store === null) throw new Error("useDemoVisit needs the root layout's DemoVisitContext");
  return store;
}
