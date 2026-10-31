import type { Listing } from "@anime-tcg/shared/api";
import { listingTileCopy } from "../../lib/marketCopy";
import { Card } from "../card/Card";
import { TILE, TILE_CAPTION, TILE_RING } from "../collection/styles";

interface Props {
  listing: Listing;
  /** The character's primary series' title, or null when the answer does not name it. */
  series: string | null;
  poolSize: number | null;
  onOpen: () => void;
}

/**
 * One listing in the browse grid (market-and-shop.md §3.4 step 5, §6, §7):
 * the collection's tile with the card by the listing's rarity, and under it
 * the price on the left and the listing's end, or `Yours`, on the right.
 * Nothing marks a price as low, high, popular or new.
 */
export function ListingTile({ listing, series, poolSize, onOpen }: Props) {
  const { character, rarity, price, mine } = listing;
  return (
    <li className="flex">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={listingTileCopy.label(character.name, rarity, series, price, mine)}
        data-listing={listing.listingId}
        onClick={onOpen}
        className={TILE}
      >
        <span className={TILE_RING}>
          <Card
            character={character}
            rarity={rarity}
            series={series}
            poolSize={poolSize}
            effects="hover"
            standalone={false}
          />
        </span>
        <span className={TILE_CAPTION}>
          <span className="text-zinc-200">{listingTileCopy.price(price)}</span>
          <span className="truncate text-zinc-400">
            {mine ? listingTileCopy.yours : listingTileCopy.until(listing.expiresAt)}
          </span>
        </span>
      </button>
    </li>
  );
}
