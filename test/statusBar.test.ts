import { describe, expect, it } from "vitest";
import type { CodexAccountRecord } from "../src/core/types";
import {
  buildStatusText,
  buildThinBar,
  renderAccountPanel,
  renderMetricRow,
  resolveStatusBarAccount
} from "../src/ui/statusBar";

const account: CodexAccountRecord = {
  id: "account-1",
  email: "dev@example.com",
  isActive: true,
  createdAt: 1,
  updatedAt: 1,
  quotaSummary: {
    hourlyPercentage: 37,
    hourlyWindowPresent: true,
    weeklyPercentage: 82,
    weeklyWindowPresent: true,
    codeReviewPercentage: 0,
    additionalRateLimits: [
      {
        limitName: "Spark",
        hourlyPercentage: 12,
        hourlyWindowPresent: true,
        weeklyPercentage: 71,
        weeklyWindowPresent: true
      }
    ]
  }
};

describe("buildStatusText", () => {
  it("shows both quota values while 5-hour quota control is enabled", () => {
    expect(buildStatusText(account, true)).toBe("$(codex-openai) dev@example.com 37%/82%");
  });

  it("shows only the weekly quota while 5-hour quota control is disabled", () => {
    expect(buildStatusText(account, false)).toBe("$(codex-openai) dev@example.com 82%");
  });
});

describe("resolveStatusBarAccount", () => {
  it("shows a newly activated account immediately instead of the account captured at window startup", () => {
    const previousAccount = { ...account, id: "previous", email: "previous@example.com", isActive: false };
    const nextAccount = { ...account, id: "next", email: "next@example.com", isActive: true };

    expect(resolveStatusBarAccount([previousAccount, nextAccount], previousAccount.id)).toBe(nextAccount);
  });

  it("falls back to the window account when no account is marked active", () => {
    const windowAccount = { ...account, id: "window", isActive: false };

    expect(resolveStatusBarAccount([windowAccount], windowAccount.id)).toBe(windowAccount);
  });
});

describe("renderAccountPanel", () => {
  it("normalizes raw ChatGPT plan identifiers", () => {
    const teamPanel = renderAccountPanel({ ...account, planType: "chatgptteamplan" }, false);
    const plusPanel = renderAccountPanel({ ...account, planType: "chatgptplusplan" }, false);

    expect(teamPanel).toContain("Team");
    expect(teamPanel).not.toContain("CHATGPTTEAMPLAN");
    expect(plusPanel).toContain("Plus");
    expect(plusPanel).not.toContain("CHATGPTPLUSPLAN");
  });

  it("hides the 5-hour row while quota control is disabled", () => {
    const panel = renderAccountPanel(account, false);

    expect(panel).not.toContain("37%");
    expect(panel).not.toContain("12%");
    expect(panel).toContain("82%");
    expect(panel).toContain("71%");
  });

  it("shows the 5-hour row while quota control is enabled", () => {
    const panel = renderAccountPanel(account, true);

    expect(panel).toContain("37%");
    expect(panel).toContain("12%");
    expect(panel).toContain("82%");
    expect(panel).toContain("71%");
  });

  it("labels a Free 30-day quota as monthly", () => {
    const panel = renderAccountPanel(
      {
        ...account,
        planType: "free",
        quotaSummary: {
          ...account.quotaSummary,
          weeklyWindowMinutes: 43_200
        }
      },
      false
    );

    expect(panel).toContain("Monthly");
  });
});

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

describe("renderMetricRow", () => {
  it("does not force inline code styling in the native tooltip", () => {
    const row = renderMetricRow("5 小时", 79);

    expect(row).toContain("5 小时");
    expect(row).toContain("79%");
    expect(row).not.toContain("`");
  });
});
