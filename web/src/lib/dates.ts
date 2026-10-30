import { MONTHS } from "./copy";

/** `<HH:MM>` (collection-overview.md §8). */
const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** `HH:MM` in the viewer's time zone, e.g. `09:30`. */
export function clockTime(at: string | Date): string {
  return CLOCK.format(new Date(at));
}

/** `D Mon` in the viewer's time zone, the date without the year (market-and-shop.md §8), e.g. `5 Sep`. */
export function dayMonth(at: string | Date): string {
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ""}`;
}
