import { Inventory } from "../components/Inventory";
import { PageHeading } from "../components/layout/PageHeading";
import { useGame } from "../hooks/useGame";
import { pageHeading } from "../lib/routes";

/** `/collection`, today's Collection tab under its `h1` (navigation-and-landing.md §3.1). */
export function CollectionPage() {
  const { account, state, stats, clearCollection } = useGame();
  return (
    <>
      <PageHeading text={pageHeading("/collection")} />
      <Inventory cards={state.cards} stats={stats} login={account.login} onClear={clearCollection} />
    </>
  );
}
