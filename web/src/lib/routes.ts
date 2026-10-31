/**
 * The route list (docs/design/navigation-and-landing.md §3.1): every page of
 * this build, its title and its `h1`. The router's tree, the header links, the
 * guard, the return-path check and the titles all read this module, so a path
 * cannot be added to one of them and missed in another (§3.1 rule 3). `/shop`
 * joined with `feat/economy-ui`, `/market` with `feat/market-ui`.
 * The opening pages (§3.13) and `/demo` (§3.14) joined with the landing revision.
 */

const SITE = "Anime TCG";

/**
 * A page's `h1` and the eyebrow above it (visual-identity.md §10.1): sentence case here, shown
 * uppercase. An opening page's eyebrow is the one of the page its pack came from.
 */
interface PageNames {
  heading: string;
  eyebrow: string;
}

/** Pages that need a session (§3 "account page"). */
export const ACCOUNT_PAGES = {
  "/packs": { heading: "Packs", eyebrow: "Timer packs", guardLine: "Log in to open your packs." },
  "/shop": { heading: "Shop", eyebrow: "Themed packs", guardLine: "Log in to see the shop." },
  "/market": { heading: "Market", eyebrow: "Player trades", guardLine: "Log in to see the market." },
  "/collection": {
    heading: "Collection",
    eyebrow: "Your cards",
    guardLine: "Log in to see your collection.",
  },
  "/profile": { heading: "Profile", eyebrow: "Player", guardLine: "Log in to see your profile." },
  "/account": { heading: "Manage account", eyebrow: "Settings", guardLine: "Log in to manage your account." },
} as const satisfies Record<string, PageNames & { guardLine: string }>;

/** Pages only a signed-out visitor sees; a signed-in one is replaced to `/packs` (§3.3 step 7). */
export const PUBLIC_PAGES = {
  "/": { heading: SITE, eyebrow: "Anime character cards" },
  "/demo": { heading: "Demo pack", eyebrow: "Try a pack" },
  "/login": { heading: "Log in", eyebrow: "Welcome back" },
  "/register": { heading: "Register", eyebrow: "Invite only" },
} as const satisfies Record<string, PageNames>;

export type AccountPath = keyof typeof ACCOUNT_PAGES;

/**
 * The opening pages (§3.13): account pages that show a pack being opened and
 * its cards, under the section page they are opened from. They have no header
 * link and are never a return path (§3.1 rule 5): their guard writes the
 * section page instead.
 */
export const OPENING_PAGES = {
  "/packs/open": { heading: "Pack opening", eyebrow: "Timer packs", section: "/packs" },
  "/shop/open": { heading: "Shop pack", eyebrow: "Themed packs", section: "/shop" },
} as const satisfies Record<string, PageNames & { section: AccountPath }>;

export type PublicPath = keyof typeof PUBLIC_PAGES;
export type OpeningPath = keyof typeof OPENING_PAGES;
export type PagePath = AccountPath | OpeningPath | PublicPath;

export const NOT_FOUND = {
  heading: "Page not found",
  eyebrow: "404",
  title: `Page not found · ${SITE}`,
} as const;

/** The header's page links, in order (§3.5 step 2). `/profile` has none until roadmap item 4 (§9 decision 2). */
export const NAV_LINKS = [
  "/packs",
  "/shop",
  "/market",
  "/collection",
] as const satisfies readonly AccountPath[];

/** Where every sign-in without a valid return path lands (§3.3 step 3, §2 "Remembering the last page"). */
export const HOME_PATH = "/packs" satisfies AccountPath;

/** `Anime TCG` while booting and on `/`; otherwise the page name first (§3.1 rule 4). */
export const BOOT_TITLE = SITE;

const PAGES: Record<PagePath, PageNames> = { ...PUBLIC_PAGES, ...ACCOUNT_PAGES, ...OPENING_PAGES };
const ACCOUNT_PATHS = Object.keys(ACCOUNT_PAGES) as AccountPath[];
const OPENING_PATHS = Object.keys(OPENING_PAGES) as OpeningPath[];
const PUBLIC_PATHS = Object.keys(PUBLIC_PAGES) as PublicPath[];

/** The list's own entry for `value`, compared exactly, or null: the lookup every check below goes through. */
function listed<P extends string>(paths: readonly P[], value: unknown): P | null {
  if (typeof value !== "string") return null;
  return paths.find((path) => path === value) ?? null;
}

export function publicPath(value: unknown): PublicPath | null {
  return listed(PUBLIC_PATHS, value);
}

export function openingPath(value: unknown): OpeningPath | null {
  return listed(OPENING_PATHS, value);
}

export function pagePath(value: unknown): PagePath | null {
  return toReturnPath(value) ?? openingPath(value) ?? publicPath(value);
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

/**
 * The return path the guard and a session end write for `pathname` (§3.3,
 * §3.13 steps 7 and 8): an account page itself, an opening page's section
 * page, or null for anything else.
 */
export function returnPathFor(pathname: unknown): AccountPath | null {
  return sectionOf(pathname) ?? toReturnPath(pathname);
}

/** The section page of an opening page, whose header link is marked as the current section (§3.13 step 6); else null. */
export function sectionOf(pathname: unknown): AccountPath | null {
  const opening = openingPath(pathname);
  return opening === null ? null : OPENING_PAGES[opening].section;
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

export function pageEyebrow(path: PagePath): string {
  return PAGES[path].eyebrow;
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
