import { Link, Navigate } from "@tanstack/react-router";
import { LoginText } from "../components/account/LoginText";
import { PageHeading } from "../components/layout/PageHeading";
import { LINK_BUTTON } from "../components/layout/styles";
import { Reveal, type RevealPack } from "../components/packs/Reveal";
import { useEntrance } from "../hooks/useEntrance";
import { useGame } from "../hooks/useGame";
import { isolate } from "../lib/bidi";
import { shopCopy } from "../lib/economyCopy";
import type { ShopPack } from "../lib/game";
import { pageHeading } from "../lib/routes";

function toReveal({ receipt, theme }: ShopPack): RevealPack {
  return {
    id: receipt.pack.openingId,
    heading: <LoginText text={{ template: shopCopy.revealHeading, login: theme.title }} />,
    label: shopCopy.revealHeading(isolate(theme.title)),
    summaryLead: "",
    cards: receipt.pack.cards,
    franchises: receipt.pack.franchises,
    // A shop pack is never Enchanted or pity-due; a Radiant one says so (card-and-rarity.md §7.2).
    lines: receipt.pack.packKind === "radiant" ? [shopCopy.radiant(theme.odds)] : [],
  };
}

/**
 * `/shop/open` (market-and-shop.md §3.3 step 6; navigation-and-landing.md
 * §3.13): the pack last bought in the shop, held in the layout's game. The
 * `h1`, `Back to the shop`, then the reveal. There is no buy button here, so
 * a Karma spend always starts from `/shop`, its price and its odds. With
 * nothing held the page replaces itself with `/shop`.
 */
export function ShopOpenPage() {
  const game = useGame();
  const { shopPack, shopPackLandedShowing } = game.state;
  // A pack bought while `/shop` showed enters on the page change that follows; one that landed after the
  // player left shows without it, even on its first showing through `See your latest shop pack` (§3.10 item 2).
  const entering = useEntrance(shopPack, shopPackLandedShowing, game.shownShopPacks);
  if (shopPack === null) return <Navigate to="/shop" replace />;

  return (
    <>
      <PageHeading text={pageHeading("/shop/open")} />
      <Link to="/shop" className={LINK_BUTTON.secondary}>
        {shopCopy.back}
      </Link>
      <Reveal
        pack={toReveal(shopPack)}
        poolSize={shopPack.poolSize}
        entering={entering}
        effects="full"
        showNew
        busy={false}
        reserve="heading"
      />
    </>
  );
}
