import { describe, expect, it } from "vitest";
import {
  ACCOUNT_PAGES,
  BOOT_TITLE,
  HOME_PATH,
  NAV_LINKS,
  NOT_FOUND,
  OPENING_PAGES,
  openingPath,
  PUBLIC_PAGES,
  pageHeading,
  pagePath,
  pageTitle,
  publicPath,
  returnPathFor,
  sectionOf,
  signInDestination,
  toReturnPath,
  withoutTrailingSlash,
} from "./routes";

describe("the route list (§3.1)", () => {
  it("holds exactly the pages of this build", () => {
    expect(Object.keys(PUBLIC_PAGES)).toEqual(["/", "/demo", "/login", "/register"]);
    expect(Object.keys(ACCOUNT_PAGES)).toEqual([
      "/packs",
      "/shop",
      "/market",
      "/collection",
      "/profile",
      "/account",
    ]);
    expect(Object.keys(OPENING_PAGES)).toEqual(["/packs/open", "/shop/open"]);
    expect(pagePath("/shop")).toBe("/shop");
    expect(pagePath("/packs/open")).toBe("/packs/open");
    expect(pagePath("/demo")).toBe("/demo");
    expect(pagePath("/market")).toBe("/market");
  });

  it("names every page's h1 as the route table does", () => {
    expect(
      (
        [
          "/",
          "/demo",
          "/packs",
          "/packs/open",
          "/shop",
          "/shop/open",
          "/collection",
          "/profile",
          "/login",
          "/register",
          "/account",
        ] as const
      ).map(pageHeading),
    ).toEqual([
      "Anime TCG",
      "Demo pack",
      "Packs",
      "Pack opening",
      "Shop",
      "Shop pack",
      "Collection",
      "Profile",
      "Log in",
      "Register",
      "Manage account",
    ]);
    expect(NOT_FOUND.heading).toBe("Page not found");
  });

  it("titles each page with its name first and no login; anything else is the not-found title", () => {
    expect(pageTitle("/")).toBe("Anime TCG");
    expect(pageTitle("/demo")).toBe("Demo pack · Anime TCG");
    expect(pageTitle("/packs")).toBe("Packs · Anime TCG");
    expect(pageTitle("/packs/open")).toBe("Pack opening · Anime TCG");
    expect(pageTitle("/shop")).toBe("Shop · Anime TCG");
    expect(pageTitle("/shop/open")).toBe("Shop pack · Anime TCG");
    expect(pageTitle("/market")).toBe("Market · Anime TCG");
    expect(pageTitle("/collection")).toBe("Collection · Anime TCG");
    expect(pageTitle("/profile")).toBe("Profile · Anime TCG");
    expect(pageTitle("/login")).toBe("Log in · Anime TCG");
    expect(pageTitle("/register")).toBe("Register · Anime TCG");
    expect(pageTitle("/account")).toBe("Manage account · Anime TCG");
    for (const path of [
      "/Shop",
      "/Market",
      "/Packs",
      "/packs/1",
      "/packs/Open",
      "/demo/1",
      "/index.html",
      "",
      "/packs/",
    ]) {
      expect(pageTitle(path), path).toBe("Page not found · Anime TCG");
    }
    expect(BOOT_TITLE).toBe("Anime TCG");
  });

  it("links Packs, Shop, Market, then Collection in the header; Profile has no link until item 4", () => {
    expect(NAV_LINKS).toEqual(["/packs", "/shop", "/market", "/collection"]);
    expect(HOME_PATH).toBe("/packs");
  });

  it("gives every account page a guard line (§8)", () => {
    expect(Object.values(ACCOUNT_PAGES).map((page) => page.guardLine)).toEqual([
      "Log in to open your packs.",
      "Log in to see the shop.",
      "Log in to see the market.",
      "Log in to see your collection.",
      "Log in to see your profile.",
      "Log in to manage your account.",
    ]);
  });

  it("puts each opening page under its section page, which is its return path (§3.1 rule 5, §3.13 step 7)", () => {
    expect(sectionOf("/packs/open")).toBe("/packs");
    expect(sectionOf("/shop/open")).toBe("/shop");
    expect(sectionOf("/packs")).toBeNull();
    expect(sectionOf("/packs/open/")).toBeNull();
    expect(returnPathFor("/packs/open")).toBe("/packs");
    expect(returnPathFor("/shop/open")).toBe("/shop");
    expect(returnPathFor("/collection")).toBe("/collection");
    expect(returnPathFor("/demo")).toBeNull();
    expect(returnPathFor("/no-such-page")).toBeNull();
    expect(returnPathFor(42)).toBeNull();
    expect(openingPath("/packs/open")).toBe("/packs/open");
    expect(openingPath("/packs")).toBeNull();
  });

  it("tells the public-only pages apart from the rest", () => {
    expect(publicPath("/")).toBe("/");
    expect(publicPath("/demo")).toBe("/demo");
    expect(publicPath("/packs/open")).toBeNull();
    expect(publicPath("/login")).toBe("/login");
    expect(publicPath("/register")).toBe("/register");
    expect(publicPath("/packs")).toBeNull();
    expect(publicPath("/no-such-page")).toBeNull();
  });
});

describe("the return path check (§3.3 step 3)", () => {
  it("accepts each account page exactly, and hands back the list's own entry", () => {
    for (const path of Object.keys(ACCOUNT_PAGES)) {
      const copy = [...path].join("");
      const checked = toReturnPath(copy);
      expect(checked).toBe(path);
      expect(Object.keys(ACCOUNT_PAGES)).toContain(checked);
    }
  });

  const hostile: Array<[string, unknown]> = [
    ["an absolute URL", "https://evil.example/packs"],
    ["a protocol-relative URL", "//evil.example"],
    ["a protocol-relative URL with a page path", "//evil.example/packs"],
    ["a backslash host", "/\\evil.example"],
    ["a backslash pair", "\\\\evil.example"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["an encoded slash", "%2F%2Fevil.example"],
    ["an encoded character in a page path", "/p%61cks"],
    ["a fully encoded page path", "%2Fpacks"],
    ["a double-encoded page path", "%252Fpacks"],
    ["a query string", "/packs?x=1"],
    ["a return query", "/packs?return=//evil.example"],
    ["a hash", "/packs#top"],
    ["a trailing slash", "/packs/"],
    ["a deeper path", "/packs/1"],
    ["a dot segment", "/packs/../account"],
    ["another case", "/PACKS"],
    ["a leading space", " /packs"],
    ["a trailing newline", "/packs\n"],
    ["a NUL byte", "/packs\u0000"],
    ["a public page", "/login"],
    ["the start page", "/"],
    ["an unknown page", "/no-such-page"],
    ["a page that does not exist", "/auction"],
    ["an opening page", "/packs/open"],
    ["the shop's opening page", "/shop/open"],
    ["the demo page", "/demo"],
    ["another case of a listed page", "/Shop"],
    ["an empty string", ""],
    ["a value longer than any listed path", `/collection${"/".repeat(200)}`],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object with a matching toString", { toString: () => "/packs" }],
    ["a String object", new String("/packs")],
    ["an array", ["/packs"]],
  ];

  it.each(hostile)("rejects %s", (_name, value) => {
    expect(toReturnPath(value)).toBeNull();
    expect(signInDestination(value)).toBe("/packs");
  });

  it("sends a valid return path on, and anything else to /packs", () => {
    expect(signInDestination("/collection")).toBe("/collection");
    expect(signInDestination("/account")).toBe("/account");
    expect(signInDestination(undefined)).toBe("/packs");
  });
});

describe("the trailing-slash replace (§3.1 rule 2)", () => {
  it("strips the trailing slashes from a listed page", () => {
    expect(withoutTrailingSlash("/packs/")).toBe("/packs");
    expect(withoutTrailingSlash("/packs//")).toBe("/packs");
    expect(withoutTrailingSlash("/login/")).toBe("/login");
    expect(withoutTrailingSlash("/account/")).toBe("/account");
    expect(withoutTrailingSlash("/packs/open/")).toBe("/packs/open");
    expect(withoutTrailingSlash("/demo/")).toBe("/demo");
  });

  it("leaves everything else alone, so it can never produce another host", () => {
    for (const path of [
      "/",
      "/packs",
      "//",
      "///",
      "//evil.example/",
      "/\\evil.example/",
      "/Packs/",
      "/Market/",
      "/no-such/",
      "/packs/1/",
    ]) {
      expect(withoutTrailingSlash(path), path).toBeNull();
    }
  });
});
