import { BASE_WEIGHTS } from "../lib/rarity";

interface Props {
  disabled: boolean;
  opening: boolean;
  onOpen: () => void;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function BoosterPack({ disabled, opening, onOpen }: Props) {
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled || opening}
        className="group relative inline-flex items-center gap-3 rounded-2xl bg-gradient-to-br from-fuchsia-600 via-violet-600 to-sky-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-violet-900/40 transition hover:scale-[1.03] hover:shadow-violet-700/50 focus:outline-none focus-visible:ring-4 focus-visible:ring-violet-400/60 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
      >
        <span aria-hidden className="text-2xl transition-transform group-hover:-rotate-12">
          🎴
        </span>
        {opening ? "Opening…" : "Open Booster Pack"}
      </button>
      <p className="text-xs text-zinc-500">
        Base odds · Common {pct(BASE_WEIGHTS.common)} · Rare {pct(BASE_WEIGHTS.rare)} · Legendary{" "}
        {pct(BASE_WEIGHTS.legendary)} — popular characters tilt slightly rarer
      </p>
    </div>
  );
}
