import type { ReactNode } from "react";
import { headerCopy } from "../../lib/navigationCopy";
import { PageFrame } from "./PageFrame";
import { PageLink } from "./PageLink";
import { HEADER_TEXT_LINK, LINK_BUTTON } from "./styles";
import { Wordmark } from "./Wordmark";

/** The signed-out frame (navigation-and-landing.md §3.5 step 1): the wordmark to `/`, then `Log in` and `Register`. */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame
      header={
        <>
          <Wordmark to="/" />
          <nav aria-label={headerCopy.navLabel} className="flex items-center gap-2">
            <PageLink to="/login" className={HEADER_TEXT_LINK}>
              {headerCopy.logIn}
            </PageLink>
            <PageLink to="/register" className={LINK_BUTTON.secondary}>
              {headerCopy.register}
            </PageLink>
          </nav>
        </>
      }
    >
      {children}
    </PageFrame>
  );
}
