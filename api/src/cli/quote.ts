/**
 * Control (Cc: C0, DEL, C1 such as the U+009B CSI and U+009D OSC
 * introducers), format (Cf: bidi overrides, zero-width marks) and the two
 * line and paragraph separators. `JSON.stringify` escapes C0 only, so each of
 * these would otherwise reach the owner's terminal as it is.
 */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

function codeUnitEscape(unit: string): string {
  return `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

/**
 * `text` with every UTF-16 code unit of an unprintable character written as
 * `\uXXXX`; everything else, other scripts included, stays as it is. For a
 * message that is printed as is but may carry what a file or AniList sent.
 */
export function escapeUnprintable(text: string): string {
  return text.replace(UNPRINTABLE, (char) => char.split("").map(codeUnitEscape).join(""));
}

/** A stored string (a login, a title) as the owner CLIs print it: JSON-quoted, with nothing unprintable left raw. */
export function quote(value: string): string {
  return escapeUnprintable(JSON.stringify(value));
}
