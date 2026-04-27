import { useEffect, useMemo, useState } from "preact/hooks";
import type { CodexAnnouncement, CodexAnnouncementAction, CodexAnnouncementState } from "../../src/core/types";
import type { DashboardCopy } from "../../src/domain/dashboard/types";
import { formatTemplate } from "./helpers";
import type { SendAction } from "./hookTypes";

function parseTime(value: string | null | undefined): number {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatTimeAgo(value: string | null | undefined, copy: DashboardCopy): string {
  const time = parseTime(value);
  if (!time) {
    return "";
  }
  const diff = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return copy.announcementsJustNow;
  }
  if (minutes < 60) {
    return formatTemplate(copy.announcementsMinutesAgo, minutes);
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return formatTemplate(copy.announcementsHoursAgo, hours);
  }
  return formatTemplate(copy.announcementsDaysAgo, Math.floor(hours / 24));
}

function typeLabel(type: string, copy: DashboardCopy): string {
  switch (type.toLowerCase()) {
    case "feature":
      return copy.announcementsTypeFeature;
    case "warning":
      return copy.announcementsTypeWarning;
    case "urgent":
      return copy.announcementsTypeUrgent;
    default:
      return copy.announcementsTypeInfo;
  }
}

function typeClass(type: string): string {
  const value = type.toLowerCase();
  return ["feature", "warning", "urgent", "info"].includes(value) ? value : "info";
}

export function AnnouncementCenter(props: {
  open: boolean;
  copy: DashboardCopy;
  state: CodexAnnouncementState;
  refreshPending: boolean;
  markAllPending: boolean;
  onClose: () => void;
  onAction: SendAction;
}) {
  const unreadIds = Array.isArray(props.state.unreadIds) ? props.state.unreadIds : [];
  const [detail, setDetail] = useState<CodexAnnouncement | null>(null);
  const [handledPopupId, setHandledPopupId] = useState("");

  const sortedAnnouncements = useMemo(() => {
    const items = Array.isArray(props.state.announcements) ? props.state.announcements : [];
    return [...items].sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return parseTime(b.createdAt) - parseTime(a.createdAt);
    });
  }, [props.state.announcements]);

  useEffect(() => {
    const popup = props.state.popupAnnouncement;
    if (!popup || handledPopupId === popup.id) {
      return;
    }
    setHandledPopupId(popup.id);
    setDetail(popup);
  }, [handledPopupId, props.state.popupAnnouncement]);

  const closeDetail = (reopenList = false): void => {
    const current = detail;
    setDetail(null);
    if (current && unreadIds.includes(current.id)) {
      props.onAction("markAnnouncementRead", undefined, { announcementId: current.id });
    }
    if (!reopenList && !props.open) {
      props.onClose();
    }
  };

  const runAction = (action: CodexAnnouncementAction | undefined): void => {
    if (!action) {
      return;
    }
    if (action.type === "url") {
      props.onAction("openExternalUrl", undefined, { url: action.target });
      closeDetail(false);
      return;
    }
    if (action.type === "command" && action.target === "announcement.forceRefresh") {
      props.onAction("refreshAnnouncements");
    }
  };

  return (
    <>
      <div class={`overlay announcement-overlay ${props.open ? "open" : ""}`} onClick={props.onClose}>
        <div class="settings-modal dashboard-modal announcement-list-modal" onClick={(event) => event.stopPropagation()}>
          <div class="settings-modal-head">
            <div class="settings-modal-title">{props.copy.announcementsTitle}</div>
            <button class="settings-close" type="button" aria-label={props.copy.closeModal} onClick={props.onClose}>
              ×
            </button>
          </div>
          <div class="settings-modal-body dashboard-modal-body announcement-list-body">
            <div class="announcement-toolbar">
              <button
                class="announcement-toolbar-btn"
                type="button"
                disabled={unreadIds.length === 0 || props.markAllPending}
                onClick={() => props.onAction("markAllAnnouncementsRead")}
              >
                {props.copy.announcementsMarkAllRead}
              </button>
              <button
                class="announcement-toolbar-btn"
                type="button"
                disabled={props.refreshPending}
                onClick={() => props.onAction("refreshAnnouncements")}
              >
                {props.refreshPending ? props.copy.announcementsRefreshing : props.copy.announcementsRefresh}
              </button>
            </div>

            {sortedAnnouncements.length === 0 ? <div class="announcement-empty">{props.copy.announcementsEmpty}</div> : null}

            {sortedAnnouncements.map((item) => {
              const unread = unreadIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  class={`announcement-list-item ${unread ? "is-unread" : ""}`}
                  type="button"
                  onClick={() => {
                    setDetail(item);
                  }}
                >
                  <div class="announcement-list-item-top">
                    <div class="announcement-title-meta">
                      {item.pinned ? <span class="announcement-pinned-chip">{props.copy.announcementsPinned}</span> : null}
                      <span class={`announcement-type-chip ${typeClass(item.type)}`}>{typeLabel(item.type, props.copy)}</span>
                      {item.releaseVersion ? <span class="announcement-version-chip">v{item.releaseVersion}</span> : null}
                      <strong class="announcement-item-title">{item.title}</strong>
                      {unread ? <span class="announcement-unread-dot" aria-hidden="true"></span> : null}
                    </div>
                    <span class="announcement-time">{formatTimeAgo(item.createdAt, props.copy)}</span>
                  </div>
                  <p class="announcement-summary">{item.summary}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {detail ? (
        <div class="overlay announcement-overlay open" onClick={() => closeDetail(false)}>
          <div class="settings-modal dashboard-modal announcement-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div class="settings-modal-head announcement-detail-head">
              <div class="announcement-detail-head-left">
                <div class="announcement-detail-title-group">
                  <div class="announcement-detail-meta">
                    {detail.pinned ? <span class="announcement-pinned-chip">{props.copy.announcementsPinned}</span> : null}
                    <span class={`announcement-type-chip ${typeClass(detail.type)}`}>{typeLabel(detail.type, props.copy)}</span>
                    {detail.releaseVersion ? <span class="announcement-version-chip">v{detail.releaseVersion}</span> : null}
                    <span class="announcement-time">{formatTimeAgo(detail.createdAt, props.copy)}</span>
                  </div>
                  <div class="announcement-detail-title">{detail.title}</div>
                </div>
              </div>
              <button class="settings-close" type="button" aria-label={props.copy.closeModal} onClick={() => closeDetail(false)}>
                ×
              </button>
            </div>
            <div class="settings-modal-body dashboard-modal-body announcement-detail-body">
              <div class="announcement-detail-content">
                {String(detail.content || "")
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
              </div>
              {detail.restartRequired && detail.restartHint ? (
                <div class="announcement-restart-hint">
                  <strong>v{detail.currentVersion ?? ""} → v{detail.releaseVersion ?? ""}</strong>
                  <span>{detail.restartHint}</span>
                </div>
              ) : null}
              {detail.images.length > 0 ? (
                <div class="announcement-images-grid">
                  {detail.images.map((image) => (
                    <div key={image.url} class="announcement-image-card">
                      <img src={image.url} alt={image.alt ?? image.label ?? ""} class="announcement-image" />
                      {image.label ? <span>{image.label}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div class="announcement-detail-footer">
              {detail.action ? (
                <button class="modal-primary-btn" type="button" onClick={() => runAction(detail.action)}>
                  {detail.action.label}
                </button>
              ) : (
                <button class="modal-primary-btn" type="button" onClick={() => closeDetail(false)}>
                  {props.copy.announcementsGotIt}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
