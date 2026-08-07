import { useId, useRef, type ReactNode } from "react";
import { Columns3 } from "lucide-react";
import { useOutsideDismiss } from "../../lib/useOutsideDismiss";
import { Button } from "./Button";
import "./ColumnVisibilityMenu.css";

export type ColumnVisibilityOption<Key extends string> = {
  key: Key;
  label: ReactNode;
  disabled?: boolean;
};

export type ColumnVisibilityMenuProps<Key extends string> = {
  columns: readonly ColumnVisibilityOption<Key>[];
  visible: Record<Key, boolean>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (key: Key) => void;
  label?: string;
  icon?: ReactNode;
  className?: string;
};

export function ColumnVisibilityMenu<Key extends string>({
  columns,
  visible,
  open,
  onOpenChange,
  onToggle,
  label = "列设置",
  icon = <Columns3 size={16} aria-hidden="true" />,
  className = "",
}: ColumnVisibilityMenuProps<Key>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useOutsideDismiss(rootRef, open, () => onOpenChange(false));

  return (
    <div className={`ui-column-visibility-menu ${className}`.trim()} ref={rootRef}>
      <Button
        variant="secondary"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
      >
        {icon}<span>{label}</span>
      </Button>
      {open && (
        <div id={menuId} className="ui-column-visibility-menu-panel" role="menu" aria-label={label}>
          {columns.map(({ key, label: optionLabel, disabled }) => (
            <label className="ui-column-visibility-menu-item" key={key}>
              <input
                type="checkbox"
                checked={visible[key]}
                disabled={disabled}
                onChange={() => onToggle(key)}
              />
              <span>{optionLabel}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
