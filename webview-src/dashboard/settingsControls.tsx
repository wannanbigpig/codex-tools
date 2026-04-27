import type { ComponentChildren } from "preact";
import type { DashboardCopy, DashboardSettings } from "../../src/domain/dashboard/types";
import {
  DASHBOARD_LANGUAGE_OPTIONS,
  DASHBOARD_LANGUAGE_OPTION_LABELS,
  type DashboardLanguage,
  isDashboardLanguageOption
} from "../../src/localization/languages";
import {
  formatTemplate,
  pickSparseScaleValues,
  resolveDiscreteIndex,
  resolveDiscretePercent,
  resolveNearestDiscreteValue
} from "./helpers";

export function SettingsLanguageBlock(props: {
  copy: DashboardCopy;
  settings: DashboardSettings;
  onChange: (value: DashboardSettings["displayLanguage"]) => void;
}) {
  return (
    <div class="settings-block">
      <div class="settings-block-head">
        <div class="settings-block-title">{props.copy.languageTitle}</div>
        <div class="settings-block-sub">{props.copy.languageSub}</div>
      </div>
      <select
        class="settings-select"
        value={props.settings.displayLanguage}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          if (isDashboardLanguageOption(nextValue)) {
            props.onChange(nextValue);
          }
        }}
      >
        {DASHBOARD_LANGUAGE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option === "auto" ? props.copy.languageAuto : DASHBOARD_LANGUAGE_OPTION_LABELS[option]}
          </option>
        ))}
      </select>
      <div class="settings-note">{props.copy.languageNote}</div>
    </div>
  );
}

export function SettingsThemeBlock(props: {
  lang: DashboardLanguage;
  settings: DashboardSettings;
  onChange: (value: DashboardSettings["dashboardTheme"]) => void;
}) {
  const zh = props.lang === "zh" || props.lang === "zh-hant";
  const copy = zh
    ? {
        title: "主题",
        dark: "深色",
        light: "浅色",
        auto: "跟随 VS Code"
      }
    : {
        title: "Theme",
        dark: "Dark",
        light: "Light",
        auto: "Follow VS Code"
      };
  const options: Array<{ value: DashboardSettings["dashboardTheme"]; label: string }> = [
    { value: "dark", label: copy.dark },
    { value: "light", label: copy.light },
    { value: "auto", label: copy.auto }
  ];

  return (
    <div class="settings-block settings-theme-block">
      <div class="settings-theme-row">
        <div class="settings-block-title">{copy.title}</div>
        <div class="settings-theme-options">
          {options.map((option) => (
            <button
              key={option.value}
              class={`settings-theme-option ${props.settings.dashboardTheme === option.value ? "active" : ""}`}
              type="button"
              onClick={() => props.onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SettingsSegmentBlock(props: {
  title: string;
  sub: string;
  note?: string;
  options: Array<{
    key: string;
    title: string;
    description: string;
    active: boolean;
    onClick: () => void;
  }>;
  children?: ComponentChildren;
}) {
  return (
    <div class="settings-block">
      <div class="settings-block-head">
        <div class="settings-block-title">{props.title}</div>
        <div class="settings-block-sub">{props.sub}</div>
      </div>
      <div class="settings-segment">
        {props.options.map((option) => (
          <button key={option.key} class={`segment-btn ${option.active ? "active" : ""}`} type="button" onClick={option.onClick}>
            <span class="segment-title">{option.title}</span>
            <span class="segment-copy">{option.description}</span>
          </button>
        ))}
      </div>
      {props.children}
      {props.note ? <div class="settings-note">{props.note}</div> : null}
    </div>
  );
}

export function SettingsToggleBlock(props: {
  title: string;
  sub: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children?: ComponentChildren;
}) {
  return (
    <div class="settings-block">
      <div class="settings-toggle-head">
        <div class="settings-block-head">
          <div class="settings-block-title">{props.title}</div>
          <div class="settings-block-sub">{props.sub}</div>
        </div>
        <button class={`settings-inline-toggle ${props.enabled ? "active" : ""}`} type="button" aria-pressed={props.enabled} onClick={() => props.onToggle(!props.enabled)}>
          <span class="settings-inline-toggle-track">
            <span class="settings-inline-toggle-thumb"></span>
          </span>
        </button>
      </div>
      {props.children}
    </div>
  );
}

export function SettingsPreferenceRow(props: {
  title: string;
  sub: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div class="settings-preference-row">
      <div class="settings-block-head">
        <div class="settings-block-title">{props.title}</div>
        <div class="settings-block-sub">{props.sub}</div>
      </div>
      <button class={`settings-inline-toggle ${props.enabled ? "active" : ""}`} type="button" aria-pressed={props.enabled} onClick={() => props.onToggle(!props.enabled)}>
        <span class="settings-inline-toggle-track">
          <span class="settings-inline-toggle-thumb"></span>
        </span>
      </button>
    </div>
  );
}

export function SettingsPathBlock(props: {
  copy: DashboardCopy;
  pathValue: string;
  hasCustomPath: boolean;
  compact?: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  const content = (
    <>
      <div class="settings-block-head">
        <div class="settings-block-title">{props.copy.appPathTitle}</div>
        <div class="settings-block-sub">{props.copy.appPathSub}</div>
      </div>
      <div class="settings-note settings-path-note">{props.pathValue || props.copy.appPathEmpty}</div>
      <div class="saved-actions settings-inline-actions">
        <button type="button" onClick={props.onPick}>
          {props.copy.pickPath}
        </button>
        <button type="button" disabled={!props.hasCustomPath} onClick={props.onClear}>
          {props.copy.clearPath}
        </button>
      </div>
    </>
  );

  if (props.compact) {
    return <div class="settings-stack settings-path-inline">{content}</div>;
  }

  return <div class="settings-block">{content}</div>;
}

export function SettingsThresholdBlock(props: {
  copy: DashboardCopy;
  settings: DashboardSettings;
  onPreview: (key: "yellow" | "green", value: number) => void;
  onCommit: (key: "yellow" | "green", value: number) => void;
}) {
  const yellow = props.settings.quotaYellowThreshold;
  const green = props.settings.quotaGreenThreshold;
  const fillRedStyle = { width: `${yellow}%` } as Record<string, string>;
  const fillYellowStyle = { left: `${yellow}%`, width: `${Math.max(0, green - yellow)}%` } as Record<string, string>;
  const fillGreenStyle = { left: `${green}%`, width: `${Math.max(0, 100 - green)}%` } as Record<string, string>;

  return (
    <div class="settings-block">
      <div class="settings-block-head">
        <div class="settings-block-title">{props.copy.colorThresholdTitle}</div>
        <div class="settings-block-sub">{props.copy.colorThresholdSub}</div>
      </div>
      <div class="settings-note">{formatTemplate(props.copy.colorThresholdRedNoteTemplate, yellow)}</div>
      <div class="threshold-dual">
        <div class="threshold-dual-head">
          <div class="threshold-marker threshold-marker-yellow">
            <span class="threshold-marker-label">{props.copy.colorThresholdYellowTitle}</span>
            <span class="threshold-slider-value">{yellow}%</span>
          </div>
          <div class="threshold-marker threshold-marker-green">
            <span class="threshold-marker-label">{props.copy.colorThresholdGreenTitle}</span>
            <span class="threshold-slider-value">{green}%</span>
          </div>
        </div>
        <div class="threshold-dual-copy">
          <div class="threshold-slider-copy">{formatTemplate(props.copy.colorThresholdYellowDescTemplate, yellow)}</div>
          <div class="threshold-slider-copy">{formatTemplate(props.copy.colorThresholdGreenDescTemplate, green)}</div>
        </div>
        <div class="threshold-range-stack">
          <div class="threshold-range-rail"></div>
          <div class="threshold-range-fill threshold-range-fill-red" style={fillRedStyle}></div>
          <div class="threshold-range-fill threshold-range-fill-yellow" style={fillYellowStyle}></div>
          <div class="threshold-range-fill threshold-range-fill-green" style={fillGreenStyle}></div>
          <input class="threshold-range threshold-range-yellow" type="range" min="0" max="100" step="1" value={yellow} onInput={(event) => props.onPreview("yellow", Number(event.currentTarget.value))} onChange={(event) => props.onCommit("yellow", Number(event.currentTarget.value))} />
          <input class="threshold-range threshold-range-green" type="range" min="0" max="100" step="1" value={green} onInput={(event) => props.onPreview("green", Number(event.currentTarget.value))} onChange={(event) => props.onCommit("green", Number(event.currentTarget.value))} />
        </div>
        <div class="threshold-slider-scale">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}

export function SettingsDiscreteSlider(props: {
  value: number;
  values: number[];
  accent: "violet" | "amber" | "sky";
  valueLabel: (value: number) => string;
  description: (value: number) => string;
  sparseScale?: boolean;
  scaleValues?: number[];
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const currentIndex = resolveDiscreteIndex(props.values, props.value);
  const currentValue = props.values[currentIndex] ?? props.values[0] ?? 0;
  const progress = resolveDiscretePercent(props.values, currentValue);
  const minValue = props.values[0] ?? 0;
  const maxValue = props.values[props.values.length - 1] ?? minValue;
  const fillStyle = { width: `${progress}%` } as Record<string, string>;
  const thumbStyle = { left: `${progress}%` } as Record<string, string>;

  return (
    <div class={`step-slider step-slider-${props.accent}`}>
      <div class="step-slider-head">
        <div class="step-slider-copy">{props.description(currentValue)}</div>
        <div class="step-slider-value">{props.valueLabel(currentValue)}</div>
      </div>
      <div class="step-slider-stack">
        <div class="step-slider-rail"></div>
        <div class="step-slider-fill" style={fillStyle}></div>
        <div class="step-slider-thumb" style={thumbStyle}></div>
        <input
          class={`step-slider-range step-slider-range-${props.accent}`}
          type="range"
          min={String(minValue)}
          max={String(maxValue)}
          step="1"
          value={currentValue}
          onInput={(event) => {
            const nextRawValue = Number(event.currentTarget.value);
            props.onPreview(resolveNearestDiscreteValue(props.values, nextRawValue));
          }}
          onChange={(event) => {
            const nextRawValue = Number(event.currentTarget.value);
            props.onCommit(resolveNearestDiscreteValue(props.values, nextRawValue));
          }}
        />
      </div>
      <div class="step-slider-scale">
        {(props.scaleValues ?? (props.sparseScale ? pickSparseScaleValues(props.values) : props.values)).map((value, index, scaleValues) => {
          const markerPercent = resolveDiscretePercent(props.values, value);
          const labelStyle = { left: `${markerPercent}%` } as Record<string, string>;

          return (
            <span
              key={value}
              class={`step-slider-scale-label ${index === 0 ? "is-start" : index === scaleValues.length - 1 ? "is-end" : ""}`}
              style={labelStyle}
            >
              {props.valueLabel(value)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
