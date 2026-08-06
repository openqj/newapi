import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Columns3, Copy, Plus, RefreshCw, Search, Zap } from "lucide-react";
import type { Station } from "../../stations";
import { useOutsideDismiss } from "../../../lib/useOutsideDismiss";

export type KeyTableColumn = "station" | "modelType" | "name" | "apiKey" | "group" | "multiplier" | "balance" | "concurrency" | "usage" | "expires" | "status" | "created" | "actions";
export const keyTableColumns: ReadonlyArray<{ key: KeyTableColumn; label: string }> = [{ key: "station", label: "中转站" }, { key: "modelType", label: "模型类型" }, { key: "name", label: "名称" }, { key: "apiKey", label: "API 密钥" }, { key: "group", label: "分组" }, { key: "multiplier", label: "倍率" }, { key: "balance", label: "余额" }, { key: "concurrency", label: "当前并发" }, { key: "usage", label: "用量" }, { key: "expires", label: "过期时间" }, { key: "status", label: "状态" }, { key: "created", label: "创建时间" }, { key: "actions", label: "操作" }];

type FilterOption = { value: string; label: string };
type FilterMenuPosition = { top: number; left: number; width: number };

function FilterSelect({ ariaLabel, value, options, onChange }: { ariaLabel: string; value: string; options: FilterOption[]; onChange: (value: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<FilterMenuPosition | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  const updatePosition = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = bounds.width;
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
    setMenuPosition({ top: bounds.bottom + 4, left, width });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
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
    <div ref={menuRef} className="sub2-filter-menu" role="listbox" aria-label={ariaLabel} style={menuPosition}>
      {options.map((option) => {
        const isSelected = option.value === value;
        return <button type="button" role="option" aria-selected={isSelected} className={isSelected ? "selected" : ""} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{isSelected && <Check size={16} aria-hidden="true" />}</button>;
      })}
    </div>,
    document.body,
  );

  return <div ref={rootRef} className="sub2-filter-select">
    <button ref={triggerRef} type="button" className="sub2-filter-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => { updatePosition(); setOpen((current) => !current); }}>
      <span>{selected?.label ?? value}</span>
      {open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
    </button>
    {menu}
  </div>;
}

export function ApiKeyToolbar({ stations, query, station, status, modelType, modelTypes, visible, refreshing, showColumns, onQueryChange, onStationChange, onStatusChange, onModelTypeChange, onToggleColumn, onToggleColumns, onCloseColumns, onRefresh, onCreate, onCopyEndpoint }: { stations: Station[]; query: string; station: string; status: string; modelType: string; modelTypes: string[]; visible: Record<KeyTableColumn, boolean>; refreshing: boolean; showColumns: boolean; onQueryChange: (value: string) => void; onStationChange: (value: string) => void; onStatusChange: (value: string) => void; onModelTypeChange: (value: string) => void; onToggleColumn: (key: KeyTableColumn) => void; onToggleColumns: () => void; onCloseColumns: () => void; onRefresh: () => void; onCreate: () => void; onCopyEndpoint: (station: Station) => void }) {
  const columnMenuRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(columnMenuRef, showColumns, onCloseColumns);
  return <section className="table-page-toolbar">
    <div className="sub2-key-toolbar-main">
      <div className="table-page-filters">
        <label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索密钥名称、站点或分组" /></label>
        <FilterSelect ariaLabel="站点筛选" value={station} options={[{ value: "all", label: "全部站点" }, ...stations.map((item) => ({ value: item.id, label: item.name }))]} onChange={onStationChange} />
        <FilterSelect ariaLabel="模型类型筛选" value={modelType} options={[{ value: "all", label: "全部模型类型" }, ...modelTypes.map((item) => ({ value: item, label: item }))]} onChange={onModelTypeChange} />
        <FilterSelect ariaLabel="状态筛选" value={status} options={[{ value: "all", label: "全部状态" }, { value: "active", label: "启用" }, { value: "inactive", label: "停用" }]} onChange={onStatusChange} />
      </div>
      <div className="table-page-actions">
        <button className="button-secondary" title="刷新" aria-label="刷新" onClick={onRefresh} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} /></button>
        <div className="sub2-column-menu" ref={columnMenuRef}>
          <button className="button-secondary" title="列设置" onClick={onToggleColumns}><Columns3 size={16} /><span>列设置</span></button>
          {showColumns && <div className="sub2-menu">{keyTableColumns.map(({ key, label }) => <label key={key}><input type="checkbox" checked={visible[key]} onChange={() => onToggleColumn(key)} />{label}</label>)}</div>}
        </div>
        <button className="button-primary" onClick={onCreate}><Plus size={16} />新建密钥</button>
      </div>
    </div>
    {stations.length > 0 && <div className="sub2-key-endpoints" aria-label="API 接口地址">
      {stations.map((item, index) => <button type="button" className="sub2-key-endpoint-chip" key={item.id} title="复制接口地址" onClick={() => onCopyEndpoint(item)}>
        <span>{index === 0 ? "API 端点" : item.name}</span>
        {index === 0 && <b>默认</b>}
        <code>{item.baseUrl}</code>
        <Copy size={12} aria-hidden="true" />
        <Zap size={12} aria-hidden="true" />
      </button>)}
    </div>}
  </section>;
}
