type HeaderValue = string | string[] | undefined;

export interface OriginHeaders {
  origin?: HeaderValue;
  referer?: HeaderValue;
}

/** Methods a browser may send cross-site without a preflight and without changing state here. */
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export function needsOriginCheck(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * The CSRF rule from the spec: a state-changing request is accepted only when
 * its `Origin` equals the web origin exactly; `Referer` stands in when the
 * browser sent no `Origin` at all. A duplicated header (an array) is hostile
 * and fails, it never falls through to the other header.
 */
export function originAllowed(headers: OriginHeaders, webOrigin: string): boolean {
  if (headers.origin !== undefined) return headers.origin === webOrigin;
  if (typeof headers.referer !== "string" || !URL.canParse(headers.referer)) return false;
  return new URL(headers.referer).origin === webOrigin;
}
