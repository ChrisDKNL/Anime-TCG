import type { DemoOpened } from "@anime-tcg/shared/api";
import { Link } from "@tanstack/react-router";
import { DemoControl } from "../components/landing/DemoControl";
import { JoinOffer } from "../components/landing/JoinOffer";
import { PackOdds } from "../components/landing/PackOdds";
import { PageHeading } from "../components/layout/PageHeading";
import { TEXT_LINK } from "../components/layout/styles";
import { Reveal, type RevealPack } from "../components/packs/Reveal";
import { SECONDARY_LINE } from "../components/packs/styles";
import { useLandingDemo } from "../hooks/useLandingDemo";
import { demoCopy, landingCopy, landingText } from "../lib/navigationCopy";
import { PAGE_HEADING_ID } from "../lib/pageFocus";
import { pageHeading } from "../lib/routes";

/** The demo's cards in the shared reveal: no heading, no `New`, no special lines (§3.7 item 1.4). */
function toReveal(n: number, opened: DemoOpened): RevealPack {
  return {
    id: `demo-${n}`,
    heading: null,
    label: demoCopy.listLabel,
    summaryLead: demoCopy.summaryLead,
    cards: opened.cards,
    franchises: opened.franchises,
    lines: [],
  };
}

/**
 * `/`, signed out (navigation-and-landing.md §3.7): the heading, the lede from
 * the server's pool facts, the demo pack and its reveal, How it plays with the
 * server's numbers and odds, then Join. The page holds no number of its own,
 * keeps its demo cards in component state only, and reads and writes no
 * storage and no address.
 */
export function LandingPage() {
  const demo = useLandingDemo();
  const text = landingText(demo.facts);
  const odds = demo.facts?.odds ?? null;
  const { control, keepCards } = demo.view;

  return (
    <>
      <section aria-labelledby={PAGE_HEADING_ID}>
        <div className="max-w-3xl">
          <PageHeading
            text={pageHeading("/")}
            className="text-3xl font-black tracking-tight text-zinc-100 focus:outline-none sm:text-4xl"
          />
          <p className="mt-3 max-w-xl text-base text-zinc-300 tabular-nums">{text.lede}</p>
          <DemoControl control={control} onOpen={demo.open} />
        </div>
        <Reveal
          pack={demo.pack === null ? null : toReveal(demo.pack.n, demo.pack.opened)}
          poolSize={odds?.snapshot.characterCount ?? null}
          entering
          effects="none"
          showNew={false}
          busy={demo.opening}
          spacing="mt-6"
        />
        {keepCards && (
          <p className={`mt-4 ${SECONDARY_LINE}`}>
            {demoCopy.keepCards.before}
            <Link to="/register" className={TEXT_LINK}>
              {demoCopy.keepCards.link}
            </Link>
            {demoCopy.keepCards.after}
          </p>
        )}
      </section>

      <div className="max-w-3xl">
        <section aria-labelledby="how-it-plays" className="mt-16">
          <h2 id="how-it-plays" className="text-lg font-bold text-zinc-100">
            {landingCopy.howItPlays}
          </h2>
          <dl className="mt-4 grid gap-y-3 sm:grid-cols-[8rem_1fr] sm:gap-x-6">
            {text.rows.map((row) => (
              <div key={row.term} className="contents">
                <dt className="text-sm font-semibold text-zinc-200">{row.term}</dt>
                <dd className="text-sm text-zinc-400 tabular-nums">{row.text}</dd>
              </div>
            ))}
          </dl>
          {odds !== null && <PackOdds odds={odds} />}
        </section>

        <section aria-labelledby="join" className="mt-16 border-t border-zinc-800 pt-8">
          <h2 id="join" className="mb-3 text-lg font-bold text-zinc-100">
            {landingCopy.join}
          </h2>
          <JoinOffer />
        </section>
      </div>
    </>
  );
}
