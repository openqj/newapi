import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState, type AriaAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";
import { Button } from "./Button";
import "./SelectDropdown.css";

export type SelectDropdownOption = {
  value: string;
  label: ReactNode;
  searchText?: string;
  ariaLabel?: string;
  disabled?: boolean;
};

type SelectDropdownRenderContext = {
  isSelected: boolean;
  isActive: boolean;
};

type SelectDropdownProps = {
  value: string;
  options: SelectDropdownOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: ReactNode;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string | ((option: SelectDropdownOption, context: SelectDropdownRenderContext) => string | undefined);
  searchClassName?: string;
  optionsClassName?: string;
  title?: string;
  id?: string;
  name?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: AriaAttributes["aria-invalid"];
  required?: boolean;
  minMenuWidth?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  emptyLabel?: ReactNode;
  renderValue?: (option: SelectDropdownOption | undefined) => ReactNode;
  renderOption?: (option: SelectDropdownOption, context: SelectDropdownRenderContext) => ReactNode;
  renderSelectedIndicator?: (option: SelectDropdownOption) => ReactNode;
  showSelectedIndicator?: boolean;
  triggerIcon?: ReactNode;
};

type MenuPosition = { top: number; left: number; width: number };

const optionText = (option: SelectDropdownOption) => option.searchText ?? (typeof option.label === "string" ? option.label : "");

export function SelectDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "请选择",
  disabled = false,
  className = "",
  triggerClassName = "",
  menuClassName = "",
  optionClassName = "",
  searchClassName = "",
  optionsClassName = "",
  title,
  id,
  name,
  ariaLabelledBy,
  ariaDescribedBy,
  ariaInvalid,
  required = false,
  minMenuWidth = 0,
  searchable = false,
  searchPlaceholder = "搜索...",
  searchAriaLabel = "搜索选项",
  emptyLabel = "暂无选项",
  renderValue,
  renderOption,
  renderSelectedIndicator,
  showSelectedIndicator = true,
  triggerIcon,
}: SelectDropdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => optionText(option).toLowerCase().includes(query));
  }, [options, searchQuery]);

  const firstEnabledIndex = (items: SelectDropdownOption[]) => items.findIndex((option) => !option.disabled);
  const selectedIndex = filteredOptions.findIndex((option) => option.value === value && !option.disabled);

  const updatePosition = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const maxWidth = Math.max(1, window.innerWidth - 16);
    const width = Math.min(Math.max(bounds.width, minMenuWidth), maxWidth);
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
    setMenuPosition({ top: bounds.bottom + 4, left, width });
  };

  const openMenu = () => {
    if (disabled) return;
    updatePosition();
    setSearchQuery("");
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options));
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (option: SelectDropdownOption) => {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu(true);
  };

  const moveActive = (direction: 1 | -1, items = filteredOptions) => {
    const enabled = items.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
    if (!enabled.length) return;
    const currentPosition = enabled.indexOf(activeIndex);
    const nextPosition = currentPosition < 0
      ? direction > 0 ? 0 : enabled.length - 1
      : (currentPosition + direction + enabled.length) % enabled.length;
    setActiveIndex(enabled[nextPosition]);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenu();
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(firstEnabledIndex(filteredOptions));
    } else if (event.key === "End") {
      event.preventDefault();
      const last = [...filteredOptions].reverse().findIndex((option) => !option.disabled);
      if (last >= 0) setActiveIndex(filteredOptions.length - last - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = filteredOptions[activeIndex];
      if (option) choose(option);
    }
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
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
    if (!open) return;
    if (!filteredOptions[activeIndex] || filteredOptions[activeIndex].disabled) setActiveIndex(firstEnabledIndex(filteredOptions));
  }, [activeIndex, filteredOptions, open]);

  const menu = open && menuPosition && createPortal(
    <div
      ref={menuRef}
      id={listboxId}
      className={`ui-select-dropdown-menu ${menuClassName}`.trim()}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={filteredOptions[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
      style={menuPosition}
      onKeyDown={handleKeyDown}
    >
      {searchable && <div className={`ui-select-dropdown-search ${searchClassName}`.trim()}>
        <Search size={16} aria-hidden="true" />
        <input
          ref={searchRef}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          autoComplete="off"
          onClick={(event) => event.stopPropagation()}
        />
      </div>}
      <div className={`ui-select-dropdown-options ${optionsClassName}`.trim()}>
        {filteredOptions.length === 0 && <div className="ui-select-dropdown-empty">{emptyLabel}</div>}
        {filteredOptions.map((option, index) => {
          const isSelected = option.value === value;
          const isActive = index === activeIndex;
          const customClassName = typeof optionClassName === "function" ? optionClassName(option, { isSelected, isActive }) : optionClassName;
          return <Button
            variant="ghost"
            type="button"
            id={`${listboxId}-option-${index}`}
            role="option"
            aria-selected={isSelected}
            aria-label={option.ariaLabel}
            aria-disabled={option.disabled || undefined}
            className={`ui-select-dropdown-option ${isSelected ? "selected" : ""} ${isActive ? "active" : ""} ${customClassName ?? ""}`.trim()}
            key={option.value}
            disabled={option.disabled}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => choose(option)}
          >
            {renderOption ? renderOption(option, { isSelected, isActive }) : <span className="ui-select-dropdown-option-label">{option.label}</span>}
            {isSelected && showSelectedIndicator && (renderSelectedIndicator ? renderSelectedIndicator(option) : <Check size={16} className="ui-select-dropdown-check" aria-hidden="true" />)}
          </Button>;
        })}
      </div>
    </div>,
    document.body,
  );

  return <div ref={rootRef} className={`ui-select-dropdown ${className}`.trim()}>
    <Button
      variant="ghost"
      ref={triggerRef}
      id={id}
      type="button"
      className={`ui-select-dropdown-trigger ${triggerClassName}`.trim()}
      title={title}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      aria-required={required || undefined}
      aria-haspopup="listbox"
      aria-controls={open ? listboxId : undefined}
      aria-expanded={open}
      disabled={disabled}
      onClick={() => open ? closeMenu() : openMenu()}
      onKeyDown={handleKeyDown}
    >
      {renderValue ? renderValue(selected) : <span className="ui-select-dropdown-value">{selected?.label ?? placeholder}</span>}
      {triggerIcon ?? (open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />)}
    </Button>
    {name && <input type="hidden" name={name} value={value} />}
    {menu && <>{menu}</>}
  </div>;
}
