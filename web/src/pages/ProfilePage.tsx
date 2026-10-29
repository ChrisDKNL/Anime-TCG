import { Link } from "@tanstack/react-router";
import { PageHeading } from "../components/layout/PageHeading";
import { LINK_BUTTON } from "../components/layout/styles";
import { profileCopy } from "../lib/navigationCopy";
import { pageHeading } from "../lib/routes";

/** `/profile` until roadmap item 4 (navigation-and-landing.md §4.6): reachable by its address only. */
export function ProfilePage() {
  return (
    <div className="max-w-md py-12">
      <PageHeading text={pageHeading("/profile")} />
      <p className="text-sm text-zinc-400">{profileCopy.line}</p>
      <Link to="/collection" className={`${LINK_BUTTON.secondary} mt-6`}>
        {profileCopy.link}
      </Link>
    </div>
  );
}
