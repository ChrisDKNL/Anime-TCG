import { useLinkProps } from "@tanstack/react-router";
import { useCurrentPageClick } from "../../hooks/useCurrentPageClick";
import { headerCopy } from "../../lib/navigationCopy";
import { WORDMARK } from "./styles";

/** The wordmark, not a heading (§6.1). Booting, before the session is known, it is plain text. */
export function Wordmark({ to }: { to?: "/" | "/packs" }) {
  if (to === undefined) return <span className={`${WORDMARK} mr-auto`}>{headerCopy.wordmark}</span>;
  return <WordmarkLink to={to} />;
}

function WordmarkLink({ to }: { to: "/" | "/packs" }) {
  const { onClick } = useCurrentPageClick(to);
  const props = useLinkProps({ to, onClick, activeOptions: { exact: true, includeSearch: false } });
  // Only the page links carry aria-current (§7 "Links"); signed in, Packs already does on /packs.
  return (
    <a {...props} aria-current={undefined} data-status={undefined} className={`${WORDMARK} mr-auto`}>
      {headerCopy.wordmark}
    </a>
  );
}
