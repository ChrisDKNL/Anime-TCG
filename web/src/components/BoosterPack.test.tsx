import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BoosterPack } from "./BoosterPack";

const noop = () => undefined;

describe("BoosterPack", () => {
  // engineering standards §2: no emoji as icons. The button holds its label and nothing else.
  it("labels the pack button with text only", () => {
    render(<BoosterPack disabled={false} opening={false} onOpen={noop} />);
    expect(screen.getByRole("button", { name: "Open Booster Pack" })).toHaveTextContent(
      /^Open Booster Pack$/,
    );
  });

  it("says Opening… while a pack opens", () => {
    render(<BoosterPack disabled={false} opening onOpen={noop} />);
    expect(screen.getByRole("button", { name: "Opening…" })).toHaveTextContent(/^Opening…$/);
  });
});
