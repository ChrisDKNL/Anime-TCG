/**
 * Every user-facing string of the accounts feature, verbatim from
 * docs/design/accounts.md §8. Functions take the login, a count phrase or the
 * seconds they interpolate; the copy test renders all of them and scans for the
 * words §8 forbids. The plain strings that embed a login (an aria-label)
 * wrap it in directional isolates, since <bdi> cannot go there.
 * Page headings and titles live in the route list (routes.ts): the navigation
 * spec moved them there and took the login out of the title bar.
 */

import { isolate } from "./bidi";

/** `Manage account` has no ellipsis: it goes to a page (navigation-and-landing.md §3.4). */
export const header = {
  accountMenuLabel: (login: string) => `Account menu. Signed in as ${isolate(login)}`,
  manage: "Manage account",
  logOut: "Log out",
} as const;

export const common = {
  back: "Back",
  cancel: "Cancel",
  close: "Close",
  show: "Show",
  hide: "Hide",
  showPassword: "Show password",
  hidePassword: "Hide password",
  showConfirmation: "Show password confirmation",
  hideConfirmation: "Hide password confirmation",
  passwordRules: "8 to 128 characters. Letters, numbers, spaces and symbols are all fine.",
  loginLength: "Keep the login between 3 and 24 characters.",
  passwordLength: "Keep the password between 8 and 128 characters.",
  mismatch: "The passwords don't match.",
  loginTaken: (login: string) => `The login "${login}" is already taken.`,
  tryAgainIn: (seconds: number) => `Try again in ${seconds} s`,
  breather:
    "Five misses in a row. Take ten seconds, check the spelling of your login and whether caps lock is on, then try again.",
  waitOver: "You can try again now.",
} as const;

export const registerCopy = {
  step1: "Step 1 of 2",
  step2: "Step 2 of 2",
  inviteLabel: "Invite code",
  inviteHint: "Ask the owner for a code. Codes are not case-sensitive.",
  continue: "Continue",
  checking: "Checking…",
  emptyCode: "Enter an invite code.",
  invalidCode: "That invite code isn't valid.",
  capReached: "All 10 places are taken for now. Ask the owner to make room.",
  loginLabel: "Login",
  loginHint: "3 to 24 characters. This is the name shown on your collection.",
  loginPlaceholder: "e.g. Chris",
  passwordLabel: "Password",
  confirmLabel: "Confirm password",
  submit: "Register",
  submitting: "Registering…",
  emptyLogin: "Choose a login.",
  emptyPassword: "Choose a password.",
  registered: (login: string) => `Registered ${login}. You're now on ${login}.`,
} as const;

export const loginCopy = {
  loginLabel: "Login",
  passwordLabel: "Password",
  submit: "Log in",
  submitting: "Logging in…",
  emptyLogin: "Enter your login.",
  emptyPassword: "Enter your password.",
  incorrect: "Login or password is incorrect.",
  forgotten: "There is no way to recover a forgotten password yourself. Ask the owner to set a new one.",
  loggedIn: (login: string) => `Logged in. You're now on ${login}.`,
} as const;

export const menuCopy = {
  loggedOut: "Logged out.",
} as const;

export const manageCopy = {
  loginSection: "Login",
  newLoginLabel: "New login",
  save: "Save",
  saving: "Saving…",
  loginChanged: (login: string) => `Login changed to ${login}.`,
  passwordSection: "Password",
  currentLabel: "Current password",
  newLabel: "New password",
  confirmNewLabel: "Confirm new password",
  showCurrentPassword: "Show current password",
  hideCurrentPassword: "Hide current password",
  showNewPassword: "Show new password",
  hideNewPassword: "Hide new password",
  change: "Change password",
  changing: "Changing…",
  wrongCurrent: "That password is incorrect.",
  passwordChanged: "Password changed.",
  deleteSection: "Delete account",
  deleteExplanation: "Deleting removes this account and every card in it. There is no undo.",
  deleteTrigger: "Delete account…",
  deleteHeading: (login: string) => `Delete ${login}?`,
  /** With at least one card; `cards` is the `cardCount` phrase. */
  deleteBody: (login: string, cards: string) =>
    `This permanently deletes ${login} and its ${cards}. There is no undo.`,
  deleteBodyNoCards: (login: string) => `This permanently deletes ${login}. There is no undo.`,
  deletePasswordLabel: "Password",
  deleteButton: (login: string) => `Delete ${login}`,
  deleting: "Deleting…",
  deleted: (login: string) => `Deleted ${login}.`,
} as const;

export const banners = {
  unreachable: "Couldn't reach the game server. Check your connection and try again.",
  tryAgain: "Try again",
  unreachableForm: "Couldn't reach the game server. Nothing was changed. Try again.",
  sessionEnded: "You were logged out. Log in again to continue.",
  loading: "Loading…",
} as const;

const NUMBER = new Intl.NumberFormat("en-GB");

/** A count as `Intl.NumberFormat("en-GB")` writes it: `2,983`. */
export function formatCount(n: number): string {
  return NUMBER.format(n);
}

/** `No cards yet` / `1 card` / `<N> cards` (`1,240 cards`), used wherever a card count is shown. */
export function cardCount(n: number): string {
  if (n === 0) return "No cards yet";
  return n === 1 ? "1 card" : `${formatCount(n)} cards`;
}

/**
 * §8's three-letter months. Intl's short month is locale data, not a format:
 * en-GB has written September as "Sept" since CLDR 38, so the names are fixed here.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `D Mon YYYY` in the viewer's time zone, e.g. `5 Sep 2026`. */
export function shortDate(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ""} ${date.getFullYear()}`;
}

/** `<N cards> · Created <D Mon YYYY>` for the Manage account header. */
export function metaLine(cards: number, createdAt: string): string {
  return `${cardCount(cards)} · Created ${shortDate(createdAt)}`;
}
