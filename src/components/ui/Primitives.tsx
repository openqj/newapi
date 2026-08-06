import { TriangleAlert } from "lucide-react";
import { Children, isValidElement, useState, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import type { ChangeEvent } from "react";
import { SelectDropdown, type SelectDropdownOption } from "./SelectDropdown";
import "./Primitives.css";

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-header-actions">{actions}</div>}</header>;
}

export function Panel({ title, description, children, className = "", ...props }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return <section {...props} className={`panel ${className}`.trim()}>{(title || description) && <header className="panel-header">{title && <h2>{title}</h2>}{description && <p>{description}</p>}</header>}{children}</section>;
}

export function StatusBadge({ status, children, className, indicator }: { status: "online" | "partial" | "error" | "connecting" | "neutral" | string; children?: ReactNode; className?: string; indicator?: ReactNode }) {
  if (children == null && !className && !indicator) {
    const tone = status === "online" ? "good" : status === "error" || status === "requires_reauth" ? "bad" : "warn";
    const label = ({ online: "正常", partial: "部分可用", error: "异常", requires_reauth: "需要重新登录", connecting: "连接中" }[status] ?? status) || "未知";
    return <span className={`sub2-status sub2-status-${tone}`}><i />{label}</span>;
  }
  return <span className={className ?? `status-label ${status}`}>{indicator}{children}</span>;
}

export function EmptyState({ title = "暂无数据", description, action, className, children, message }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; children?: ReactNode; message?: ReactNode }) {
  if (message != null && !className && !children) return <div className="sub2-empty"><TriangleAlert size={22} /><span>{message}</span></div>;
  return <div className={className ?? "empty-state"}>{children ?? <><strong>{title}</strong>{description && <p>{description}</p>}{action && <div>{action}</div>}</>}</div>;
}

type FieldProps = { label: ReactNode; error?: ReactNode; hint?: ReactNode; required?: boolean; children: ReactNode };
export function FormField({ label, error, hint, required, children }: FieldProps) {
  return <label className="form-field"><span>{label}{required && <b aria-hidden="true"> *</b>}</span>{children}{hint && !error && <small>{hint}</small>}{error && <small className="field-error">{error}</small>}</label>;
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & { error?: boolean };
export function TextField({ error, ...props }: TextFieldProps) { return <input {...props} className="input" aria-invalid={error || undefined} />; }
export function PasswordField({ error, ...props }: TextFieldProps) { return <input {...props} type="password" className="input" aria-invalid={error || undefined} />; }
type SelectOptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };

export function SelectField({ children, value, defaultValue, onChange, className, id, name, title, disabled, required, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid }: SelectHTMLAttributes<HTMLSelectElement>) {
  const options: SelectDropdownOption[] = Children.toArray(children).filter((child) => isValidElement<SelectOptionProps>(child) && child.type === "option").map((child) => ({
    value: String(child.props.value ?? ""),
    label: child.props.children,
    disabled: child.props.disabled,
  }));
  const controlledValue = value == null || Array.isArray(value) ? undefined : String(value);
  const [internalValue, setInternalValue] = useState(() => controlledValue ?? (defaultValue == null || Array.isArray(defaultValue) ? options[0]?.value ?? "" : String(defaultValue)));
  const selectedValue = controlledValue ?? internalValue;
  const handleChange = (nextValue: string) => {
    if (controlledValue == null) setInternalValue(nextValue);
    onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } } as ChangeEvent<HTMLSelectElement>);
  };
  return <SelectDropdown
    value={selectedValue}
    options={options}
    onChange={handleChange}
    id={id}
    name={name}
    title={title}
    disabled={disabled}
    ariaLabel={ariaLabel}
    className="select-field"
    triggerClassName={`input ${className ?? ""}`.trim()}
    ariaLabelledBy={ariaLabelledBy}
    ariaDescribedBy={ariaDescribedBy}
    ariaInvalid={ariaInvalid}
    required={required}
  />;
}
export function TextareaField(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className="input" />; }
