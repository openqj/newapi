import { forwardRef, type ButtonHTMLAttributes } from "react";
import "./Switch.css";

export type SwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onChange" | "onClick" | "type"
> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    onCheckedChange,
    label,
    className,
    disabled,
    title,
    "aria-label": ariaLabel,
    ...props
  },
  ref,
) {
  const classes = ["ui-switch", checked && "ui-switch-checked", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...props}
      ref={ref}
      type="button"
      className={classes}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      title={title ?? label}
      disabled={disabled}
      data-state={checked ? "checked" : "unchecked"}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="ui-switch-track" aria-hidden="true">
        <span className="ui-switch-thumb" />
      </span>
    </button>
  );
});
