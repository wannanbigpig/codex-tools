import type { ComponentChildren } from "preact";

export function ActionButton(props: {
  class?: string;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon?: ComponentChildren;
  iconOnly?: boolean;
  label?: string;
  "aria-haspopup"?: "dialog" | "menu";
  "aria-expanded"?: boolean;
  children?: ComponentChildren;
}) {
  const className = [props.class, "action-btn", props.pending ? "is-pending" : "", props.iconOnly ? "icon-only" : ""]
    .filter(Boolean)
    .join(" ");
  const accessibleLabel =
    props.label ??
    (typeof props.children === "string"
      ? props.children
      : typeof props.children === "number"
        ? String(props.children)
        : undefined);

  return (
    <button
      class={className}
      type="button"
      disabled={props.disabled}
      aria-busy={props.pending}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      aria-haspopup={props["aria-haspopup"]}
      aria-expanded={props["aria-expanded"]}
      onClick={props.onClick}
    >
      <span class="button-face">
        {props.pending ? <span class="button-spinner" aria-hidden="true"></span> : null}
        {!props.pending && props.icon ? <span class="button-icon">{props.icon}</span> : null}
        {!props.iconOnly ? <span class="button-label">{props.children}</span> : null}
      </span>
    </button>
  );
}

export function ModalShell(props: {
  open: boolean;
  title: string;
  closeLabel: string;
  className?: string;
  closeOnBackdrop?: boolean;
  onClose: () => void;
  children: ComponentChildren;
}) {
  return (
    <div
      class={`overlay ${props.open ? "open" : ""}`}
      onClick={props.closeOnBackdrop === false ? undefined : props.onClose}
    >
      <div
        class={`settings-modal dashboard-modal ${props.className ?? ""}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="settings-modal-head">
          <div class="settings-modal-title">{props.title}</div>
          <button class="settings-close" type="button" aria-label={props.closeLabel} onClick={props.onClose}>
            ×
          </button>
        </div>
        <div class="settings-modal-body dashboard-modal-body">{props.children}</div>
      </div>
    </div>
  );
}
