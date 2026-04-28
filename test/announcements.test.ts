import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { AnnouncementService, filterAnnouncements, normalizeAnnouncementResponse } from "../src/services/announcements";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-announcements-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env["CODEX_ACCOUNTS_ANNOUNCEMENT_FILE"];
  delete process.env["CODEX_ACCOUNTS_ANNOUNCEMENT_DEV_LOCAL"];
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("AnnouncementService", () => {
  it("filters localized announcements and sorts pinned items first", () => {
    const normalized = normalizeAnnouncementResponse({
      announcements: [
        {
          id: "old",
          title: "Old",
          targetVersions: "<0.1.0",
          targetLanguages: ["*"]
        },
        {
          id: "normal",
          title: "Normal",
          createdAt: "2026-04-27T01:00:00Z",
          targetVersions: "*",
          targetLanguages: ["*"]
        },
        {
          id: "pinned",
          title: "Pinned",
          pinned: true,
          createdAt: "2026-04-26T01:00:00Z",
          targetVersions: "*",
          targetLanguages: ["zh-CN"],
          locales: {
            "zh-CN": {
              title: "置顶"
            }
          }
        }
      ]
    });

    const filtered = filterAnnouncements(normalized.announcements, { version: "0.1.5", locale: "zh-CN" });

    expect(filtered.map((item) => item.id)).toEqual(["pinned", "normal"]);
    expect(filtered[0]?.title).toBe("置顶");
  });

  it("matches locale resources by language prefix in both directions", () => {
    const normalized = normalizeAnnouncementResponse({
      announcements: [
        {
          id: "locale",
          title: "Base",
          content: "Base content",
          targetVersions: "*",
          targetLanguages: ["*"],
          locales: {
            "en-US": {
              title: "English title",
              content: "English content"
            }
          }
        }
      ]
    });

    const filtered = filterAnnouncements(normalized.announcements, { version: "0.1.5", locale: "en" });

    expect(filtered[0]?.title).toBe("English title");
    expect(filtered[0]?.content).toBe("English content");
  });

  it("adds marketplace wait hint only when current version is behind release version", () => {
    const normalized = normalizeAnnouncementResponse({
      announcements: [
        {
          id: "release",
          title: "Release",
          content: "Release content",
          releaseVersion: "0.2.0",
          targetVersions: "*",
          targetLanguages: ["*"]
        }
      ]
    });

    const mismatch = filterAnnouncements(normalized.announcements, { version: "0.1.5", locale: "zh" });
    expect(mismatch[0]?.releaseVersion).toBe("0.2.0");
    expect(mismatch[0]?.currentVersion).toBe("0.1.5");
    expect(mismatch[0]?.restartRequired).toBe(true);
    expect(mismatch[0]?.restartHint).toContain("v0.1.5");
    expect(mismatch[0]?.restartHint).toContain("v0.2.0");
    expect(mismatch[0]?.restartHint).toContain("应用市场");

    const matched = filterAnnouncements(normalized.announcements, { version: "0.2.0", locale: "zh" });
    expect(matched[0]?.restartRequired).toBe(false);
    expect(matched[0]?.restartHint).toBeUndefined();

    const newer = filterAnnouncements(normalized.announcements, { version: "0.3.0", locale: "zh" });
    expect(newer[0]?.restartRequired).toBe(false);
    expect(newer[0]?.restartHint).toBeUndefined();
  });

  it("keeps only the newest releaseVersion announcement when multiple updates exist", () => {
    const normalized = normalizeAnnouncementResponse({
      announcements: [
        {
          id: "old-update",
          title: "Old update",
          summary: "Old summary",
          content: "Old content",
          releaseVersion: "0.1.5",
          targetVersions: "*",
          targetLanguages: ["*"],
          popup: true,
          pinned: false,
          showOnce: true,
          createdAt: "2026-01-01T00:00:00Z"
        },
        {
          id: "new-update",
          title: "New update",
          summary: "New summary",
          content: "New content",
          releaseVersion: "0.1.7",
          targetVersions: "*",
          targetLanguages: ["*"],
          popup: true,
          pinned: false,
          showOnce: true,
          createdAt: "2026-04-01T00:00:00Z"
        },
        {
          id: "stable-note",
          title: "Stable note",
          summary: "Stable summary",
          content: "Stable content",
          targetVersions: "*",
          targetLanguages: ["*"],
          showOnce: true,
          popup: false,
          pinned: false,
          createdAt: "2026-02-01T00:00:00Z"
        }
      ]
    });

    const filtered = filterAnnouncements(normalized.announcements, { version: "0.1.7", locale: "zh" });

    expect(filtered.map((item) => item.id)).toEqual(["new-update", "stable-note"]);
  });

  it("tracks unread, popup, single read, and mark all read state", async () => {
    const storageDir = await makeTempDir();
    const extensionRoot = await makeTempDir();
    const localFile = path.join(extensionRoot, "announcements.json");
    await fs.writeFile(
      localFile,
      JSON.stringify({
        announcements: [
          {
            id: "popup",
            title: "Popup",
            summary: "Popup summary",
            content: "Popup content",
            popup: true,
            targetVersions: "*",
            targetLanguages: ["*"],
            createdAt: "2026-04-27T08:00:00Z"
          },
          {
            id: "plain",
            title: "Plain",
            summary: "Plain summary",
            content: "Plain content",
            targetVersions: "*",
            targetLanguages: ["*"],
            createdAt: "2026-04-27T07:00:00Z"
          }
        ]
      }),
      "utf8"
    );
    process.env["CODEX_ACCOUNTS_ANNOUNCEMENT_DEV_LOCAL"] = "1";

    const service = new AnnouncementService(storageDir, extensionRoot);
    const initial = await service.getState({ version: "0.1.5", locale: "zh-CN" });
    expect(initial.unreadIds).toEqual(["popup", "plain"]);
    expect(initial.popupAnnouncement?.id).toBe("popup");

    await service.markAsRead("popup");
    const afterSingleRead = await service.getState({ version: "0.1.5", locale: "zh-CN" });
    expect(afterSingleRead.unreadIds).toEqual(["plain"]);
    expect(afterSingleRead.popupAnnouncement).toBeNull();

    await service.markAllAsRead({ version: "0.1.5", locale: "zh-CN" });
    const afterAllRead = await service.getState({ version: "0.1.5", locale: "zh-CN" });
    expect(afterAllRead.unreadIds).toEqual([]);
  });
});
