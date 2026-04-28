(function () {
  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
  const lang = document.documentElement.lang;
  const html = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const privacyButton = document.querySelector("[data-role='privacy-toggle']");
  const editTagsButton = document.querySelector("[data-role='details-edit-tags']");
  const toggleAutoSwitchLockButton = document.querySelector("[data-role='details-toggle-auto-switch-lock']");

  function resolveDashboardTheme() {
    const themePreference = html.dataset.themePreference || "auto";
    if (themePreference === "dark" || themePreference === "light") {
      return themePreference;
    }
    if (
      document.body.classList.contains("vscode-light") ||
      html.classList.contains("vscode-light")
    ) {
      return "light";
    }
    if (
      document.body.classList.contains("vscode-dark") ||
      document.body.classList.contains("vscode-high-contrast") ||
      html.classList.contains("vscode-dark") ||
      html.classList.contains("vscode-high-contrast")
    ) {
      return "dark";
    }
    return media.matches ? "light" : "dark";
  }

  function applyResolvedTheme() {
    html.dataset.theme = resolveDashboardTheme();
  }

  applyResolvedTheme();
  media.addEventListener("change", applyResolvedTheme);
  const themeObserver = new MutationObserver(applyResolvedTheme);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  themeObserver.observe(html, { attributes: true, attributeFilter: ["class"] });

  function applyPrivacyMode(hidden) {
    document.body.classList.toggle("privacy-hidden", hidden);

    if (!privacyButton) {
      return;
    }

    const nextLabel = hidden ? privacyButton.dataset.showLabel : privacyButton.dataset.hideLabel;
    if (!nextLabel) {
      return;
    }

    privacyButton.setAttribute("aria-pressed", String(hidden));
    privacyButton.setAttribute("aria-label", nextLabel);
    privacyButton.setAttribute("title", nextLabel);
  }

  function formatRelativeTime(epochSeconds) {
    if (!epochSeconds) {
      return isChinese() ? "重置时间未知" : "reset unknown";
    }

    const diffSeconds = epochSeconds - Math.floor(Date.now() / 1000);
    if (diffSeconds <= 0) {
      return isChinese() ? "已重置" : "reset";
    }

    const totalMinutes = Math.floor(diffSeconds / 60);
    if (totalMinutes <= 0) {
      return isChinese() ? "不到1分钟" : "<1m left";
    }

    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];

    if (days > 0) {
      parts.push(formatDurationPart(days, "d"));
    }
    if (hours > 0) {
      parts.push(formatDurationPart(hours, "h"));
    }
    if (minutes > 0) {
      parts.push(formatDurationPart(minutes, "m"));
    }

    return isChinese() ? parts.join(" ") : parts.join(" ") + " left";
  }

  function formatDurationPart(value, unit) {
    if (lang === "zh-hant") {
      return value + ({ d: "天", h: "小時", m: "分鐘" }[unit] || "");
    }
    if (lang === "zh") {
      return value + ({ d: "天", h: "小时", m: "分钟" }[unit] || "");
    }
    return value + unit;
  }

  function isChinese() {
    return lang === "zh" || lang === "zh-hant";
  }

  function updateLiveTimes() {
    document.querySelectorAll(".live-reset").forEach((node) => {
      const value = Number(node.dataset.resetAt);
      const fallback = node.dataset.resetUnknown || (isChinese() ? "重置时间未知" : "reset unknown");
      node.textContent = value ? formatRelativeTime(value) : fallback;
    });
    document.querySelectorAll(".live-timestamp").forEach((node) => {
      const value = Number(node.dataset.epochMs);
      const fallback = node.dataset.never || (isChinese() ? "从未" : "never");
      node.textContent = value ? new Date(value).toLocaleString() : fallback;
    });
  }

  updateLiveTimes();
  applyPrivacyMode(document.body.dataset.privacyHidden === "true");

  if (privacyButton) {
    privacyButton.addEventListener("click", () => {
      const hidden = !document.body.classList.contains("privacy-hidden");
      applyPrivacyMode(hidden);
    });
  }

  if (editTagsButton && vscode) {
    editTagsButton.addEventListener("click", () => {
      vscode.postMessage({ type: "details:edit-tags" });
    });
  }

  if (toggleAutoSwitchLockButton && vscode) {
    toggleAutoSwitchLockButton.addEventListener("click", () => {
      vscode.postMessage({ type: "details:toggle-auto-switch-lock" });
    });
  }

  setInterval(updateLiveTimes, 60000);
})();
