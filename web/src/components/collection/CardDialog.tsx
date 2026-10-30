import type { CollectionEntry } from "@anime-tcg/shared/api";
import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { useGame } from "../../hooks/useGame";
import { useListOnMarket } from "../../hooks/useListOnMarket";
import { useRecycle } from "../../hooks/useRecycle";
import { dialogCopy } from "../../lib/collectionCopy";
import type { SeriesName } from "../../lib/collectionSeries";
import type { IndexedEntry } from "../../lib/collectionView";
import { formatCount } from "../../lib/packsCopy";
import { LoginText } from "../account/LoginText";
import { BUTTON, PANEL_HEADING, WIDE_DIALOG } from "../account/styles";
import { Card } from "../card/Card";
import { TEXT_BUTTON_SM } from "../packs/styles";
import { ListConfirmation, ListSection } from "./ListSection";
import { RecycleConfirmation, RecycleSection } from "./RecycleSection";
import { RarityWord } from "./RarityWord";
import { AlsoIn, PrimarySeries } from "./SeriesLines";

const NO_ENTRIES: readonly CollectionEntry[] = [];

interface Props {
  /** The entry as the newest answer has it, or null once a refetch no longer has it (§4.5 "entry gone"). */
  indexed: IndexedEntry | null;
  names: ReadonlyMap<number, SeriesName>;
  poolSize: number | null;
  /** Close and Escape: the caller returns focus to the grid (§3.7). */
  onClose: () => void;
}

/** Where focus goes once the body the last action left has rendered (§7 "Dialog"). */
type FocusTarget = "confirmation" | "heading" | "recycleButton" | "listButton";

/**
 * The card dialog (collection-overview.md §3.4, §5.4, §7) as a native modal
 * `<dialog>`: `showModal()` gives the focus trap, Escape and the inert page,
 * and focus starts on the dialog itself, as in Manage account. Under the
 * details sit List on the market (§3.5) and Recycle for Karma (§3.6), each
 * with a confirmation that replaces the body below the close button and names
 * the dialog while it shows; one confirmation at a time. While a listing or a
 * recycle is in flight nothing closes the dialog, so it cannot close on an
 * unknown outcome. It mounts per opening, so it opens on mount and closes by
 * unmounting.
 */
export function CardDialog({ indexed, names, poolSize, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const goneRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  const recycleButtonRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const focusAfter = useRef<FocusTarget | null>(null);
  const headingId = useId();
  const gone = indexed === null;

  const game = useGame();
  const wallet = game.wallet.data?.wallet ?? null;
  const rules = wallet?.rules ?? null;
  const stale = game.collection.isError || game.wallet.isError || rules === null;
  const recycle = useRecycle(indexed?.entry ?? null, rules);
  const list = useListOnMarket(indexed?.entry ?? null, wallet, game.collection.data?.entries ?? NO_ENTRIES);
  let confirming: "list" | "recycle" | null = null;
  if (!gone && list.asking !== null) confirming = "list";
  else if (!gone && recycle.asking !== null) confirming = "recycle";
  const sending = list.action.sending || recycle.action.sending;

  // A confirmation's answer that returns to the details puts focus on the name heading (§3.5 step 9, §3.6 step 7).
  const { result } = recycle;
  const { result: listResult } = list;
  useLayoutEffect(() => {
    if (result !== null) headingRef.current?.focus();
  }, [result]);
  useLayoutEffect(() => {
    if (listResult !== null) headingRef.current?.focus();
  }, [listResult]);

  // After every render: the target the last action asked for, once its element is there.
  useLayoutEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === "confirmation") confirmationRef.current?.focus();
    if (target === "heading") headingRef.current?.focus();
    if (target === "recycleButton") recycleButtonRef.current?.focus();
    if (target === "listButton") listButtonRef.current?.focus();
  });

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null || dialog.open) return;
    dialog.showModal();
    dialog.focus();
  }, []);

  // §3.7, §4.5: when the entry goes with focus inside the details, the focused control went with
  // them; focus moves to the message that replaced them, never to <body>. Focus on the dialog
  // itself or on the top Close stays where it is.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!gone || dialog === null || dialog.contains(document.activeElement)) return;
    goneRef.current?.focus();
  }, [gone]);

  /** `Cancel` or Escape on a confirmation: the details, focus back on the button that opened it. */
  const back = () => {
    if (confirming === "list") {
      list.back();
      focusAfter.current = "listButton";
    } else {
      recycle.back();
      focusAfter.current = "recycleButton";
    }
  };

  /** Close: never in flight; the `close` event does the rest. */
  const close = () => {
    if (!sending) ref.current?.close();
  };

  /**
   * Every close, however it came: Chromium honours a prevented `cancel` once, and a second Escape
   * closes the dialog with no cancelable event. In flight it opens again at once, so it never closes
   * on an unknown outcome. Otherwise a confirmation's `Cancel` runs first (after no answer it
   * discards the key and reads the server again), then the dialog goes.
   */
  const onCloseEvent = () => {
    if (sending) {
      ref.current?.showModal();
      confirmationRef.current?.focus();
      return;
    }
    if (confirming === "list") list.back();
    if (confirming === "recycle") recycle.back();
    onClose();
  };

  /** Escape: ignored in flight; on a confirmation it returns to the details first (§3.7 step 1). */
  const onCancel = (event: SyntheticEvent) => {
    if (!sending && confirming === null) return;
    event.preventDefault();
    if (!sending) back();
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
        <button type="button" onClick={close} disabled={sending} className={TEXT_BUTTON_SM}>
          {dialogCopy.close}
        </button>
      </div>
      {indexed === null ? (
        <div className="flex flex-col items-start gap-4">
          <p id={headingId} ref={goneRef} tabIndex={-1} className="text-sm text-zinc-300 focus:outline-none">
            {dialogCopy.gone}
          </p>
          <button type="button" onClick={close} className={BUTTON.secondary}>
            {dialogCopy.goneClose}
          </button>
        </div>
      ) : confirming === "list" ? (
        <ListConfirmation
          entry={indexed.entry}
          list={list}
          onBack={back}
          headingId={headingId}
          headingRef={confirmationRef}
        />
      ) : confirming === "recycle" ? (
        <RecycleConfirmation
          entry={indexed.entry}
          recycle={recycle}
          onBack={back}
          headingId={headingId}
          headingRef={confirmationRef}
        />
      ) : (
        <Details
          indexed={indexed}
          names={names}
          poolSize={poolSize}
          headingId={headingId}
          headingRef={headingRef}
          section={
            <>
              <ListSection
                entry={indexed.entry}
                rules={rules}
                stale={stale}
                list={list}
                buttonRef={listButtonRef}
                fieldRef={priceRef}
                onAsk={() => {
                  focusAfter.current = "confirmation";
                }}
              />
              <RecycleSection
                entry={indexed.entry}
                rules={rules}
                stale={stale}
                recycle={recycle}
                buttonRef={recycleButtonRef}
                fieldRef={fieldRef}
                onAsk={() => {
                  focusAfter.current = "confirmation";
                }}
              />
            </>
          }
        />
      )}
    </dialog>
  );
}

function Details({
  indexed,
  names,
  poolSize,
  headingId,
  headingRef,
  section,
}: {
  indexed: IndexedEntry;
  names: ReadonlyMap<number, SeriesName>;
  poolSize: number | null;
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** The economy sections under the facts and the note (§3.4 step 4). */
  section: ReactNode;
}) {
  const { entry, franchises, series } = indexed;
  const { character } = entry;
  const [primary, ...others] = franchises;
  return (
    <div className="mt-2 grid gap-6 sm:grid-cols-[15rem_1fr]">
      <div className="mx-auto w-[200px] sm:w-[240px]">
        <Card
          character={character}
          rarity={entry.rarity}
          series={series}
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
        <Facts indexed={indexed} />
        <Note indexed={indexed} />
        {section}
      </div>
    </div>
  );
}

function Facts({ indexed }: { indexed: IndexedEntry }) {
  const { entry } = indexed;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-zinc-400">{dialogCopy.facts.rarity}</dt>
      <dd className="text-zinc-200">
        <RarityWord rarity={entry.rarity} />
      </dd>
      <dt className="text-zinc-400">{dialogCopy.facts.copies}</dt>
      <dd className="text-zinc-200 tabular-nums">{formatCount(entry.count)}</dd>
      {entry.listed >= 1 && (
        <>
          <dt className="text-zinc-400">{dialogCopy.facts.onTheMarket}</dt>
          <dd className="text-zinc-200 tabular-nums">{formatCount(entry.listed)}</dd>
        </>
      )}
      <dt className="text-zinc-400">{dialogCopy.facts.firstObtained}</dt>
      <dd className="text-zinc-200 tabular-nums">{dialogCopy.date(entry.firstObtainedAt)}</dd>
      {entry.count >= 2 && (
        <>
          <dt className="text-zinc-400">{dialogCopy.facts.lastObtained}</dt>
          <dd className="text-zinc-200 tabular-nums">{dialogCopy.date(entry.lastObtainedAt)}</dd>
        </>
      )}
    </dl>
  );
}

/** §3.4 step 3: at most one note, the out-of-pool line before the tier move. */
function Note({ indexed }: { indexed: IndexedEntry }) {
  const { character, rarity } = indexed.entry;
  if (!character.inCurrentSnapshot) return <p className="text-sm text-zinc-300">{dialogCopy.outOfPool}</p>;
  const { tier } = character;
  if (tier === null || tier === rarity) return null;
  return (
    <p className="text-sm break-words text-zinc-300">
      <LoginText text={{ template: (name) => dialogCopy.tierMoved(name, tier), login: character.name }} />
    </p>
  );
}
