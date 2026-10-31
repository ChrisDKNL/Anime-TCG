import type { CharacterPublic, Rarity } from "@anime-tcg/shared/api";
import { useState } from "react";

/** card-and-rarity.md §3.2, §5.2: the tier's flat frame colour; Epic and up take their gradient's middle stop. */
const FRAME: Record<Rarity, string> = {
  common: "bg-(--card-frame-common)",
  uncommon: "bg-(--card-frame-uncommon)",
  rare: "bg-(--card-frame-rare)",
  epic: "bg-(--card-frame-flat-epic)",
  legendary: "bg-(--card-frame-flat-legendary)",
  mythic: "bg-(--card-frame-flat-mythic)",
};

/**
 * The 48 × 67 px thumbnail of a My listings row (card-and-rarity.md §3.2):
 * the art in a 3 px frame of the tier's flat colour, no face text, no glow,
 * no animation. Decorative: the row's text names the character and the tier.
 */
export function Thumbnail({ character, rarity }: { character: CharacterPublic; rarity: Rarity }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden="true"
      className={`block h-[67px] w-12 shrink-0 rounded-[6px] p-[3px] ${FRAME[rarity]}`}
    >
      {failed ? (
        <span className="block h-full w-full rounded-[4px] bg-zinc-800" />
      ) : (
        <img
          src={character.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full rounded-[4px] bg-zinc-800 object-cover"
        />
      )}
    </span>
  );
}
