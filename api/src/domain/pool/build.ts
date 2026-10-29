import type { PerRarity } from "@anime-tcg/shared/api";
import { PACK_SIZE } from "@anime-tcg/shared/economy";
import type { Rarity } from "@anime-tcg/shared/rarity";
import { buildFranchises, type Franchise, mergingEdges } from "./franchises.js";
import {
  FRANCHISE_MAX_REQUESTS,
  SNAPSHOT_CHARACTERS_MAX,
  SNAPSHOT_CHARACTERS_MIN,
  SNAPSHOT_SERIES_MIN,
} from "./limits.js";
import { assignTiers, shortTier, tierCounts } from "./tiers.js";
import {
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
  /** The most popular entry it is MAIN or SUPPORTING in. */
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
  differingAppearances: number;
}

/**
 * Validates the pages, refuses a snapshot the game must not run on, and
 * builds its franchises and tiers. Refusal changes nothing: it happens
 * before any write.
 */
export function buildSnapshot(input: SnapshotInput): SnapshotPlan {
  if (input.relations.length > FRANCHISE_MAX_REQUESTS) {
    throw new SnapshotRefused(
      `The franchise hops needed ${input.relations.length} relation requests, more than ${FRANCHISE_MAX_REQUESTS}.`,
    );
  }
  const validated = validate(input);
  const { entries, characters } = validated;
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

  const { franchises, franchiseOf } = buildFranchises(entries, validated.edges);
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
    differingAppearances: validated.differingAppearances,
  };
}
