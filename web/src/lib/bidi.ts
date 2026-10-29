/**
 * The text between U+2068 FIRST STRONG ISOLATE and U+2069 POP DIRECTIONAL
 * ISOLATE: the plain-string counterpart of <bdi> and `dir="auto"`, for the
 * places markup cannot go (an aria-label, a `title`, the title bar, a confirm
 * dialog). A right-to-left override inside an untrusted string (a login, an
 * AniList name or title) then cannot reorder the words around it (T1,
 * docs/05-security.md C9). The string itself is not altered.
 */
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}
