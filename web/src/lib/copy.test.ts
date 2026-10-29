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

  // The date is the viewer's local calendar day, so the instants are built from local parts. A fixed
  // UTC instant names another day somewhere: 2025-01-02T00:00Z is 1 Jan in New York, and even
  // midday 2026-09-05T12:00Z is 6 Sep in Kiritimati (UTC+14).
  it("formats the Manage account meta line with a short date", () => {
    expect(copy.metaLine(0, new Date(2026, 9, 28, 9, 30).toISOString())).toBe(
      "No cards yet · Created 28 Oct 2026",
    );
    expect(copy.metaLine(3, new Date(2025, 0, 2, 0, 0).toISOString())).toBe("3 cards · Created 2 Jan 2025");
  });

  it("writes every month in three letters, September as Sep (§8 `D Mon YYYY`)", () => {
    expect(copy.metaLine(1, new Date(2026, 8, 5, 12).toISOString())).toBe("1 card · Created 5 Sep 2026");
    const months = Array.from({ length: 12 }, (_, month) =>
      copy
        .metaLine(0, new Date(2026, month, 15, 12).toISOString())
        .split(" ")
        .at(-2),
    );
    expect(months).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
  });

  it("names the Manage account menu item without an ellipsis: it goes to a page", () => {
    expect(copy.header.manage).toBe("Manage account");
  });

  it("isolates the login with FSI/PDI in the plain strings that cannot hold <bdi>", () => {
    const rtl = "\u202Egnp.exe";
    expect(copy.header.accountMenuLabel(rtl)).toBe("Account menu. Signed in as \u2068\u202Egnp.exe\u2069");
    expect(copy.inventoryCopy.resetConfirm(rtl)).toBe(
      "Delete every card in \u2068\u202Egnp.exe\u2069? This cannot be undone.",
    );
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
      "Delete every card in \u2068Chris\u2069? This cannot be undone.",
    );
  });
});
