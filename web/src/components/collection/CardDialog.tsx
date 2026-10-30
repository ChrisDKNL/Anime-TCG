import type { FranchiseRef } from "@anime-tcg/shared/api";
import { RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { isolate } from "../../lib/bidi";
import { dialogCopy, seriesTitle } from "../../lib/collectionCopy";
import type { SeriesName } from "../../lib/collectionSeries";
import type { IndexedEntry } from "../../lib/collectionView";
import { cardCopy, formatCount } from "../../lib/packsCopy";
import { LoginText } from "../account/LoginText";
import { BUTTON, PANEL_HEADING, WIDE_DIALOG } from "../account/styles";
import { Card } from "../card/Card";
import { TEXT_BUTTON_SM, TIER_TEXT } from "../packs/styles";

/** §5.4: `Also in` shows five titles, then `and <N> more`. */
const ALSO_IN_SHOWN = 5;

interface Props {
  /** The entry as the newest answer has it, or null once a refetch no longer has it (§4.5 "entry gone"). */
  indexed: IndexedEntry | null;
  names: ReadonlyMap<number, SeriesName>;
  poolSize: number | null;
  /** Close and Escape: the caller returns focus to the grid (§3.7). */
  onClose: () => void;
}

/**
 * The card dialog (collection-overview.md §3.4, §5.4, §7) as a native modal
 * `<dialog>`: `showModal()` gives the focus trap, Escape and the inert page,
 * and focus starts on the dialog itself, as in Manage account. It shows the
 * entry's details only (owner, round 3 decision 12): the economy PRs add
 * `List on the market` and `Recycle for Karma` as sections under the notes
 * (§3.4 step 4), each with its own confirmation in place of the body.
 * It mounts per opening, so it opens on mount and closes by unmounting.
 */
export function CardDialog({ indexed, names, poolSize, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null || dialog.open) return;
    dialog.showModal();
    dialog.focus();
  }, []);

  const close = () => ref.current?.close();

  return (
    <dialog ref={ref} tabIndex={-1} aria-labelledby={headingId} onClose={onClose} className={WIDE_DIALOG}>
      <div className="flex justify-end">
        <button type="button" onClick={close} className={TEXT_BUTTON_SM}>
          {dialogCopy.close}
        </button>
      </div>
      {indexed === null ? (
        <div className="flex flex-col items-start gap-4">
          <p id={headingId} className="text-sm text-zinc-300">
            {dialogCopy.gone}
          </p>
          <button type="button" onClick={close} className={BUTTON.secondary}>
            {dialogCopy.goneClose}
          </button>
        </div>
      ) : (
        <Details indexed={indexed} names={names} poolSize={poolSize} headingId={headingId} />
      )}
    </dialog>
  );
}

function Details({
  indexed,
  names,
  poolSize,
  headingId,
}: {
  indexed: IndexedEntry;
  names: ReadonlyMap<number, SeriesName>;
  poolSize: number | null;
  headingId: string;
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
          <h2 id={headingId} dir="auto" className={`${PANEL_HEADING} break-words`}>
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
      </div>
    </div>
  );
}

function PrimarySeries({ franchise, name }: { franchise: FranchiseRef; name: SeriesName | undefined }) {
  const year = name?.year ?? null;
  return (
    <>
      <p className="text-sm break-words text-zinc-400">
        <bdi>{franchise.title}</bdi>
        {year !== null && `, ${year}`}
      </p>
      {franchise.titleNative !== null && franchise.titleNative !== franchise.title && (
        <p dir="auto" lang="ja" className="text-xs break-words text-zinc-400">
          {franchise.titleNative}
        </p>
      )}
    </>
  );
}

/** §5.4: a comma-separated run of titles; more than five show five and `and <N> more`, which reveals the rest. */
function AlsoIn({
  franchises,
  names,
}: {
  franchises: FranchiseRef[];
  names: ReadonlyMap<number, SeriesName>;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? franchises : franchises.slice(0, ALSO_IN_SHOWN);
  const hidden = franchises.length - shown.length;
  return (
    <p className="mt-1 text-xs break-words text-zinc-300">
      <span className="text-zinc-400">{dialogCopy.alsoIn}</span>{" "}
      {shown.map((franchise, i) => {
        const year = names.get(franchise.id)?.year ?? null;
        return (
          <span key={franchise.id}>
            {i > 0 && ", "}
            <bdi title={isolate(seriesTitle(franchise.title, year))}>{franchise.title}</bdi>
            {year !== null && `, ${year}`}
          </span>
        );
      })}
      {hidden > 0 && (
        <>
          {" "}
          <button type="button" onClick={() => setExpanded(true)} className={TEXT_BUTTON_SM}>
            {dialogCopy.more(hidden)}
          </button>
        </>
      )}
    </p>
  );
}

function Facts({ indexed }: { indexed: IndexedEntry }) {
  const { entry } = indexed;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-zinc-400">{dialogCopy.facts.rarity}</dt>
      <dd className="text-zinc-200">
        <span
          aria-hidden="true"
          className={`mr-1.5 tracking-[2px] [font-variant-emoji:text] ${TIER_TEXT[entry.rarity]}`}
        >
          {cardCopy.starGlyphs(entry.rarity)}
        </span>
        <span className={TIER_TEXT[entry.rarity]}>{RARITY_LABEL[entry.rarity]}</span>
      </dd>
      <dt className="text-zinc-400">{dialogCopy.facts.copies}</dt>
      <dd className="text-zinc-200 tabular-nums">{formatCount(entry.count)}</dd>
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
