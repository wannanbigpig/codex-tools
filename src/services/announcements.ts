import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import type {
  CodexAnnouncement,
  CodexAnnouncementAction,
  CodexAnnouncementImage,
  CodexAnnouncementState
} from "../core/types";

const DEFAULT_ANNOUNCEMENT_URL = "https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/announcements.json";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_FILE = "announcement_cache.json";
const READ_IDS_FILE = "announcement_read_ids.json";

export interface AnnouncementOptions {
  version?: string;
  locale?: string;
}

export class AnnouncementService {
  constructor(
    private readonly storageDir: string,
    private readonly extensionRoot: string,
    private readonly announcementUrl = process.env["CODEX_ACCOUNTS_ANNOUNCEMENT_URL"]?.trim() ?? DEFAULT_ANNOUNCEMENT_URL
  ) {}

  async getState(options: AnnouncementOptions = {}): Promise<CodexAnnouncementState> {
    const raw = await this.loadAnnouncementsRaw(false);
    return this.buildState(raw.announcements, options);
  }

  async forceRefresh(options: AnnouncementOptions = {}): Promise<CodexAnnouncementState> {
    await this.removeCache();
    const raw = await this.loadAnnouncementsRaw(true);
    return this.buildState(raw.announcements, options);
  }

  async markAsRead(id: string): Promise<void> {
    const value = id.trim();
    if (!value) {
      return;
    }

    const ids = await this.getReadIds();
    if (!ids.includes(value)) {
      ids.push(value);
      await this.saveReadIds(ids);
    }
  }

  async markAllAsRead(options: AnnouncementOptions = {}): Promise<void> {
    const raw = await this.loadAnnouncementsRaw(false);
    const announcements = filterAnnouncements(raw.announcements, options);
    await this.saveReadIds(announcements.map((item) => item.id));
  }

  private async buildState(announcements: CodexAnnouncement[], options: AnnouncementOptions): Promise<CodexAnnouncementState> {
    const filtered = filterAnnouncements(announcements, options);
    const readIds = await this.getReadIds();
    const unreadIds = filtered.filter((item) => !readIds.includes(item.id)).map((item) => item.id);
    const popupAnnouncement = filtered.find((item) => item.popup && unreadIds.includes(item.id)) ?? null;

    return {
      announcements: filtered,
      unreadIds,
      popupAnnouncement
    };
  }

  private get announcementDir(): string {
    return path.join(this.storageDir, "announcements");
  }

  private get cachePath(): string {
    return path.join(this.announcementDir, CACHE_FILE);
  }

  private get readIdsPath(): string {
    return path.join(this.announcementDir, READ_IDS_FILE);
  }

  private get localFilePath(): string {
    const explicit = process.env["CODEX_ACCOUNTS_ANNOUNCEMENT_FILE"]?.trim();
    return explicit ? path.resolve(explicit) : path.join(this.extensionRoot, "announcements.json");
  }

  private async loadAnnouncementsRaw(forceRefresh: boolean): Promise<{ version: string; announcements: CodexAnnouncement[] }> {
    const localFile = this.localFilePath;
    if (isDevelopmentRuntime(this.extensionRoot) && fsSync.existsSync(localFile)) {
      return normalizeAnnouncementResponse(await readJsonSafe(localFile, { announcements: [] }));
    }

    if (!forceRefresh) {
      const cache = await readJsonSafe(this.cachePath, null);
      if (isCachePayload(cache) && Date.now() - cache.time < CACHE_TTL_MS) {
        return normalizeAnnouncementResponse(cache.data);
      }
    }

    try {
      const remote = normalizeAnnouncementResponse(await fetchJson(this.announcementUrl));
      await this.saveCache(remote);
      return remote;
    } catch {
      const cache = await readJsonSafe(this.cachePath, null);
      if (isCachePayload(cache)) {
        return normalizeAnnouncementResponse(cache.data);
      }
      if (fsSync.existsSync(localFile)) {
        return normalizeAnnouncementResponse(await readJsonSafe(localFile, { announcements: [] }));
      }
      return { version: "1.0", announcements: [] };
    }
  }

  private async ensureAnnouncementDir(): Promise<void> {
    await fs.mkdir(this.announcementDir, { recursive: true });
  }

  private async saveCache(payload: unknown): Promise<void> {
    await this.ensureAnnouncementDir();
    await fs.writeFile(this.cachePath, `${JSON.stringify({ time: Date.now(), data: payload }, null, 2)}\n`, "utf8");
  }

  private async removeCache(): Promise<void> {
    try {
      await fs.unlink(this.cachePath);
    } catch {
      // Cache misses are expected.
    }
  }

  private async getReadIds(): Promise<string[]> {
    const raw = await readJsonSafe(this.readIdsPath, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map((value) => String(value || "").trim()).filter(Boolean);
  }

  private async saveReadIds(ids: string[]): Promise<void> {
    const unique = Array.from(new Set(ids.map((value) => value.trim()).filter(Boolean)));
    await this.ensureAnnouncementDir();
    await fs.writeFile(this.readIdsPath, `${JSON.stringify(unique, null, 2)}\n`, "utf8");
  }
}

export function normalizeAnnouncementResponse(payload: unknown): { version: string; announcements: CodexAnnouncement[] } {
  const raw = isRecord(payload) ? payload : {};
  const source = Array.isArray(raw["announcements"]) ? raw["announcements"] : Array.isArray(raw["data"]) ? raw["data"] : [];
  return {
    version: String(raw["version"] || "1.0"),
    announcements: source.map(normalizeAnnouncement).filter((item): item is CodexAnnouncement => Boolean(item))
  };
}

export function filterAnnouncements(
  announcements: CodexAnnouncement[],
  options: AnnouncementOptions = {}
): CodexAnnouncement[] {
  const currentVersion = String(options.version ?? "0.0.0");
  const locale = String(options.locale ?? "zh-CN");
  const now = Date.now();

  return announcements
    .filter((item) => matchVersions(currentVersion, item.targetVersions))
    .filter((item) => matchLanguage(locale, item.targetLanguages))
    .filter((item) => !item.expiresAt || parseTime(item.expiresAt) === 0 || parseTime(item.expiresAt) >= now)
    .map((item) => applyLocale(item, locale))
    .map((item) => applyVersionState(item, currentVersion, locale))
    .filter(onlyLatestReleaseVersion)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return parseTime(b.createdAt) - parseTime(a.createdAt) || b.priority - a.priority;
    });
}

function onlyLatestReleaseVersion(item: CodexAnnouncement, _index: number, all: CodexAnnouncement[]): boolean {
  const latestRelease = getLatestReleaseVersion(all);
  return !item.releaseVersion || item.releaseVersion === latestRelease;
}

function getLatestReleaseVersion(announcements: CodexAnnouncement[]): string | undefined {
  let latest: string | undefined;
  for (const announcement of announcements) {
    if (!announcement.releaseVersion) {
      continue;
    }
    if (!latest || compareVersions(announcement.releaseVersion, latest) > 0) {
      latest = announcement.releaseVersion;
    }
  }
  return latest;
}

export function isDevelopmentRuntime(extensionRoot: string): boolean {
  const explicit = process.env["CODEX_ACCOUNTS_ANNOUNCEMENT_DEV_LOCAL"]?.trim().toLowerCase();
  if (explicit === "1" || explicit === "true") {
    return true;
  }
  if (explicit === "0" || explicit === "false") {
    return false;
  }
  if (process.env["NODE_ENV"]?.trim().toLowerCase() === "development") {
    return true;
  }
  return fsSync.existsSync(path.join(extensionRoot, "src")) && fsSync.existsSync(path.join(extensionRoot, "webview-src"));
}

function normalizeAnnouncement(item: unknown): CodexAnnouncement | null {
  if (!isRecord(item)) {
    return null;
  }
  const id = String(item["id"] || "").trim();
  if (!id) {
    return null;
  }

  return {
    id,
    type: String(item["type"] || item["announcementType"] || "info").trim() || "info",
    priority: Number.isFinite(Number(item["priority"])) ? Number(item["priority"]) : 0,
    releaseVersion: normalizeVersionString(
      item["releaseVersion"] ?? item["release_version"] ?? item["updateVersion"] ?? item["update_version"] ?? item["version"]
    ),
    title: String(item["title"] || "").trim(),
    summary: String(item["summary"] || "").trim(),
    content: String(item["content"] || "").trim(),
    restartHint: normalizeOptionalString(item["restartHint"] ?? item["restart_hint"]),
    action: normalizeAction(item["action"]),
    targetVersions: String(item["targetVersions"] || item["target_versions"] || "*").trim() || "*",
    targetLanguages: normalizeStringList(item["targetLanguages"] ?? item["target_languages"], ["*"]),
    showOnce: item["showOnce"] !== false && item["show_once"] !== false,
    popup: item["popup"] === true,
    pinned: item["pinned"] === true || item["top"] === true,
    createdAt: String(item["createdAt"] || item["created_at"] || "").trim(),
    expiresAt: item["expiresAt"] == null && item["expires_at"] == null ? null : String(item["expiresAt"] ?? item["expires_at"]),
    locales: isRecord(item["locales"]) ? item["locales"] : null,
    images: Array.isArray(item["images"])
      ? item["images"].map(normalizeImage).filter((image): image is CodexAnnouncementImage => Boolean(image))
      : []
  };
}

function normalizeAction(action: unknown): CodexAnnouncementAction | undefined {
  if (!isRecord(action)) {
    return undefined;
  }
  const type = String(action["type"] || "").trim();
  const target = String(action["target"] || "").trim();
  if (!type || !target) {
    return undefined;
  }
  return {
    type,
    target,
    label: String(action["label"] || "").trim() || "打开",
    arguments: Array.isArray(action["arguments"]) ? action["arguments"] : []
  };
}

function normalizeImage(image: unknown): CodexAnnouncementImage | undefined {
  if (!isRecord(image)) {
    return undefined;
  }
  const url = String(image["url"] || "").trim();
  if (!url) {
    return undefined;
  }
  return {
    url,
    label: String(image["label"] || "").trim() || undefined,
    alt: String(image["alt"] || "").trim() || undefined
  };
}

function applyLocale(announcement: CodexAnnouncement, locale: string): CodexAnnouncement {
  const locales = announcement.locales;
  if (!locales || !isRecord(locales)) {
    return announcement;
  }
  const current = locale.toLowerCase();
  const key = Object.keys(locales).find((item) => {
    const normalized = item.toLowerCase();
    return normalized === current || current.startsWith(`${normalized}-`) || normalized.startsWith(`${current}-`);
  });
  const localized = key ? locales[key] : undefined;
  if (!isRecord(localized)) {
    return announcement;
  }

  const next = { ...announcement };
  if (localized["title"]) {
    next.title = String(localized["title"]);
  }
  if (localized["summary"]) {
    next.summary = String(localized["summary"]);
  }
  if (localized["content"]) {
    next.content = String(localized["content"]);
  }
  if (localized["restartHint"]) {
    next.restartHint = String(localized["restartHint"]);
  }
  if (localized["actionLabel"] && next.action) {
    next.action = { ...next.action, label: String(localized["actionLabel"]) };
  }
  return next;
}

function applyVersionState(announcement: CodexAnnouncement, currentVersion: string, locale: string): CodexAnnouncement {
  const releaseVersion = normalizeVersionString(announcement.releaseVersion);
  if (!releaseVersion) {
    return {
      ...announcement,
      currentVersion,
      restartRequired: false
    };
  }

  const restartRequired = compareVersions(currentVersion, releaseVersion) < 0;
  return {
    ...announcement,
    releaseVersion,
    currentVersion,
    restartRequired,
    restartHint: restartRequired
      ? announcement.restartHint ?? formatRestartHint(currentVersion, releaseVersion, locale)
      : announcement.restartHint
  };
}

function formatRestartHint(currentVersion: string, releaseVersion: string, locale: string): string {
  const lang = resolveRestartHintLanguage(locale);
  const messages: Record<string, string> = {
    ar: `إصدار الإضافة الحالي هو v${currentVersion}، وهذه الرسالة تخص v${releaseVersion}. إذا لم يظهر التحديث بعد، فانتظر حتى يتوفر في سوق الإضافات ثم أعد تحميل نافذة VS Code أو أعد تشغيل الإضافة.`,
    cs: `Aktuální verze rozšíření je v${currentVersion}, ale tato zpráva je pro v${releaseVersion}. Pokud aktualizace ještě není dostupná, počkejte na její zveřejnění v marketplace a poté znovu načtěte okno VS Code nebo restartujte rozšíření.`,
    de: `Die aktuelle Erweiterungsversion ist v${currentVersion}, diese Meldung ist für v${releaseVersion}. Falls das Update noch nicht verfügbar ist, warten Sie auf die Marketplace-Aktualisierung und laden Sie danach das VS Code-Fenster neu oder starten Sie die Erweiterung neu.`,
    en: `Current extension version is v${currentVersion}, while this message is for v${releaseVersion}. If the update is not available yet, wait for the marketplace update, then reload the VS Code window or restart the extension.`,
    es: `La versión actual de la extensión es v${currentVersion}, pero este mensaje corresponde a v${releaseVersion}. Si la actualización aún no aparece, espera a que esté disponible en el marketplace y luego recarga VS Code o reinicia la extensión.`,
    fr: `La version actuelle de l'extension est v${currentVersion}, mais ce message concerne v${releaseVersion}. Si la mise à jour n'est pas encore disponible, attendez sa publication sur le marketplace puis rechargez VS Code ou redémarrez l'extension.`,
    it: `La versione attuale dell'estensione è v${currentVersion}, mentre questo messaggio riguarda v${releaseVersion}. Se l'aggiornamento non è ancora disponibile, attendi il marketplace e poi ricarica VS Code o riavvia l'estensione.`,
    ja: `現在の拡張機能バージョンは v${currentVersion} ですが、このメッセージは v${releaseVersion} 向けです。更新がまだ表示されない場合は、マーケットプレイスで利用可能になるのを待ってから VS Code ウィンドウを再読み込みするか、拡張機能を再起動してください。`,
    ko: `현재 확장 버전은 v${currentVersion}이고 이 메시지는 v${releaseVersion}용입니다. 업데이트가 아직 보이지 않으면 마켓플레이스 업데이트를 기다린 뒤 VS Code 창을 다시 로드하거나 확장을 다시 시작하세요.`,
    pl: `Obecna wersja rozszerzenia to v${currentVersion}, a ta wiadomość dotyczy v${releaseVersion}. Jeśli aktualizacja nie jest jeszcze dostępna, poczekaj na marketplace, a potem przeładuj VS Code albo uruchom rozszerzenie ponownie.`,
    "pt-br": `A versão atual da extensão é v${currentVersion}, mas esta mensagem é para v${releaseVersion}. Se a atualização ainda não aparecer, aguarde o marketplace e depois recarregue a janela do VS Code ou reinicie a extensão.`,
    ru: `Текущая версия расширения v${currentVersion}, а это сообщение относится к v${releaseVersion}. Если обновление еще недоступно, дождитесь его в marketplace, затем перезагрузите окно VS Code или расширение.`,
    tr: `Geçerli uzantı sürümü v${currentVersion}, bu mesaj ise v${releaseVersion} içindir. Güncelleme henüz görünmüyorsa marketplace güncellemesini bekleyin, ardından VS Code penceresini yeniden yükleyin veya uzantıyı yeniden başlatın.`,
    vi: `Phiên bản tiện ích hiện tại là v${currentVersion}, còn thông báo này dành cho v${releaseVersion}. Nếu bản cập nhật chưa xuất hiện, hãy chờ marketplace cập nhật rồi tải lại cửa sổ VS Code hoặc khởi động lại tiện ích.`,
    zh: `当前扩展版本为 v${currentVersion}，此更新消息对应 v${releaseVersion}。如果应用市场暂未显示更新，请等待应用市场同步后，再重新加载 VS Code 窗口或重启扩展。`,
    "zh-hant": `目前擴充版本為 v${currentVersion}，此更新訊息對應 v${releaseVersion}。如果應用市場暫未顯示更新，請等待應用市場同步後，再重新載入 VS Code 視窗或重啟擴充。`
  };
  return messages[lang] ?? messages["en"]!;
}

function resolveRestartHintLanguage(locale: string): string {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("zh-hant") || normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk")) {
    return "zh-hant";
  }
  if (normalized.startsWith("pt")) {
    return "pt-br";
  }
  const language = normalized.split("-")[0] ?? "en";
  return language === "zh" ? "zh" : language;
}

function matchLanguage(locale: string, languages: string[]): boolean {
  const current = locale.toLowerCase();
  const list = languages.length ? languages : ["*"];
  return list.some((value) => {
    const lang = value.toLowerCase();
    return lang === "*" || current === lang || current.startsWith(`${lang}-`);
  });
}

function matchVersions(currentVersion: string, targetVersions: string): boolean {
  const text = targetVersions.trim();
  if (!text || text === "*") {
    return true;
  }
  return text.split(",").some((rule) => matchVersionRule(currentVersion, rule));
}

function matchVersionRule(currentVersion: string, rule: string): boolean {
  const raw = rule.trim();
  if (!raw || raw === "*") {
    return true;
  }
  const match = raw.match(/^(>=|<=|>|<|=)?\s*v?([0-9][0-9a-zA-Z.-]*)$/);
  if (!match) {
    return raw === currentVersion || raw === `v${currentVersion}`;
  }
  const operator = match[1] ?? "=";
  const compared = compareVersions(currentVersion, match[2] ?? "0.0.0");
  if (operator === ">=") {
    return compared >= 0;
  }
  if (operator === "<=") {
    return compared <= 0;
  }
  if (operator === ">") {
    return compared > 0;
  }
  if (operator === "<") {
    return compared < 0;
  }
  return compared === 0;
}

function compareVersions(left: string, right: string): number {
  const a = left.replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
  const b = right.replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function parseTime(value: string | null | undefined): number {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value.map((item) => String(item ?? "").trim()).filter(Boolean);
  return normalized.length ? normalized : fallback;
}

function normalizeVersionString(value: unknown): string | undefined {
  const text = normalizeOptionalString(value)?.replace(/^v/i, "");
  return text && text.length > 0 ? text : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  const text = String(value).trim();
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCachePayload(value: unknown): value is { time: number; data: unknown } {
  return isRecord(value) && Number.isFinite(Number(value["time"])) && "data" in value;
}

async function readJsonSafe<T>(filePath: string, fallback: T): Promise<unknown> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const target = url.trim();
    if (!target) {
      reject(new Error("Announcement URL is empty"));
      return;
    }

    if (target.startsWith("file://")) {
      fs.readFile(decodeURIComponent(target.replace(/^file:\/\//, "")), "utf8")
        .then((raw) => resolve(JSON.parse(raw) as unknown))
        .catch(reject);
      return;
    }

    const client = target.startsWith("http://") ? http : https;
    const request = client.get(
      `${target}${target.includes("?") ? "&" : "?"}t=${Date.now()}`,
      {
        headers: {
          "User-Agent": "Codex-Accounts-Manager",
          "Cache-Control": "no-cache",
          Pragma: "no-cache"
        },
        timeout: 10_000
      },
      (response) => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`Announcement endpoint returned ${response.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("Announcement request timed out")));
    request.on("error", reject);
  });
}
