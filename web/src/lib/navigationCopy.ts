import type { DemoResponse, Rarity } from "@anime-tcg/shared/api";
import { common, shortDate } from "./copy";
import { formatCount, percent, summary } from "./packsCopy";

/**
 * The navigation and landing strings, verbatim from
 * docs/design/navigation-and-landing.md §8. The packs page's strings are in
 * packsCopy.ts. Page titles, headings and guard lines live in the
 * route list (routes.ts). The copy test renders every string of both modules
 * and scans them for the words §8 forbids.
 */

export const headerCopy = {
  wordmark: "Anime TCG",
  navLabel: "Main",
  packs: "Packs",
  shop: "Shop",
  collection: "Collection",
  logIn: "Log in",
  register: "Register",
  skipLink: "Skip to content",
} as const;

/** The footer sentence around its AniList link (§8 "Footer"). */
export const footerCopy = {
  before:
    "Non-commercial fan project. Character images and titles © their respective owners, served via the ",
  link: "AniList",
  after: " API.",
} as const;

export const crossLinkCopy = {
  toRegister: "No account yet?",
  toLogIn: "Already registered?",
} as const;

/** `<interval>` (§8): `10 minutes`, `1 minute`, or whole hours from one hour (`2 hours`). */
export function interval(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes > 59 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${formatCount(hours)} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${formatCount(minutes)} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** The `Demo pack: ` before the pull summary, on screen and in the live region (§8). */
const DEMO_SUMMARY_LEAD = "Demo pack: ";

/**
 * The landing page (§3.7, §8). Every number in it is the server's
 * (`GET /api/demo`): the functions take the answer's figures and only format
 * them, and each line has its no-facts form for before they arrive or without
 * a pool. The strings hold no number of their own.
 */
export const landingCopy = {
  lede: "Characters from the most popular anime on AniList, five to a pack.",
  ledeWithFacts: (characters: number, entries: number) =>
    `${formatCount(characters)} characters from the ${formatCount(entries)} most popular anime on AniList, five to a pack.`,
  howItPlays: "How it plays",
  /** The steps' visible numbers (`aria-hidden`, the list position is announced): `01`, `02`, … */
  stepNumber: (position: number) => String(position).padStart(2, "0"),
  terms: { packs: "Packs", rarity: "Rarity", collection: "Collection", karma: "Karma" },
  packsRow: "A new pack on a timer, and a few can pile up. Five cards each.",
  packsRowWithFacts: (intervalSeconds: number, cap: number) =>
    `A new pack every ${interval(intervalSeconds)}, and up to ${formatCount(cap)} can pile up. Five cards each.`,
  rarityRow: "Every character has one of six tiers, set by how many AniList users favourited them.",
  rarityRowWithOdds:
    "Every character has one of six tiers, set by how many AniList users favourited them. Every pack uses the odds below.",
  collectionRow: "See how much of each series you have, and of the whole pool.",
  collectionRowWithFacts: (characters: number) =>
    `See how much of each series you have, and how much of all ${formatCount(characters)} characters.`,
  /** From `feat/economy-ui` (§3.7 item 2). */
  karmaRow:
    "Recycle duplicates for Karma and spend it on themed packs. Karma comes only from playing. It can't be bought.",
  /** The static pack beside the hero (`aria-hidden`, §3.7 item 1.8); the button and `Pack odds` say it aloud. */
  packDrawing: { brand: "Anime TCG", label: "Demo pack", cards: "Five cards" },
  odds: {
    heading: "Pack odds",
    tier: "Tier",
    perPack: "At least one per pack",
    share: "Each card",
    figure: percent,
    source: (characters: number, takenAt: string) =>
      `Drawn from ${formatCount(characters)} characters, as of ${shortDate(takenAt)}.`,
  },
  join: "Join",
  joinSentence: "Playing needs an account, and registering needs an invite code from the owner.",
} as const;

export interface LandingText {
  lede: string;
  rows: { term: string; text: string }[];
}

/** The lede and How it plays in their facts form where the answer has the number, else the no-facts form (§3.7 item 2). */
export function landingText(facts: DemoResponse | undefined): LandingText {
  const { pool, odds, allowance } = facts ?? { pool: null, odds: null, allowance: null };
  const { terms } = landingCopy;
  return {
    lede: pool === null ? landingCopy.lede : landingCopy.ledeWithFacts(pool.characters, pool.entries),
    rows: [
      {
        term: terms.packs,
        text:
          allowance === null
            ? landingCopy.packsRow
            : landingCopy.packsRowWithFacts(allowance.intervalSeconds, allowance.cap),
      },
      { term: terms.rarity, text: odds === null ? landingCopy.rarityRow : landingCopy.rarityRowWithOdds },
      {
        term: terms.collection,
        text: pool === null ? landingCopy.collectionRow : landingCopy.collectionRowWithFacts(pool.characters),
      },
      { term: terms.karma, text: landingCopy.karmaRow },
    ],
  };
}

/** The demo pack on `/` and `/demo` (§3.7 items 1.3 to 1.7, §3.14, §8). */
export const demoCopy = {
  open: "Open a demo pack",
  back: "Back to the landing page",
  opening: "Opening…",
  waitButton: common.tryAgainIn,
  disclosure:
    "A demo pack uses the same odds as every pack in the game. Its cards aren't kept: nothing is saved, and they don't go to any account.",
  listLabel: "Demo pack",
  summaryLead: DEMO_SUMMARY_LEAD,
  announce: (rarities: readonly Rarity[]) => `${DEMO_SUMMARY_LEAD}${summary(rarities)}.`,
  /** `To keep cards, register with an invite code.`, the word `register` the link. */
  keepCards: { before: "To keep cards, ", link: "register", after: " with an invite code." },
  unavailable: "Demo packs are unavailable right now.",
  wait: "Demo packs take a short pause after many in a row. The button comes back by itself.",
  waitOver: common.waitOver,
  failed: "Couldn't reach the game server. Try again.",
} as const;

export const profileCopy = {
  line: "Your profile isn't here yet.",
  link: "Go to your collection",
} as const;

export const notFoundCopy = {
  line: "There's no page at this address.",
  signedOutLink: "Go to the start page",
  signedInLink: "Go to Packs",
} as const;
