import { createPortal } from "react-dom";
import { useEffect, useId, useRef, type FormEventHandler, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import "./Dialog.css";

export type DialogProps = {
  title: ReactNode;
  description?: ReactNode;
  ariaLabel: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  hideHeader?: boolean;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  noValidate?: boolean;
  asForm?: boolean;
  portal?: boolean;
};

export function Dialog({
  title,
  description,
  ariaLabel,
  onClose,
  children,
  footer,
  headerActions,
  className = "",
  headerClassName = "",
  contentClassName = "",
  footerClassName = "",
  hideHeader = false,
  onSubmit,
  noValidate,
  asForm = false,
  portal = false,
}: DialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const surfaceClassName = `modal ${asForm ? "form-dialog" : ""} ui-dialog ${className}`.trim();
  const surfaceContent = (
    <>
      {!hideHeader && (
        <DialogHeader
          title={title}
          description={description}
          titleId={titleId}
          headerActions={headerActions}
          closeButton={closeButton}
          onClose={onClose}
          className={headerClassName}
        />
      )}
      {children != null && <div className={`form-dialog-content ${contentClassName}`.trim()}>{children}</div>}
      {footer && <div className={`form-dialog-footer ${footerClassName}`.trim()}>{footer}</div>}
    </>
  );
  const labelledBy = hideHeader ? undefined : titleId;
  const surface = asForm || onSubmit ? (
    <form
      className={surfaceClassName}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      noValidate={noValidate}
      onSubmit={onSubmit}
    >
      {surfaceContent}
    </form>
  ) : (
    <section
      className={surfaceClassName}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
    >
      {surfaceContent}
    </section>
  );

  const dialog = (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {surface}
    </div>
  );

  return portal ? createPortal(dialog, document.body) : dialog;
}

function DialogHeader({ title, description, titleId, headerActions, closeButton, onClose, className }: {
  title: ReactNode;
  description?: ReactNode;
  titleId: string;
  headerActions?: ReactNode;
  closeButton: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  className: string;
}) {
  return (
    <header className={`form-dialog-header ${className}`.trim()}>
      <div>
        <h2 id={titleId} className="font-semibold">{title}</h2>
        {description && <p className="form-dialog-description">{description}</p>}
      </div>
      <div className="ui-dialog-header-actions">
        {headerActions}
        <IconButton ref={closeButton} label="关闭" onClick={onClose} icon={<X size={17} />} />
      </div>
    </header>
  );
}
