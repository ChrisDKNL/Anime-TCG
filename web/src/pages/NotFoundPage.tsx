import { Link } from "@tanstack/react-router";
import { PageHeading } from "../components/layout/PageHeading";
import { PublicLayout } from "../components/layout/PublicLayout";
import { SignedInLayout } from "../components/layout/SignedInLayout";
import { LINK_BUTTON } from "../components/layout/styles";
import { useOptionalGame } from "../hooks/useGame";
import { notFoundCopy } from "../lib/navigationCopy";
import { NOT_FOUND } from "../lib/routes";

/**
 * Every path the route list does not hold (navigation-and-landing.md §4.7).
 * Its frame follows the
 * session: the public header signed out, the signed-in one with the game state
 * intact signed in.
 */
export function NotFoundPage() {
  const signedIn = useOptionalGame() !== null;
  const body = (
    <div className="max-w-md py-12">
      <PageHeading text={NOT_FOUND.heading} eyebrow={NOT_FOUND.eyebrow} />
      <p className="text-sm text-zinc-400">{notFoundCopy.line}</p>
      <Link to={signedIn ? "/packs" : "/"} className={`${LINK_BUTTON.secondary} mt-6`}>
        {signedIn ? notFoundCopy.signedInLink : notFoundCopy.signedOutLink}
      </Link>
    </div>
  );
  return signedIn ? <SignedInLayout>{body}</SignedInLayout> : <PublicLayout>{body}</PublicLayout>;
}
