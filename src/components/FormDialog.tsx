import { useEffect, useRef, type FormEventHandler, type ReactNode } from "react";
import { X } from "lucide-react";

type FormDialogProps = {
  title: ReactNode;
  description?: ReactNode;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  noValidate?: boolean;
};

export function FormDialog({
  title,
  description,
  ariaLabel,
  onClose,
  children,
  footer,
  className = "",
  contentClassName = "",
  onSubmit,
  noValidate,
}: FormDialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className={`modal form-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        noValidate={noValidate}
        onSubmit={onSubmit}
      >
        <div className="form-dialog-header">
          <div>
            <h2 className="font-semibold">{title}</h2>
            {description && <p className="form-dialog-description">{description}</p>}
          </div>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <div className={`form-dialog-content ${contentClassName}`.trim()}>{children}</div>
        {footer && <div className="form-dialog-footer">{footer}</div>}
      </form>
    </div>
  );
}
