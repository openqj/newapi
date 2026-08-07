import { createPortal } from "react-dom";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import "./Drawer.css";

export type DrawerProps = {
  ariaLabel: string;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  header?: ReactNode;
  headerActions?: ReactNode;
  children?: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  closeLabel?: string;
  portal?: boolean;
};

export function Drawer({
  ariaLabel,
  onClose,
  title,
  description,
  header,
  headerActions,
  children,
  className = "",
  headerClassName = "",
  contentClassName = "",
  closeLabel = "关闭",
  portal = false,
}: DrawerProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const hasDefaultTitle = header == null && title != null;

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const dialog = (
    <div
      className="ui-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className={`ui-drawer ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={hasDefaultTitle ? titleId : undefined}
      >
        <header className={`ui-drawer-header ${headerClassName}`.trim()}>
          <div className="ui-drawer-header-content">
            {header ?? (
              <>
                {title != null && <h2 id={titleId}>{title}</h2>}
                {description != null && <p>{description}</p>}
              </>
            )}
          </div>
          <div className="ui-drawer-header-actions">
            {headerActions}
            <IconButton
              ref={closeButton}
              label={closeLabel}
              onClick={onClose}
              icon={<X size={17} aria-hidden="true" />}
            />
          </div>
        </header>
        {children != null && <div className={`ui-drawer-content ${contentClassName}`.trim()}>{children}</div>}
      </aside>
    </div>
  );

  return portal ? createPortal(dialog, document.body) : dialog;
}
