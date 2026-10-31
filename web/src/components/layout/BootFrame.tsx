import { banners } from "../../lib/copy";
import { PageFrame } from "./PageFrame";
import { Wordmark } from "./Wordmark";

/**
 * Every load starts here, whatever the path, until `GET /api/session` answers
 * (navigation-and-landing.md §3.2 step 1): the wordmark only, no links, no
 * page, and `Loading…` once the check has taken 300 ms.
 */
export function BootFrame({ showLoading }: { showLoading: boolean }) {
  return (
    <PageFrame header={<Wordmark />} skipLink={false}>
      {showLoading && (
        <p role="status" className="text-sm text-ink-400">
          {banners.loading}
        </p>
      )}
    </PageFrame>
  );
}
