import type { DashboardLanguage } from "../localization/languages";

type DurationPart = {
  unit: "d" | "h" | "m";
  value: number;
};

const UNIT_LABELS: Record<DashboardLanguage, Record<DurationPart["unit"], string>> = {
  en: { d: "d", h: "h", m: "m" },
  zh: { d: "天", h: "小时", m: "分钟" },
  ja: { d: "日", h: "時間", m: "分" },
  es: { d: "d", h: "h", m: "m" },
  de: { d: "T", h: "Std.", m: "Min." },
  fr: { d: "j", h: "h", m: "min" },
  "pt-br": { d: "d", h: "h", m: "min" },
  ru: { d: "d", h: "h", m: "m" },
  ko: { d: "일", h: "시간", m: "분" },
  it: { d: "g", h: "h", m: "min" },
  "zh-hant": { d: "天", h: "小時", m: "分鐘" },
  tr: { d: "g", h: "sa", m: "dk" },
  pl: { d: "d", h: "h", m: "min" },
  cs: { d: "d", h: "h", m: "min" },
  ar: { d: "d", h: "h", m: "m" },
  vi: { d: "ng", h: "giờ", m: "ph" }
};

const LESS_THAN_MINUTE_LABELS: Record<DashboardLanguage, string> = {
  en: "<1m left",
  zh: "不到1分钟",
  ja: "1分未満",
  es: "<1m left",
  de: "<1m left",
  fr: "<1m left",
  "pt-br": "<1m left",
  ru: "<1m left",
  ko: "1분 미만",
  it: "<1m left",
  "zh-hant": "不到1分鐘",
  tr: "<1m left",
  pl: "<1m left",
  cs: "<1m left",
  ar: "<1m left",
  vi: "<1m left"
};

const RESET_LABELS: Record<DashboardLanguage, string> = {
  en: "reset",
  zh: "已重置",
  ja: "リセット済み",
  es: "reset",
  de: "reset",
  fr: "reset",
  "pt-br": "reset",
  ru: "reset",
  ko: "재설정됨",
  it: "reset",
  "zh-hant": "已重置",
  tr: "reset",
  pl: "reset",
  cs: "reset",
  ar: "reset",
  vi: "reset"
};

export function formatResetRelativeTime(epochSeconds: number, nowMs: number, lang: DashboardLanguage): string {
  const diffSeconds = epochSeconds - Math.floor(nowMs / 1000);
  if (diffSeconds <= 0) {
    return RESET_LABELS[lang];
  }

  const totalMinutes = Math.floor(diffSeconds / 60);
  if (totalMinutes <= 0) {
    return LESS_THAN_MINUTE_LABELS[lang];
  }

  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: DurationPart[] = [];

  if (days > 0) {
    parts.push({ unit: "d", value: days });
  }
  if (hours > 0) {
    parts.push({ unit: "h", value: hours });
  }
  if (minutes > 0) {
    parts.push({ unit: "m", value: minutes });
  }

  return formatDurationParts(parts, lang);
}

function formatDurationParts(parts: DurationPart[], lang: DashboardLanguage): string {
  const labels = UNIT_LABELS[lang];
  const formattedParts = parts.map((part) => `${part.value}${labels[part.unit]}`);
  if (lang === "zh" || lang === "zh-hant" || lang === "ja" || lang === "ko") {
    return formattedParts.join(" ");
  }

  return `${formattedParts.join(" ")} left`;
}
