import { ChevronsUpDown, ChevronDown, ChevronUp, Clipboard, Copy, Pencil, Play, Route, SquareTerminal, Trash2 } from "lucide-react";
import { Button, DataTable, EmptyState, IconButton, StatusBadge } from "../../../components/ui";
import { GroupRateSelect } from "./GroupRateSelect";
import { identifyModelType } from "../modelType";
import type { ApiKeyTestState, KeyRow } from "../types";

export type ApiKeySortKey = "name" | "concurrency" | "expires" | "status" | "created";
export type ApiKeySortDirection = "asc" | "desc";

function SortableHeader({ label, column, sortKey, sortDirection, onSort }: { label: string; column: ApiKeySortKey; sortKey: ApiKeySortKey; sortDirection: ApiKeySortDirection; onSort: (column: ApiKeySortKey) => void }) {
  const active = sortKey === column;
  return <th data-key-column={column} aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
    <Button variant="ghost" className={`sub2-key-sort-header${active ? " is-active" : ""}`} title={`按${label}排序`} onClick={() => onSort(column)}>
      <span>{label}</span>
      {active ? (sortDirection === "asc" ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />) : <ChevronsUpDown size={13} aria-hidden="true" />}
    </Button>
  </th>;
}

type ApiKeyTableProps = {
  rows: KeyRow[];
  hiddenColumns: string;
  sortKey: ApiKeySortKey;
  sortDirection: ApiKeySortDirection;
  saving: string | null;
  selectedIds: string[];
  testStates: Record<string, ApiKeyTestState>;
  onToggleSelected: (row: KeyRow) => void;
  onToggleAll: () => void;
  onSort: (column: ApiKeySortKey) => void;
  onReveal: (row: KeyRow) => void;
  onGroupChange: (row: KeyRow, group: string) => void;
  onApplyToCodex: (row: KeyRow) => void;
  onAddToRoute: (row: KeyRow) => void;
  onTest: (row: KeyRow) => void;
  onEdit: (row: KeyRow) => void;
  onDelete: (row: KeyRow) => void;
};

const formatMoney = (value?: number) => value == null ? "-" : `${value.toFixed(4)} 元`;
const formatMultiplier = (value?: number) => value == null ? "-" : `${value.toFixed(3)}x`;
const formatBalance = (value?: number) => value == null ? "-" : `${value.toFixed(2)} 元`;
const formatTime = (value?: number) => value
  ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000)
  : "尚未同步";
const isActive = (status: string) => status === "active" || status === "有效";
const rowId = (row: KeyRow) => `${row.stationId}:${row.key.id}`;
const rowMultiplier = (row: KeyRow) => row.groups.find((group) => group.name === (row.key.group ?? "default"))?.multiplier;

function TestStatus({ state }: { state?: ApiKeyTestState }) {
  if (!state) return null;
  if (state.status === "testing") return <StatusBadge status="connecting">测试中</StatusBadge>;
  return <StatusBadge status={state.status === "success" ? "online" : "error"}>{state.status === "success" ? "测试正常" : "测试异常"}</StatusBadge>;
}

export function ApiKeyTable({
  rows,
  hiddenColumns,
  sortKey,
  sortDirection,
  saving,
  selectedIds,
  testStates,
  onToggleSelected,
  onToggleAll,
  onSort,
  onReveal,
  onGroupChange,
  onApplyToCodex,
  onAddToRoute,
  onTest,
  onEdit,
  onDelete,
}: ApiKeyTableProps) {
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(rowId(row)));
  return (
    <DataTable
      className="sub2-panel sub2-table-panel"
      ariaLabel="API 密钥"
      isEmpty={rows.length === 0}
      empty={<EmptyState message="没有符合筛选条件的 API 密钥。" />}
      desktop={<div className={`sub2-desktop-table table-page-data-table sub2-key-data-table ${hiddenColumns}`}>
        <table>
          <thead>
            <tr>
              <th className="table-page-select-cell"><input type="checkbox" aria-label="全选 API 密钥" checked={allSelected} onChange={onToggleAll} /></th>
              <th data-key-column="station">中转站</th><SortableHeader column="name" label="名称" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} /><th data-key-column="apiKey">API 密钥</th><th data-key-column="group">分组</th><th data-key-column="balance">余额</th><SortableHeader column="concurrency" label="当前并发" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />
              <th data-key-column="usage">用量</th><SortableHeader column="expires" label="过期时间" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} /><SortableHeader column="status" label="状态" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} /><SortableHeader column="created" label="创建时间" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} /><th data-key-column="actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = rowId(row);
              const totalQuota = row.key.totalQuota ?? ((row.key.remainingQuota ?? 0) + (row.key.usedQuota ?? 0));
              const active = isActive(row.key.status);
              const testState = testStates[id];
              const busy = saving === id || saving === `codex:${id}` || saving === `route:${id}` || testState?.status === "testing";
              return (
                <tr key={id}>
                  <td className="table-page-select-cell"><input type="checkbox" aria-label={`选择 API 密钥 ${row.key.name || row.key.id}`} checked={selectedIds.includes(id)} onChange={() => onToggleSelected(row)} /></td>
                  <td data-key-column="station" className="table-page-station"><strong>{row.stationName}</strong><small>{row.stationUrl}</small></td>
                  <td data-key-column="name"><strong>{row.key.name || "未命名密钥"}</strong></td>
                  <td data-key-column="apiKey"><div className="sub2-key-code"><code>{row.key.maskedKey || "已隐藏"}</code><IconButton label="复制 API 密钥" className="sub2-copy-key" onClick={() => onReveal(row)} icon={<Copy size={15} />} /></div></td>
                  <td data-key-column="group"><GroupRateSelect className="sub2-key-group-rate-select" value={row.key.group ?? "default"} groups={row.groups.length ? row.groups : [{ name: row.key.group ?? "default" }]} disabled={busy} searchable showSelectionLabel onChange={(group) => onGroupChange(row, group)} /></td>
                  <td data-key-column="balance" className="sub2-key-value">{formatBalance(row.stationBalance)}</td>
                  <td data-key-column="concurrency"><span className={`sub2-concurrency ${row.key.currentConcurrency ? "active" : ""}`}>{row.key.currentConcurrency ?? 0}</span></td>
                  <td data-key-column="usage">
                    <div className="sub2-key-usage">
                      <div><span>今日：</span><strong>{formatMoney(row.key.todaySpent)}</strong></div>
                      <div><span>总计：</span><strong>{formatMoney(row.key.last30DaysSpent ?? row.key.usedQuota)}</strong></div>
                      {row.key.unlimitedQuota ? <div className="sub2-key-quota sub2-key-quota-unlimited"><span>额度：</span><strong>无限额</strong></div> : row.key.remainingQuota != null && <div className="sub2-key-quota"><div><span>额度：</span><strong>{formatMoney(row.key.usedQuota)} / {formatMoney(totalQuota)}</strong></div><i><b style={{ width: `${Math.min(((row.key.usedQuota ?? 0) / Math.max(0.0001, totalQuota)) * 100, 100)}%` }} /></i></div>}
                    </div>
                  </td>
                  <td data-key-column="expires">{row.key.expiresAt ? formatTime(row.key.expiresAt) : "永不过期"}</td>
                  <td data-key-column="status"><div className="sub2-key-status" title={testState?.message}><StatusBadge status={active ? "online" : "partial"} /><TestStatus state={testState} /></div></td>
                  <td data-key-column="created">{formatTime(row.key.createdAt)}</td>
                  <td data-key-column="actions">
                    <div className="sub2-key-row-actions">
                      <Button variant="ghost" className="enable" title="直接写入本地 Codex 配置" onClick={() => onApplyToCodex(row)} disabled={busy}><SquareTerminal size={15} aria-hidden="true" /><span>启用</span></Button>
                      <Button variant="ghost" className="test" title="测试 API 密钥" onClick={() => onTest(row)} disabled={busy}><Play size={15} aria-hidden="true" /><span>测试</span></Button>
                      <Button variant="ghost" className="route" title="加入本地路由" onClick={() => onAddToRoute(row)} disabled={busy}><Route size={15} aria-hidden="true" /><span>加入路由</span></Button>
                      <Button variant="ghost" className="edit" title="编辑密钥" onClick={() => onEdit(row)} disabled={busy}><Pencil size={15} /><span>编辑</span></Button>
                      <Button variant="ghost" className="delete" title="删除密钥" onClick={() => onDelete(row)} disabled={busy}><Trash2 size={15} /><span>删除</span></Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
      mobile={<div className="sub2-mobile-cards">
        {rows.map((row) => {
          const id = rowId(row);
          const active = isActive(row.key.status);
          const modelType = identifyModelType(row.models);
          const testState = testStates[id];
          return <article className="sub2-record-card" key={id}>
            <div className="sub2-record-card-heading"><label className="table-page-mobile-select"><input type="checkbox" aria-label={`选择 API 密钥 ${row.key.name || row.key.id}`} checked={selectedIds.includes(id)} onChange={() => onToggleSelected(row)} /><strong>{row.key.name || "未命名密钥"}</strong></label><div className="sub2-key-status" title={testState?.message}><StatusBadge status={active ? "online" : "partial"} /><TestStatus state={testState} /></div></div>
            <code>{row.key.maskedKey || "已隐藏"}</code>
            <dl>
              <div><dt>来源</dt><dd>{row.stationName}</dd></div><div><dt>网址</dt><dd>{row.stationUrl}</dd></div><div><dt>模型类型</dt><dd>{modelType}</dd></div>
              <div><dt>分组</dt><dd>{row.key.group || "default"}</dd></div><div><dt>倍率</dt><dd>{formatMultiplier(rowMultiplier(row))}</dd></div><div><dt>余额</dt><dd>{formatBalance(row.stationBalance)}</dd></div><div><dt>今日消费</dt><dd>{formatMoney(row.key.todaySpent)}</dd></div>
              <div><dt>额度</dt><dd>{formatMoney(row.key.remainingQuota)}</dd></div>
            </dl>
            <div className="sub2-card-actions">
              <Button variant="secondary" onClick={() => onReveal(row)}><Clipboard size={16} />复制</Button>
              <Button variant="secondary" onClick={() => onTest(row)} disabled={testState?.status === "testing"}><Play size={16} />测试</Button>
              <Button variant="secondary" onClick={() => onEdit(row)}><Pencil size={16} />编辑</Button>
              <IconButton variant="ghost" className="sub2-icon-action sub2-danger-action" label="删除密钥" onClick={() => onDelete(row)} icon={<Trash2 size={16} />} />
            </div>
          </article>;
        })}
      </div>}
    />
  );
}
