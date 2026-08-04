import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { presentGroup } from "../../../lib/groupPresentation";
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
type GroupTone = "neutral" | "green" | "orange" | "blue" | "purple";

const formatMultiplier = (value?: number) => Number.isFinite(value) ? `${value!.toFixed(3)}x` : "-";

export function groupTone(name?: string, description?: string): GroupTone {
  const text = `${name ?? ""} ${description ?? ""}`.toLowerCase();
  if (/claude|anthropic/.test(text)) return "orange";
  if (/grok|xai/.test(text)) return "neutral";
  if (/chatgpt|openai|kimi|gemini|deepseek|qwen|llama/.test(text)) return "green";
  if (/通用|default|公共|all/.test(text)) return "blue";
  if (/pro|plus|premium|高速/.test(text)) return "purple";
  return "neutral";
}

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
  const selectedPresentation = selected ? presentGroup(selected) : undefined;
  const selectedLabel = selected
    ? `${placeholder}: ${selectedPresentation?.name}${selectedPresentation?.description ? ` ${selectedPresentation.description}` : ""} ${formatMultiplier(selected.multiplier)}`
    : placeholder;
  const selectedTone = selectedPresentation ? groupTone(selectedPresentation.name, selectedPresentation.description) : "neutral";

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
      {allowEmpty && <button type="button" className="group-rate-select-option group-rate-select-tone-neutral" role="option" aria-label={placeholder} aria-selected={!value} onClick={() => choose("")} disabled={disabled}><span className="group-rate-select-option-copy"><span className="group-rate-select-option-name">{placeholder}</span></span><strong>-</strong></button>}
      {options.map((option) => {
        const presentation = presentGroup(option);
        const tone = groupTone(presentation.name, presentation.description);
        return <button type="button" className={`group-rate-select-option group-rate-select-tone-${tone}`} role="option" aria-label={`${presentation.name}${presentation.description ? ` ${presentation.description}` : ""} ${formatMultiplier(option.multiplier)}`} aria-selected={option.name === value} onClick={() => choose(option.name)} disabled={disabled} key={option.name}><span className="group-rate-select-option-copy"><span className="group-rate-select-option-name">{presentation.name}</span>{presentation.description && <small title={presentation.description}>{presentation.description}</small>}</span><strong>{formatMultiplier(option.multiplier)}</strong></button>;
      })}
    </div>,
    document.body,
  );

  return (
    <div className={`group-rate-select ${className}`.trim()} ref={rootRef}>
      <button ref={triggerRef} type="button" className={`group-rate-select-trigger group-rate-select-tone-${selectedTone}`} aria-label={selectedLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={toggle}>
        <span className="group-rate-select-trigger-copy"><span>{selectedPresentation?.name || placeholder}</span>{selectedPresentation?.description && <small title={selectedPresentation.description}>{selectedPresentation.description}</small>}</span>
        <strong>{formatMultiplier(selected?.multiplier)}</strong>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}
