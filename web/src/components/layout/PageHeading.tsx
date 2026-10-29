import { PAGE_HEADING_ID } from "../../lib/pageFocus";
import { PAGE_HEADING } from "./styles";

interface Props {
  text: string;
  className?: string;
  describedBy?: string;
}

/**
 * The page's one `h1` (§7 "Headings"): rendered from the start, loading or not,
 * so a page change always has somewhere to put focus (§3.6 step 5).
 */
export function PageHeading({ text, className = PAGE_HEADING, describedBy }: Props) {
  return (
    <h1 id={PAGE_HEADING_ID} tabIndex={-1} aria-describedby={describedBy} className={className}>
      {text}
    </h1>
  );
}
