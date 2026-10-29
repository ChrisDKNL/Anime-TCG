import { describe, expect, it } from "vitest";
import { escapeUnprintable, quote } from "./quote.js";

describe("quote", () => {
  it.each([
    ["U+009B, the C1 control sequence introducer", "a\u009b2Jb", '"a\\u009b2Jb"'],
    ["U+009D, the C1 operating system command", "a\u009d0;owned\u009cb", '"a\\u009d0;owned\\u009cb"'],
    ["U+0085, next line", "a\u0085b", '"a\\u0085b"'],
    ["DEL", "a\u007fb", '"a\\u007fb"'],
    ["U+202E, the right-to-left override", "a\u202eb", '"a\\u202eb"'],
    ["U+200B and U+FEFF, zero-width", "a\u200b\ufeffb", '"a\\u200b\\ufeffb"'],
    ["U+2028 and U+2029, the line and paragraph separators", "a\u2028\u2029b", '"a\\u2028\\u2029b"'],
    ["a C0 escape, which JSON.stringify already escapes", "a\u001b[2J\nb", '"a\\u001b[2J\\nb"'],
  ])("escapes %s", (_name, value, printed) => {
    expect(quote(value)).toBe(printed);
  });

  it("escapes a format character outside the BMP as its two code units", () => {
    expect(quote("a\u{E0001}b")).toBe('"a\\udb40\\udc01b"');
  });

  it("leaves ordinary names in any script readable", () => {
    expect(quote("Rem")).toBe('"Rem"');
    expect(quote("レム")).toBe('"レム"');
    expect(quote("Émilie Ōtsuki — 進撃の巨人 𠮷")).toBe('"Émilie Ōtsuki — 進撃の巨人 𠮷"');
  });

  it("escapes quotes and backslashes as JSON does, so the printed value is one unambiguous string", () => {
    expect(quote('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe("escapeUnprintable", () => {
  it("escapes the same characters without quoting the text", () => {
    expect(escapeUnprintable("The file is not a snapshot: /b\u009b2J is unknown.")).toBe(
      "The file is not a snapshot: /b\\u009b2J is unknown.",
    );
    expect(escapeUnprintable('No account has the login "レム"')).toBe('No account has the login "レム"');
  });
});
