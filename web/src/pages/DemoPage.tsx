import type { DemoOpened } from "@anime-tcg/shared/api";
import { Link } from "@tanstack/react-router";
import { DemoControl } from "../components/landing/DemoControl";
import { PageHeading } from "../components/layout/PageHeading";
import { LINK_BUTTON, TEXT_LINK } from "../components/layout/styles";
import { Reveal, type RevealPack } from "../components/packs/Reveal";
import { SECONDARY_LINE } from "../components/packs/styles";
import { useLandingDemo } from "../hooks/useLandingDemo";
import { demoCopy } from "../lib/navigationCopy";
import { pageEyebrow, pageHeading } from "../lib/routes";

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
 * `/demo`, signed out (navigation-and-landing.md §3.14, §4.9, §5.4): the demo
 * pack's own page, reached from `/` or by its address. Under the `h1`,
 * `Open a demo pack` beside `Back to the landing page`, the disclosure, then
 * the reveal and the keep-cards line. Every state of the control shows here,
 * and a direct load shows the page ready: it needs nothing held. The cards,
 * the count and a 429 wait are the root layout's for the page load, so Back
 * and Forward find them; there is no count line (§9.2, the designer's call).
 */
export function DemoPage() {
  const demo = useLandingDemo("demo");
  const odds = demo.facts?.odds ?? null;
  const { control, keepCards } = demo.view;

  return (
    <>
      <PageHeading text={pageHeading("/demo")} eyebrow={pageEyebrow("/demo")} />
      <DemoControl
        control={control}
        finishedHere={demo.finishedHere}
        onOpen={demo.open}
        back={
          <Link to="/" className={LINK_BUTTON.secondary}>
            {demoCopy.back}
          </Link>
        }
      />
      <Reveal
        pack={demo.pack === null ? null : toReveal(demo.pack.n, demo.pack.opened)}
        poolSize={odds?.snapshot.characterCount ?? null}
        entering={demo.entering}
        effects="none"
        showNew={false}
        busy={demo.opening}
        reserve="summary"
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
    </>
  );
}
