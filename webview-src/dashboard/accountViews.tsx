import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type { DashboardCopy, DashboardState } from "../../src/domain/dashboard/types";
import { formatTemplate } from "./helpers";
import { DropdownChevronIcon } from "./icons";
import { ActionButton } from "./primitives";

export * from "./overviewSection";

export function RecoveryPanel(props: {
  copy: DashboardCopy;
  health: DashboardState["indexHealth"];
  restoreBackupPending: boolean;
  restoreAuthPending: boolean;
  restoreJsonPending: boolean;
  onRestoreBackup: () => void;
  onRestoreAuth: () => void;
  onImportJson: () => void;
}) {
  const description =
    props.health.status === "restored_from_backup" ? props.copy.recoveryRestored : props.copy.recoveryCorrupted;

  return (
    <div class={`recovery-banner ${props.health.status === "corrupted_unrecoverable" ? "is-danger" : ""}`}>
      <div class="recovery-banner-body">
        <div class="recovery-banner-title">{props.copy.recoveryTitle}</div>
        <div class="recovery-banner-desc">{description}</div>
        <div class="recovery-banner-meta">
          <span>
            {props.copy.recoveryBackups}: {props.health.availableBackups}
          </span>
          {props.health.lastErrorMessage ? (
            <span>
              {props.copy.recoveryLastError}: {props.health.lastErrorMessage}
            </span>
          ) : null}
        </div>
      </div>
      <div class="recovery-banner-actions">
        <ActionButton
          class="toolbar-btn"
          pending={props.restoreBackupPending}
          onClick={props.onRestoreBackup}
          disabled={props.restoreAuthPending || props.restoreJsonPending}
        >
          {props.copy.recoveryRestoreBackupBtn}
        </ActionButton>
        <ActionButton
          class="toolbar-btn"
          pending={props.restoreAuthPending}
          onClick={props.onRestoreAuth}
          disabled={props.restoreBackupPending || props.restoreJsonPending}
        >
          {props.copy.recoveryRestoreAuthBtn}
        </ActionButton>
        <ActionButton
          class="toolbar-btn"
          pending={props.restoreJsonPending}
          onClick={props.onImportJson}
          disabled={props.restoreBackupPending || props.restoreAuthPending}
        >
          {props.copy.recoveryImportJsonBtn}
        </ActionButton>
      </div>
    </div>
  );
}

export function BatchSelectionBar(props: {
  copy: DashboardCopy;
  selectedCount: number;
  tagsPending: boolean;
  refreshPending: boolean;
  resyncPending: boolean;
  removePending: boolean;
  sharePending: boolean;
  onRefresh: () => void;
  onResync: () => void;
  onRemove: () => void;
  onShare: () => void;
  onAddTags: () => void;
  onRemoveTags: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, right: 0 });
  const anyPending =
    props.tagsPending || props.refreshPending || props.resyncPending || props.removePending || props.sharePending;

  useEffect(() => {
    if (!open) return;
    const updatePosition = (): void => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopoverPosition({ top: rect.bottom + 5, right: Math.max(8, window.innerWidth - rect.right) });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const run = (action: () => void): void => {
    setOpen(false);
    action();
  };

  return (
    <div class="batch-bar">
      <div class="batch-bar-count">{formatTemplate(props.copy.batchSelectedCount, { count: props.selectedCount })}</div>
      <div class="batch-menu" ref={rootRef}>
        <button
          class={`batch-menu-trigger ${open ? "active" : ""}`}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {anyPending ? <span class="button-spinner" aria-hidden="true"></span> : null}
          <span>{props.copy.batchActionsTitle}</span>
          <DropdownChevronIcon open={open} />
        </button>
        {open
          ? createPortal(
              <div
                ref={popoverRef}
                class="batch-menu-popover"
                role="menu"
                style={{ top: `${popoverPosition.top}px`, right: `${popoverPosition.right}px` }}
              >
                <button type="button" role="menuitem" disabled={props.tagsPending} onClick={() => run(props.onAddTags)}>
                  {props.copy.addTagsBtn}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={props.tagsPending}
                  onClick={() => run(props.onRemoveTags)}
                >
                  {props.copy.removeTagsBtn}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={props.refreshPending}
                  onClick={() => run(props.onRefresh)}
                >
                  {props.copy.batchRefreshBtn}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={props.resyncPending}
                  onClick={() => run(props.onResync)}
                >
                  {props.copy.batchResyncBtn}
                </button>
                <button type="button" role="menuitem" disabled={props.sharePending} onClick={() => run(props.onShare)}>
                  {props.copy.batchExportBtn}
                </button>
                <button
                  class="danger"
                  type="button"
                  role="menuitem"
                  disabled={props.removePending}
                  onClick={() => run(props.onRemove)}
                >
                  {props.copy.batchRemoveBtn}
                </button>
              </div>,
              document.body
            )
          : null}
      </div>
    </div>
  );
}

export * from "./savedAccountCard";
