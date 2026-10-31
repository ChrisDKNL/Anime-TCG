import type { ShopReceipt, ShopResponse, ThemeOffer as Theme } from "@anime-tcg/shared/api";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BUTTON, STATUS_BANNER } from "../components/account/styles";
import { PageHeading } from "../components/layout/PageHeading";
import { TEXT_LINK_SM } from "../components/packs/styles";
import { BuyDialog } from "../components/shop/BuyDialog";
import { ThemeOffer, type BuyReason } from "../components/shop/ThemeOffer";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useGame } from "../hooks/useGame";
import { useRateLimitWait } from "../hooks/useKeyedAction";
import { useShellContext } from "../hooks/useShell";
import { seriesNames } from "../lib/collectionSeries";
import { shopCopy } from "../lib/economyCopy";
import { PAGE_HEADING_ID } from "../lib/pageFocus";
import { pageEyebrow, pageHeading } from "../lib/routes";

/** Nothing but the `h1` shows for this long before the skeleton does (collection-overview.md §3.1). */
const LOADING_DELAY_MS = 300;
const SKELETON_ROWS = [0, 1, 2] as const;

/** The confirmation open for one theme, and where focus goes back to when it closes without a purchase. */
interface Confirming {
  theme: Theme;
  returnFocus: HTMLElement | null;
}

/**
 * `/shop`, the shop (market-and-shop.md §3.3, §4, §5.2): the themes of
 * `GET /api/shop` in the server's order, each with its price and published
 * odds. Showing the page reads the shop and the wallet again; every price,
 * balance and card is the server's. A purchase holds its pack in the layout's
 * game and moves to `/shop/open`, which shows the cards; while one is held,
 * `See your latest shop pack` sits under the `h1`. The `h1` is there in every state.
 */
export function ShopPage() {
  const game = useGame();
  const { announce } = useShellContext();
  const shop = useQuery(game.shopQuery);
  useQuery(game.walletQuery);
  // A 429's wait lives on the page, so Cancel and a new confirmation keep it (manager decision, 2026-10-30).
  const wait = useRateLimitWait();
  const showLoading = useDelayedFlag(shop.data === undefined && !shop.isError, LOADING_DELAY_MS);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [gone, setGone] = useState(false);
  const goneNotice = useRef<HTMLParagraphElement>(null);
  const focusGone = useRef(false);

  // After the dialog has gone: the notice after `theme_unavailable`.
  useLayoutEffect(() => {
    if (focusGone.current) goneNotice.current?.focus();
    focusGone.current = false;
  });

  const { balance } = game;
  const stale = (shop.isError && shop.data !== undefined) || game.wallet.isError || balance === null;
  const reasonFor = (theme: Theme): BuyReason => {
    if (stale || balance === null) return { kind: "stale" };
    return balance < theme.price ? { kind: "tooLittle", balance } : null;
  };

  /** The dialog has held the pack; `/shop/open` is pushed and the purchase read once, after the page change (§3.3 step 6). */
  const onBought = async (receipt: ShopReceipt) => {
    if (confirming === null) return;
    const { theme } = confirming;
    setConfirming(null);
    await navigate({ to: "/shop/open" });
    announce(shopCopy.bought(theme.title, receipt.price, receipt.balance));
  };

  const onGone = () => {
    setConfirming(null);
    setGone(true);
    focusGone.current = true;
    void shop.refetch();
  };

  /** The dialog has closed (no longer modal, so the page is not inert): focus back on `Buy…`. */
  const onClose = () => {
    confirming?.returnFocus?.focus();
    setConfirming(null);
  };

  let content: ReactNode = null;
  if (shop.data !== undefined) {
    content = (
      <Themes
        data={shop.data}
        reasonFor={reasonFor}
        onBuy={(theme) => {
          const active = document.activeElement;
          setGone(false);
          setConfirming({ theme, returnFocus: active instanceof HTMLElement ? active : null });
        }}
      />
    );
  } else if (shop.isError) {
    content = <ShopError onRetry={() => void shop.refetch()} />;
  } else if (showLoading) {
    content = <ShopSkeleton />;
  }

  return (
    <>
      <PageHeading text={pageHeading("/shop")} eyebrow={pageEyebrow("/shop")} />
      {game.state.shopPack !== null && (
        <p className="mb-6">
          <Link to="/shop/open" className={TEXT_LINK_SM}>
            {shopCopy.latest}
          </Link>
        </p>
      )}
      <section aria-labelledby={PAGE_HEADING_ID} className="max-w-3xl">
        {gone && (
          <p
            ref={goneNotice}
            tabIndex={-1}
            role="status"
            className={`${STATUS_BANNER} mb-6 focus:outline-none`}
          >
            {shopCopy.gone}
          </p>
        )}
        {content}
      </section>
      {confirming !== null && balance !== null && (
        <BuyDialog
          key={confirming.theme.id}
          theme={confirming.theme}
          balance={balance}
          wait={wait}
          poolSize={shop.data?.snapshot?.characterCount ?? null}
          onBought={(receipt) => void onBought(receipt)}
          onGone={onGone}
          onClose={onClose}
        />
      )}
    </>
  );
}

function Themes({
  data,
  reasonFor,
  onBuy,
}: {
  data: ShopResponse;
  reasonFor: (theme: Theme) => BuyReason;
  onBuy: (theme: Theme) => void;
}) {
  const names = useMemo(() => seriesNames(data), [data]);
  if (data.snapshot === null || data.themes.length === 0) {
    return <p className="py-12 text-sm text-zinc-400">{shopCopy.empty}</p>;
  }
  return (
    <div>
      {data.themes.map((theme) => (
        <ThemeOffer
          key={theme.id}
          theme={theme}
          names={names}
          reason={reasonFor(theme)}
          onBuy={() => onBuy(theme)}
        />
      ))}
    </div>
  );
}

/** §4 error with nothing held. */
function ShopError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 py-12">
      <p className="text-sm text-zinc-300">{shopCopy.error}</p>
      <button type="button" onClick={onRetry} className={BUTTON.secondary}>
        {shopCopy.tryAgain}
      </button>
    </div>
  );
}

/** §4 loading after 300 ms: three static theme rows, nothing shimmers. */
function ShopSkeleton() {
  return (
    <div>
      {SKELETON_ROWS.map((row) => (
        <div key={row} aria-hidden="true" className="flex flex-col gap-2 border-b border-zinc-800 py-5">
          <div className="h-5 w-40 rounded bg-zinc-800" />
          <div className="h-4 w-64 max-w-full rounded bg-zinc-800" />
          <div className="h-4 w-full rounded bg-zinc-800" />
        </div>
      ))}
      <p role="status" className="sr-only">
        {shopCopy.loading}
      </p>
    </div>
  );
}
