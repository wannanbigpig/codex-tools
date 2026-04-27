import type { DashboardCopy, DashboardSettingKey, DashboardSettings, DashboardState } from "../../src/domain/dashboard/types";
import {
  SettingsDiscreteSlider,
  SettingsLanguageBlock,
  SettingsPathBlock,
  SettingsPreferenceRow,
  SettingsSegmentBlock,
  SettingsThemeBlock,
  SettingsThresholdBlock,
  SettingsToggleBlock
} from "./components";
import { formatTemplate, formatTimestamp } from "./helpers";

const AUTO_REFRESH_VALUES = [5, 10, 15, 30, 60];
const AUTO_SWITCH_VALUES = Array.from({ length: 20 }, (_, index) => index + 1);
const AUTO_SWITCH_LOCK_VALUES = [0, 5, 10, 15, 30, 60, 120];
const WARNING_VALUES = Array.from({ length: 18 }, (_, index) => 5 + index * 5);
const WARNING_SCALE_VALUES = [5, 20, 35, 50, 65, 80, 90];

export function SettingsOverlay(props: {
  open: boolean;
  copy: DashboardCopy;
  lang: DashboardState["lang"];
  settings: DashboardSettings;
  tokenAutomation: DashboardState["tokenAutomation"];
  onClose: () => void;
  onPatchSettings: (patch: Partial<DashboardSettings>) => void;
  onSendSetting: (key: DashboardSettingKey, value: string | number | boolean) => void;
  onAutoRefreshToggle: (enabled: boolean) => void;
  onAutoRefreshValue: (minutes: number) => void;
  onThresholdPreview: (key: "yellow" | "green", value: number) => void;
  onThresholdCommit: (key: "yellow" | "green", value: number) => void;
  onPickCodexAppPath: () => void;
  onClearCodexAppPath: () => void;
}) {
  const patchAndSend = (key: DashboardSettingKey, value: string | number | boolean) => {
    props.onPatchSettings({ [key]: value } as Partial<DashboardSettings>);
    props.onSendSetting(key, value);
  };

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
          <SettingsToggleBlock
            title={props.copy.codexAppRestartTitle}
            sub={props.copy.codexAppRestartSub}
            enabled={props.settings.codexAppRestartEnabled}
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
                valueLabel={(value) => formatTemplate(props.copy.autoRefreshValueTemplate, value)}
                description={(value) => formatTemplate(props.copy.autoRefreshValueDescTemplate, value)}
                onPreview={(value) => props.onPatchSettings({ autoRefreshMinutes: value })}
                onCommit={props.onAutoRefreshValue}
              />
            </div>
          </SettingsToggleBlock>
          <SettingsToggleBlock
            title={props.copy.autoSwitchTitle}
            sub={props.copy.autoSwitchSub}
            enabled={props.settings.autoSwitchEnabled}
            onToggle={(enabled) => patchAndSend("autoSwitchEnabled", enabled)}
          >
            <div class={`settings-stack ${props.settings.autoSwitchEnabled ? "" : "is-hidden"}`}>
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
              <div class="settings-toggle-list">
                <SettingsPreferenceRow
                  title={props.copy.autoSwitchPreferSameEmailTitle}
                  sub={props.copy.autoSwitchPreferSameEmailSub}
                  enabled={props.settings.autoSwitchPreferSameEmail}
                  onToggle={(enabled) => patchAndSend("autoSwitchPreferSameEmail", enabled)}
                />
                <SettingsPreferenceRow
                  title={props.copy.autoSwitchPreferSameTagTitle}
                  sub={props.copy.autoSwitchPreferSameTagSub}
                  enabled={props.settings.autoSwitchPreferSameTag}
                  onToggle={(enabled) => patchAndSend("autoSwitchPreferSameTag", enabled)}
                />
              </div>
              <div class="settings-block-head">
                <div class="settings-block-title">{props.copy.autoSwitchLockMinutesTitle}</div>
                <div class="settings-block-sub">{props.copy.autoSwitchLockMinutesSub}</div>
              </div>
              <SettingsDiscreteSlider
                value={props.settings.autoSwitchLockMinutes}
                values={AUTO_SWITCH_LOCK_VALUES}
                accent="violet"
                valueLabel={(value) =>
                  value === 0 ? props.copy.autoSwitchLockOff : formatTemplate(props.copy.autoSwitchLockValueTemplate, value)
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
            sub={props.copy.warningSub}
            enabled={props.settings.quotaWarningEnabled}
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
          <SettingsSegmentBlock
            title={props.copy.debugTitle}
            sub={props.copy.debugSub}
            note={props.copy.debugNote}
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
          />
        </div>
      </div>
    </div>
  );
}
