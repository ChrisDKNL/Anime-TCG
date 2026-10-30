import type { PackOpened, PublishedOdds } from "@anime-tcg/shared/api";
import { Link, Navigate } from "@tanstack/react-router";
import { useId } from "react";
import { BUTTON } from "../components/account/styles";
import { PageHeading } from "../components/layout/PageHeading";
import { LINK_BUTTON } from "../components/layout/styles";
import { ignoreRepeat, openOnce } from "../components/packs/activation";
import { Reveal, type RevealPack } from "../components/packs/Reveal";
import { usePackOpeningPage } from "../hooks/usePackOpeningPage";
import { packControlCopy, revealCopy } from "../lib/packsCopy";
import { pageHeading } from "../lib/routes";

/**
 * The special-pack lines from the pack's stored kind and pity flag, never
 * from its cards (card-and-rarity.md §7.1); their numbers are the held odds',
 * so without a snapshot's odds there is no line to write.
 */
function specialLines(pack: PackOpened, odds: PublishedOdds | null): string[] {
  if (odds === null) return [];
  const lines: string[] = [];
  if (pack.packKind === "enchanted") lines.push(revealCopy.enchanted(odds));
  if (pack.packKind === "radiant") lines.push(revealCopy.radiant(odds));
  if (pack.pityMythic) lines.push(revealCopy.pityMythic(odds));
  return lines;
}

function toReveal(pack: PackOpened, odds: PublishedOdds | null): RevealPack {
  const heading = revealCopy.heading(pack.packKind);
  return {
    id: pack.openingId,
    heading,
    label: heading,
    summaryLead: "",
    cards: pack.cards,
    franchises: pack.franchises,
    lines: specialLines(pack, odds),
  };
}

/**
 * `/packs/open` (packs-page.md §3.7, §4.4, §5.5; navigation-and-landing.md
 * §3.13): the current opening and its cards. Under the `h1`, the count line,
 * `Open pack`, which opens the next pack in place, and `Back to packs`; then
 * the reveal. No countdown, pity line or odds: they stay on `/packs`. With
 * nothing in flight and no cards held the page replaces itself with `/packs`.
 */
export function PackOpeningPage() {
  const page = usePackOpeningPage();
  const countId = useId();
  if (page.nothingHeld) return <Navigate to="/packs" replace />;
  const { control } = page;

  return (
    <>
      <PageHeading text={pageHeading("/packs/open")} />
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
        {control.count !== null && (
          <p id={countId} className="text-sm font-medium text-zinc-200 tabular-nums">
            {control.count}
          </p>
        )}
        <button
          type="button"
          aria-disabled={control.button.enabled ? undefined : "true"}
          aria-describedby={control.describedByCount ? countId : undefined}
          onClick={control.button.enabled ? (event) => openOnce(event, page.open) : undefined}
          onKeyDown={ignoreRepeat}
          className={`${BUTTON.primary} w-full tabular-nums sm:w-auto`}
        >
          {control.button.label}
        </button>
        <Link to="/packs" className={LINK_BUTTON.secondary}>
          {packControlCopy.back}
        </Link>
      </div>
      <Reveal
        pack={page.reveal === null ? null : toReveal(page.reveal, page.lastOdds)}
        poolSize={page.lastOdds?.snapshot.characterCount ?? null}
        entering={page.entering}
        effects="full"
        showNew
        busy={page.opening}
        reserve="heading"
      />
    </>
  );
}
