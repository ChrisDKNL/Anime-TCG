import type { CollectionEntry, FranchiseRef, Listing } from "@anime-tcg/shared/api";
import { useId, useLayoutEffect, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { useCountdown } from "../../hooks/useCountdown";
import {
  cancelEnded,
  useBuyListing,
  useMarketActions,
  type BuyListing,
  type CancelResult,
} from "../../hooks/useMarketActions";
import type { SeriesName } from "../../lib/collectionSeries";
import { actionCopy } from "../../lib/economyCopy";
import type { LimitBlock } from "../../lib/market";
import { buyCopy, listingDialogCopy } from "../../lib/marketCopy";
import { LoginText } from "../account/LoginText";
import { ALERT_BANNER, BODY_TEXT, BUTTON, PANEL_HEADING, WIDE_DIALOG } from "../account/styles";
import { Card } from "../card/Card";
import { RarityWord } from "../collection/RarityWord";
import { AlsoIn, PrimarySeries } from "../collection/SeriesLines";
import { ignoreRepeat, openOnce } from "../packs/activation";
import { ERROR_LINE, NEW_MARKER, SECONDARY_LINE, TEXT_BUTTON_SM } from "../packs/styles";
import { CancelLine } from "./CancelLine";

interface Props {
  listing: Listing;
  /** The franchises the browse pages name, with their years where titles are shared. */
  names: ReadonlyMap<number, SeriesName>;
  poolSize: number | null;
  /** The player's entries of this character, from the held collection answer. */
  held: readonly CollectionEntry[];
  /** The balance the header shows, null before the wallet's first answer. */
  balance: number | null;
  /** The wallet is stale, or never answered: `Buy…` waits for it. */
  stale: boolean;
  /** `rules.window.seconds`, for the limit line; null without the wallet. */
  windowSeconds: number | null;
  /** The dialog has closed, with nothing in flight: the page returns focus to the grid. */
  onClose: () => void;
}

/**
 * The listing dialog (market-and-shop.md §3.4 step 7, §3.5, §5.3, §7): the
 * card dialog's shell with the listing's card and facts and the player's own
 * copies of the character; then `Buy…`, or for the player's own listing
 * `Cancel listing`. `Buy…` replaces the body with the confirmation, whose one
 * request carries the key and no price, and then with the result, the card
 * the purchase delivered. While a purchase is in flight nothing closes the
 * dialog, so it cannot close on an unknown outcome. It mounts per opening.
 */
export function ListingDialog(props: Props) {
  const { listing, balance, onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const buyRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const buy = useBuyListing(listing, balance);
  const { stage, action } = buy;
  const focusBuy = useRef(false);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null || dialog.open) return;
    dialog.showModal();
    dialog.focus();
  }, []);

  // Each stage's heading takes focus as it shows (§7: a confirmation and the result focus their heading);
  // back on the details, focus returns to `Buy…`.
  useLayoutEffect(() => {
    if (stage === "details") {
      if (focusBuy.current) buyRef.current?.focus();
      focusBuy.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stage]);

  const back = () => {
    buy.back();
    focusBuy.current = true;
  };

  const close = () => {
    if (!action.sending) ref.current?.close();
  };

  /** Every close, however it came: in flight it opens again at once; from the confirmation it is `Cancel` first. */
  const onCloseEvent = () => {
    if (action.sending) {
      ref.current?.showModal();
      headingRef.current?.focus();
      return;
    }
    if (stage === "confirm") buy.back();
    onClose();
  };

  /** Escape: ignored in flight; on the confirmation it returns to the details first. */
  const onCancel = (event: SyntheticEvent) => {
    if (!action.sending && stage !== "confirm") return;
    event.preventDefault();
    if (!action.sending) back();
  };

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      onCancel={onCancel}
      onClose={onCloseEvent}
      className={WIDE_DIALOG}
    >
      <div className="flex justify-end">
        <button type="button" onClick={close} disabled={action.sending} className={TEXT_BUTTON_SM}>
          {listingDialogCopy.close}
        </button>
      </div>
      {stage === "details" && (
        <Details {...props} buy={buy} headingId={headingId} headingRef={headingRef} buyRef={buyRef} />
      )}
      {stage === "confirm" && balance !== null && (
        <BuyConfirmation
          {...props}
          balance={balance}
          buy={buy}
          onBack={back}
          headingId={headingId}
          headingRef={headingRef}
        />
      )}
      {stage === "bought" && buy.receipt !== null && (
        <Bought
          receipt={buy.receipt}
          poolSize={props.poolSize}
          headingId={headingId}
          headingRef={headingRef}
          onClose={close}
        />
      )}
      {stage === "gone" && (
        <div className="flex flex-col items-start gap-4">
          <p
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-sm text-zinc-300 focus:outline-none"
          >
            {buyCopy.gone}
          </p>
          <button type="button" onClick={close} className={BUTTON.secondary}>
            {buyCopy.close}
          </button>
        </div>
      )}
    </dialog>
  );
}

function seriesOf(listing: Listing, names: ReadonlyMap<number, SeriesName>): FranchiseRef[] {
  return listing.character.franchiseIds.flatMap((id) => names.get(id)?.franchise ?? []);
}

function Details({
  listing,
  names,
  poolSize,
  held,
  balance,
  stale,
  buy,
  headingId,
  headingRef,
  buyRef,
}: Props & {
  buy: BuyListing;
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  buyRef: RefObject<HTMLButtonElement | null>;
}) {
  const reasonId = useId();
  const { character, rarity, price } = listing;
  const [primary, ...others] = seriesOf(listing, names);
  let reason: string | null = null;
  if (stale || balance === null) reason = listingDialogCopy.stale;
  else if (balance < price) reason = listingDialogCopy.tooLittle(price, balance);

  return (
    <div className="mt-2 grid gap-6 sm:grid-cols-[15rem_1fr]">
      <div className="mx-auto w-[200px] sm:w-[240px]">
        <Card
          character={character}
          rarity={rarity}
          series={primary?.title ?? null}
          poolSize={poolSize}
          effects="full"
          size="dialog"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            dir="auto"
            className={`${PANEL_HEADING} break-words focus:outline-none`}
          >
            {character.name}
          </h2>
          {character.nameNative !== null && character.nameNative !== character.name && (
            <p dir="auto" lang="ja" className="text-sm break-words text-zinc-400">
              {character.nameNative}
            </p>
          )}
          {primary !== undefined && <PrimarySeries franchise={primary} name={names.get(primary.id)} />}
          {others.length > 0 && <AlsoIn franchises={others} names={names} />}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-400">{listingDialogCopy.facts.rarity}</dt>
          <dd className="text-zinc-200">
            <RarityWord rarity={rarity} />
          </dd>
          <dt className="text-zinc-400">{listingDialogCopy.facts.price}</dt>
          <dd className="text-zinc-200 tabular-nums">{listingDialogCopy.price(price)}</dd>
          <dt className="text-zinc-400">{listingDialogCopy.facts.until}</dt>
          <dd className="text-zinc-200 tabular-nums">{listingDialogCopy.until(listing.expiresAt)}</dd>
        </dl>
        <ul className="flex flex-col gap-1 text-sm text-zinc-300">
          {held.length === 0 ? (
            <li>{listingDialogCopy.notInCollection}</li>
          ) : (
            held.map((entry) => (
              <li key={entry.rarity} className="tabular-nums">
                {listingDialogCopy.inCollection(entry.rarity, entry.count)}
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-zinc-800 pt-5">
          {listing.mine ? (
            <OwnListing listing={listing} />
          ) : (
            <div className="flex flex-col items-start gap-1">
              <button
                ref={buyRef}
                type="button"
                aria-disabled={reason === null ? undefined : "true"}
                aria-describedby={reason === null ? undefined : reasonId}
                onClick={reason === null ? buy.ask : undefined}
                className={BUTTON.primary}
              >
                {listingDialogCopy.buy}
              </button>
              {reason !== null && (
                <p id={reasonId} className="text-xs text-zinc-400 tabular-nums">
                  {reason}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** §3.4 step 7: the player's own listing offers no buy, only `Cancel listing`, whose answer shows in place. */
function OwnListing({ listing }: { listing: Listing }) {
  const { cancel, wait } = useMarketActions();
  const [result, setResult] = useState<CancelResult | null>(null);
  const cancelling = cancel.cancelling.has(listing.listingId);
  const ended = result !== null && cancelEnded(result);
  const run = async () => {
    const answer = await cancel.cancel(listing);
    if (answer !== null) setResult(answer);
  };
  let label: string = result?.kind === "noAnswer" ? actionCopy.tryAgain : listingDialogCopy.cancelListing;
  if (cancelling) label = listingDialogCopy.cancelling;
  else if (wait.seconds !== null) label = actionCopy.waitButton(wait.seconds);
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-zinc-300">{listingDialogCopy.yours}</p>
      {!ended && (
        <button
          type="button"
          aria-disabled={cancelling || wait.seconds !== null ? "true" : undefined}
          onClick={cancelling || wait.seconds !== null ? undefined : () => void run()}
          className={`${BUTTON.secondary} tabular-nums`}
        >
          {label}
        </button>
      )}
      <CancelLine result={result} name={listing.character.name} />
    </div>
  );
}

function BuyConfirmation({
  listing,
  balance,
  windowSeconds,
  buy,
  onBack,
  headingId,
  headingRef,
}: Props & {
  /** `Buy…` is offered only with a balance held. */
  balance: number;
  buy: BuyListing;
  onBack: () => void;
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const bodyId = useId();
  const { action, line, noAnswer } = buy;
  const { blocks } = useMarketActions();
  const block = blocks.blockFor(listing.listingId);
  const left = useCountdown(block?.until ?? null);
  const limited = block !== null && left !== null && left > 0;
  const blocked = action.sending || action.wait !== null || limited || line?.kind === "tooLittle";
  let label = noAnswer ? actionCopy.tryAgain : buyCopy.confirm(listing.price);
  if (action.sending) label = buyCopy.buying;
  else if (action.wait !== null) label = actionCopy.waitButton(action.wait);

  return (
    <div className="mt-2 flex flex-col gap-4">
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        aria-describedby={bodyId}
        className={`${PANEL_HEADING} break-words focus:outline-none`}
      >
        <LoginText
          text={{
            template: (name) => buyCopy.confirmHeading(name, listing.price),
            login: listing.character.name,
          }}
        />
      </h2>
      {noAnswer ? (
        <p id={bodyId} role="alert" className={ALERT_BANNER}>
          {actionCopy.noAnswer}
        </p>
      ) : (
        <p id={bodyId} className={`${BODY_TEXT} tabular-nums`}>
          {buyCopy.confirmBody(listing.rarity, balance)}
        </p>
      )}
      {line?.kind === "serverFailure" && (
        <p role="alert" className={ALERT_BANNER}>
          {actionCopy.serverFailure}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <button
          type="button"
          aria-disabled={blocked ? "true" : undefined}
          onClick={blocked ? undefined : (event) => openOnce(event, () => void buy.confirm())}
          onKeyDown={ignoreRepeat}
          className={`${BUTTON.primary} tabular-nums`}
        >
          {label}
        </button>
        <button type="button" disabled={action.sending} onClick={onBack} className={BUTTON.secondary}>
          {buyCopy.cancel}
        </button>
      </div>
      {line?.kind === "tooLittle" && (
        <p role="alert" className={`${ERROR_LINE} tabular-nums`}>
          {buyCopy.tooLittleRefused(listing.price, line.balance)}
        </p>
      )}
      {limited && <LimitLine block={block} windowSeconds={windowSeconds} />}
      {line?.kind === "rateLimited" && (
        <p role="status" className={SECONDARY_LINE}>
          {actionCopy.rateLimited}
        </p>
      )}
    </div>
  );
}

/** §3.5 step 4 `market_limit`: whose room ran out and the date it frees up; no countdown. */
function LimitLine({ block, windowSeconds }: { block: LimitBlock; windowSeconds: number | null }) {
  return (
    <p role="alert" className={`${ERROR_LINE} tabular-nums`}>
      {buyCopy.limit(block.limit, windowSeconds, block.freesAt)}
    </p>
  );
}

/** §3.5 step 4, 201 or 200: the card the purchase delivered, from the receipt. */
function Bought({
  receipt,
  poolSize,
  headingId,
  headingRef,
  onClose,
}: {
  receipt: NonNullable<BuyListing["receipt"]>;
  poolSize: number | null;
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}) {
  const { card } = receipt;
  const primary = receipt.franchises.find((franchise) => franchise.id === card.character.franchiseIds[0]);
  return (
    <div className="mt-2 grid gap-6 sm:grid-cols-[15rem_1fr]">
      <div className="mx-auto w-[200px] sm:w-[240px]">
        <Card
          character={card.character}
          rarity={card.rarity}
          series={primary?.title ?? null}
          poolSize={poolSize}
          effects="full"
          size="dialog"
        />
      </div>
      <div className="flex min-w-0 flex-col items-start gap-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className={`${PANEL_HEADING} self-stretch [overflow-wrap:anywhere] focus:outline-none`}
        >
          <LoginText text={{ template: buyCopy.resultHeading, login: card.character.name }} />
        </h2>
        <p className="flex items-center gap-2 text-sm">
          <span>
            <RarityWord rarity={card.rarity} />
          </span>
          {card.isNew && <span className={NEW_MARKER}>{buyCopy.newMarker}</span>}
        </p>
        <p role="status" className="text-sm text-zinc-200 tabular-nums">
          {buyCopy.bought(receipt.price, receipt.balance)}
        </p>
        <button type="button" onClick={onClose} className={BUTTON.secondary}>
          {buyCopy.close}
        </button>
      </div>
    </div>
  );
}
