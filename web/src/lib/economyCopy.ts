/**
 * Every string of the economy UI (economy PR 2): the balance in the header,
 * the Shop page (docs/design/market-and-shop.md §8) and the card dialog's
 * Recycle for Karma section with its failures (collection-overview.md §8).
 * Every amount in them is the server's: a balance, a price, a credit or a
 * value from `GET /api/wallet`, `GET /api/shop` or a receipt. The functions
 * only format them; the one sum is the recycle total (count × the server's
 * value, collection-overview.md §3.6 step 1), which the caller passes in.
 * The currency's name is `CURRENCY_NAME` in copy.ts. AniList strings in a
 * plain-string sink (the live region) are isolated; sentences shown as markup
 * take them raw through `LoginText`, which puts them in a `<bdi>`. The copy
 * test renders every string and scans it for the words §8 forbids.
 */

import type { PerRarity, Rarity, ThemeOffer } from "@anime-tcg/shared/api";
import { RARITIES, RARITY_LABEL } from "@anime-tcg/shared/rarity";
import { isolate } from "./bidi";
import { amount, common, CURRENCY_NAME, formatCount } from "./copy";
import { listSeparator, oddsCopy, plural, revealCopy } from "./packsCopy";

/** `<n> Common, <n> Uncommon, … and <n> Mythic`: every tier, lowest first. */
function tierCounts(sizes: PerRarity): string {
  return RARITIES.map(
    (rarity, i) =>
      `${listSeparator(i, RARITIES.length)}${formatCount(sizes[rarity])} ${RARITY_LABEL[rarity]}`,
  ).join("");
}

/** A theme's tables in the shape 1c's odds copy reads: the same rules, so the same sentences. */
function packRules(odds: ThemeOffer["odds"]) {
  return { scale: odds.scale, radiant: odds.radiant, slots: odds.perSlot };
}

export const balanceCopy = {
  /** The header's `<B> Karma`: the number and the name are styled apart (market-and-shop.md §6). */
  name: CURRENCY_NAME,
} as const;

export const shopCopy = {
  loading: "Loading the shop…",
  error: "Couldn't load the shop.",
  tryAgain: "Try again",
  empty: "No packs in the shop.",
  /** After the first three series: `and <N> more`, a text button that reveals the rest. */
  moreSeries: (n: number) => `and ${formatCount(n)} more`,
  oddsLead: "At least one per pack:",
  oddsSeparator: " · ",
  oddsDisclosure: "Odds per card",
  tierSizes: (sizes: PerRarity) => `Drawn from ${tierCounts(sizes)} characters.`,
  /** The slot floors from `perSlot`, as the free pack's odds page words them. */
  slots: (odds: ThemeOffer["odds"]) => oddsCopy.slots(packRules(odds)),
  /** card-and-rarity.md §7.1's Radiant sentence, from the theme's own published odds. */
  radiant: (odds: ThemeOffer["odds"]) => revealCopy.radiant(packRules(odds)),
  shopRule: "Shop packs don't count toward Enchanted packs or the guarantee.",
  price: amount,
  buy: "Buy…",
  tooLittle: (price: number, balance: number) => `Costs ${amount(price)}. You have ${formatCount(balance)}.`,
  stale: "Buying waits until the game server answers.",
  /** `title` goes in a `<bdi>`. */
  confirmHeading: (title: string) => `Buy the ${title} pack?`,
  confirmBody: (price: number, cards: number, balance: number) =>
    `${amount(price)} for ${formatCount(cards)} cards from this pack's characters, at the odds shown. You have ${amount(balance)}. There is no undo.`,
  confirm: (price: number) => `Buy for ${amount(price)}`,
  buying: "Buying…",
  cancel: common.cancel,
  /** `title` goes in a `<bdi>`. */
  revealHeading: (title: string) => `${title} pack`,
  /** For the live region, a plain string: the title is isolated. */
  bought: (title: string, price: number, balance: number) =>
    `Bought the ${isolate(title)} pack for ${amount(price)}. You have ${amount(balance)}.`,
  tooLittleRefused: (price: number, balance: number) =>
    `This pack costs ${amount(price)}. You have ${amount(balance)}.`,
  gone: "That pack is no longer in the shop.",
  /** `/shop` while a bought pack is held (§3.3 step 6). */
  latest: "See your latest shop pack",
  /** `/shop/open`'s way back; there is no buy button on that page. */
  back: "Back to the shop",
  noCards: "There are no cards to draw from right now. Nothing changed.",
} as const;

/** collection-overview.md §8 "Failures": a confirmation's answers other than its own. */
export const actionCopy = {
  rateLimited: "That was a lot in a short time. Give it a few seconds.",
  waitButton: common.tryAgainIn,
  waitOver: common.waitOver,
  serverFailure: "The game server couldn't finish this. Nothing changed. Try again.",
  noAnswer: "Couldn't reach the game server, so this may not have gone through.",
  tryAgain: "Try again",
  cancel: common.cancel,
} as const;

export const recycleCopy = {
  heading: `Recycle for ${CURRENCY_NAME}`,
  value: (value: number) => `Each duplicate recycles for ${amount(value)}.`,
  label: "Duplicates",
  hint: (max: number) => `1 to ${formatCount(max)}`,
  credit: (total: number) => `You get ${amount(total)}.`,
  fieldError: (max: number) => `Choose a whole number from 1 to ${formatCount(max)}.`,
  button: "Recycle…",
  oneCopy: "No duplicates. The last copy can't be recycled.",
  allListed: "Copies on the market can't be recycled.",
  stale: "Listing and recycling wait until the game server answers.",
  somethingChanged: "Something changed since you opened this card. Check the numbers and try again.",
  /** `name` goes in a `<bdi>`. */
  confirmHeading: (count: number, name: string) =>
    count === 1 ? `Recycle 1 duplicate of ${name}?` : `Recycle ${formatCount(count)} duplicates of ${name}?`,
  /** `kept` copies stay, `listed` of them on the market. */
  confirmBody: (count: number, rarity: Rarity, total: number, kept: number, listed: number) => {
    const first = `${formatCount(count)} ${RARITY_LABEL[rarity]} ${count === 1 ? "copy" : "copies"} become ${amount(total)}.`;
    const keep =
      listed >= 1
        ? ` You keep ${formatCount(kept)}, ${formatCount(listed)} of them on the market.`
        : ` You keep ${formatCount(kept)}.`;
    return `${first}${keep} There is no undo.`;
  },
  confirm: (total: number) => `Recycle for ${amount(total)}`,
  recycling: "Recycling…",
  cancel: common.cancel,
  /** `name` goes in a `<bdi>`; the count, the credit and the balance are the receipt's. */
  recycled: (count: number, name: string, credited: number, balance: number) =>
    `Recycled ${plural(count, "copy", "copies")} of ${name} for ${amount(credited)}. You have ${amount(balance)}.`,
  valueChanged: (value: number) => ` Each duplicate now recycles for ${amount(value)}.`,
  /**
   * `balance_limit` (manager decision, 2026-10-30). The spec's `That would take you past <max> Karma, …`
   * needs `MAX_BALANCE` in the wallet's published rules, which `KarmaRules` does not carry yet, so the
   * line names no number: the client computes none.
   */
  ceiling: `That would take you past the most ${CURRENCY_NAME} you can hold, so nothing was recycled.`,
} as const;
