import { usePageEnter } from "../../hooks/usePageEnter";
import { PAGE_HEADING_ID } from "../../lib/pageFocus";
import { EYEBROW, PAGE_ENTER, PAGE_HEADER, TITLE, type TitleSize } from "./styles";

interface Props {
  text: string;
  /** The small label above the title (visual-identity.md §10.1), from the route list. */
  eyebrow: string;
  size?: TitleSize;
  /** The block's spacing to what follows: the page header's by default; a panel spaces its own. */
  className?: string;
  describedBy?: string;
}

/**
 * The page's header: its eyebrow, then its one `h1` (§7 "Headings"), rendered from the start, loading or
 * not, so a page change always has somewhere to put focus (§3.6 step 5). The eyebrow repeats nothing the
 * page does not say elsewhere, so it is hidden from assistive technology. Both enter on a navigation.
 */
export function PageHeading({ text, eyebrow, size = "title", className = PAGE_HEADER, describedBy }: Props) {
  const entering = usePageEnter();
  return (
    <div className={className}>
      <p aria-hidden="true" className={`${EYEBROW} ${entering ? PAGE_ENTER.eyebrow : ""}`}>
        {eyebrow}
      </p>
      <h1
        id={PAGE_HEADING_ID}
        tabIndex={-1}
        aria-describedby={describedBy}
        className={`${TITLE[size]} ${entering ? PAGE_ENTER.title : ""}`}
      >
        {text}
      </h1>
    </div>
  );
}
