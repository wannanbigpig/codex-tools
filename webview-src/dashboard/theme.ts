import type { DashboardThemeOption } from "../../src/domain/dashboard/types";

type ThemeClassList = Pick<DOMTokenList, "contains">;

export function resolveDashboardTheme(
  preference: DashboardThemeOption,
  classList: ThemeClassList,
  systemPrefersLight: boolean
): "dark" | "light" {
  if (preference === "dark" || preference === "light") {
    return preference;
  }
  if (classList.contains("vscode-light")) {
    return "light";
  }
  if (classList.contains("vscode-dark") || classList.contains("vscode-high-contrast")) {
    return "dark";
  }
  return systemPrefersLight ? "light" : "dark";
}

export function resolveDashboardThemeFromMedia(preference: DashboardThemeOption, media: MediaQueryList): "dark" | "light" {
  return resolveDashboardTheme(preference, document.body.classList, media.matches);
}
