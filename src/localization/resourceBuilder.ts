import { DASHBOARD_LANGUAGES, type DashboardLanguage } from "./languages";

export function defineLocaleResources<T extends object>(
  base: T,
  overrides: Partial<Record<DashboardLanguage, Partial<T>>>
): Record<DashboardLanguage, T> {
  return Object.fromEntries(
    DASHBOARD_LANGUAGES.map((language) => [
      language,
      {
        ...base,
        ...(overrides[language] ?? {})
      }
    ])
  ) as Record<DashboardLanguage, T>;
}
