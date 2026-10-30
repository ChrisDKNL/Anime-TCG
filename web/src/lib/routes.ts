/**
 * The route list (docs/design/navigation-and-landing.md §3.1): every page of
 * this build, its title and its `h1`. The router's tree, the header links, the
 * guard, the return-path check and the titles all read this module, so a path
 * cannot be added to one of them and missed in another (§3.1 rule 3). `/shop`
 * joined with `feat/economy-ui`; `/market` joins `ACCOUNT_PAGES` in the PR that
 * builds it, and until then it is the not-found page like any other unknown path.
 */

const SITE = "Anime TCG";

/** Pages that need a session (§3 "account page"). */
export const ACCOUNT_PAGES = {
  "/packs": { heading: "Packs", guardLine: "Log in to open your packs." },
  "/shop": { heading: "Shop", guardLine: "Log in to see the shop." },
  "/collection": { heading: "Collection", guardLine: "Log in to see your collection." },
  "/profile": { heading: "Profile", guardLine: "Log in to see your profile." },
  "/account": { heading: "Manage account", guardLine: "Log in to manage your account." },
} as const satisfies Record<string, { heading: string; guardLine: string }>;

/** Pages only a signed-out visitor sees; a signed-in one is replaced to `/packs` (§3.3 step 7). */
export const PUBLIC_PAGES = {
  "/": { heading: SITE },
  "/login": { heading: "Log in" },
  "/register": { heading: "Register" },
} as const satisfies Record<string, { heading: string }>;

export type AccountPath = keyof typeof ACCOUNT_PAGES;
export type PublicPath = keyof typeof PUBLIC_PAGES;
export type PagePath = AccountPath | PublicPath;

export const NOT_FOUND = { heading: "Page not found", title: `Page not found · ${SITE}` } as const;

/** The header's page links, in order (§3.5 step 2). `/profile` has none until roadmap item 4 (§9 decision 2). */
export const NAV_LINKS = ["/packs", "/shop", "/collection"] as const satisfies readonly AccountPath[];

/** Where every sign-in without a valid return path lands (§3.3 step 3, §2 "Remembering the last page"). */
export const HOME_PATH = "/packs" satisfies AccountPath;

/** `Anime TCG` while booting and on `/`; otherwise the page name first (§3.1 rule 4). */
export const BOOT_TITLE = SITE;

const PAGES: Record<PagePath, { heading: string }> = { ...PUBLIC_PAGES, ...ACCOUNT_PAGES };
const ACCOUNT_PATHS = Object.keys(ACCOUNT_PAGES) as AccountPath[];
const PUBLIC_PATHS = Object.keys(PUBLIC_PAGES) as PublicPath[];

/** The list's own entry for `value`, compared exactly, or null: the lookup every check below goes through. */
function listed<P extends string>(paths: readonly P[], value: unknown): P | null {
  if (typeof value !== "string") return null;
  return paths.find((path) => path === value) ?? null;
}

export function publicPath(value: unknown): PublicPath | null {
  return listed(PUBLIC_PATHS, value);
}

export function pagePath(value: unknown): PagePath | null {
  return toReturnPath(value) ?? publicPath(value);
}

/**
 * The return path check (§3.3 step 3), run when the value is written and again
 * when it is used. Only a string exactly equal to an account page of this build
 * passes, and what comes back is the list's own entry, never the input: a full
 * URL, `//host`, `/\host`, a query, a hash, another case, a trailing slash, an
 * encoded character or a non-string all give null, so no navigation can be
 * steered outside the list.
 */
export function toReturnPath(value: unknown): AccountPath | null {
  return listed(ACCOUNT_PATHS, value);
}

/** Where a sign-in sends the visitor: the held return path if it is still valid, else `/packs`. */
export function signInDestination(returnTo: unknown): AccountPath {
  return toReturnPath(returnTo) ?? HOME_PATH;
}

/** `document.title` for a pathname (§3.1): the route list's name, or the not-found title for anything else. */
export function pageTitle(pathname: string): string {
  const page = pagePath(pathname);
  if (page === null) return NOT_FOUND.title;
  if (page === "/") return SITE;
  return `${PAGES[page].heading} · ${SITE}`;
}

export function pageHeading(path: PagePath): string {
  return PAGES[path].heading;
}

/**
 * §3.1 rule 2: `/packs/` is replaced by `/packs` (and `/packs//` the same way:
 * the router itself would match it to the page, so the address is made to
 * agree). Only a listed page is produced, so a pathname like `//evil.example/`
 * can never turn into a protocol-relative address; anything else stays where
 * it is and renders the not-found page.
 */
export function withoutTrailingSlash(pathname: string): PagePath | null {
  const trimmed = pathname.replace(/\/+$/, "");
  if (trimmed === pathname || trimmed === "") return null;
  return pagePath(trimmed);
}
