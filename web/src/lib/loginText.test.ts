import { describe, expect, it } from "vitest";
import { manageCopy, registerCopy } from "./copy";
import { textAroundLogin } from "./loginText";

describe("textAroundLogin", () => {
  it("splits a sentence around its one login", () => {
    expect(textAroundLogin(manageCopy.deleteHeading)).toEqual(["Delete ", "?"]);
  });

  it("gives n + 1 parts for a login used n times", () => {
    expect(textAroundLogin(registerCopy.registered)).toEqual(["Registered ", ". You're now on ", "."]);
  });

  it("gives empty parts at the edges", () => {
    expect(textAroundLogin((login) => login)).toEqual(["", ""]);
  });
});
