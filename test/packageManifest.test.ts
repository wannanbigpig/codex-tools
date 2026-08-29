import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("extension manifest configuration", () => {
  it("uses the Codex branding asset for the extension icon", () => {
    const manifestPath = path.resolve(__dirname, "../package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { icon?: string };
    expect(manifest.icon).toBe("media/product-icons/codex-openai.png");
    expect(fs.statSync(path.resolve(path.dirname(manifestPath), manifest.icon!)).size).toBeGreaterThan(0);
    expect(fs.existsSync(path.resolve(path.dirname(manifestPath), "media/CT_logo_transparent_square_hd.png"))).toBe(false);
  });

  it("contributes the Codex status-bar icon and its font asset", () => {
    const manifestPath = path.resolve(__dirname, "../package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      contributes?: {
        icons?: Record<string, { default?: { fontPath?: string; fontCharacter?: string } }>;
      };
    };
    const icon = manifest.contributes?.icons?.["codex-openai"];

    expect(icon?.default).toEqual({
      fontPath: "./media/product-icons/codex-icons.woff",
      fontCharacter: "\\EA01"
    });
    expect(fs.statSync(path.resolve(path.dirname(manifestPath), icon!.default!.fontPath!)).size).toBeGreaterThan(0);
  });

  it("declares the auto switch reload window setting", () => {
    const manifestPath = path.resolve(__dirname, "../package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      contributes?: {
        configuration?: {
          properties?: Record<string, { type?: string; default?: unknown; markdownDescription?: string }>;
        };
      };
    };

    const property = manifest.contributes?.configuration?.properties?.["codexAccounts.autoSwitchReloadWindowEnabled"];

    expect(property).toBeTruthy();
    expect(property).toMatchObject({
      type: "boolean",
      default: false
    });
    expect(property?.markdownDescription).toContain("Automatically reload");
  });

  it("declares quota graph history retention with a 7-day default", () => {
    const manifestPath = path.resolve(__dirname, "../package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      contributes?: { configuration?: { properties?: Record<string, { type?: string; default?: unknown }> } };
    };

    expect(manifest.contributes?.configuration?.properties?.["codexAccounts.usageHistoryRetentionDays"]).toMatchObject({
      type: "number",
      minimum: 1,
      default: 7
    });
  });

  it("keeps machine-specific operations out of Settings Sync", () => {
    const manifestPath = path.resolve(__dirname, "../package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      contributes?: {
        configuration?: {
          properties?: Record<string, { scope?: string; ignoreSync?: boolean; markdownDescription?: string }>;
        };
      };
    };
    const properties = manifest.contributes?.configuration?.properties;

    expect(properties?.["codexAccounts.codexAppRestartMode"]?.scope).toBe("machine");
    expect(properties?.["codexAccounts.codexAppRestartEnabled"]?.scope).toBe("machine");
    expect(properties?.["codexAccounts.codexAppPath"]?.scope).toBe("machine");
    expect(properties?.["codexAccounts.webDashboardEnabled"]?.scope).toBe("machine");
    expect(properties?.["codexAccounts.encryptedSyncEnabled"]).toMatchObject({
      scope: "machine",
      ignoreSync: true
    });
    expect(properties?.["codexAccounts.encryptedSyncEnabled"]?.markdownDescription).toContain("Sync is run");
    expect(properties?.["codexAccounts.encryptedSyncScheduleMinutes"]).toBeUndefined();
  });
});
