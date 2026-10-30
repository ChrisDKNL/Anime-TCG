import type { ShopReceipt, ShopResponse, ThemeOffer as Theme } from "@anime-tcg/shared/api";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LoginText } from "../components/account/LoginText";
import { BUTTON, STATUS_BANNER } from "../components/account/styles";
import { PageHeading } from "../components/layout/PageHeading";
import { Reveal, type RevealPack } from "../components/packs/Reveal";
import { BuyDialog } from "../components/shop/BuyDialog";
import { ThemeOffer, type BuyReason } from "../components/shop/ThemeOffer";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useGame } from "../hooks/useGame";
import { useShellContext } from "../hooks/useShell";
import { seriesNames } from "../lib/collectionSeries";
import { shopCopy } from "../lib/economyCopy";
import { PAGE_HEADING_ID } from "../lib/pageFocus";
import { pageHeading } from "../lib/routes";

/** Nothing but the `h1` shows for this long before the skeleton does (collection-overview.md §3.1). */
const LOADING_DELAY_MS = 300;
const SKELETON_ROWS = [0, 1, 2] as const;

/** A purchase the server answered: its pack and the theme it was bought from, for the reveal's heading. */
interface Bought {
  receipt: ShopReceipt;
  theme: Theme;
}

/** The confirmation open for one theme, and where focus goes back to when it closes without a purchase. */
interface Confirming {
  theme: Theme;
  returnFocus: HTMLElement | null;
}

function toReveal({ receipt, theme }: Bought): RevealPack {
  return {
    id: receipt.pack.openingId,
    heading: <LoginText text={{ template: shopCopy.revealHeading, login: theme.title }} />,
    cards: receipt.pack.cards,
    franchises: receipt.pack.franchises,
    // A shop pack is never Enchanted or pity-due; a Radiant one says so (card-and-rarity.md §7.2).
    lines: receipt.pack.packKind === "radiant" ? [shopCopy.radiant(theme.odds)] : [],
  };
}

/**
 * `/shop`, the shop (market-and-shop.md §3.3, §4, §5.2): the themes of
 * `GET /api/shop` in the server's order, each with its price and published
 * odds, and the reveal of the last pack bought here above them. Showing the
 * page reads the shop and the wallet again; every price, balance and card
 * is the server's. The reveal stays until the page is left or another pack
 * is bought. The `h1` is there in every state.
 */
export function ShopPage() {
  const game = useGame();
  const { announce } = useShellContext();
  const shop = useQuery(game.shopQuery);
  useQuery(game.walletQuery);
  const showLoading = useDelayedFlag(shop.data === undefined && !shop.isError, LOADING_DELAY_MS);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [bought, setBought] = useState<Bought | null>(null);
  const [gone, setGone] = useState(false);
  const revealHeading = useRef<HTMLHeadingElement>(null);
  const goneNotice = useRef<HTMLParagraphElement>(null);
  const focusAfter = useRef<"reveal" | "gone" | null>(null);

  // After the dialog has gone: the reveal's heading after a purchase, the notice after `theme_unavailable`.
  useLayoutEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === "reveal") revealHeading.current?.focus();
    if (target === "gone") goneNotice.current?.focus();
  });

  const { balance } = game;
  const stale = (shop.isError && shop.data !== undefined) || game.wallet.isError || balance === null;
  const reasonFor = (theme: Theme): BuyReason => {
    if (stale || balance === null) return { kind: "stale" };
    return balance < theme.price ? { kind: "tooLittle", balance } : null;
  };

  const onBought = (receipt: ShopReceipt) => {
    if (confirming === null) return;
    const { theme } = confirming;
    setConfirming(null);
    setBought({ receipt, theme });
    focusAfter.current = "reveal";
    announce(shopCopy.bought(theme.title, receipt.price, receipt.balance));
  };

  const onGone = () => {
    setConfirming(null);
    setGone(true);
    focusAfter.current = "gone";
    void shop.refetch();
  };

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
      <PageHeading text={pageHeading("/shop")} />
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
        {bought !== null && (
          <Reveal
            pack={toReveal(bought)}
            poolSize={shop.data?.snapshot?.characterCount ?? null}
            entering
            effects="full"
            showNew
            busy={false}
            headingRef={revealHeading}
            className="mb-8"
          />
        )}
        {content}
      </section>
      {confirming !== null && balance !== null && (
        <BuyDialog
          key={confirming.theme.id}
          theme={confirming.theme}
          balance={balance}
          onBought={onBought}
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
