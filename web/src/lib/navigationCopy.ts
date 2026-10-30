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

/**
 * The landing page of the navigation PR (§3.7): every line in its no-facts
 * form, because the pool facts and the demo arrive with the demo PR after 1c's
 * server pool. Nothing here holds a number.
 */
export const landingCopy = {
  lede: "Characters from the most popular anime on AniList, five to a pack.",
  howItPlays: "How it plays",
  rows: [
    { term: "Packs", text: "A new pack on a timer, and a few can pile up. Five cards each." },
    {
      term: "Rarity",
      text: "Every character has one of six tiers, set by how many AniList users favourited them.",
    },
    { term: "Collection", text: "See how much of each series you have, and of the whole pool." },
  ],
  join: "Join",
  joinSentence: "Playing needs an account, and registering needs an invite code from the owner.",
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
