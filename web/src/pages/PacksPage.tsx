import { Link } from "@tanstack/react-router";
import { PageHeading } from "../components/layout/PageHeading";
import { PackControl } from "../components/packs/PackControl";
import { TEXT_LINK_SM } from "../components/packs/styles";
import { usePacksPage } from "../hooks/usePacksPage";
import { packControlCopy } from "../lib/packsCopy";
import { pageHeading } from "../lib/routes";

/**
 * `/packs` (packs-page.md §3.1, §5.1): the pack control under the page's
 * `h1`. Every number is the server's last answer. Opening a pack moves to
 * `/packs/open`, which shows the cards (§3.7); while they are held, the
 * control block ends with `See your latest pack`. The opening and its cards
 * live in the root layout's game, so a pack opened here lands even if the
 * player has moved on.
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
      {page.cardsHeld && (
        <p className="mt-4 max-w-md">
          <Link to="/packs/open" className={TEXT_LINK_SM}>
            {packControlCopy.latest}
          </Link>
        </p>
      )}
    </>
  );
}
