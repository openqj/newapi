import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { presentGroup } from "../../../lib/groupPresentation";
import type { GroupOption } from "../types";

type GroupRateSelectProps = {
  value: string;
  groups: GroupOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
  searchable?: boolean;
  showSelectionLabel?: boolean;
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
  searchable = false,
  showSelectionLabel = false,
  className = "",
}: GroupRateSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const options = groups.some((group) => group.name === value) || !value
    ? groups
    : [{ name: value }, ...groups];
  const selected = options.find((option) => option.name === value);
  const selectedPresentation = selected ? presentGroup(selected) : undefined;
  const selectedLabel = selected
    ? `${placeholder}: ${selectedPresentation?.name}${selectedPresentation?.description ? ` ${selectedPresentation.description}` : ""} ${formatMultiplier(selected.multiplier)}`
    : placeholder;
  const selectedTone = selectedPresentation ? groupTone(selectedPresentation.name, selectedPresentation.description) : "neutral";
  const filteredOptions = searchQuery.trim()
    ? options.filter((option) => {
      const presentation = presentGroup(option);
      return `${presentation.name} ${presentation.description ?? ""}`.toLowerCase().includes(searchQuery.trim().toLowerCase());
    })
    : options;

  const updatePosition = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const maxWidth = Math.max(1, window.innerWidth - 16);
    const width = Math.min(Math.max(bounds.width, 380), maxWidth);
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
    setMenuPosition({ top: bounds.bottom + 4, left, width });
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
    if (searchable) searchRef.current?.focus();
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, searchable]);

  useEffect(() => {
    if (!open) setSearchQuery("");
  }, [open]);

  const menu = open && menuPosition && createPortal(
    <div ref={menuRef} className="group-rate-select-menu" role="listbox" aria-label={placeholder} style={menuPosition}>
      {searchable && <div className="group-rate-select-search"><Search size={16} aria-hidden="true" /><input ref={searchRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索分组..." aria-label="搜索分组" onClick={(event) => event.stopPropagation()} /></div>}
      <div className="group-rate-select-menu-options">
        {allowEmpty && <button type="button" className="group-rate-select-option group-rate-select-tone-neutral" role="option" aria-label={placeholder} aria-selected={!value} onClick={() => choose("")} disabled={disabled}><span className="group-rate-select-option-copy"><span className="group-rate-select-option-name">{placeholder}</span></span><span className="group-rate-select-option-meta"><strong>-</strong>{!value && <Check size={16} className="group-rate-select-option-check" aria-hidden="true" />}</span></button>}
        {filteredOptions.map((option) => {
        const presentation = presentGroup(option);
        const tone = groupTone(presentation.name, presentation.description);
        return (
          <button type="button" className={`group-rate-select-option group-rate-select-tone-${tone}`} role="option" aria-label={`${presentation.name}${presentation.description ? ` ${presentation.description}` : ""} ${formatMultiplier(option.multiplier)} 倍率`} aria-selected={option.name === value} onClick={() => choose(option.name)} disabled={disabled} key={option.name}>
            <span className="group-rate-select-option-copy"><span className="group-rate-select-option-name">{presentation.name}</span>{presentation.description && <small title={presentation.description}>{presentation.description}</small>}</span>
            <span className="group-rate-select-option-meta"><strong>{formatMultiplier(option.multiplier)} 倍率</strong>{option.name === value && <Check size={16} className="group-rate-select-option-check" aria-hidden="true" />}</span>
          </button>
        );
        })}
        {filteredOptions.length === 0 && <div className="group-rate-select-empty">未找到分组</div>}
      </div>
    </div>,
    document.body,
  );

  return (
    <div className={`group-rate-select ${className}`.trim()} ref={rootRef}>
      <button ref={triggerRef} type="button" className={`group-rate-select-trigger group-rate-select-tone-${selectedTone} ${!selected ? "group-rate-select-trigger-empty" : ""} ${showSelectionLabel ? "group-rate-select-trigger-with-label" : ""}`} aria-label={selectedLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={toggle}>
        <span className="group-rate-select-trigger-copy"><span>{selectedPresentation?.name || placeholder}</span></span>
        {selected && <strong>{formatMultiplier(selected.multiplier)}</strong>}
        {showSelectionLabel && <span className="group-rate-select-trigger-label">{placeholder.replace(/^请/, "")}</span>}
        <ChevronsUpDown size={14} aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}
