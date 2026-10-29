import "react";

/** The custom properties the app sets through `style` (React writes them through the CSSOM, which CSP does not govern). */
declare module "react" {
  interface CSSProperties {
    /** The card's starting point in its glint or drift loop, in seconds (card-and-rarity.md §5.3). */
    "--card-phase"?: string;
    /** A reveal slot's index, which delays its entrance (packs-page.md §6.3). */
    "--slot"?: string;
  }
}
