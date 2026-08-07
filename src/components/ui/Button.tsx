import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "icon" | "test" | "nav";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClassNames: Record<ButtonVariant, string> = {
  primary: "button-primary",
  secondary: "button-secondary",
  danger: "button-danger",
  ghost: "button-ghost",
  icon: "icon-button",
  test: "test-mode-button",
  nav: "nav-item",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  children,
  ...props
}, ref) {
  const classes = [
    "ui-button",
    variantClassNames[variant],
    `ui-button-${size}`,
    className,
  ].filter(Boolean).join(" ");

  return <button {...props} ref={ref} type={type} className={classes}>{children}</button>;
});

export type IconButtonProps = Omit<ButtonProps, "children"> & {
  icon: ReactNode;
  label: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, variant = "icon", title, "aria-label": ariaLabel, className, ...props }, ref) {
  return <Button
    {...props}
    ref={ref}
    variant={variant}
    aria-label={ariaLabel ?? label}
    title={title ?? label}
    className={["ui-button-icon-only", className].filter(Boolean).join(" ")}
  >{icon}</Button>;
});
