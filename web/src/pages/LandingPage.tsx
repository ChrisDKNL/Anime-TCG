import { Link } from "@tanstack/react-router";
import { PageHeading } from "../components/layout/PageHeading";
import { LINK_BUTTON, TEXT_LINK } from "../components/layout/styles";
import { crossLinkCopy, headerCopy, landingCopy } from "../lib/navigationCopy";
import { PAGE_HEADING_ID } from "../lib/pageFocus";
import { pageHeading } from "../lib/routes";

/**
 * `/`, signed out (navigation-and-landing.md §3.7), as the navigation PR ships
 * it: the heading, the lede and How it plays in their no-facts form, then
 * Join. The demo pack, the live numbers and the odds table come with the demo
 * PR once 1c's server pool exists (§9 decision 1); this page calls nothing.
 */
export function LandingPage() {
  return (
    <div className="max-w-3xl">
      <section aria-labelledby={PAGE_HEADING_ID}>
        <PageHeading
          text={pageHeading("/")}
          className="text-3xl font-black tracking-tight text-zinc-100 focus:outline-none sm:text-4xl"
        />
        <p className="mt-3 max-w-xl text-base text-zinc-300">{landingCopy.lede}</p>
      </section>

      <section aria-labelledby="how-it-plays" className="mt-16">
        <h2 id="how-it-plays" className="text-lg font-bold text-zinc-100">
          {landingCopy.howItPlays}
        </h2>
        <dl className="mt-4 grid gap-y-3 sm:grid-cols-[8rem_1fr] sm:gap-x-6">
          {landingCopy.rows.map((row) => (
            <div key={row.term} className="contents">
              <dt className="text-sm font-semibold text-zinc-200">{row.term}</dt>
              <dd className="text-sm text-zinc-400">{row.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="join" className="mt-16 border-t border-zinc-800 pt-8">
        <h2 id="join" className="text-lg font-bold text-zinc-100">
          {landingCopy.join}
        </h2>
        <p className="mt-3 text-sm text-zinc-300">{landingCopy.joinSentence}</p>
        <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <Link to="/register" className={LINK_BUTTON.primary}>
            {headerCopy.register}
          </Link>
          <p className="text-sm text-zinc-300">
            {crossLinkCopy.toLogIn}{" "}
            <Link to="/login" className={TEXT_LINK}>
              {headerCopy.logIn}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
