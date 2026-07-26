import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-header-actions">{actions}</div>}</header>;
}

export function Panel({ title, description, children, className = "" }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`.trim()}>{(title || description) && <header className="panel-header">{title && <h2>{title}</h2>}{description && <p>{description}</p>}</header>}{children}</section>;
}

export function StatusBadge({ status, children }: { status: "online" | "partial" | "error" | "connecting" | "neutral"; children: ReactNode }) {
  return <span className={`status-label ${status}`}>{children}</span>;
}

export function EmptyState({ title = "暂无数据", description, action }: { title?: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong>{description && <p>{description}</p>}{action && <div>{action}</div>}</div>;
}

type FieldProps = { label: ReactNode; error?: ReactNode; hint?: ReactNode; required?: boolean; children: ReactNode };
export function FormField({ label, error, hint, required, children }: FieldProps) {
  return <label className="form-field"><span>{label}{required && <b aria-hidden="true"> *</b>}</span>{children}{hint && !error && <small>{hint}</small>}{error && <small className="field-error">{error}</small>}</label>;
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & { error?: boolean };
export function TextField({ error, ...props }: TextFieldProps) { return <input {...props} className="input" aria-invalid={error || undefined} />; }
export function PasswordField({ error, ...props }: TextFieldProps) { return <input {...props} type="password" className="input" aria-invalid={error || undefined} />; }
export function SelectField(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className="input" />; }
export function TextareaField(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className="input" />; }
