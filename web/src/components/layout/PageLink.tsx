import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCurrentPageClick } from "../../hooks/useCurrentPageClick";
import type { PagePath } from "../../lib/routes";
import type { LinkState } from "./styles";

interface Props {
  to: PagePath;
  /** One class string, or one per state when the current page's link looks different (the page links). */
  className: string | Record<LinkState, string>;
  children: ReactNode;
}

/**
 * A header link: a real `<a href>` the router intercepts on a plain click,
 * marked `aria-current="page"` on its own page (the router sets it), and inert
 * when it points at the page already showing.
 */
export function PageLink({ to, className, children }: Props) {
  const { current, onClick } = useCurrentPageClick(to);
  return (
    <Link
      to={to}
      onClick={onClick}
      // The query string is never read (§3.1 rule 2), so it cannot make a page's own link look inactive.
      activeOptions={{ exact: true, includeSearch: false }}
      // An empty object stops the router adding its default `active` class.
      activeProps={{}}
      className={typeof className === "string" ? className : className[current ? "current" : "other"]}
    >
      {children}
    </Link>
  );
}
