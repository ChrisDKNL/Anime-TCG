/**
 * Copy that embeds a login, kept as the copy function plus the login instead
 * of one finished string, so the UI can render the login inside <bdi> and a
 * right-to-left override in it cannot reorder the words around it (T1,
 * docs/05-security.md). Attributes and the title bar take the plain string.
 */
export interface LoginSentence {
  template: (login: string) => string;
  login: string;
}

/** Text for the live region or a field message: plain copy, or a sentence with a login in it. */
export type CopyText = string | LoginSentence;

/** Never part of any copy, so splitting on it finds exactly the places the template puts the login. */
const SLOT = "\u0000";

/** The copy around each place the template puts the login: `n` places give `n + 1` parts. */
export function textAroundLogin(template: (login: string) => string): string[] {
  return template(SLOT).split(SLOT);
}
