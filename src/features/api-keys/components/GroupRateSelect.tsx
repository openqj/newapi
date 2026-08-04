import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import type { GroupOption } from "../types";

type GroupRateSelectProps = {
  value: string;
  groups: GroupOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
  className?: string;
};

type MenuPosition = { top: number; left: number; width: number };

const formatMultiplier = (value?: number) => Number.isFinite(value) ? `${value!.toFixed(3)}x` : "-";

export function GroupRateSelect({
  value,
  groups,
  onChange,
  disabled = false,
  placeholder = "请选择分组",
  allowEmpty = false,
  className = "",
}: GroupRateSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const options = groups.some((group) => group.name === value) || !value
    ? groups
    : [{ name: value }, ...groups];
  const selected = options.find((option) => option.name === value);
  const selectedDescription = selected?.description?.trim();
  const selectedLabel = selected
    ? `${placeholder}: ${selected.name}${selectedDescription ? ` ${selectedDescription}` : ""} ${formatMultiplier(selected.multiplier)}`
    : placeholder;

  const updatePosition = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setMenuPosition({ top: bounds.bottom + 4, left: bounds.left, width: Math.max(bounds.width, 200) });
  };

  const toggle = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    updatePosition();
    setOpen(true);
  };

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const menu = open && menuPosition && createPortal(
    <div ref={menuRef} className="group-rate-select-menu" role="listbox" aria-label={placeholder} style={menuPosition}>
      {allowEmpty && <button type="button" role="option" aria-label={placeholder} aria-selected={!value} onClick={() => choose("")} disabled={disabled}><span className="group-rate-select-option-copy"><span className="group-rate-select-option-name">{placeholder}</span></span><strong>-</strong></button>}
      {options.map((option) => {
        const description = option.description?.trim();
        return <button type="button" role="option" aria-label={`${option.name}${description ? ` ${description}` : ""} ${formatMultiplier(option.multiplier)}`} aria-selected={option.name === value} onClick={() => choose(option.name)} disabled={disabled} key={option.name}><span className="group-rate-select-option-copy"><span className="group-rate-select-option-name">{option.name}</span>{description && <small title={description}>{description}</small>}</span><strong>{formatMultiplier(option.multiplier)}</strong></button>;
      })}
    </div>,
    document.body,
  );

  return (
    <div className={`group-rate-select ${className}`.trim()} ref={rootRef}>
      <button ref={triggerRef} type="button" className="group-rate-select-trigger" aria-label={selectedLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={toggle}>
        <span>{selected?.name || placeholder}</span>
        <strong>{formatMultiplier(selected?.multiplier)}</strong>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}
