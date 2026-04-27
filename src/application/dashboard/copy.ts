import type { DashboardCopy } from "../../domain/dashboard/types";
import type { DashboardLanguage } from "../../localization/languages";
import { dashboardCopyResources } from "../../localization/resources/dashboard";

const AUTH_PROVIDER_LOGIN_SUFFIX: Record<DashboardLanguage, string> = {
  en: "login",
  zh: "登录",
  ja: "ログイン",
  es: "inicio de sesión",
  de: "Anmeldung",
  fr: "connexion",
  "pt-br": "login",
  ru: "вход",
  ko: "로그인",
  it: "accesso",
  "zh-hant": "登入",
  tr: "girişi",
  pl: "logowanie",
  cs: "přihlášení",
  ar: "تسجيل الدخول",
  vi: "đăng nhập"
};

const ACCOUNT_STRUCTURE_LABELS: Record<string, Record<DashboardLanguage, string>> = {
  organization: {
    en: "Organization",
    zh: "组织空间",
    ja: "組織スペース",
    es: "Espacio de organización",
    de: "Organisationsbereich",
    fr: "Espace d'organisation",
    "pt-br": "Espaço da organização",
    ru: "Пространство организации",
    ko: "조직 공간",
    it: "Spazio organizzazione",
    "zh-hant": "組織空間",
    tr: "Kuruluş alanı",
    pl: "Obszar organizacji",
    cs: "Prostor organizace",
    ar: "مساحة المؤسسة",
    vi: "Không gian tổ chức"
  },
  team: {
    en: "Team Workspace",
    zh: "团队空间",
    ja: "チームスペース",
    es: "Espacio del equipo",
    de: "Team-Bereich",
    fr: "Espace d'équipe",
    "pt-br": "Espaço da equipe",
    ru: "Пространство команды",
    ko: "팀 공간",
    it: "Spazio del team",
    "zh-hant": "團隊空間",
    tr: "Ekip alanı",
    pl: "Obszar zespołu",
    cs: "Prostor týmu",
    ar: "مساحة الفريق",
    vi: "Không gian nhóm"
  },
  personal: {
    en: "Personal Workspace",
    zh: "个人空间",
    ja: "個人スペース",
    es: "Espacio personal",
    de: "Persönlicher Bereich",
    fr: "Espace personnel",
    "pt-br": "Espaço pessoal",
    ru: "Личное пространство",
    ko: "개인 공간",
    it: "Spazio personale",
    "zh-hant": "個人空間",
    tr: "Kişisel alan",
    pl: "Obszar osobisty",
    cs: "Osobní prostor",
    ar: "مساحة شخصية",
    vi: "Không gian cá nhân"
  },
  workspace: {
    en: "Workspace",
    zh: "工作空间",
    ja: "ワークスペース",
    es: "Espacio de trabajo",
    de: "Arbeitsbereich",
    fr: "Espace de travail",
    "pt-br": "Espaço de trabalho",
    ru: "Рабочее пространство",
    ko: "워크스페이스",
    it: "Spazio di lavoro",
    "zh-hant": "工作空間",
    tr: "Çalışma alanı",
    pl: "Obszar roboczy",
    cs: "Pracovní prostor",
    ar: "مساحة العمل",
    vi: "Không gian làm việc"
  }
};

const UNKNOWN_LABELS: Record<DashboardLanguage, string> = {
  en: "unknown",
  zh: "未知",
  ja: "不明",
  es: "desconocido",
  de: "unbekannt",
  fr: "inconnu",
  "pt-br": "desconhecido",
  ru: "неизвестно",
  ko: "알 수 없음",
  it: "sconosciuto",
  "zh-hant": "未知",
  tr: "bilinmiyor",
  pl: "nieznane",
  cs: "neznámé",
  ar: "غير معروف",
  vi: "không rõ"
};

export function getDashboardCopy(language: DashboardLanguage): DashboardCopy {
  return dashboardCopyResources[language] ?? dashboardCopyResources.en;
}

export function formatAuthProvider(value: string | undefined, language: DashboardLanguage): string {
  const rawProvider = value?.trim() ?? "OpenAI";
  const provider =
    {
      google: "Google",
      github: "GitHub",
      microsoft: "Microsoft",
      apple: "Apple",
      password: "Password",
      openai: "OpenAI"
    }[rawProvider.toLowerCase()] ?? rawProvider;
  return `${provider} ${AUTH_PROVIDER_LOGIN_SUFFIX[language] ?? AUTH_PROVIDER_LOGIN_SUFFIX.en}`;
}

export function formatAccountStructure(value: string | undefined, language: DashboardLanguage): string {
  const normalized = (value ?? "workspace").toLowerCase();
  const fallback =
    ACCOUNT_STRUCTURE_LABELS["workspace"]?.[language] ?? ACCOUNT_STRUCTURE_LABELS["workspace"]?.["en"] ?? "Workspace";
  return ACCOUNT_STRUCTURE_LABELS[normalized]?.[language] ?? fallback;
}

export function formatPlanType(value: string | undefined, language: DashboardLanguage): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return UNKNOWN_LABELS[language] ?? UNKNOWN_LABELS.en;
  }

  const labels: Record<string, Record<DashboardLanguage, string>> = {
    free: Object.fromEntries(Object.keys(UNKNOWN_LABELS).map((lang) => [lang, "Free"])) as Record<
      DashboardLanguage,
      string
    >,
    plus: Object.fromEntries(Object.keys(UNKNOWN_LABELS).map((lang) => [lang, "Plus"])) as Record<
      DashboardLanguage,
      string
    >,
    pro: Object.fromEntries(Object.keys(UNKNOWN_LABELS).map((lang) => [lang, "Pro"])) as Record<
      DashboardLanguage,
      string
    >,
    team: Object.fromEntries(Object.keys(UNKNOWN_LABELS).map((lang) => [lang, "Team"])) as Record<
      DashboardLanguage,
      string
    >,
    business: Object.fromEntries(Object.keys(UNKNOWN_LABELS).map((lang) => [lang, "Business"])) as Record<
      DashboardLanguage,
      string
    >,
    enterprise: Object.fromEntries(Object.keys(UNKNOWN_LABELS).map((lang) => [lang, "Enterprise"])) as Record<
      DashboardLanguage,
      string
    >
  };

  const matched = labels[normalized];
  if (matched) {
    return matched[language] ?? matched.en;
  }

  return normalized;
}
