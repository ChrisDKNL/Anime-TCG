import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCurrentPageClick } from "../../hooks/useCurrentPageClick";
import { sectionOf, type PagePath } from "../../lib/routes";
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
 * when it points at the page already showing. On an opening page its
 * section's link keeps the current fill and reads `aria-current="true"`, the
 * current section rather than the current page, and still goes to the
 * section page (navigation-and-landing.md §3.13 step 6).
 */
export function PageLink({ to, className, children }: Props) {
  const { current, onClick } = useCurrentPageClick(to);
  const inSection = useLocation({ select: (location) => sectionOf(location.pathname) === to });
  return (
    <Link
      to={to}
      onClick={onClick}
      // The query string is never read (§3.1 rule 2), so it cannot make a page's own link look inactive.
      activeOptions={{ exact: true, includeSearch: false }}
      // An empty object stops the router adding its default `active` class.
      activeProps={{}}
      inactiveProps={inSection ? { "aria-current": "true" } : {}}
      className={
        typeof className === "string" ? className : className[current || inSection ? "current" : "other"]
      }
    >
      {children}
    </Link>
  );
}
