import type { ClosedListing, KarmaRules, Listing, MarketMine, PurchaseReceipt } from "@anime-tcg/shared/api";
import { RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { useQuery } from "@tanstack/react-query";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { useGame } from "../../hooks/useGame";
import type { RateLimitWait } from "../../hooks/useKeyedAction";
import { cancelEnded, type CancelListing, type CancelResult } from "../../hooks/useMarketActions";
import { actionCopy } from "../../lib/economyCopy";
import { mineCopy } from "../../lib/marketCopy";
import { BUTTON } from "../account/styles";
import { CancelLine } from "./CancelLine";
import { Thumbnail } from "./Thumbnail";

/** Nothing but the view shows for this long before the skeleton does (collection-overview.md §3.1). */
const LOADING_DELAY_MS = 300;
const SKELETON_ROWS = [0, 1, 2] as const;

/** The last cancel's answer and the listing it was for. */
interface Cancelled {
  listing: Listing;
  result: CancelResult;
}

interface Props {
  cancel: CancelListing;
  wait: RateLimitWait;
}

/**
 * My listings (market-and-shop.md §3.6, §5.3, §7): `GET /api/market/mine`,
 * read each time the view is shown and after a cancel, in four parts: the
 * active listings with `Cancel listing`, the window limits' room, the
 * listings closed and the cards bought in the last 30 days. Every figure is
 * the server's; the one sum is a listing's net, its price less its own fee.
 */
export function MyListings({ cancel, wait }: Props) {
  const game = useGame();
  const mine = useQuery(game.marketMineQuery);
  const rules = game.wallet.data?.wallet.rules ?? null;
  const showLoading = useDelayedFlag(mine.data === undefined && !mine.isError, LOADING_DELAY_MS);
  const [last, setLast] = useState<Cancelled | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusStatus = useRef(false);

  // §7: after a cancel, focus moves to the status line once it shows.
  useLayoutEffect(() => {
    if (focusStatus.current) statusRef.current?.focus();
    focusStatus.current = false;
  });

  const run = async (listing: Listing) => {
    const result = await cancel.cancel(listing);
    if (result === null) return;
    focusStatus.current = cancelEnded(result);
    setLast({ listing, result });
  };

  if (mine.data === undefined) {
    if (mine.isError) {
      return (
        <div className="flex max-w-3xl flex-col items-start gap-3 py-12">
          <p className="text-sm text-zinc-300">{mineCopy.error}</p>
          <button type="button" onClick={() => void mine.refetch()} className={BUTTON.secondary}>
            {mineCopy.tryAgain}
          </button>
        </div>
      );
    }
    return showLoading ? <MineSkeleton /> : null;
  }

  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-8">
      {last !== null && cancelEnded(last.result) && (
        <CancelLine result={last.result} name={last.listing.character.name} statusRef={statusRef} />
      )}
      <Active
        data={mine.data}
        rules={rules}
        cancel={cancel}
        wait={wait}
        last={last}
        onCancel={(listing) => void run(listing)}
      />
      <Part heading={mineCopy.limitsHeading(rules?.window.seconds ?? null)}>
        <p className="text-sm text-zinc-300 tabular-nums">{mineCopy.limits(mine.data.left)}</p>
      </Part>
      <Part heading={mineCopy.closedHeading}>
        <Rows
          items={mine.data.closed}
          keyOf={(listing) => listing.listingId}
          render={(listing) => <ClosedRow listing={listing} />}
        />
      </Part>
      <Part heading={mineCopy.boughtHeading}>
        <Rows
          items={mine.data.purchases}
          keyOf={(purchase) => purchase.purchaseId}
          render={(purchase) => <BoughtRow purchase={purchase} />}
        />
      </Part>
    </div>
  );
}

function Part({ heading, children }: { heading: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-base font-semibold text-zinc-100 tabular-nums">
        {heading}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Rows<T>({
  items,
  keyOf,
  render,
  empty = mineCopy.empty,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  empty?: string;
}) {
  if (items.length === 0) return <p className="text-sm text-zinc-400">{empty}</p>;
  return (
    // eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics under `list-style: none` (collection-overview.md §7).
    <ul role="list">
      {items.map((item) => (
        <li key={keyOf(item)} className="flex gap-3 border-b border-zinc-800 py-3">
          {render(item)}
        </li>
      ))}
    </ul>
  );
}

function Active({
  data,
  rules,
  cancel,
  wait,
  last,
  onCancel,
}: {
  data: MarketMine;
  rules: KarmaRules | null;
  cancel: CancelListing;
  wait: RateLimitWait;
  last: Cancelled | null;
  onCancel: (listing: Listing) => void;
}) {
  return (
    <Part heading={mineCopy.activeHeading(data.active.length, rules?.maxListings ?? null)}>
      <Rows
        items={data.active}
        keyOf={(listing) => listing.listingId}
        empty={mineCopy.activeEmpty}
        render={(listing) => (
          <ActiveRow
            listing={listing}
            cancelling={cancel.cancelling.has(listing.listingId)}
            waitSeconds={wait.seconds}
            result={last?.listing.listingId === listing.listingId ? last.result : null}
            onCancel={() => onCancel(listing)}
          />
        )}
      />
    </Part>
  );
}

function ActiveRow({
  listing,
  cancelling,
  waitSeconds,
  result,
  onCancel,
}: {
  listing: Listing;
  cancelling: boolean;
  waitSeconds: number | null;
  /** This row's last cancel answer that kept the listing: no answer, a failure or a 429. */
  result: CancelResult | null;
  onCancel: () => void;
}) {
  const blocked = cancelling || waitSeconds !== null;
  let label: string = result?.kind === "noAnswer" ? actionCopy.tryAgain : mineCopy.cancel;
  if (cancelling) label = mineCopy.cancelling;
  else if (waitSeconds !== null) label = actionCopy.waitButton(waitSeconds);
  return (
    <>
      <Thumbnail character={listing.character} rarity={listing.rarity} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <ListingText name={listing.character.name} rarity={RARITY_LABEL[listing.rarity]} />
          <p className="text-xs text-zinc-400 tabular-nums">{mineCopy.price(listing.price)}</p>
          <p className="text-xs text-zinc-400 tabular-nums">
            {mineCopy.fee(listing.fee, listing.price - listing.fee)}
          </p>
          <p className="text-xs text-zinc-400 tabular-nums">{mineCopy.until(listing.expiresAt)}</p>
          {result !== null && !cancelEnded(result) && (
            <CancelLine result={result} name={listing.character.name} />
          )}
        </div>
        <button
          type="button"
          aria-label={label === mineCopy.cancel ? mineCopy.cancelName(listing.character.name) : undefined}
          aria-disabled={blocked ? "true" : undefined}
          onClick={blocked ? undefined : onCancel}
          className={`${BUTTON.secondary} shrink-0 self-start tabular-nums`}
        >
          {label}
        </button>
      </div>
    </>
  );
}

function ListingText({ name, rarity }: { name: string; rarity: string }) {
  return (
    <>
      <p dir="auto" className="text-sm break-words text-zinc-100">
        {name}
      </p>
      <p className="text-xs text-zinc-400">{rarity}</p>
    </>
  );
}

function ClosedRow({ listing }: { listing: ClosedListing }) {
  let status: string = mineCopy.expired;
  if (listing.status === "sold") {
    status =
      listing.proceeds === null
        ? mineCopy.soldFor(listing.price)
        : mineCopy.sold(listing.price, listing.proceeds);
  } else if (listing.status === "cancelled") status = mineCopy.cancelled;
  return (
    <>
      <Thumbnail character={listing.character} rarity={listing.rarity} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <ListingText name={listing.character.name} rarity={RARITY_LABEL[listing.rarity]} />
        <p className="text-xs text-zinc-300 tabular-nums">{status}</p>
        {listing.closedAt !== null && (
          <p className="text-xs text-zinc-400 tabular-nums">{mineCopy.date(listing.closedAt)}</p>
        )}
      </div>
    </>
  );
}

function BoughtRow({ purchase }: { purchase: PurchaseReceipt }) {
  const { card } = purchase;
  return (
    <>
      <Thumbnail character={card.character} rarity={card.rarity} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <ListingText name={card.character.name} rarity={RARITY_LABEL[card.rarity]} />
        <p className="text-xs text-zinc-400 tabular-nums">{mineCopy.price(purchase.price)}</p>
        <p className="text-xs text-zinc-400 tabular-nums">{mineCopy.date(purchase.boughtAt)}</p>
      </div>
    </>
  );
}

/** §4 loading after 300 ms: static rows, nothing shimmers. */
function MineSkeleton() {
  return (
    <div className="mt-6 max-w-3xl">
      {SKELETON_ROWS.map((row) => (
        <div key={row} aria-hidden="true" className="flex gap-3 border-b border-zinc-800 py-3">
          <div className="h-[67px] w-12 rounded-[6px] bg-zinc-800" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-4 w-40 rounded bg-zinc-800" />
            <div className="h-3 w-24 rounded bg-zinc-800" />
          </div>
        </div>
      ))}
      <p role="status" className="sr-only">
        {mineCopy.loading}
      </p>
    </div>
  );
}
