export const DASHBOARD_LANGUAGES = [
  "en",
  "zh",
  "ja",
  "es",
  "de",
  "fr",
  "pt-br",
  "ru",
  "ko",
  "it",
  "zh-hant",
  "tr",
  "pl",
  "cs",
  "ar",
  "vi"
] as const;

export type DashboardLanguage = (typeof DASHBOARD_LANGUAGES)[number];

export const DASHBOARD_LANGUAGE_OPTIONS = ["auto", ...DASHBOARD_LANGUAGES] as const;

export type DashboardLanguageOption = (typeof DASHBOARD_LANGUAGE_OPTIONS)[number];

export const DASHBOARD_LANGUAGE_OPTION_LABELS: Record<DashboardLanguage, string> = {
  en: "English",
  zh: "简体中文",
  ja: "日本語",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  "pt-br": "Português (Brasil)",
  ru: "Русский",
  ko: "한국어",
  it: "Italiano",
  "zh-hant": "繁體中文",
  tr: "Türkçe",
  pl: "Polski",
  cs: "Čeština",
  ar: "العربية",
  vi: "Tiếng Việt"
};

const DASHBOARD_LANGUAGE_INTL_LOCALES: Record<DashboardLanguage, string> = {
  en: "en-US",
  zh: "zh-CN",
  ja: "ja-JP",
  es: "es-ES",
  de: "de-DE",
  fr: "fr-FR",
  "pt-br": "pt-BR",
  ru: "ru-RU",
  ko: "ko-KR",
  it: "it-IT",
  "zh-hant": "zh-Hant",
  tr: "tr-TR",
  pl: "pl-PL",
  cs: "cs-CZ",
  ar: "ar",
  vi: "vi-VN"
};

const LANGUAGE_PREFIXES: Array<[string, DashboardLanguage]> = [
  ["zh-hant", "zh-hant"],
  ["zh-tw", "zh-hant"],
  ["zh-hk", "zh-hant"],
  ["zh-mo", "zh-hant"],
  ["zh", "zh"],
  ["pt-br", "pt-br"],
  ["pt", "pt-br"],
  ["ja", "ja"],
  ["es", "es"],
  ["de", "de"],
  ["fr", "fr"],
  ["ru", "ru"],
  ["ko", "ko"],
  ["it", "it"],
  ["tr", "tr"],
  ["pl", "pl"],
  ["cs", "cs"],
  ["ar", "ar"],
  ["vi", "vi"],
  ["en", "en"]
];

function isDashboardLanguage(value: string): value is DashboardLanguage {
  return (DASHBOARD_LANGUAGES as readonly string[]).includes(value);
}

export function isDashboardLanguageOption(value: string): value is DashboardLanguageOption {
  return (DASHBOARD_LANGUAGE_OPTIONS as readonly string[]).includes(value);
}

export function resolveDashboardLanguage(configured: string | undefined, vscodeLanguage: string): DashboardLanguage {
  if (configured && configured !== "auto" && isDashboardLanguage(configured)) {
    return configured;
  }

  const normalizedVscodeLanguage = vscodeLanguage.trim().toLowerCase().replace(/_/g, "-");
  for (const [prefix, language] of LANGUAGE_PREFIXES) {
    if (normalizedVscodeLanguage === prefix || normalizedVscodeLanguage.startsWith(`${prefix}-`)) {
      return language;
    }
  }

  return "en";
}

export function getIntlLocale(language: DashboardLanguage): string {
  return DASHBOARD_LANGUAGE_INTL_LOCALES[language];
}
