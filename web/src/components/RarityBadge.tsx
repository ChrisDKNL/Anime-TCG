import type { Rarity } from "../types";
import { RARITY_LABEL } from "../types";

const BADGE_CLASS: Record<Rarity, string> = {
  common: "bg-zinc-950/85 text-zinc-200 ring-zinc-500/60",
  rare: "bg-zinc-950/85 text-sky-300 ring-sky-400/70",
  legendary: "bg-zinc-950/85 text-amber-300 ring-amber-400/80",
};

export function RarityBadge({ rarity }: { rarity: Rarity }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase shadow-md ring-1 shadow-black/40 backdrop-blur-sm ${BADGE_CLASS[rarity]}`}
    >
      {RARITY_LABEL[rarity]}
    </span>
  );
}
