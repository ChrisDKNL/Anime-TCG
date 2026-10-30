import type { DemoOpened, DemoResponse } from "@anime-tcg/shared/api";
import { DEMO_PACKS_PER_VISIT } from "@anime-tcg/shared/economy";
import type { Queryable } from "../../db/client.js";
import { ApiError } from "../errors.js";
import { ALLOWANCE_RULES } from "../packs/allowance.js";
import { publishedOdds } from "../packs/odds.js";
import { drawPack, type PackCounters, planPack } from "../packs/roll.js";
import type { Rng } from "../packs/rng.js";
import { currentSnapshot, describeCharacters, franchiseRefs, type TierPoolCache } from "../pool/catalog.js";

/**
 * A demo pack has no account, so nothing counts towards pity or Enchanted;
 * `planPack` ignores these for the `demo` source, and they are written out so
 * no account's counters are ever read for one.
 */
const NO_COUNTERS: PackCounters = { packsSinceMythic: 0, freePacksOpened: 0 };

/**
 * The landing page's demo (navigation-and-landing.md §3.8): the pool's public
 * facts, and a pack rolled by the game's own plan, roll and pick with the
 * writes left out. It reads the current snapshot and nothing else: no account,
 * session, opening or card is read or written, and nothing is logged beyond
 * the request line, so no card data reaches the log either.
 */
export class DemoService {
  constructor(
    private readonly db: Queryable,
    private readonly rng: Rng,
    private readonly pools: TierPoolCache,
  ) {}

  async facts(): Promise<DemoResponse> {
    const snapshot = await currentSnapshot(this.db);
    return {
      odds: snapshot === null ? null : publishedOdds(snapshot.tierSizes, snapshot.info),
      pool:
        snapshot === null ? null : { characters: snapshot.info.characterCount, entries: snapshot.entries },
      allowance: ALLOWANCE_RULES,
      perVisit: DEMO_PACKS_PER_VISIT,
    };
  }

  /** Five cards in slot order from the current snapshot, at exactly a pack's odds; 503 without a snapshot. */
  async open(): Promise<DemoOpened> {
    const snapshot = await currentSnapshot(this.db);
    if (snapshot === null) throw new ApiError(503, "pool_unavailable", "Cards are not available right now");
    const tiers = await this.pools.get(this.db, snapshot.id);
    const dealt = drawPack(tiers, planPack(NO_COUNTERS, "demo", this.rng), this.rng);
    const described = await describeCharacters(
      this.db,
      dealt.map((card) => card.characterId),
      snapshot.id,
    );
    const cards = dealt.map(({ slot, characterId, tier }) => {
      const character = described.characters.get(characterId);
      if (character === undefined) throw new Error(`demo character ${characterId} is missing`);
      return { slot, character, rarity: tier };
    });
    return { cards, franchises: await franchiseRefs(this.db, described.franchiseIds) };
  }
}
