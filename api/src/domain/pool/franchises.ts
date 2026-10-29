import { FRANCHISE_MAX_HOPS, FRANCHISE_RELATIONS } from "./limits.js";
import type { Edge } from "./validate.js";

/**
 * Franchises (collection-packs.md §5.1.2): the snapshot's entries grouped
 * by the relations that merge them, read in both directions, through at most
 * `FRANCHISE_MAX_HOPS` entries outside the snapshot on any one path.
 */

const MERGING: ReadonlySet<string> = new Set(FRANCHISE_RELATIONS);

/** The merging edges among `edges`, each (from, to, type) once, in a stable order. */
export function mergingEdges(edges: readonly Edge[]): Edge[] {
  const unique = new Map<string, Edge>();
  for (const edge of edges) {
    if (MERGING.has(edge.relationType)) unique.set(`${edge.fromId}:${edge.toId}:${edge.relationType}`, edge);
  }
  return [...unique.values()].sort(
    (a, b) => a.fromId - b.fromId || a.toId - b.toId || a.relationType.localeCompare(b.relationType),
  );
}

function neighbours(edges: readonly Edge[]): Map<number, Set<number>> {
  const graph = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    const set = graph.get(a) ?? new Set<number>();
    set.add(b);
    graph.set(a, set);
  };
  for (const edge of mergingEdges(edges)) {
    link(edge.fromId, edge.toId);
    link(edge.toId, edge.fromId);
  }
  return graph;
}

export interface Franchise {
  /** The smallest AniList id among its entries: its anchor, whose title it carries. */
  id: number;
  /** The best popularity rank among its entries. */
  popularityRank: number;
  entryIds: number[];
}

export interface Franchises {
  franchises: Franchise[];
  franchiseOf: Map<number, number>;
}

/** Top entries reachable from `start` along merging edges, passing through at most `FRANCHISE_MAX_HOPS` other nodes. */
function reachableEntries(
  start: number,
  graph: ReadonlyMap<number, ReadonlySet<number>>,
  top: ReadonlySet<number>,
): number[] {
  const found: number[] = [];
  const outsideUsed = new Map<number, number>([[start, 0]]);
  const queue: [number, number][] = [[start, 0]];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const [node, used] = next;
    for (const neighbour of graph.get(node) ?? []) {
      if (top.has(neighbour)) {
        found.push(neighbour);
        continue;
      }
      const cost = used + 1;
      const seen = outsideUsed.get(neighbour);
      if (cost > FRANCHISE_MAX_HOPS || (seen !== undefined && seen <= cost)) continue;
      outsideUsed.set(neighbour, cost);
      queue.push([neighbour, cost]);
    }
  }
  return found;
}

export function buildFranchises(
  entries: readonly { id: number; popularityRank: number }[],
  edges: readonly Edge[],
): Franchises {
  const top = new Set(entries.map((entry) => entry.id));
  const graph = neighbours(edges);
  const parent = new Map<number, number>(entries.map((entry) => [entry.id, entry.id]));
  const root = (id: number): number => {
    let current = id;
    for (let up = parent.get(current); up !== undefined && up !== current; up = parent.get(current))
      current = up;
    return current;
  };
  for (const entry of entries) {
    for (const other of reachableEntries(entry.id, graph, top)) {
      const [a, b] = [root(entry.id), root(other)];
      // The smaller id becomes the root, so a franchise's root is its anchor.
      if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
    }
  }

  const groups = new Map<number, Franchise>();
  for (const entry of entries) {
    const id = root(entry.id);
    const group = groups.get(id) ?? { id, popularityRank: entry.popularityRank, entryIds: [] };
    group.popularityRank = Math.min(group.popularityRank, entry.popularityRank);
    group.entryIds.push(entry.id);
    groups.set(id, group);
  }
  const franchises = [...groups.values()].sort((a, b) => a.popularityRank - b.popularityRank || a.id - b.id);
  const franchiseOf = new Map<number, number>();
  for (const franchise of franchises) for (const id of franchise.entryIds) franchiseOf.set(id, franchise.id);
  return { franchises, franchiseOf };
}

/**
 * The anime ids the next round of relation requests reads: those a merging
 * edge from `sources` reaches that are neither snapshot entries nor already
 * read, in ascending order so a resumed fetch asks for the same batches.
 */
export function nextHops(
  edges: readonly Edge[],
  sources: ReadonlySet<number>,
  top: ReadonlySet<number>,
  read: ReadonlySet<number>,
): number[] {
  const hops = new Set<number>();
  for (const edge of mergingEdges(edges)) {
    for (const [from, to] of [
      [edge.fromId, edge.toId],
      [edge.toId, edge.fromId],
    ] as const) {
      if (sources.has(from) && !top.has(to) && !read.has(to)) hops.add(to);
    }
  }
  return [...hops].sort((a, b) => a - b);
}
