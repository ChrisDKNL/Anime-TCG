import type { PerRarity } from "@anime-tcg/shared/api";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { buildFranchises, type Franchise, mergingEdges } from "./franchises.js";
import {
  FRANCHISE_MAX_REQUESTS,
  SNAPSHOT_CHARACTERS_MAX,
  SNAPSHOT_CHARACTERS_MIN,
  SNAPSHOT_CHARACTERS_PER_FRANCHISE,
  SNAPSHOT_SERIES_MIN,
} from "./limits.js";
import { assignTiers, shortTier, tierCounts } from "./tiers.js";
import {
  type Candidate,
  type Edge,
  type Entry,
  type Role,
  type SkipTally,
  type SnapshotInput,
  validate,
} from "./validate.js";

/** A snapshot that must not be activated; the message is the one line the command prints. */
export class SnapshotRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotRefused";
  }
}

/** A listed entry; its `popularityRank` is its position among the listed entries, which an export keeps. */
export interface PlannedEntry extends Entry {
  franchiseId: number;
}

export interface PlannedCharacter {
  id: number;
  name: string;
  nameNative: string | null;
  imageUrl: string;
  favourites: number;
  favouritesRank: number;
  tier: Rarity;
  /** The most popular entry it is MAIN or SUPPORTING in, among the franchises that kept it. */
  primarySeriesId: number;
  memberships: { seriesId: number; role: Role }[];
}

/** Everything activation writes, decided before the transaction opens (collection-packs.md §5.1.7 steps 1 and 2). */
export interface SnapshotPlan {
  entries: PlannedEntry[];
  franchises: Franchise[];
  /** The merging edges the franchises were built from. */
  edges: Edge[];
  characters: PlannedCharacter[];
  tierCounts: PerRarity;
  skipped: SkipTally;
  /** Accepted characters the franchise cap left out of the pool entirely, those of the entries it emptied included. */
  capped: number;
  /** Per franchise id, the candidates it did not keep; only franchises that cut someone are listed. */
  cappedByFranchise: Map<number, number>;
  differingAppearances: number;
}

/** Most favourited first, ties by AniList id ascending: the rank rule of §5.1.4, which the cap shares. */
const byFavourites = (a: Candidate, b: Candidate) => b.favourites - a.favourites || a.id - b.id;

export interface CappedPool {
  /** The characters at least one franchise kept, each with only the memberships of the franchises that kept it. */
  characters: Candidate[];
  capped: number;
  cappedByFranchise: Map<number, number>;
}

/**
 * The franchise cap of collection-packs.md §5.1.3: each franchise keeps its
 * `perFranchise` most-favourited candidates (the accepted characters MAIN or
 * SUPPORTING in one of its entries), and a character stays in the pool when
 * some franchise keeps it, with the memberships of the franchises that did.
 * Idempotent: no franchise of the pool it returns has more than
 * `perFranchise` members, so capping that pool again changes nothing.
 */
export function capPerFranchise(
  characters: readonly Candidate[],
  franchiseOf: ReadonlyMap<number, number>,
  perFranchise: number = SNAPSHOT_CHARACTERS_PER_FRANCHISE,
): CappedPool {
  const franchiseOfEntry = (seriesId: number) => franchiseOf.get(seriesId) ?? seriesId;
  const candidatesOf = new Map<number, Candidate[]>();
  for (const character of characters) {
    for (const franchiseId of new Set([...character.memberships.keys()].map(franchiseOfEntry))) {
      const list = candidatesOf.get(franchiseId) ?? [];
      list.push(character);
      candidatesOf.set(franchiseId, list);
    }
  }

  const keptBy = new Map<number, Set<number>>();
  const cappedByFranchise = new Map<number, number>();
  for (const [franchiseId, candidates] of candidatesOf) {
    const kept = [...candidates].sort(byFavourites).slice(0, perFranchise);
    for (const character of kept) {
      const franchises = keptBy.get(character.id) ?? new Set<number>();
      franchises.add(franchiseId);
      keptBy.set(character.id, franchises);
    }
    if (candidates.length > kept.length) cappedByFranchise.set(franchiseId, candidates.length - kept.length);
  }

  const pool: Candidate[] = [];
  for (const character of characters) {
    const franchises = keptBy.get(character.id);
    if (franchises === undefined) continue;
    const memberships = new Map(
      [...character.memberships].filter(([seriesId]) => franchises.has(franchiseOfEntry(seriesId))),
    );
    pool.push({ ...character, memberships });
  }
  return { characters: pool, capped: characters.length - pool.length, cappedByFranchise };
}

/** `characters` with only their memberships in `entryIds`; a character left with none is out. */
function withinEntries(characters: readonly Candidate[], entryIds: ReadonlySet<number>): Candidate[] {
  return characters.flatMap((character) => {
    const memberships = new Map([...character.memberships].filter(([seriesId]) => entryIds.has(seriesId)));
    return memberships.size === 0 ? [] : [{ ...character, memberships }];
  });
}

interface SettledPool {
  /** In popularity order, each ranked by its position among them. */
  entries: Entry[];
  franchises: Franchise[];
  franchiseOf: Map<number, number>;
  characters: Candidate[];
  cappedByFranchise: Map<number, number>;
}

/**
 * The listed entries, their franchises and the capped pool (collection-packs.md
 * §5.1.6): an entry the cap leaves without a member is not listed, and the
 * franchises and the cap are worked out again without it, where it only
 * connects like an entry outside the top 100, until every listed entry keeps
 * a member. So an emptied entry never anchors or titles a franchise, and an
 * export, which holds only listed entries, rebuilds the same grouping. Each
 * round lists fewer entries, so it ends.
 */
function settle(
  accepted: readonly Entry[],
  edges: readonly Edge[],
  candidates: readonly Candidate[],
  perFranchise: number,
): SettledPool {
  let listed = accepted;
  for (;;) {
    const entries = listed.map((entry, index) => ({ ...entry, popularityRank: index + 1 }));
    const { franchises, franchiseOf } = buildFranchises(entries, edges);
    const { characters, cappedByFranchise } = capPerFranchise(
      withinEntries(candidates, new Set(entries.map((entry) => entry.id))),
      franchiseOf,
      perFranchise,
    );
    const withMembers = new Set(characters.flatMap((character) => [...character.memberships.keys()]));
    if (entries.every((entry) => withMembers.has(entry.id))) {
      return { entries, franchises, franchiseOf, characters, cappedByFranchise };
    }
    listed = entries.filter((entry) => withMembers.has(entry.id));
  }
}

/**
 * Validates the pages, groups the entries into franchises, applies the
 * franchise cap, refuses a snapshot the game must not run on, and ranks
 * and tiers the capped pool. Refusal changes nothing: it happens before any
 * write. `perFranchise` is the cap; another cap is a rebuild from the same
 * pages, which the snapshot file keeps unchanged.
 */
export function buildSnapshot(
  input: SnapshotInput,
  perFranchise: number = SNAPSHOT_CHARACTERS_PER_FRANCHISE,
): SnapshotPlan {
  if (input.relations.length > FRANCHISE_MAX_REQUESTS) {
    throw new SnapshotRefused(
      `The franchise hops needed ${input.relations.length} relation requests, more than ${FRANCHISE_MAX_REQUESTS}.`,
    );
  }
  const validated = validate(input);
  const { entries, franchises, franchiseOf, characters, cappedByFranchise } = settle(
    validated.entries,
    validated.edges,
    validated.characters,
    perFranchise,
  );
  if (entries.length < SNAPSHOT_SERIES_MIN) {
    throw new SnapshotRefused(`Only ${entries.length} valid entries, fewer than ${SNAPSHOT_SERIES_MIN}.`);
  }
  if (characters.length < SNAPSHOT_CHARACTERS_MIN) {
    throw new SnapshotRefused(
      `Only ${characters.length} valid characters, fewer than ${SNAPSHOT_CHARACTERS_MIN}.`,
    );
  }
  if (characters.length > SNAPSHOT_CHARACTERS_MAX) {
    throw new SnapshotRefused(`${characters.length} valid characters, more than ${SNAPSHOT_CHARACTERS_MAX}.`);
  }
  const counts = tierCounts(characters.length);
  const short = shortTier(counts);
  if (short !== null) {
    throw new SnapshotRefused(
      `The ${short} tier would hold ${counts[short]} characters, fewer than ${PACK_SIZE}.`,
    );
  }

  const rankOf = new Map(entries.map((entry) => [entry.id, entry.popularityRank]));
  const planned = assignTiers(characters).map((character): PlannedCharacter => {
    const memberships = [...character.memberships].map(([seriesId, role]) => ({ seriesId, role }));
    const primary = memberships.reduce((best, next) =>
      (rankOf.get(next.seriesId) ?? Infinity) < (rankOf.get(best.seriesId) ?? Infinity) ? next : best,
    );
    return {
      id: character.id,
      name: character.name,
      nameNative: character.nameNative,
      imageUrl: character.imageUrl,
      favourites: character.favourites,
      favouritesRank: character.favouritesRank,
      tier: character.tier,
      primarySeriesId: primary.seriesId,
      memberships,
    };
  });

  return {
    entries: entries.map((entry) => ({ ...entry, franchiseId: franchiseOf.get(entry.id) ?? entry.id })),
    franchises,
    edges: mergingEdges(validated.edges),
    characters: planned,
    tierCounts: counts,
    skipped: validated.skipped,
    capped: validated.characters.length - characters.length,
    cappedByFranchise,
    differingAppearances: validated.differingAppearances,
  };
}
