import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CollectionOverview } from "../components/collection/CollectionOverview";
import { CollectionError, CollectionSkeleton } from "../components/collection/CollectionStates";
import { PageHeading } from "../components/layout/PageHeading";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useGame } from "../hooks/useGame";
import { PAGE_HEADING_ID } from "../lib/pageFocus";
import { pageHeading } from "../lib/routes";

/** Nothing but the `h1` shows for this long before the skeleton does (collection-overview.md §3.1 step 2). */
const LOADING_DELAY_MS = 300;

/**
 * `/collection`, the collection overview (collection-overview.md). The
 * signed-in layout holds the answer and the controls, so a held answer shows
 * at once with the search, filters, sort, view and page as they were; this
 * page's own observers refetch the answer and the wallet (whose rules the card
 * dialog's Recycle for Karma shows, market-and-shop.md §3.1 step 2) silently
 * each time it is shown. The `h1` is there in every state (§3.1).
 */
export function CollectionPage() {
  const game = useGame();
  const collection = useQuery(game.collectionQuery);
  useQuery(game.walletQuery);
  const showLoading = useDelayedFlag(collection.data === undefined && !collection.isError, LOADING_DELAY_MS);

  let content: ReactNode = null;
  if (collection.data !== undefined) {
    content = (
      <CollectionOverview
        data={collection.data}
        staleSince={collection.isError ? new Date(collection.dataUpdatedAt) : null}
        controls={game.state.overview}
        onChange={game.changeOverview}
      />
    );
  } else if (collection.isError) {
    content = <CollectionError onRetry={() => void collection.refetch()} />;
  } else if (showLoading) {
    content = <CollectionSkeleton />;
  }

  return (
    <>
      <PageHeading text={pageHeading("/collection")} />
      <section aria-labelledby={PAGE_HEADING_ID}>{content}</section>
    </>
  );
}
