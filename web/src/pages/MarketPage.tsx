import { useQuery } from "@tanstack/react-query";
import { PageHeading } from "../components/layout/PageHeading";
import { ViewSwitch } from "../components/collection/ViewSwitch";
import { MarketBrowse } from "../components/market/MarketBrowse";
import { MyListings } from "../components/market/MyListings";
import { useGame } from "../hooks/useGame";
import { useRateLimitWait } from "../hooks/useKeyedAction";
import { useCancelListing, useMarketBlocks } from "../hooks/useMarketActions";
import type { MarketView } from "../lib/market";
import { browseCopy } from "../lib/marketCopy";
import { PAGE_HEADING_ID } from "../lib/pageFocus";
import { pageHeading } from "../lib/routes";

const VIEWS: readonly MarketView[] = ["browse", "mine"];
const VIEW_LABELS: Readonly<Record<MarketView, string>> = {
  browse: browseCopy.views.browse,
  mine: browseCopy.views.mine,
};

/**
 * `/market` (market-and-shop.md §3.4 to §3.6): Browse and My listings. The
 * view, the search, the filters and the sort are the signed-in layout's, so
 * they survive page changes and reset on reload and log out; nothing is in
 * the address or in storage. Showing the page reads the wallet again, whose
 * balance and rules the buy and the limits show. The 429 wait, the
 * `market_limit` refusals and the cancels in flight live on the page, so
 * closing a dialog and opening it again keeps them. The `h1` is there in
 * every state.
 */
export function MarketPage() {
  const game = useGame();
  useQuery(game.walletQuery);
  const controls = game.state.market;
  const wait = useRateLimitWait();
  const blocks = useMarketBlocks();
  const cancel = useCancelListing(wait);

  return (
    <>
      <PageHeading text={pageHeading("/market")} />
      <section aria-labelledby={PAGE_HEADING_ID}>
        <ViewSwitch
          views={VIEWS}
          labels={VIEW_LABELS}
          tab={controls.view}
          disabled={false}
          onChange={(view) => game.changeMarket({ type: "view", view })}
        />
        {controls.view === "browse" ? (
          <MarketBrowse controls={controls} wait={wait} blocks={blocks} cancel={cancel} />
        ) : (
          <MyListings cancel={cancel} wait={wait} />
        )}
      </section>
    </>
  );
}
