import type { PackOpened, PublishedOdds } from "@anime-tcg/shared/api";
import { PageHeading } from "../components/layout/PageHeading";
import { PackControl } from "../components/packs/PackControl";
import { Reveal, type RevealPack } from "../components/packs/Reveal";
import { usePacksPage } from "../hooks/usePacksPage";
import { revealCopy } from "../lib/packsCopy";
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
 * `/packs` (packs-page.md §3.1): the pack control and the last reveal under
 * the page's `h1`. Every number is the server's last answer; the opening and
 * its reveal live in the root layout's game, so a pack opened here lands even
 * if the player has moved on, and coming back shows it without its entrance.
 */
export function PacksPage() {
  const page = usePacksPage();
  return (
    <>
      <PageHeading text={pageHeading("/packs")} />
      <PackControl
        view={page.view}
        odds={page.odds}
        onOpen={page.open}
        onCheckNextPack={page.checkNextPack}
        onReload={page.reload}
      />
      <Reveal
        pack={page.reveal === null ? null : toReveal(page.reveal, page.lastOdds)}
        poolSize={page.lastOdds?.snapshot.characterCount ?? null}
        entering={page.entering}
        effects="full"
        showNew
        busy={page.opening}
      />
    </>
  );
}
