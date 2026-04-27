import { describe, expect, it, vi } from "vitest";
import { formatResetLabel } from "../webview-src/dashboard/helpers";
import { formatResetRelativeTime } from "../src/utils/resetTime";
import { formatRelativeReset } from "../src/utils/time";

describe("formatResetRelativeTime", () => {
  const now = Date.UTC(2026, 3, 27, 14, 33, 0);

  it("uses day/hour/minute parts instead of switching between raw hours and days", () => {
    const in47h37m = Math.floor((now + ((47 * 60 + 37) * 60 * 1000)) / 1000);
    const in50h55m = Math.floor((now + ((50 * 60 + 55) * 60 * 1000)) / 1000);

    expect(formatResetRelativeTime(in47h37m, now, "zh")).toBe("1天 23小时 37分钟");
    expect(formatResetRelativeTime(in50h55m, now, "zh")).toBe("2天 2小时 55分钟");
  });

  it("matches Aideck-style short reset labels for small and elapsed durations", () => {
    expect(formatResetRelativeTime(Math.floor((now + 30 * 1000) / 1000), now, "zh")).toBe("不到1分钟");
    expect(formatResetRelativeTime(Math.floor((now - 60 * 1000) / 1000), now, "zh")).toBe("已重置");
    expect(formatResetRelativeTime(Math.floor((now + ((47 * 60 + 37) * 60 * 1000)) / 1000), now, "en")).toBe(
      "1d 23h 37m left"
    );
  });
});

describe("formatResetLabel", () => {
  const now = Date.UTC(2026, 3, 27, 14, 33, 0);

  it("keeps dashboard reset labels consistent around the two-day boundary", () => {
    const in47h37m = Math.floor((now + ((47 * 60 + 37) * 60 * 1000)) / 1000);
    const in50h55m = Math.floor((now + ((50 * 60 + 55) * 60 * 1000)) / 1000);

    expect(formatResetLabel(in47h37m, "重置时间未知", now, "zh")).toMatch(/^1天 23小时 37分钟 \(/);
    expect(formatResetLabel(in50h55m, "重置时间未知", now, "zh")).toMatch(/^2天 2小时 55分钟 \(/);
  });
});

describe("formatRelativeReset", () => {
  it("uses the same reset duration formatter outside the dashboard", () => {
    const now = Date.UTC(2026, 3, 27, 14, 33, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const in47h37m = Math.floor((now + ((47 * 60 + 37) * 60 * 1000)) / 1000);
      expect(formatRelativeReset(in47h37m)).toBe("1d 23h 37m left");
    } finally {
      vi.useRealTimers();
    }
  });
});
