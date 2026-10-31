import type { ReactNode } from "react";
import { useFrame } from "../../hooks/useFrame";
import { banners } from "../../lib/copy";
import { fontsCopy, footerCopy, headerCopy } from "../../lib/navigationCopy";
import { focusPageHeading, PAGE_HEADING_ID } from "../../lib/pageFocus";
import { ALERT_BANNER, STATUS_BANNER } from "../account/styles";
import { FOOTER_LINK, SKIP_LINK } from "./styles";

interface Props {
  /** The header's contents: the wordmark, the `Main` navigation and, signed in, the Account control. */
  header: ReactNode;
  children?: ReactNode;
  /** Booting there is no page yet, so no skip link (§3.2 step 1). */
  skipLink?: boolean;
}

/** Written into the build by `web/font-licenses.ts`, and answered by the dev server too. */
const FONT_LICENSES_PATH = "/licenses/fonts.txt";

/** The frame every page shares: skip link, header, the app-level banners, `<main>` and the footer. */
export function PageFrame({ header, children, skipLink = true }: Props) {
  const frame = useFrame();
  return (
    <div className="min-h-screen">
      <div className="relative mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        {skipLink && (
          // The heading takes focus without the URL changing: the app never writes a hash (§3.6 step 6).
          <a
            href={`#${PAGE_HEADING_ID}`}
            onClick={(event) => {
              event.preventDefault();
              focusPageHeading({ preventScroll: false });
            }}
            className={SKIP_LINK}
          >
            {headerCopy.skipLink}
          </a>
        )}
        <header className="flex flex-wrap items-center gap-3">{header}</header>

        {frame?.notice === "unreachable" && (
          <div role="alert" className={ALERT_BANNER}>
            <span>{banners.unreachable}</span>
            <button
              type="button"
              onClick={frame.onRetry}
              disabled={frame.retrying}
              className="rounded-lg bg-red-800/60 px-3 py-1 font-medium hover:bg-red-700/60 disabled:opacity-50"
            >
              {banners.tryAgain}
            </button>
          </div>
        )}
        {frame?.notice === "sessionEnded" && (
          <p role="status" className={STATUS_BANNER}>
            {banners.sessionEnded}
          </p>
        )}

        <main>{children}</main>

        <footer className="mt-8 flex flex-col gap-1 text-center text-xs text-ink-400">
          <p>
            {footerCopy.before}
            <a href="https://anilist.co" target="_blank" rel="noreferrer" className={FOOTER_LINK}>
              {footerCopy.link}
            </a>
            {footerCopy.after}
          </p>
          {/* OFL §2: the fonts' licence travels with them (visual-identity.md §4.1, §11.1). */}
          <p>
            {fontsCopy.before}
            <a href={FONT_LICENSES_PATH} className={FOOTER_LINK}>
              {fontsCopy.link}
            </a>
            {fontsCopy.after}
          </p>
        </footer>
      </div>
    </div>
  );
}
