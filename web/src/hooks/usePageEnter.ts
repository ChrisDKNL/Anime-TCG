import { createContext, useContext, useState } from "react";

/**
 * Whether the page now rendering came by a navigation: true once the router has finished showing a
 * first page. Provided by the root layout; without it (a component rendered on its own) nothing enters.
 */
export const NavigatedContext = createContext<() => boolean>(() => false);

/**
 * `page-enter` (visual-identity.md §9.1) runs on navigation only, never on a load or a reload. The answer
 * is taken once, when the page's header mounts: a later render of the same page does not replay it.
 */
export function usePageEnter(): boolean {
  const navigated = useContext(NavigatedContext);
  const [entering] = useState(navigated);
  return entering;
}
