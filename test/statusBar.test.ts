import { describe, expect, it } from "vitest";
import { buildThinBar } from "../src/ui/statusBar";

describe("buildThinBar", () => {
  it("renders an empty bar for zero percent", () => {
    expect(buildThinBar(0, 5)).toBe("▱▱▱▱▱");
  });

  it("renders a full bar for one hundred percent", () => {
    expect(buildThinBar(100, 5)).toBe("▰▰▰▰▰");
  });

  it("renders a neutral bar when percentage is unavailable", () => {
    expect(buildThinBar(undefined, 5)).toBe("╌╌╌╌╌");
  });
});
