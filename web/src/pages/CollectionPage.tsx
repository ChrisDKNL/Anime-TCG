import { useQuery } from "@tanstack/react-query";
import { InterimCollection, type CollectionView } from "../components/collection/InterimCollection";
import { PageHeading } from "../components/layout/PageHeading";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useGame } from "../hooks/useGame";
import { pageHeading } from "../lib/routes";

/** Nothing but the `h1` shows for this long before the skeleton does (packs-page.md §4.3). */
const LOADING_DELAY_MS = 300;

/**
 * `/collection`, the interim view over `GET /api/collection` (packs-page.md
 * §3.6). The layout holds the answer, so a held one shows at once; this
 * page's own observer refetches it silently each time the page is shown.
 */
export function CollectionPage() {
  const game = useGame();
  const collection = useQuery(game.collectionQuery);
  const showLoading = useDelayedFlag(collection.data === undefined && !collection.isError, LOADING_DELAY_MS);

  let view: CollectionView;
  if (collection.data !== undefined) {
    const staleSince = collection.isError ? new Date(collection.dataUpdatedAt) : null;
    view = { kind: "loaded", data: collection.data, staleSince };
  } else if (collection.isError) view = { kind: "error" };
  else view = showLoading ? { kind: "loading" } : { kind: "blank" };

  return (
    <>
      <PageHeading text={pageHeading("/collection")} />
      <InterimCollection
        view={view}
        filter={game.state.rarityFilter}
        onFilter={game.setRarityFilter}
        onRetry={() => void collection.refetch()}
      />
    </>
  );
}
