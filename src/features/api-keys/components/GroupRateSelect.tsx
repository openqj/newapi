import { Check, ChevronsUpDown } from "lucide-react";
import { SelectDropdown, type SelectDropdownOption } from "../../../components/ui";
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

type GroupTone = "neutral" | "green" | "orange";

const formatMultiplier = (value?: number) => Number.isFinite(value) ? `${value!.toFixed(3)}x` : "-";

export function groupTone(name?: string, description?: string): GroupTone {
  const text = `${name ?? ""} ${description ?? ""}`.toLowerCase();
  return /claude|anthropic|kiro/.test(text) ? "orange" : "green";
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
  const options = groups.some((group) => group.name === value) || !value
    ? groups
    : [{ name: value }, ...groups];
  const selected = options.find((option) => option.name === value);
  const selectedPresentation = selected ? presentGroup(selected) : undefined;
  const selectedLabel = selected
    ? `${placeholder}: ${selectedPresentation?.name}${selectedPresentation?.description ? ` ${selectedPresentation.description}` : ""} ${formatMultiplier(selected.multiplier)}`
    : placeholder;
  const selectedTone = selectedPresentation ? groupTone(selectedPresentation.name, selectedPresentation.description) : "neutral";
  const selectOptions: SelectDropdownOption[] = [
    ...(allowEmpty ? [{ value: "", label: placeholder, searchText: placeholder, ariaLabel: placeholder }] : []),
    ...options.map((option) => {
      const presentation = presentGroup(option);
      return {
        value: option.name,
        label: `${presentation.name}${presentation.description ? ` ${presentation.description}` : ""} ${formatMultiplier(option.multiplier)} 倍率`,
        searchText: `${presentation.name} ${presentation.description ?? ""}`,
        ariaLabel: `${presentation.name}${presentation.description ? ` ${presentation.description}` : ""} ${formatMultiplier(option.multiplier)} 倍率`,
      };
    }),
  ];

  return <SelectDropdown
    value={value}
    options={selectOptions}
    onChange={onChange}
    ariaLabel={selectedLabel}
    placeholder={placeholder}
    disabled={disabled}
    className={`group-rate-select ${className}`.trim()}
    triggerClassName={`group-rate-select-trigger group-rate-select-tone-${selectedTone} ${!selected ? "group-rate-select-trigger-empty" : ""} ${showSelectionLabel ? "group-rate-select-trigger-with-label" : ""}`.trim()}
    menuClassName="group-rate-select-menu"
    searchClassName="group-rate-select-search"
    optionsClassName="group-rate-select-menu-options"
    minMenuWidth={380}
    searchable={searchable}
    searchPlaceholder="搜索分组..."
    searchAriaLabel="搜索分组"
    emptyLabel="未找到分组"
    triggerIcon={<ChevronsUpDown size={14} aria-hidden="true" />}
    showSelectedIndicator={false}
    renderValue={() => <>
      <span className="group-rate-select-trigger-copy"><span>{selectedPresentation?.name || placeholder}</span></span>
      {selected && <strong>{formatMultiplier(selected.multiplier)}</strong>}
      {showSelectionLabel && <span className="group-rate-select-trigger-label">{placeholder.replace(/^请/, "")}</span>}
    </>}
    optionClassName={(option) => {
      if (!option.value) return "group-rate-select-option group-rate-select-tone-neutral";
      const group = options.find((item) => item.name === option.value);
      const presentation = group ? presentGroup(group) : undefined;
      return `group-rate-select-option group-rate-select-tone-${groupTone(presentation?.name, presentation?.description)}`;
    }}
    renderOption={(option, context) => {
      if (!option.value) return <><span className="group-rate-select-option-copy"><span className="group-rate-select-option-name">{placeholder}</span></span><span className="group-rate-select-option-meta"><strong>-</strong>{context.isSelected && <Check size={16} className="group-rate-select-option-check" aria-hidden="true" />}</span></>;
      const group = options.find((item) => item.name === option.value);
      const presentation = group ? presentGroup(group) : { name: option.value };
      return <><span className="group-rate-select-option-copy"><span className="group-rate-select-option-name">{presentation.name}</span>{presentation.description && <small title={presentation.description}>{presentation.description}</small>}</span><span className="group-rate-select-option-meta"><strong>{formatMultiplier(group?.multiplier)} 倍率</strong>{context.isSelected && <Check size={16} className="group-rate-select-option-check" aria-hidden="true" />}</span></>;
    }}
  />;
}
