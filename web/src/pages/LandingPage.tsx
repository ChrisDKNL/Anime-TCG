import { useNavigate } from "@tanstack/react-router";
import { DemoControl } from "../components/landing/DemoControl";
import { JoinOffer } from "../components/landing/JoinOffer";
import { PackDrawing } from "../components/landing/PackDrawing";
import { PackOdds } from "../components/landing/PackOdds";
import { PageHeading } from "../components/layout/PageHeading";
import { useLandingDemo } from "../hooks/useLandingDemo";
import { landingCopy, landingText } from "../lib/navigationCopy";
import { PAGE_HEADING_ID } from "../lib/pageFocus";
import { pageEyebrow, pageHeading } from "../lib/routes";

/**
 * `/`, signed out (navigation-and-landing.md §3.7, §5.3, §6.2): the hero with
 * the lede from the server's pool facts, `Open a demo pack` and its disclosure
 * beside the static pack drawing; How it plays as numbered steps; `Pack odds`;
 * then Join. Opening a demo pack moves to `/demo`, where the cards are shown
 * (§3.14), so this page shows no reveal. It holds no number of its own and
 * reads and writes no storage and no address.
 */
export function LandingPage() {
  const demo = useLandingDemo("landing");
  const navigate = useNavigate();
  const text = landingText(demo.facts);
  const odds = demo.facts?.odds ?? null;

  // The request and the page change in one task, so the opening shows on `/demo` from its first frame (§3.14 step 1).
  const open = () => {
    if (demo.open()) void navigate({ to: "/demo" });
  };

  return (
    <>
      <section
        aria-labelledby={PAGE_HEADING_ID}
        className="pt-6 sm:grid sm:grid-cols-[minmax(0,1fr)_11.25rem] sm:items-center sm:gap-8 sm:pt-10 lg:grid-cols-[minmax(0,42rem)_11.25rem] lg:gap-16 lg:pt-16"
      >
        <div>
          <PageHeading text={pageHeading("/")} eyebrow={pageEyebrow("/")} size="hero" className="" />
          <p className="mt-4 max-w-xl text-base text-zinc-300 tabular-nums sm:text-lg">{text.lede}</p>
          <DemoControl control={demo.view.control} finishedHere={demo.finishedHere} onOpen={open} />
        </div>
        <PackDrawing />
      </section>

      <section aria-labelledby="how-it-plays" className="mt-20">
        <h2 id="how-it-plays" className="text-lg font-bold text-zinc-100">
          {landingCopy.howItPlays}
        </h2>
        {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics under `list-style: none` (§7 "Steps"). */}
        <ol role="list" className="mt-6 divide-y divide-zinc-800 border-y border-zinc-800">
          {text.rows.map((row, i) => (
            <li
              key={row.term}
              className="py-4 sm:grid sm:grid-cols-[2.5rem_8rem_minmax(0,1fr)] sm:items-baseline sm:gap-x-6"
            >
              <div className="flex items-baseline gap-3 sm:contents">
                <span aria-hidden="true" className="text-sm font-semibold text-zinc-400 tabular-nums">
                  {landingCopy.stepNumber(i + 1)}
                </span>
                <h3 className="text-sm font-semibold text-zinc-100">{row.term}</h3>
              </div>
              <p className="mt-1 max-w-xl text-sm text-zinc-400 tabular-nums sm:mt-0">{row.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {odds !== null && <PackOdds odds={odds} />}

      <section aria-labelledby="join" className="mt-16 border-t border-zinc-800 pt-8">
        <h2 id="join" className="mb-3 text-lg font-bold text-zinc-100">
          {landingCopy.join}
        </h2>
        <JoinOffer />
      </section>
    </>
  );
}
