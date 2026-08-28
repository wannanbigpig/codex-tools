import { describe, expect, it } from "vitest";
import { canRunAccountOnThisPc } from "../webview-src/dashboard/accountRunPolicy";

describe("dashboard account run policy", () => {
  it("blocks an account claimed by another PC", () => {
    expect(
      canRunAccountOnThisPc(
        {
          enabled: false,
          runningDeviceName: "Office PC",
          runningOnThisDevice: false
        },
        false
      )
    ).toBe(false);
  });

  it("blocks another switch while a dashboard action is busy", () => {
    expect(canRunAccountOnThisPc({ enabled: true }, true)).toBe(false);
  });

  it("allows a locally enabled foreign claim only while emergency bypass is active", () => {
    const account = {
      enabled: true,
      runningDeviceName: "Office PC",
      runningOnThisDevice: false
    };

    expect(canRunAccountOnThisPc(account, false)).toBe(false);
    expect(canRunAccountOnThisPc(account, false, true)).toBe(true);
  });
});
