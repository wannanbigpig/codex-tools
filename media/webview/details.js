(function () {
  const lang = document.documentElement.lang;
  const privacyButton = document.querySelector("[data-role='privacy-toggle']");

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
      return lang === "zh" ? "重置时间未知" : "reset unknown";
    }

    const deltaMs = epochSeconds * 1000 - Date.now();
    const abs = Math.abs(deltaMs);
    const minutes = Math.round(abs / 60000);
    const future = deltaMs >= 0;

    if (minutes < 60) {
      return lang === "zh"
        ? future ? "剩余" + minutes + "分钟" : minutes + "分钟前"
        : future ? minutes + "m left" : minutes + "m ago";
    }

    const hours = Math.round(minutes / 60);
    if (hours < 48) {
      return lang === "zh"
        ? future ? "剩余" + hours + "小时" : hours + "小时前"
        : future ? hours + "h left" : hours + "h ago";
    }

    const days = Math.round(hours / 24);
    return lang === "zh"
      ? future ? "剩余" + days + "天" : days + "天前"
      : future ? days + "d left" : days + "d ago";
  }

  function updateLiveTimes() {
    document.querySelectorAll(".live-reset").forEach((node) => {
      const value = Number(node.dataset.resetAt);
      const fallback = node.dataset.resetUnknown || (lang === "zh" ? "重置时间未知" : "reset unknown");
      node.textContent = value ? formatRelativeTime(value) : fallback;
    });
    document.querySelectorAll(".live-timestamp").forEach((node) => {
      const value = Number(node.dataset.epochMs);
      const fallback = node.dataset.never || (lang === "zh" ? "从未" : "never");
      node.textContent = value ? new Date(value).toLocaleString() : fallback;
    });
  }

  updateLiveTimes();
  applyPrivacyMode(false);

  if (privacyButton) {
    privacyButton.addEventListener("click", () => {
      const hidden = !document.body.classList.contains("privacy-hidden");
      applyPrivacyMode(hidden);
    });
  }

  setInterval(updateLiveTimes, 60000);
})();
