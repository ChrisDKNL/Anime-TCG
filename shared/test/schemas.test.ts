import { readdirSync } from "node:fs";
import { type TSchema, Type, TypeGuard } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

/**
 * Every object the API accepts or returns must refuse unknown fields: a body
 * with an extra property is a 400, never silently dropped, and a response
 * emits only what is declared (docs/design/accounts-api.md §4.3, the skill).
 * The flag has to be set on each nested object, so the whole schema is
 * walked rather than its top level checked.
 */

/** Paths of every `type: "object"` schema (Object or Record) that lacks `additionalProperties: false`. */
function unguardedObjects(schema: TSchema, path: string): string[] {
  if (TypeGuard.IsObject(schema)) {
    const here = schema.additionalProperties === false ? [] : [path];
    return here.concat(
      Object.entries(schema.properties).flatMap(([key, value]) => unguardedObjects(value, `${path}.${key}`)),
    );
  }
  if (TypeGuard.IsRecord(schema)) {
    const here = schema.additionalProperties === false ? [] : [path];
    return here.concat(
      Object.values(schema.patternProperties).flatMap((value) => unguardedObjects(value, `${path}{}`)),
    );
  }
  if (TypeGuard.IsArray(schema)) return unguardedObjects(schema.items, `${path}[]`);
  if (TypeGuard.IsTuple(schema)) {
    return (schema.items ?? []).flatMap((member, index) => unguardedObjects(member, `${path}[${index}]`));
  }
  if (TypeGuard.IsUnion(schema)) {
    return schema.anyOf.flatMap((member, index) => unguardedObjects(member, `${path}|${index}`));
  }
  if (TypeGuard.IsIntersect(schema)) {
    return schema.allOf.flatMap((member, index) => unguardedObjects(member, `${path}&${index}`));
  }
  return [];
}

const srcDir = new URL("../src/", import.meta.url);
const moduleFiles = readdirSync(srcDir).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"));

/** Every exported TypeBox schema in shared/src, named `<file>.<export>`; constants and types are skipped. */
async function exportedSchemas(): Promise<{ name: string; schema: TSchema }[]> {
  const found: { name: string; schema: TSchema }[] = [];
  for (const file of moduleFiles) {
    const module = (await import(new URL(file, srcDir).href)) as Record<string, unknown>;
    for (const [exportName, value] of Object.entries(module)) {
      if (TypeGuard.IsSchema(value)) found.push({ name: `${file}.${exportName}`, schema: value });
    }
  }
  return found;
}

const schemas = await exportedSchemas();

describe("shared schemas refuse unknown fields", () => {
  it("sees every contract module and the schemas the API serves today", () => {
    expect(moduleFiles).toEqual(
      expect.arrayContaining(["api.ts", "economy.ts", "errors.ts", "rarity.ts", "search.ts"]),
    );
    expect(schemas.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "api.ts.SessionResponse",
        "api.ts.AccountPublic",
        "api.ts.AccountResponse",
        "api.ts.InviteBody",
        "api.ts.RegisterBody",
        "api.ts.LoginBody",
        "api.ts.RenameBody",
        "api.ts.ChangePasswordBody",
        "api.ts.DeleteBody",
        "api.ts.HealthResponse",
        "api.ts.PerRarity",
        "api.ts.SnapshotInfo",
        "api.ts.PackKind",
        "api.ts.SlotOdds",
        "api.ts.PublishedOdds",
        "api.ts.PackAllowance",
        "api.ts.PacksResponse",
        "api.ts.FranchiseRef",
        "api.ts.CharacterPublic",
        "api.ts.OpenPackBody",
        "api.ts.OpenedCard",
        "api.ts.PackOpened",
        "api.ts.CollectionEntry",
        "api.ts.Completion",
        "api.ts.FranchiseCompletion",
        "api.ts.CollectionTotals",
        "api.ts.CollectionResponse",
        "api.ts.KarmaRules",
        "api.ts.Wallet",
        "api.ts.ThemeOffer",
        "api.ts.ShopResponse",
        "api.ts.ShopBuyBody",
        "api.ts.ShopReceipt",
        "api.ts.RecycleBody",
        "api.ts.RecycleReceipt",
        "api.ts.ListBody",
        "api.ts.Listing",
        "api.ts.ClosedListing",
        "api.ts.ListingParams",
        "api.ts.ListingsQuery",
        "api.ts.ListingsPage",
        "api.ts.BuyBody",
        "api.ts.CancelBody",
        "api.ts.ReceivedCard",
        "api.ts.PurchaseReceipt",
        "api.ts.WindowLeft",
        "api.ts.MarketMine",
        "errors.ts.ErrorEnvelope",
      ]),
    );
  });

  it.each(schemas)("$name has additionalProperties: false on every object", ({ name, schema }) => {
    expect(unguardedObjects(schema, name)).toEqual([]);
  });
});

describe("the walker itself", () => {
  const guarded = { additionalProperties: false } as const;

  it("passes a fully guarded schema with nesting through every container kind", () => {
    const leaf = Type.Object({ x: Type.String() }, guarded);
    const schema = Type.Object(
      {
        one: leaf,
        many: Type.Array(leaf),
        pair: Type.Tuple([leaf, Type.String()]),
        either: Type.Union([Type.Null(), leaf]),
        both: Type.Intersect([leaf, Type.Object({ y: Type.Number() }, guarded)]),
        byKey: Type.Record(Type.String(), leaf, guarded),
        maybe: Type.Optional(leaf),
      },
      guarded,
    );
    expect(unguardedObjects(schema, "Fixture")).toEqual([]);
  });

  it("names the top-level object when it lacks the flag", () => {
    expect(unguardedObjects(Type.Object({ x: Type.String() }), "Fixture")).toEqual(["Fixture"]);
  });

  it("finds an unguarded object behind a property, an array, a tuple, a union, an intersection and a record", () => {
    const open = Type.Object({ x: Type.String() });
    const schema = Type.Object(
      {
        one: open,
        many: Type.Array(open),
        pair: Type.Tuple([Type.String(), open]),
        either: Type.Union([Type.Null(), open]),
        both: Type.Intersect([Type.Object({ y: Type.Number() }, guarded), open]),
        byKey: Type.Record(Type.String(), open, guarded),
      },
      guarded,
    );
    expect(unguardedObjects(schema, "Fixture")).toEqual([
      "Fixture.one",
      "Fixture.many[]",
      "Fixture.pair[1]",
      "Fixture.either|1",
      "Fixture.both&1",
      "Fixture.byKey{}",
    ]);
  });

  it("treats a record without the flag as an open object too", () => {
    const record = Type.Record(Type.String(), Type.String());
    expect(unguardedObjects(record, "Fixture")).toEqual(["Fixture"]);
  });

  it("ignores non-object leaves", () => {
    expect(unguardedObjects(Type.String(), "Fixture")).toEqual([]);
    expect(unguardedObjects(Type.Union([Type.Literal("a"), Type.Literal("b")]), "Fixture")).toEqual([]);
    expect(unguardedObjects(Type.Array(Type.Integer()), "Fixture")).toEqual([]);
  });
});
