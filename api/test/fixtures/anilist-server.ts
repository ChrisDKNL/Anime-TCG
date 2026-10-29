import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { type FixturePool, snapshotFile } from "./pool.js";

/**
 * A local stand-in for AniList's GraphQL endpoint on 127.0.0.1:0, answering
 * the snapshot command's three queries from a fixture pool. Tests queue
 * faults for the next requests; every request is recorded. The real
 * AniList is never called from a test.
 */

export interface RecordedRequest {
  kind: "series" | "relations" | "characters" | "unknown";
  variables: Record<string, unknown>;
}

/** Writes a faulty answer; `null` in the queue, or an empty queue, answers normally. */
export type Fault = ((res: ServerResponse) => void) | null;

export const faults = {
  status:
    (code: number, headers: Record<string, string> = {}): NonNullable<Fault> =>
    (res) => {
      res
        .writeHead(code, { "content-type": "application/json", ...headers })
        .end('{"errors":[{"message":"x"}]}');
    },
  /** Never answers; the client's timeout has to end it. */
  stall: (): NonNullable<Fault> => () => undefined,
  oversized:
    (bytes: number): NonNullable<Fault> =>
    (res) => {
      res.writeHead(200, { "content-type": "application/json" }).end(`{"data":"${"x".repeat(bytes)}"}`);
    },
  invalidJson: (): NonNullable<Fault> => (res) => {
    res.writeHead(200, { "content-type": "application/json" }).end("{ not json");
  },
  graphqlErrors: (): NonNullable<Fault> => (res) => {
    res
      .writeHead(200, { "content-type": "application/json" })
      .end('{"data":null,"errors":[{"message":"busy"}]}');
  },
};

export interface FakeAniList {
  url: string;
  requests: RecordedRequest[];
  /** Faults for the next requests in order; `null` lets one through. */
  failNext(...queued: Fault[]): void;
  close(): Promise<void>;
}

function kindOf(query: string): RecordedRequest["kind"] {
  if (query.includes("POPULARITY_DESC")) return "series";
  if (query.includes("id_in")) return "relations";
  if (query.includes("characters(role: MAIN")) return "characters";
  return "unknown";
}

async function readJson(
  req: IncomingMessage,
): Promise<{ query: string; variables: Record<string, unknown> }> {
  let text = "";
  for await (const chunk of req) text += String(chunk);
  return JSON.parse(text) as { query: string; variables: Record<string, unknown> };
}

const EMPTY_CONNECTION = { pageInfo: { hasNextPage: false }, edges: [] };

export async function startFakeAniList(pool: FixturePool): Promise<FakeAniList> {
  const file = snapshotFile(pool);
  const series = file.series as unknown[];
  const characters = file.characters as Record<string, unknown[]>;
  const requests: RecordedRequest[] = [];
  const queue: Fault[] = [];

  const server = createServer((req, res) => {
    void readJson(req).then(({ query, variables }) => {
      const kind = kindOf(query);
      requests.push({ kind, variables });
      const fault = queue.shift();
      if (fault !== undefined && fault !== null) return fault(res);
      const answer = (body: unknown) =>
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (kind === "series")
        return answer(series[Number(variables.page) - 1] ?? { data: { Page: { media: [] } } });
      if (kind === "relations") {
        const ids = new Set(variables.ids as number[]);
        const media = (pool.hops ?? [])
          .filter((hop) => ids.has(hop.id))
          .map((hop) => ({
            id: hop.id,
            relations: {
              edges: hop.relations.map((edge) => ({
                relationType: edge.type,
                node: { id: edge.to, type: edge.nodeType ?? "ANIME" },
              })),
            },
          }));
        return answer({ data: { Page: { media } } });
      }
      if (kind === "characters") {
        const pages = characters[String(variables.id)] ?? [];
        return answer(
          pages[Number(variables.page) - 1] ?? {
            data: { Media: { main: EMPTY_CONNECTION, supporting: EMPTY_CONNECTION } },
          },
        );
      }
      return res.writeHead(400).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    failNext: (...queued) => queue.push(...queued),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
