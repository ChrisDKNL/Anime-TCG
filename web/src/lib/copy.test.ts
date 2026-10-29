import { describe, expect, it } from "vitest";
import * as copy from "./copy";

/** The words accounts.md §8 forbids (as stems where a suffix would hide them), matched case-insensitively. "caps lock" in the breather line is the spec's own copy and is not "locked". */
const FORBIDDEN = /secure|verif|protect|safe|privat|attempt|locked|blocked/i;

type CopyValue = string | ((...args: never[]) => string) | Readonly<Record<string, unknown>>;

/** Every string the module can produce, with sample arguments for the interpolating functions. */
function renderAll(value: CopyValue, path: string, out: Array<[string, string]>): void {
  if (typeof value === "string") {
    out.push([path, value]);
    return;
  }
  if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => string;
    // Second argument: a card phrase or an ISO date, whichever the function takes.
    out.push([path, fn("Chris", "2026-10-28T09:30:00.000Z")]);
    out.push([path, fn(9, "2026-10-28T09:30:00.000Z")]);
    return;
  }
  for (const [key, child] of Object.entries(value)) renderAll(child as CopyValue, `${path}.${key}`, out);
}

describe("copy", () => {
  it("contains none of the words §8 forbids", () => {
    const rendered: Array<[string, string]> = [];
    renderAll(copy, "copy", rendered);
    expect(rendered.length).toBeGreaterThan(60);
    const offenders = rendered.filter(([, text]) => FORBIDDEN.test(text));
    expect(offenders).toEqual([]);
  });

  it("never uses the word profile in UI copy", () => {
    const rendered: Array<[string, string]> = [];
    renderAll(copy, "copy", rendered);
    expect(rendered.filter(([, text]) => /profile/i.test(text))).toEqual([]);
  });

  it("formats the card-count phrase", () => {
    expect(copy.cardCount(0)).toBe("No cards yet");
    expect(copy.cardCount(1)).toBe("1 card");
    expect(copy.cardCount(12)).toBe("12 cards");
  });

  it("formats the Manage account meta line with a short date", () => {
    expect(copy.metaLine(0, "2026-10-28T09:30:00.000Z")).toBe("No cards yet · Created 28 Oct 2026");
    expect(copy.metaLine(3, "2025-01-02T00:00:00.000Z")).toBe("3 cards · Created 2 Jan 2025");
  });

  it("builds the document title", () => {
    expect(copy.documentTitle(null)).toBe("Anime TCG");
    expect(copy.documentTitle("Chris")).toBe("Chris · Anime TCG");
  });

  it("interpolates the login verbatim", () => {
    expect(copy.common.loginTaken("Chris")).toBe('The login "Chris" is already taken.');
    expect(copy.common.tryAgainIn(10)).toBe("Try again in 10 s");
    expect(copy.manageCopy.deleteBody("Chris", copy.cardCount(3))).toBe(
      "This permanently deletes Chris and its 3 cards. There is no undo.",
    );
    expect(copy.manageCopy.deleteBodyNoCards("Chris")).toBe(
      "This permanently deletes Chris. There is no undo.",
    );
    expect(copy.inventoryCopy.resetConfirm("Chris")).toBe(
      "Delete every card in Chris? This cannot be undone.",
    );
  });
});
