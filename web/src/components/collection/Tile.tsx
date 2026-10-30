import { tileCopy } from "../../lib/collectionCopy";
import type { IndexedEntry } from "../../lib/collectionView";
import { Card } from "../card/Card";
import { TILE, TILE_CAPTION, TILE_RING } from "./styles";

interface Props {
  indexed: IndexedEntry;
  poolSize: number | null;
  onOpen: () => void;
}

/**
 * One entry in the grid (collection-overview.md §6.2, §7): the card at tile
 * size by its granted rarity inside a button that opens the card dialog,
 * with the copies and the listed copies under it. The button's name is the whole sentence, so the
 * card inside is part of it rather than an article of its own. The caption
 * is always one line high so rows align.
 */
export function Tile({ indexed, poolSize, onOpen }: Props) {
  const { entry, series, key } = indexed;
  return (
    <li className="flex">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={tileCopy.label(entry.character.name, entry.rarity, series, entry.count, entry.listed)}
        data-entry={key}
        onClick={onOpen}
        className={TILE}
      >
        <span className={TILE_RING}>
          <Card
            character={entry.character}
            rarity={entry.rarity}
            series={series}
            poolSize={poolSize}
            effects="hover"
            standalone={false}
          />
        </span>
        {/* §6.2: `×<N>` on the left, `<L> listed` on the right; one line high even when empty. */}
        <span className={TILE_CAPTION}>
          <span>{entry.count >= 2 && tileCopy.count(entry.count)}</span>
          {entry.listed >= 1 && <span className="text-zinc-400">{tileCopy.listed(entry.listed)}</span>}
        </span>
      </button>
    </li>
  );
}
