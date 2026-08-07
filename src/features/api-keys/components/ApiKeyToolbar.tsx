import { Plus, RefreshCw, Search } from "lucide-react";
import type { Station } from "../../stations";
import { Button, ColumnVisibilityMenu, IconButton, SelectDropdown } from "../../../components/ui";

export type KeyTableColumn = "station" | "name" | "apiKey" | "group" | "balance" | "concurrency" | "usage" | "expires" | "status" | "created" | "actions";
export const keyTableColumns: ReadonlyArray<{ key: KeyTableColumn; label: string }> = [{ key: "station", label: "中转站" }, { key: "name", label: "名称" }, { key: "apiKey", label: "API 密钥" }, { key: "group", label: "分组" }, { key: "balance", label: "余额" }, { key: "concurrency", label: "当前并发" }, { key: "usage", label: "用量" }, { key: "expires", label: "过期时间" }, { key: "status", label: "状态" }, { key: "created", label: "创建时间" }, { key: "actions", label: "操作" }];

type FilterOption = { value: string; label: string };

function FilterSelect({ ariaLabel, value, options, onChange }: { ariaLabel: string; value: string; options: FilterOption[]; onChange: (value: string) => void }) {
  return <SelectDropdown
    value={value}
    options={options}
    onChange={onChange}
    ariaLabel={ariaLabel}
    className="sub2-filter-select"
    triggerClassName="sub2-filter-select-trigger"
    menuClassName="sub2-filter-menu"
  />;
}

export function ApiKeyToolbar({ stations, query, station, status, modelType, modelTypes, visible, refreshing, showColumns, onQueryChange, onStationChange, onStatusChange, onModelTypeChange, onToggleColumn, onToggleColumns, onCloseColumns, onRefresh, onCreate }: { stations: Station[]; query: string; station: string; status: string; modelType: string; modelTypes: string[]; visible: Record<KeyTableColumn, boolean>; refreshing: boolean; showColumns: boolean; onQueryChange: (value: string) => void; onStationChange: (value: string) => void; onStatusChange: (value: string) => void; onModelTypeChange: (value: string) => void; onToggleColumn: (key: KeyTableColumn) => void; onToggleColumns: () => void; onCloseColumns: () => void; onRefresh: () => void; onCreate: () => void }) {
  return <section className="table-page-toolbar">
    <div className="sub2-key-toolbar-main">
      <div className="table-page-filters">
        <label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索密钥名称、站点或分组" /></label>
        <FilterSelect ariaLabel="站点筛选" value={station} options={[{ value: "all", label: "全部站点" }, ...stations.map((item) => ({ value: item.id, label: item.name }))]} onChange={onStationChange} />
        <FilterSelect ariaLabel="模型类型筛选" value={modelType} options={[{ value: "all", label: "全部模型类型" }, ...modelTypes.map((item) => ({ value: item, label: item }))]} onChange={onModelTypeChange} />
        <FilterSelect ariaLabel="状态筛选" value={status} options={[{ value: "all", label: "全部状态" }, { value: "active", label: "启用" }, { value: "inactive", label: "停用" }]} onChange={onStatusChange} />
      </div>
      <div className="table-page-actions">
        <IconButton variant="secondary" label="刷新" onClick={onRefresh} disabled={refreshing} icon={<RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} />} />
        <ColumnVisibilityMenu columns={keyTableColumns} visible={visible} open={showColumns} onOpenChange={(open) => open ? onToggleColumns() : onCloseColumns()} onToggle={onToggleColumn} />
        <Button variant="primary" onClick={onCreate}><Plus size={16} />新建密钥</Button>
      </div>
    </div>
  </section>;
}
