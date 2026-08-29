import type {
  DashboardCopy,
  DashboardSettingKey,
  DashboardSettings,
  DashboardState
} from "../../src/domain/dashboard/types";
import {
  SettingsDiscreteSlider,
  SettingsLanguageBlock,
  SettingsPathBlock,
  SettingsSegmentBlock,
  SettingsThemeBlock,
  SettingsThresholdBlock,
  SettingsToggleBlock
} from "./components";
import { formatTemplate, formatTimestamp } from "./helpers";
import { renderRemoveIcon } from "./icons";

const AUTO_REFRESH_VALUES = Array.from({ length: 60 }, (_, index) => index + 1);
const AUTO_REFRESH_SCALE_VALUES = [1, 15, 30, 45, 60];
const USAGE_HISTORY_RETENTION_VALUES = [1, 3, 7, 14, 30, 60, 90];
const AUTO_SWITCH_VALUES = Array.from({ length: 21 }, (_, index) => index);
const AUTO_SWITCH_LOCK_VALUES = [0, 5, 10, 15, 30, 60, 120];
const WARNING_VALUES = Array.from({ length: 18 }, (_, index) => 5 + index * 5);
const WARNING_SCALE_VALUES = [5, 20, 35, 50, 65, 80, 90];

export function SettingsOverlay(props: {
  open: boolean;
  copy: DashboardCopy;
  lang: DashboardState["lang"];
  settings: DashboardSettings;
  tokenAutomation: DashboardState["tokenAutomation"];
  encryptedSyncNeedsConfiguration: boolean;
  encryptedSyncNeedsSettingsSync: boolean;
  usageHistoryCount: number;
  onClose: () => void;
  onPatchSettings: (patch: Partial<DashboardSettings>) => void;
  onSendSetting: (key: DashboardSettingKey, value: string | number | boolean) => void;
  onAutoRefreshToggle: (enabled: boolean) => void;
  onAutoRefreshValue: (minutes: number) => void;
  onAutoRefreshCurrentToggle: (enabled: boolean) => void;
  onAutoRefreshCurrentValue: (minutes: number) => void;
  onThresholdPreview: (key: "yellow" | "green", value: number) => void;
  onThresholdCommit: (key: "yellow" | "green", value: number) => void;
  onPickCodexAppPath: () => void;
  onClearCodexAppPath: () => void;
  onClearUsageHistory: () => void;
  onOpenNetworkLogs: () => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  onConfigureSync: () => void;
  onSyncNow: () => void;
  onSetRegistryOverride: (enabled: boolean) => void;
  registryOverridePending: boolean;
  onSetWebDashboardPassword: () => void;
}) {
  const patchAndSend = (key: DashboardSettingKey, value: string | number | boolean) => {
    props.onPatchSettings({ [key]: value } as Partial<DashboardSettings>);
    props.onSendSetting(key, value);
  };
  const sessionResumeCopy = resolveSessionResumeCopy(props.lang);
  const usageHistoryCopy = resolveUsageHistoryCopy(props.lang, props.usageHistoryCount);
  const transferCopy = resolveTransferCopy(props.lang);

  return (
    <div class={`overlay ${props.open ? "open" : ""}`} onClick={props.onClose}>
      <div class="settings-modal" onClick={(event) => event.stopPropagation()}>
        <div class="settings-modal-head">
          <div class="settings-modal-title">{props.copy.settingsTitle}</div>
          <button class="settings-close" type="button" onClick={props.onClose}>
            ×
          </button>
        </div>
        <div class="settings-modal-body">
          <div class="settings-layout">
            <SettingsThemeBlock
              lang={props.lang}
              settings={props.settings}
              onChange={(value) => {
                props.onPatchSettings({ dashboardTheme: value });
                props.onSendSetting("dashboardTheme", value);
              }}
            />
            <SettingsLanguageBlock
              copy={props.copy}
              settings={props.settings}
              onChange={(value) => {
                props.onPatchSettings({ displayLanguage: value });
                props.onSendSetting("displayLanguage", value);
              }}
            />
            <div class="settings-block settings-block-wide settings-integration-group">
              <div class="settings-block-head settings-integration-head">
                <div class="settings-block-title">{props.lang === "zh" ? "面板与 CLI 会话" : props.lang === "zh-hant" ? "面板與 CLI 工作階段" : "Dashboard & CLI Sessions"}</div>
                <div class="settings-block-sub">{props.lang === "zh" ? "在一个位置配置浏览器访问、本机 CLI 会话和会话恢复。" : props.lang === "zh-hant" ? "在一個位置設定瀏覽器存取、本機 CLI 工作階段與工作階段恢復。" : "Configure browser access, local CLI sessions, and session resume in one place."}</div>
              </div>
              <div class="settings-integration-grid">
            <SettingsToggleBlock
              title={props.lang === "zh" ? "浏览器面板" : props.lang === "zh-hant" ? "瀏覽器面板" : "Web Dashboard"}
              sub={
                <>
                  {props.lang === "zh"
                    ? "在 127.0.0.1:39875 启动浏览器面板。"
                    : props.lang === "zh-hant"
                      ? "在 127.0.0.1:39875 啟動瀏覽器面板。"
                      : "Run the browser dashboard at 127.0.0.1:39875. "}
                  <button class="settings-inline-link" type="button" onClick={props.onSetWebDashboardPassword}>
                    {props.lang === "zh" ? "设置密码" : props.lang === "zh-hant" ? "設定密碼" : "Set password"}
                  </button>
                </>
              }
              enabled={props.settings.webDashboardEnabled}
              onToggle={(enabled) => patchAndSend("webDashboardEnabled", enabled)}
            >
              <div class="settings-note">
                {props.settings.webDashboardEnabled
                  ? props.lang === "zh"
                    ? "已启用。点击顶部面板按钮可在浏览器中打开。"
                    : props.lang === "zh-hant"
                      ? "已啟用。點擊頂部面板按鈕可在瀏覽器中開啟。"
                      : "Enabled. Use the dashboard button at the top to open it in your browser."
                  : props.lang === "zh"
                    ? "已停用。"
                    : props.lang === "zh-hant"
                      ? "已停用。"
                      : "Disabled."}
              </div>
            </SettingsToggleBlock>
            <SettingsToggleBlock
              title={props.lang === "zh" ? "CLI 集成" : props.lang === "zh-hant" ? "CLI 整合" : "CLI Integration"}
              sub={props.lang === "zh" ? "允许按需读取本机 Codex CLI 会话，并作为自动恢复的总开关。" : props.lang === "zh-hant" ? "允許按需讀取本機 Codex CLI 工作階段，並作為自動恢復的總開關。" : "Allow on-demand access to local Codex CLI sessions and gate automatic session resume."}
              enabled={props.settings.cliIntegrationEnabled === true}
              onToggle={(enabled) => patchAndSend("cliIntegrationEnabled", enabled)}
            >
              <div class="settings-note">
                {props.settings.cliIntegrationEnabled
                  ? props.lang === "zh" ? "已启用。浏览器面板可以打开会话列表和消息。" : props.lang === "zh-hant" ? "已啟用。瀏覽器面板可以開啟工作階段清單與訊息。" : "Enabled. The browser dashboard can open the session list and messages."
                  : props.lang === "zh" ? "已停用。不会读取 CLI 会话文件。" : props.lang === "zh-hant" ? "已停用。不會讀取 CLI 工作階段檔案。" : "Disabled. CLI session files are not read."
                }
              </div>
            </SettingsToggleBlock>
            <SettingsToggleBlock
              title={sessionResumeCopy.title}
              sub={sessionResumeCopy.sub}
              enabled={props.settings.cliIntegrationEnabled === true && props.settings.autoResumeCodexSessions === true}
              disabled={!props.settings.cliIntegrationEnabled}
              className={`settings-subordinate ${props.settings.cliIntegrationEnabled ? "" : "is-disabled"}`}
              onToggle={(enabled) => patchAndSend("autoResumeCodexSessions", enabled)}
            >
              <div class="settings-note">
                {props.settings.autoResumeCodexSessions ? sessionResumeCopy.enabled : sessionResumeCopy.disabled}
              </div>
            </SettingsToggleBlock>
              </div>
            </div>
            <SettingsToggleBlock
              title={props.copy.codexAppRestartTitle}
              sub={props.copy.codexAppRestartSub}
              enabled={props.settings.codexAppRestartEnabled}
              className={props.settings.codexAppRestartEnabled ? "settings-block-wide" : ""}
              onToggle={(enabled) => patchAndSend("codexAppRestartEnabled", enabled)}
            >
              <div class={`settings-stack ${props.settings.codexAppRestartEnabled ? "" : "is-hidden"}`}>
                <div class="settings-segment">
                  <button
                    class={`segment-btn ${props.settings.codexAppRestartMode === "auto" ? "active" : ""}`}
                    type="button"
                    onClick={() => patchAndSend("codexAppRestartMode", "auto")}
                  >
                    <span class="segment-title">{props.copy.restartModeAuto}</span>
                    <span class="segment-copy">{props.copy.restartModeAutoDesc}</span>
                  </button>
                  <button
                    class={`segment-btn ${props.settings.codexAppRestartMode === "manual" ? "active" : ""}`}
                    type="button"
                    onClick={() => patchAndSend("codexAppRestartMode", "manual")}
                  >
                    <span class="segment-title">{props.copy.restartModeManual}</span>
                    <span class="segment-copy">{props.copy.restartModeManualDesc}</span>
                  </button>
                </div>
                <div class="settings-note">{props.copy.restartModeNote}</div>
                <SettingsPathBlock
                  copy={props.copy}
                  pathValue={props.settings.resolvedCodexAppPath}
                  hasCustomPath={Boolean(props.settings.codexAppPath)}
                  compact
                  onPick={props.onPickCodexAppPath}
                  onClear={props.onClearCodexAppPath}
                />
              </div>
            </SettingsToggleBlock>
            <div class="settings-block settings-block-wide settings-refresh-group">
              <SettingsToggleBlock
                title={props.copy.autoRefreshCurrentTitle}
                sub={props.copy.autoRefreshCurrentSub}
                enabled={props.settings.autoRefreshCurrentMinutes > 0}
                onToggle={props.onAutoRefreshCurrentToggle}
              >
                <div class={`settings-stack ${props.settings.autoRefreshCurrentMinutes > 0 ? "" : "is-hidden"}`}>
                  <SettingsDiscreteSlider
                    value={props.settings.autoRefreshCurrentMinutes}
                    values={AUTO_REFRESH_VALUES}
                    accent="violet"
                    scaleValues={AUTO_REFRESH_SCALE_VALUES}
                    valueLabel={(value) => formatTemplate(props.copy.autoRefreshValueTemplate, value)}
                    description={(value) => formatTemplate(props.copy.autoRefreshCurrentValueDescTemplate, value)}
                    onPreview={(value) => props.onPatchSettings({ autoRefreshCurrentMinutes: value })}
                    onCommit={props.onAutoRefreshCurrentValue}
                  />
                </div>
              </SettingsToggleBlock>
              <SettingsToggleBlock
                title={props.copy.autoRefreshTitle}
                sub={props.copy.autoRefreshSub}
                enabled={props.settings.autoRefreshMinutes > 0}
                onToggle={props.onAutoRefreshToggle}
              >
                <div class={`settings-stack ${props.settings.autoRefreshMinutes > 0 ? "" : "is-hidden"}`}>
                  <SettingsDiscreteSlider
                    value={props.settings.autoRefreshMinutes}
                    values={AUTO_REFRESH_VALUES}
                    accent="violet"
                    scaleValues={AUTO_REFRESH_SCALE_VALUES}
                    valueLabel={(value) => formatTemplate(props.copy.autoRefreshValueTemplate, value)}
                    description={(value) => formatTemplate(props.copy.autoRefreshValueDescTemplate, value)}
                    onPreview={(value) => props.onPatchSettings({ autoRefreshMinutes: value })}
                    onCommit={props.onAutoRefreshValue}
                  />
                </div>
              </SettingsToggleBlock>
            </div>
            <div class="settings-block settings-block-wide settings-history-block">
              <div class="settings-toggle-head">
                <div class="settings-block-head">
                  <div class="settings-block-title settings-title-with-badge">
                    {usageHistoryCopy.title}
                    <span class="settings-count-badge">{usageHistoryCopy.count}</span>
                  </div>
                  <div class="settings-block-sub">{usageHistoryCopy.sub}</div>
                </div>
                <button
                  class="settings-history-clear"
                  type="button"
                  disabled={props.usageHistoryCount === 0}
                  title={usageHistoryCopy.clear}
                  aria-label={usageHistoryCopy.clear}
                  onClick={props.onClearUsageHistory}
                >
                  {renderRemoveIcon()}
                </button>
              </div>
              <SettingsDiscreteSlider
                value={props.settings.usageHistoryRetentionDays}
                values={USAGE_HISTORY_RETENTION_VALUES}
                accent="sky"
                scaleValues={[0, 7, 30, 60, 90]}
                valueLabel={(value) => resolveRetentionValueLabel(value, props.lang)}
                description={(value) => resolveRetentionDescription(value, props.lang)}
                onPreview={(value) => props.onPatchSettings({ usageHistoryRetentionDays: value })}
                onCommit={(value) => patchAndSend("usageHistoryRetentionDays", value)}
              />
            </div>
            <SettingsToggleBlock
              title={props.copy.hourlyQuotaControlTitle}
              sub={props.copy.hourlyQuotaControlSub}
              enabled={props.settings.hourlyQuotaControlEnabled}
              onToggle={(enabled) => patchAndSend("hourlyQuotaControlEnabled", enabled)}
            >
              <div class="settings-note">
                {props.settings.hourlyQuotaControlEnabled
                  ? props.copy.hourlyQuotaControlOnDesc
                  : props.copy.hourlyQuotaControlOffDesc}
              </div>
            </SettingsToggleBlock>
            <SettingsToggleBlock
              title={props.copy.tokenAutomationTitle}
              sub={props.copy.tokenAutomationSub}
              enabled={props.settings.backgroundTokenRefreshEnabled}
              onToggle={(enabled) => patchAndSend("backgroundTokenRefreshEnabled", enabled)}
            >
              <div class={`settings-stack ${props.settings.backgroundTokenRefreshEnabled ? "" : "is-hidden"}`}>
                <div class="settings-note-list">
                  <div class="settings-note-item">
                    <span>{props.copy.tokenAutomationLastCheck}</span>
                    <strong>{formatTimestamp(props.tokenAutomation.lastCheckAt, props.copy.never)}</strong>
                  </div>
                  <div class="settings-note-item">
                    <span>{props.copy.tokenAutomationLastRefresh}</span>
                    <strong>{formatTimestamp(props.tokenAutomation.lastRefreshAt, props.copy.never)}</strong>
                  </div>
                  <div class="settings-note-item">
                    <span>{props.copy.tokenAutomationNextCheck}</span>
                    <strong>{formatTimestamp(props.tokenAutomation.nextCheckAt, props.copy.never)}</strong>
                  </div>
                  <div class="settings-note-item">
                    <span>{props.copy.tokenAutomationLastFailure}</span>
                    <strong>{props.tokenAutomation.lastFailureMessage ?? props.copy.never}</strong>
                  </div>
                </div>
              </div>
            </SettingsToggleBlock>
            <SettingsToggleBlock
              title={props.copy.autoSwitchTitle}
              sub={props.copy.autoSwitchSub}
              enabled={props.settings.autoSwitchEnabled}
              className="settings-block-wide"
              onToggle={(enabled) => patchAndSend("autoSwitchEnabled", enabled)}
            >
              <div class={`settings-stack ${props.settings.autoSwitchEnabled ? "" : "is-hidden"}`}>
                {props.settings.hourlyQuotaControlEnabled ? (
                  <SettingsDiscreteSlider
                    value={props.settings.autoSwitchHourlyThreshold}
                    values={AUTO_SWITCH_VALUES}
                    accent="violet"
                    sparseScale
                    valueLabel={(value) => `${value}%`}
                    description={(value) =>
                      formatTemplate(props.copy.autoSwitchThresholdDescTemplate, {
                        label: props.copy.hourlyLabel,
                        value
                      })
                    }
                    onPreview={(value) => props.onPatchSettings({ autoSwitchHourlyThreshold: value })}
                    onCommit={(value) => patchAndSend("autoSwitchHourlyThreshold", value)}
                  />
                ) : null}
                <SettingsDiscreteSlider
                  value={props.settings.autoSwitchWeeklyThreshold}
                  values={AUTO_SWITCH_VALUES}
                  accent="sky"
                  sparseScale
                  valueLabel={(value) => `${value}%`}
                  description={(value) =>
                    formatTemplate(props.copy.autoSwitchThresholdDescTemplate, {
                      label: props.copy.weeklyLabel,
                      value
                    })
                  }
                  onPreview={(value) => props.onPatchSettings({ autoSwitchWeeklyThreshold: value })}
                  onCommit={(value) => patchAndSend("autoSwitchWeeklyThreshold", value)}
                />
                <SettingsToggleBlock
                  title={props.copy.autoSwitchReloadTitle}
                  sub={props.copy.autoSwitchReloadSub}
                  enabled={props.settings.autoSwitchReloadWindowEnabled}
                  onToggle={(enabled) => patchAndSend("autoSwitchReloadWindowEnabled", enabled)}
                />
                <div class="settings-block-head">
                  <div class="settings-block-title">{props.copy.autoSwitchLockMinutesTitle}</div>
                  <div class="settings-block-sub">{props.copy.autoSwitchLockMinutesSub}</div>
                </div>
                <SettingsDiscreteSlider
                  value={props.settings.autoSwitchLockMinutes}
                  values={AUTO_SWITCH_LOCK_VALUES}
                  accent="violet"
                  valueLabel={(value) =>
                    value === 0
                      ? props.copy.autoSwitchLockOff
                      : formatTemplate(props.copy.autoSwitchLockValueTemplate, value)
                  }
                  description={(value) =>
                    value === 0
                      ? props.copy.autoSwitchLockMinutesSub
                      : formatTemplate(props.copy.autoSwitchLockValueDescTemplate, value)
                  }
                  scaleValues={AUTO_SWITCH_LOCK_VALUES}
                  onPreview={(value) => props.onPatchSettings({ autoSwitchLockMinutes: value })}
                  onCommit={(value) => patchAndSend("autoSwitchLockMinutes", value)}
                />
                <div class="settings-note">{props.copy.autoSwitchAnyNote}</div>
              </div>
            </SettingsToggleBlock>
            <SettingsToggleBlock
              title={props.copy.warningTitle}
              sub={props.settings.hourlyQuotaControlEnabled ? props.copy.warningSub : props.copy.warningWeeklyOnlySub}
              enabled={props.settings.quotaWarningEnabled}
              className={props.settings.quotaWarningEnabled ? "settings-block-wide" : ""}
              onToggle={(enabled) => patchAndSend("quotaWarningEnabled", enabled)}
            >
              <div class={`settings-stack ${props.settings.quotaWarningEnabled ? "" : "is-hidden"}`}>
                <SettingsDiscreteSlider
                  value={props.settings.quotaWarningThreshold}
                  values={WARNING_VALUES}
                  accent="amber"
                  scaleValues={WARNING_SCALE_VALUES}
                  valueLabel={(value) => `${value}%`}
                  description={(value) => formatTemplate(props.copy.warningValueDescTemplate, value)}
                  onPreview={(value) => props.onPatchSettings({ quotaWarningThreshold: value })}
                  onCommit={(value) => patchAndSend("quotaWarningThreshold", value)}
                />
              </div>
            </SettingsToggleBlock>
            <SettingsThresholdBlock
              copy={props.copy}
              settings={props.settings}
              onPreview={props.onThresholdPreview}
              onCommit={props.onThresholdCommit}
            />
            <SettingsSegmentBlock
              title={props.copy.debugTitle}
              sub={props.copy.debugSub}
              note={props.copy.debugNote}
              className="settings-block-wide"
              options={[
                {
                  key: "debug-on",
                  title: props.copy.debugOn,
                  description: props.copy.debugOnDesc,
                  active: props.settings.debugNetwork,
                  onClick: () => patchAndSend("debugNetwork", true)
                },
                {
                  key: "debug-off",
                  title: props.copy.debugOff,
                  description: props.copy.debugOffDesc,
                  active: !props.settings.debugNetwork,
                  onClick: () => patchAndSend("debugNetwork", false)
                }
              ]}
            >
              <div class="settings-actions">
                <button class="settings-action-btn" type="button" onClick={props.onOpenNetworkLogs}>
                  {resolveOpenLogsLabel(props.lang)}
                </button>
              </div>
            </SettingsSegmentBlock>
            <div class="settings-block settings-block-wide">
              <div class="settings-block-head">
                <div class="settings-block-title">{transferCopy.syncTitle}</div>
                <div class="settings-block-sub">{transferCopy.syncSub}</div>
              </div>
              {props.encryptedSyncNeedsConfiguration ? (
                <div class="settings-note settings-notice-warning">{transferCopy.syncNeedsConfiguration}</div>
              ) : null}
              {props.encryptedSyncNeedsSettingsSync ? (
                <div class="settings-note settings-notice-warning">{transferCopy.syncNeedsSettingsSync}</div>
              ) : null}
              <div class="settings-note">{transferCopy.syncNote}</div>
              <div class="settings-actions">
                <button class="settings-action-btn" type="button" onClick={props.onConfigureSync}>
                  {transferCopy.configureSync}
                </button>
                <button
                  class="settings-action-btn"
                  type="button"
                  onClick={props.onSyncNow}
                  disabled={!props.settings.encryptedSyncEnabled}
                >
                  {transferCopy.syncNow}
                </button>
              </div>
            </div>
            <SettingsToggleBlock
              title={resolveRegistryOverrideText("title", props.lang)}
              sub={resolveRegistryOverrideText("sub", props.lang)}
              enabled={props.settings.encryptedSyncRegistryOverrideEnabled}
              disabled={props.registryOverridePending}
              className="settings-block-wide"
              onToggle={props.onSetRegistryOverride}
            >
              <div class="settings-note settings-notice-warning">
                {props.registryOverridePending
                  ? resolveRegistryOverrideText("pending", props.lang)
                  : props.settings.encryptedSyncRegistryOverrideEnabled
                    ? resolveRegistryOverrideText("enabled", props.lang)
                    : resolveRegistryOverrideText("disabled", props.lang)}
              </div>
            </SettingsToggleBlock>
            <div class="settings-block settings-block-wide">
              <div class="settings-block-head">
                <div class="settings-block-title">{transferCopy.title}</div>
                <div class="settings-block-sub">{transferCopy.sub}</div>
              </div>
              <div class="settings-stack">
                <div class="settings-actions">
                  <button class="settings-action-btn" type="button" onClick={props.onExportBackup}>
                    {transferCopy.exportLabel}
                  </button>
                  <button class="settings-action-btn" type="button" onClick={props.onImportBackup}>
                    {transferCopy.importLabel}
                  </button>
                </div>
                <div class="settings-note">{transferCopy.note}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function resolveRegistryOverrideText(
  key: "title" | "sub" | "enabled" | "disabled" | "pending",
  lang: DashboardState["lang"]
): string {
  const values = {
    en: {
      title: "Rescue override",
      sub: "Unlock a foreign-PC enablement locally without changing the shared registry.",
      enabled: "Rescue is active on this PC. The shared enable/disable registry is unchanged.",
      disabled: "Off. Turning this on requires the encrypted sync passphrase.",
      pending: "Waiting for passphrase verification…"
    },
    zh: {
      title: "救援覆盖",
      sub: "仅在本机解除其他电脑的启用锁定，不更改共享注册表。",
      enabled: "本机绕过已启用。同一会话现在可能被多台电脑同时使用。",
      disabled: "已关闭。启用时需要验证加密同步密码。",
      pending: "正在等待同步密码验证…"
    },
    "zh-hant": {
      title: "救援覆寫",
      sub: "僅在本機解除其他電腦的啟用鎖定，不變更共享登錄。",
      enabled: "本機略過已啟用。同一工作階段現在可能被多台電腦同時使用。",
      disabled: "已關閉。啟用時需要驗證加密同步密碼。",
      pending: "正在等待同步密碼驗證…"
    }
  } as const;
  const locale = lang === "zh" || lang === "zh-hant" ? lang : "en";
  return values[locale][key];
}

function resolveOpenLogsLabel(lang: DashboardState["lang"]): string {
  return lang === "zh" ? "打开网络日志" : lang === "zh-hant" ? "開啟網路日誌" : "Open network logs";
}

function resolveUsageHistoryCopy(
  lang: DashboardState["lang"],
  count: number
): { title: string; sub: string; count: string; clear: string } {
  if (lang === "zh") {
    return {
      title: "配额图表记录",
      sub: "选择自动清理时间。",
      count: `${count} 条`,
      clear: "清除配额图表记录"
    };
  }
  if (lang === "zh-hant") {
    return {
      title: "配額圖表記錄",
      sub: "選擇自動清理時間。",
      count: `${count} 筆`,
      clear: "清除配額圖表記錄"
    };
  }
  return {
    title: "Quota graph history",
    sub: "Choose when old graph samples are automatically removed.",
    count: `${count} samples`,
    clear: "Clear quota graph history"
  };
}

function resolveTransferCopy(lang: DashboardState["lang"]): {
  title: string;
  sub: string;
  exportLabel: string;
  importLabel: string;
  note: string;
  syncTitle: string;
  syncSub: string;
  syncNote: string;
  syncNeedsConfiguration: string;
  syncNeedsSettingsSync: string;
  configureSync: string;
  syncNow: string;
} {
  if (lang === "zh") {
    return {
      title: "手动迁移",
      sub: "手动迁移所有账号会话、扩展设置和诊断日志。",
      exportLabel: "导出全部会话",
      importLabel: "导入全部会话",
      note: "导出文件包含登录令牌，请使用安全方式传输并在完成后删除。",
      syncTitle: "加密 VS Code 同步",
      syncSub: "通过 VS Code Settings Sync 按操作同步会话和电脑占用。",
      syncNote:
        "同步会记录启用账号的电脑。每次切换后运行同步，即可在电脑之间共享最新登记。",
      syncNeedsConfiguration: "同步保险库需要重新配置。请使用“设置同步密码”重新输入密码。",
      syncNeedsSettingsSync:
        "此电脑上的 VS Code Settings Sync 尚未启用。请登录 VS Code 并启用 Settings Sync，然后重试。",
      configureSync: "设置同步密码",
      syncNow: "立即同步"
    };
  }
  if (lang === "zh-hant") {
    return {
      title: "手動轉移",
      sub: "手動轉移所有帳戶工作階段、擴充功能設定與診斷記錄。",
      exportLabel: "匯出全部工作階段",
      importLabel: "匯入全部工作階段",
      note: "匯出檔案包含登入權杖，請使用安全方式傳輸並在完成後刪除。",
      syncTitle: "加密 VS Code 同步",
      syncSub: "透過 VS Code Settings Sync 按操作同步工作階段和啟用登錄。",
      syncNote:
        "同步會記錄啟用帳號的電腦。每次切換後執行同步，即可在電腦之間分享最新登錄。",
      syncNeedsConfiguration: "同步保存庫需要重新設定。請使用「設定同步密碼」重新輸入密碼。",
      syncNeedsSettingsSync:
        "此電腦上的 VS Code Settings Sync 尚未啟用。請登入 VS Code 並啟用 Settings Sync，然後重試。",
      configureSync: "設定同步密碼",
      syncNow: "立即同步"
    };
  }
  return {
    title: "Manual transfer",
    sub: "Transfer all account sessions, extension settings, and diagnostic logs.",
    exportLabel: "Export all sessions",
    importLabel: "Import all sessions",
    note: "The export contains login tokens. Transfer it securely and delete it when finished.",
    syncTitle: "Encrypted VS Code sync",
    syncSub: "Sync sessions and the enable/disable registry through VS Code Settings Sync.",
    syncNote:
      "The registry records which PC has an account enabled. Run Sync after each toggle to share the latest registry across PCs.",
    syncNeedsConfiguration: "The sync vault needs configuration. Use Set sync passphrase to enter it again.",
    syncNeedsSettingsSync:
      "VS Code Settings Sync is not active on this PC. Sign in to VS Code and turn on Settings Sync, then try again.",
    configureSync: "Set sync passphrase",
    syncNow: "Sync now"
  };
}

function resolveRetentionValueLabel(value: number, lang: DashboardState["lang"]): string {
  return lang === "zh" ? `${value} 天` : lang === "zh-hant" ? `${value} 天` : `${value} days`;
}

function resolveRetentionDescription(value: number, lang: DashboardState["lang"]): string {
  return lang === "zh"
    ? `自动删除超过 ${value} 天的记录。`
    : lang === "zh-hant"
      ? `自動刪除超過 ${value} 天的記錄。`
      : `Automatically remove samples older than ${value} days.`;
}

function resolveSessionResumeCopy(lang: DashboardState["lang"]): {
  title: string;
  sub: string;
  enabled: string;
  disabled: string;
} {
  if (lang === "zh") {
    return {
      title: "自动恢复 Codex 会话",
      sub: "重新打开此工作区中上次仍在使用的官方 Codex 会话标签页。",
      enabled: "仅在 VS Code 启动或重新加载时运行一次；不会检查账户，也不会读取对话内容。",
      disabled: "不会自动打开会话；仍可从命令面板手动恢复。"
    };
  }
  if (lang === "zh-hant") {
    return {
      title: "自動恢復 Codex 工作階段",
      sub: "重新開啟此工作區上次仍在使用的官方 Codex 工作階段分頁。",
      enabled: "僅在 VS Code 啟動或重新載入時執行一次；不會檢查帳戶，也不會讀取對話內容。",
      disabled: "不會自動開啟工作階段；仍可從命令選擇區手動恢復。"
    };
  }
  return {
    title: "Resume Codex sessions",
    sub: "Reopen the official Codex conversation tabs that were active in this workspace.",
    enabled: "Runs once when VS Code starts or reloads. No account checks or conversation-content access.",
    disabled: "Sessions will not open automatically; manual resume remains available from the Command Palette."
  };
}
