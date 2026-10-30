import type {
  CollectionEntry,
  CollectionResponse,
  CollectionTotals,
  FranchiseCompletion,
  FranchiseRef,
} from "@anime-tcg/shared/api";
import { RARITIES, type Rarity } from "@anime-tcg/shared/rarity";
import { and, count, countDistinct, eq, isNull, max, min, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { cards, poolSnapshotCharacters } from "../../db/schema.js";
import { holdingOf } from "../economy/recycle.js";
import { cardIsListed } from "../market/listings.js";
import { type CurrentSnapshot, currentSnapshot, describeCharacters, franchiseRefs } from "../pool/catalog.js";
import { perRarity } from "../pool/tiers.js";

interface EntryRow {
  characterId: number;
  rarity: Rarity;
  variant: "standard";
  count: number;
  listed: number;
  escrowed: number;
  firstObtainedAt: Date | null;
  lastObtainedAt: Date | null;
}

const RANK = new Map<Rarity, number>(RARITIES.map((tier, index) => [tier, index]));

/** Mythic first, then name, then character id: stable for tests; the UI may re-sort. */
function byRarityThenName(a: CollectionEntry, b: CollectionEntry): number {
  const rank = (RANK.get(b.rarity) ?? 0) - (RANK.get(a.rarity) ?? 0);
  if (rank !== 0) return rank;
  if (a.character.name !== b.character.name) return a.character.name < b.character.name ? -1 : 1;
  return a.character.id - b.character.id;
}

export function totalsOf(entries: readonly { rarity: Rarity; count: number }[]): CollectionTotals {
  const cardsHeld = entries.reduce((sum, entry) => sum + entry.count, 0);
  return {
    cards: cardsHeld,
    duplicates: entries.reduce((sum, entry) => sum + entry.count - 1, 0),
    byRarity: perRarity((tier) =>
      entries.filter((entry) => entry.rarity === tier).reduce((sum, entry) => sum + entry.count, 0),
    ),
  };
}

/**
 * The account's collection (collection-packs.md §5.5): entries keyed by
 * character, granted rarity and variant, totals, and completion against
 * the current snapshot, each character counted once in the pool and once
 * per franchise it belongs to. Only held cards count (economy.md §7): a
 * recycled or sold card stays as a row for the audit and is in none of
 * these, while a listed one is held and counts. An entry's `listed` copies
 * are the cards of its live listings at `now`.
 */
export class CollectionService {
  constructor(private readonly db: Db) {}

  async read(accountId: string, now: Date): Promise<CollectionResponse> {
    const snapshot = await currentSnapshot(this.db);
    const rows: EntryRow[] = await this.db
      .select({
        characterId: cards.characterId,
        rarity: cards.rarity,
        variant: cards.variant,
        count: count(),
        listed: sql<number>`count(*) filter (where ${cardIsListed(now)})::int`,
        escrowed: count(cards.escrowId),
        firstObtainedAt: min(cards.pulledAt),
        lastObtainedAt: max(cards.pulledAt),
      })
      .from(cards)
      .where(and(eq(cards.accountId, accountId), isNull(cards.removedAt)))
      .groupBy(cards.characterId, cards.rarity, cards.variant);

    const described = await describeCharacters(
      this.db,
      rows.map((row) => row.characterId),
      snapshot?.id ?? null,
    );
    const entries = rows.map((row): CollectionEntry => {
      const character = described.characters.get(row.characterId);
      if (character === undefined || row.firstObtainedAt === null || row.lastObtainedAt === null) {
        throw new Error(`collection entry for character ${row.characterId} is incomplete`);
      }
      return {
        kind: "card",
        character,
        rarity: row.rarity,
        variant: row.variant,
        count: row.count,
        ...holdingOf({ held: row.count, listed: row.listed, escrowed: row.escrowed }),
        firstObtainedAt: row.firstObtainedAt.toISOString(),
        lastObtainedAt: row.lastObtainedAt.toISOString(),
      };
    });
    entries.sort(byRarityThenName);

    const franchiseCompletion =
      snapshot === null ? [] : await this.franchiseCompletion(accountId, snapshot.id);
    const franchises = await this.franchises(franchiseCompletion, described.franchiseIds);
    return {
      snapshot: snapshot?.info ?? null,
      totals: totalsOf(entries),
      completion: {
        pool: snapshot === null ? { owned: 0, total: 0 } : await this.poolCompletion(accountId, snapshot),
        franchises: franchiseCompletion,
      },
      franchises,
      entries,
    };
  }

  private async poolCompletion(
    accountId: string,
    snapshot: CurrentSnapshot,
  ): Promise<{ owned: number; total: number }> {
    const [row] = await this.db
      .select({ owned: countDistinct(cards.characterId) })
      .from(cards)
      .innerJoin(
        poolSnapshotCharacters,
        and(
          eq(poolSnapshotCharacters.characterId, cards.characterId),
          eq(poolSnapshotCharacters.snapshotId, snapshot.id),
        ),
      )
      .where(and(eq(cards.accountId, accountId), isNull(cards.removedAt)));
    const total = RARITIES.reduce((sum, tier) => sum + snapshot.tierSizes[tier], 0);
    return { owned: row?.owned ?? 0, total };
  }

  /** Every franchise of the snapshot in popularity order, owned or not, with its distinct members. */
  private async franchiseCompletion(accountId: string, snapshotId: number): Promise<FranchiseCompletion[]> {
    const result = await this.db.execute<{ franchiseId: number; owned: number; total: number }>(sql`
      select f.franchise_id as "franchiseId",
             count(distinct m.character_id)::int as "total",
             count(distinct m.character_id) filter (where o.character_id is not null)::int as "owned"
      from pool_snapshot_franchises f
      join pool_snapshot_series s on s.snapshot_id = f.snapshot_id and s.franchise_id = f.franchise_id
      join pool_snapshot_memberships m on m.snapshot_id = s.snapshot_id and m.series_id = s.series_id
      left join (select distinct character_id from cards where account_id = ${accountId} and removed_at is null) o
        on o.character_id = m.character_id
      where f.snapshot_id = ${snapshotId}
      group by f.franchise_id, f.popularity_rank
      order by f.popularity_rank, f.franchise_id
    `);
    return result.rows.map((row) => ({ franchiseId: row.franchiseId, owned: row.owned, total: row.total }));
  }

  /** The current snapshot's franchises in popularity order, then any other an entry names, by id. */
  private async franchises(
    completion: readonly FranchiseCompletion[],
    named: ReadonlySet<number>,
  ): Promise<FranchiseRef[]> {
    const ordered = completion.map((row) => row.franchiseId);
    const current = new Set(ordered);
    const others = [...named].filter((id) => !current.has(id)).sort((a, b) => a - b);
    const refs = new Map((await franchiseRefs(this.db, [...ordered, ...others])).map((ref) => [ref.id, ref]));
    return [...ordered, ...others].flatMap((id) => {
      const ref = refs.get(id);
      return ref === undefined ? [] : [ref];
    });
  }
}
