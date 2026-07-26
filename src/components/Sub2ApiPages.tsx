import { type FormEvent, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DataTable, useConfirm } from "./ui";
import { isTauri } from "../lib/platform";
import {
  Activity,
  ArrowRight,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Clock3,
  Columns3,
  Copy,
  Database,
  DollarSign,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Timer,
  Terminal,
  Trash2,
  TriangleAlert,
  Upload,
  Zap,
} from "lucide-react";
import {
  ArcElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";
import { FormDialog } from "./FormDialog";
import "./Sub2ApiPages.css";

ChartJS.register(ArcElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);

export type Station = {
  id: string;
  name: string;
  baseUrl: string;
  kind: string;
  status: string;
  lastSyncedAt?: number;
  lastError?: string;
};

export type UsageSummary = {
  todayInputTokens?: number;
  todayOutputTokens?: number;
  todayRequests?: number;
  totalRequests?: number;
  todaySpent?: number;
  todayLimit?: number;
  totalSpent?: number;
  totalLimit?: number;
  costsAreIsolated?: boolean;
};

export type KeyRow = {
  stationId: string;
  stationName: string;
  stationUrl: string;
  stationBalance?: number;
  groups: { name: string; multiplier?: number }[];
  models: string[];
  key: {
    id: string;
    name: string;
    maskedKey: string;
    group?: string;
    status: string;
    remainingQuota?: number;
    totalQuota?: number;
    unlimitedQuota?: boolean;
    currentConcurrency?: number;
    usedQuota?: number;
    todaySpent?: number;
    last30DaysSpent?: number;
    expiresAt?: number;
    createdAt?: number;
  };
};

export type AccountRow = {
  stationId: string;
  stationName: string;
  stationUrl: string;
  kind: string;
  syncStatus: string;
  lastSyncedAt?: number;
  account: {
    id: string;
    username: string;
    displayName: string;
    email?: string;
    group?: string;
    role: string;
    status: string;
    balance?: number;
  };
  usage: UsageSummary;
};

export type UsageLog = {
  id: string;
  stationId: string;
  stationName: string;
  stationUrl?: string;
  apiKeyName?: string;
  groupName?: string;
  endpoint?: string;
  ipAddress?: string;
  reasoningEffort?: string;
  billingType?: string;
  billingMode?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  actualCost: number;
  requestType: string;
  durationMs?: number;
  createdAt: number;
};

type RateRow = {
  stationId: string;
  stationName: string;
  stationUrl: string;
  lastSyncedAt?: number;
  syncStatus: string;
  rate: {
    group: string;
    model: string;
    multiplier: number;
    inputMultiplier?: number;
    outputMultiplier?: number;
  };
};

type KeyTableColumn = "station" | "name" | "apiKey" | "group" | "concurrency" | "usage" | "expires" | "status" | "created" | "actions";

const keyTableColumns: ReadonlyArray<{ key: KeyTableColumn; label: string }> = [
  { key: "station", label: "中转站" },
  { key: "name", label: "名称" },
  { key: "apiKey", label: "API 密钥" },
  { key: "group", label: "分组" },
  { key: "concurrency", label: "当前并发" },
  { key: "usage", label: "用量" },
  { key: "expires", label: "过期时间" },
  { key: "status", label: "状态" },
  { key: "created", label: "创建时间" },
  { key: "actions", label: "操作" },
];

const formatMoney = (value?: number) =>
  value == null ? "-" : `${value.toFixed(4)} 额度`;
const formatNumber = (value?: number) =>
  new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
const formatTime = (value?: number) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000)
    : "尚未同步";
const statusLabel = (value: string) =>
  (({ online: "正常", partial: "部分可用", error: "异常", connecting: "连接中" })[value] ?? value) || "未知";

function StatusBadge({ status }: { status: string }) {
  const tone = status === "online" ? "good" : status === "error" ? "bad" : "warn";
  return <span className={`sub2-status sub2-status-${tone}`}><i />{statusLabel(status)}</span>;
}

function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="sub2-page-header">
      <div><h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="sub2-page-actions">{actions}</div>}
    </div>
  );
}

function StatCard({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <article className="sub2-stat-card"><span className="sub2-stat-icon">{icon}</span><p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
}

type DashboardView = "overview" | "keys" | "usage";

function DashboardStatCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <article className={`sub2-dashboard-stat sub2-dashboard-stat-${tone}`}><span className="sub2-dashboard-stat-icon">{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}

export function Sub2Dashboard({ stations, keys, summary, usageRows, onRefresh, onNavigate }: { stations: Station[]; keys: KeyRow[]; summary: UsageSummary; usageRows: UsageLog[]; onRefresh: () => Promise<void>; onNavigate: (view: DashboardView) => void }) {
  const [startDate, setStartDate] = useState(todayInput(new Date(Date.now() - 6 * 86_400_000)));
  const [endDate, setEndDate] = useState(todayInput(new Date()));
  const [granularity, setGranularity] = useState<"day" | "hour">("day");
  const online = stations.filter((station) => station.status === "online").length;
  const latest = [...usageRows].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const records = usageRows.filter((row) => row.createdAt >= beginOfDay(startDate) && row.createdAt <= endOfDay(endDate));
  const totalTokens = records.reduce((total, row) => total + row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens, 0);
  const averageLatency = records.reduce((total, row) => total + (row.durationMs ?? 0), 0) / Math.max(1, records.filter((row) => row.durationMs != null).length);
  const modelMap = records.reduce((map, row) => {
    const model = row.model || "未知模型";
    const current = map.get(model) ?? { requests: 0, tokens: 0, cost: 0 };
    current.requests += 1;
    current.tokens += row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens;
    current.cost += row.actualCost;
    map.set(model, current);
    return map;
  }, new Map<string, { requests: number; tokens: number; cost: number }>());
  const models = [...modelMap.entries()].map(([model, value]) => ({ model, ...value })).sort((a, b) => b.tokens - a.tokens).slice(0, 8);
  const buckets = records.reduce((map, row) => {
    const date = new Date(row.createdAt * 1000);
    const key = granularity === "hour" ? `${date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} ${String(date.getHours()).padStart(2, "0")}:00` : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
    map.set(key, (map.get(key) ?? 0) + row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens);
    return map;
  }, new Map<string, number>());
  const trend = [...buckets.entries()].map(([label, tokens]) => ({ label, tokens })).slice(-18);
  const setRange = (days: number) => { setStartDate(todayInput(new Date(Date.now() - (days - 1) * 86_400_000))); setEndDate(todayInput(new Date())); };
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
  return <div className="sub2-page sub2-dashboard-page">
    <section className="sub2-dashboard-stat-grid">
      <DashboardStatCard icon={<DollarSign size={18} />} label="余额" value="-" detail="站点未提供可聚合余额" tone="blue" />
      <DashboardStatCard icon={<KeyRound size={18} />} label="API 密钥" value={String(keys.length)} detail={`${stations.length} 个已连接站点`} tone="emerald" />
      <DashboardStatCard icon={<Activity size={18} />} label="今日请求" value={formatNumber(summary.todayRequests)} detail={`累计 ${formatNumber(summary.totalRequests)} 次`} tone="amber" />
      <DashboardStatCard icon={<LayoutDashboard size={18} />} label="今日站点额度" value={formatMoney(summary.todaySpent)} detail={summary.costsAreIsolated ? "不同站点额度单位不汇总" : `累计 ${formatMoney(summary.totalSpent)}`} tone="purple" />
    </section>
    <section className="sub2-dashboard-stat-grid sub2-dashboard-stat-grid-secondary">
      <DashboardStatCard icon={<Database size={18} />} label="今日 Tokens" value={formatNumber((summary.todayInputTokens ?? 0) + (summary.todayOutputTokens ?? 0))} detail={`输入 ${formatNumber(summary.todayInputTokens)} / 输出 ${formatNumber(summary.todayOutputTokens)}`} tone="cyan" />
      <DashboardStatCard icon={<Database size={18} />} label="区间 Tokens" value={formatNumber(totalTokens)} detail={`${startDate} 至 ${endDate}`} tone="indigo" />
      <DashboardStatCard icon={<Gauge size={18} />} label="运行站点" value={`${online}/${stations.length}`} detail={online === stations.length ? "所有站点运行正常" : "存在需要处理的站点"} tone="violet" />
      <DashboardStatCard icon={<Clock3 size={18} />} label="平均响应" value={records.some((row) => row.durationMs != null) ? compactDuration(Math.round(averageLatency)) : "-"} detail="基于当前筛选使用记录" tone="rose" />
    </section>
    <section className="sub2-dashboard-controls">
      <div className="sub2-dashboard-date-fields"><label>开始日期<input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>结束日期<input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
      <div className="sub2-dashboard-control-actions"><div className="sub2-quick-range"><button onClick={() => setRange(1)}>今天</button><button onClick={() => setRange(7)}>7 天</button><button onClick={() => setRange(30)}>30 天</button></div><label className="sub2-granularity">粒度<select value={granularity} onChange={(event) => setGranularity(event.target.value as "day" | "hour")}><option value="day">按天</option><option value="hour">按小时</option></select></label><button className="button-secondary" title="刷新数据" onClick={() => void onRefresh()}><RefreshCw size={16} /></button></div>
    </section>
    <section className="sub2-dashboard-chart-grid">
      <article className="sub2-panel sub2-dashboard-chart-card"><div className="sub2-panel-heading"><div><h2>模型用量</h2><p>所选时间范围内的模型分布</p></div></div><div className="sub2-dashboard-distribution">{models.length ? <div className="sub2-dashboard-doughnut"><Doughnut data={{ labels: models.map((item) => item.model), datasets: [{ data: models.map((item) => item.tokens), backgroundColor: colors, borderWidth: 0 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} /></div> : <div className="sub2-dashboard-no-chart">暂无可用数据</div>}<div className="sub2-dashboard-model-table"><table><thead><tr><th>模型</th><th>请求</th><th>Tokens</th><th>实际费用</th></tr></thead><tbody>{models.map((item, index) => <tr key={item.model}><td><i style={{ background: colors[index] }} />{item.model}</td><td>{formatNumber(item.requests)}</td><td>{formatNumber(item.tokens)}</td><td>{formatMoney(item.cost)}</td></tr>)}{!models.length && <tr><td colSpan={4}>暂无使用记录</td></tr>}</tbody></table></div></div></article>
      <article className="sub2-panel sub2-dashboard-chart-card"><div className="sub2-panel-heading"><div><h2>Token 使用趋势</h2><p>{granularity === "day" ? "按天" : "按小时"}汇总</p></div></div><div className="sub2-dashboard-line">{trend.length ? <Line data={{ labels: trend.map((item) => item.label), datasets: [{ data: trend.map((item) => item.tokens), fill: true, borderColor: "#2563eb", backgroundColor: "rgba(37, 99, 235, .10)", pointRadius: 2, tension: .35 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: { beginAtZero: true, ticks: { callback: (value) => formatNumber(Number(value)) } } } }} /> : <div className="sub2-dashboard-no-chart">暂无可用数据</div>}</div></article>
    </section>
    <section className="sub2-dashboard-bottom-grid"><article className="sub2-panel sub2-dashboard-recent"><div className="sub2-panel-heading"><h2>最近使用记录</h2><span className="sub2-muted">最近 7 天</span></div><div className="sub2-dashboard-recent-list">{latest.map((row) => <div key={row.id} className="sub2-dashboard-recent-row"><span className="sub2-dashboard-recent-icon"><Zap size={18} /></span><div><strong>{row.model || "未知模型"}</strong><small>{formatTime(row.createdAt)}</small></div><div><strong>{formatMoney(row.actualCost)}</strong><small>{formatNumber(row.inputTokens + row.outputTokens)} Tokens</small></div></div>)}{!latest.length && <EmptyState message="暂无使用记录。" />}</div><button className="sub2-dashboard-link" onClick={() => onNavigate("usage")}>查看全部使用记录 <ArrowRight size={16} /></button></article><article className="sub2-panel sub2-dashboard-actions"><div className="sub2-panel-heading"><h2>快捷操作</h2></div><div><button onClick={() => onNavigate("keys")}><span className="sub2-dashboard-action-icon key"><KeyRound size={20} /></span><span><strong>创建 API 密钥</strong><small>生成并管理新的访问密钥</small></span><ArrowRight size={17} /></button><button onClick={() => onNavigate("usage")}><span className="sub2-dashboard-action-icon usage"><Activity size={20} /></span><span><strong>查看使用记录</strong><small>检查详细的调用和费用</small></span><ArrowRight size={17} /></button></div></article></section>
  </div>;
}

function EmptyState({ message }: { message: string }) { return <div className="sub2-empty"><TriangleAlert size={22} /><span>{message}</span></div>; }

export function Sub2ApiKeys({ rows, stations, onUpdated, setError }: { rows: KeyRow[]; stations: Station[]; onUpdated: () => Promise<void>; setError: (message: string) => void }) {
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [status, setStatus] = useState("all");
  const [showColumns, setShowColumns] = useState(false);
  const [visible, setVisible] = useState<Record<KeyTableColumn, boolean>>({ station: true, name: true, apiKey: true, group: true, concurrency: true, usage: true, expires: true, status: true, created: true, actions: true });
  const [saving, setSaving] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState<{ row?: KeyRow } | null>(null);
  const filtered = rows.filter((row) => {
    const active = row.key.status === "active" || row.key.status === "有效";
    return (station === "all" || row.stationId === station) && (status === "all" || (status === "active" ? active : !active)) && `${row.stationName} ${row.key.name} ${row.key.maskedKey} ${row.key.group ?? ""}`.toLowerCase().includes(query.toLowerCase());
  });
  const reveal = async (row: KeyRow) => {
    try {
      const key = await invoke<string>("reveal_key", { stationId: row.stationId, keyId: row.key.id });
      await navigator.clipboard.writeText(key);
      window.setTimeout(() => void navigator.clipboard.writeText(""), 30_000);
    } catch (reason) { setError(String(reason)); }
  };
  const changeGroup = async (row: KeyRow, group: string) => {
    if (group === row.key.group) return;
    const id = `${row.stationId}:${row.key.id}`;
    setSaving(id);
    try {
      if (isTauri()) await invoke("update_key_group", { stationId: row.stationId, keyId: row.key.id, group });
      await onUpdated();
    } catch (reason) { setError(String(reason)); } finally { setSaving(null); }
  };
  const toggleStatus = async (row: KeyRow) => {
    const id = `${row.stationId}:${row.key.id}`;
    setSaving(id);
    try {
      await invoke("update_api_key", { request: { stationId: row.stationId, keyId: row.key.id, status: row.key.status === "active" || row.key.status === "有效" ? "inactive" : "active" } });
      await onUpdated();
    } catch (reason) { setError(String(reason)); } finally { setSaving(null); }
  };
  const importToCcSwitch = async (row: KeyRow) => {
    try { await invoke("import_to_cc_switch", { stationId: row.stationId, keyId: row.key.id, targetApp: "codex" }); }
    catch (reason) { setError(String(reason)); }
  };
  const remove = async (row: KeyRow) => {
    if (!(await confirm({ title: "删除 API 密钥", description: `确定删除“${row.key.name || row.key.id}”吗？此操作无法撤销。`, confirmLabel: "删除", destructive: true }))) return;
    try { await invoke("delete_api_key", { stationId: row.stationId, keyId: row.key.id }); await onUpdated(); } catch (reason) { setError(String(reason)); }
  };
  const refresh = async () => {
    setRefreshing(true);
    try { await onUpdated(); }
    finally { setRefreshing(false); }
  };
  const hiddenColumns = keyTableColumns.filter(({ key }) => !visible[key]).map(({ key }) => `sub2-key-column-hidden-${key}`).join(" ");
  return <div className="sub2-page sub2-keys-page">
    <section className="sub2-key-page-toolbar">
      <div className="sub2-key-filters"><label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索密钥名称、站点或分组" /></label><select aria-label="站点筛选" value={station} onChange={(event) => setStation(event.target.value)}><option value="all">全部站点</option>{stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select aria-label="状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">启用</option><option value="inactive">停用</option></select></div>
      <div className="sub2-key-actions"><button className="button-secondary" title="刷新" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} /></button><div className="sub2-column-menu"><button className="button-secondary" title="列设置" onClick={() => setShowColumns((value) => !value)}><Columns3 size={16} /><span>列设置</span></button>{showColumns && <div className="sub2-menu">{keyTableColumns.map(({ key, label }) => <label key={key}><input type="checkbox" checked={visible[key]} onChange={() => setVisible((value) => ({ ...value, [key]: !value[key] }))} />{label}</label>)}</div>}</div><button className="button-primary" onClick={() => setEditor({})}><Plus size={16} />新建密钥</button></div>
    </section>
    <DataTable className="sub2-panel sub2-table-panel">
      <div className={`sub2-desktop-table sub2-key-data-table ${hiddenColumns}`}><table><thead><tr><th>中转站</th><th>名称</th><th>API 密钥</th><th>分组</th><th>当前并发</th><th>用量</th><th>过期时间</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{filtered.map((row) => { const totalQuota = row.key.totalQuota ?? ((row.key.remainingQuota ?? 0) + (row.key.usedQuota ?? 0)); return <tr key={`${row.stationId}:${row.key.id}`}><td className="sub2-key-station"><strong>{row.stationName}</strong><small>{row.stationUrl}</small></td><td><strong>{row.key.name || "未命名密钥"}</strong></td><td><div className="sub2-key-code"><code>{row.key.maskedKey || "已隐藏"}</code><button title="复制 API 密钥" className="sub2-copy-key" onClick={() => void reveal(row)}><Copy size={15} /></button></div></td><td><select className="sub2-group-select sub2-key-group-select" value={row.key.group ?? "default"} disabled={saving === `${row.stationId}:${row.key.id}`} onChange={(event) => void changeGroup(row, event.target.value)}>{(row.groups.length ? row.groups : [{ name: row.key.group ?? "default" }]).map((group) => <option key={group.name}>{group.name}</option>)}</select></td><td><span className={`sub2-concurrency ${row.key.currentConcurrency ? "active" : ""}`}>{row.key.currentConcurrency ?? 0}</span></td><td><div className="sub2-key-usage"><div><span>今日：</span><strong>{formatMoney(row.key.todaySpent)}</strong></div><div><span>总计：</span><strong>{formatMoney(row.key.last30DaysSpent ?? row.key.usedQuota)}</strong></div>{row.key.unlimitedQuota ? <div className="sub2-key-quota"><span>额度：</span><strong>不限额</strong></div> : row.key.remainingQuota != null && <div className="sub2-key-quota"><div><span>额度：</span><strong>{formatMoney(row.key.usedQuota)} / {formatMoney(totalQuota)}</strong></div><i><b style={{ width: `${Math.min(((row.key.usedQuota ?? 0) / Math.max(0.0001, totalQuota)) * 100, 100)}%` }} /></i></div>}</div></td><td>{row.key.expiresAt ? formatTime(row.key.expiresAt) : "永不过期"}</td><td><StatusBadge status={row.key.status === "有效" || row.key.status === "active" ? "online" : "partial"} /></td><td>{formatTime(row.key.createdAt)}</td><td><div className="sub2-key-row-actions"><button className="use" title="使用密钥" onClick={() => void reveal(row)}><Terminal size={15} /><span>使用</span></button><button className="import" title="导入 CC Switch" onClick={() => void importToCcSwitch(row)}><Upload size={15} /><span>导入</span></button><button className="toggle" title={row.key.status === "有效" || row.key.status === "active" ? "停用密钥" : "启用密钥"} onClick={() => void toggleStatus(row)} disabled={saving === `${row.stationId}:${row.key.id}`}>{row.key.status === "有效" || row.key.status === "active" ? <Ban size={15} /> : <Check size={15} />}<span>{row.key.status === "有效" || row.key.status === "active" ? "停用" : "启用"}</span></button><button className="edit" title="编辑密钥" onClick={() => setEditor({ row })}><Pencil size={15} /><span>编辑</span></button><button className="delete" title="删除密钥" onClick={() => void remove(row)}><Trash2 size={15} /><span>删除</span></button></div></td></tr>})}{!filtered.length && <tr><td colSpan={10}><EmptyState message="没有符合筛选条件的 API 密钥。" /></td></tr>}</tbody></table></div>
      <div className="sub2-mobile-cards">{filtered.map((row) => <article className="sub2-record-card" key={`${row.stationId}:${row.key.id}`}><div><strong>{row.key.name || "未命名密钥"}</strong><StatusBadge status={row.key.status === "有效" || row.key.status === "active" ? "online" : "partial"} /></div><code>{row.key.maskedKey || "已隐藏"}</code><dl><div><dt>来源</dt><dd>{row.stationName}</dd></div><div><dt>网址</dt><dd>{row.stationUrl}</dd></div><div><dt>分组</dt><dd>{row.key.group || "default"}</dd></div><div><dt>今日消费</dt><dd>{formatMoney(row.key.todaySpent)}</dd></div><div><dt>额度</dt><dd>{formatMoney(row.key.remainingQuota)}</dd></div></dl><div className="sub2-card-actions"><button className="button-secondary" onClick={() => void reveal(row)}><Clipboard size={16} />复制</button><button className="button-secondary" onClick={() => setEditor({ row })}><Pencil size={16} />编辑</button><button className="sub2-icon-action sub2-danger-action" onClick={() => void remove(row)}><Trash2 size={16} /></button></div></article>)}{!filtered.length && <EmptyState message="没有符合筛选条件的 API 密钥。" />}</div>
    </DataTable>
    {editor && <ApiKeyEditor row={editor.row} rows={rows} stations={stations} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await onUpdated(); }} setError={setError} />}
  </div>;
}

export function Sub2Accounts({ rows, stations, onRefresh, onOpenStation, onAdd }: { rows: AccountRow[]; stations: Station[]; onRefresh: () => Promise<void>; onOpenStation: (url: string) => Promise<void> | void; onAdd: () => void }) {
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const filtered = rows.filter((row) =>
    (station === "all" || row.stationId === station) &&
    `${row.stationName} ${row.account.username} ${row.account.displayName} ${row.account.email ?? ""} ${row.account.group ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); }
    finally { setRefreshing(false); }
  };
  return <div className="sub2-page sub2-keys-page">
    <section className="sub2-key-page-toolbar">
      <div className="sub2-key-filters"><label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索站点账户、站点、邮箱或分组" /></label><select aria-label="站点筛选" value={station} onChange={(event) => setStation(event.target.value)}><option value="all">全部站点</option>{stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
      <div className="sub2-key-actions"><button className="button-secondary" title="刷新站点账户" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} /><span>刷新</span></button><button className="button-primary" onClick={onAdd}><Plus size={16} />添加站点</button></div>
    </section>
    <DataTable className="sub2-panel sub2-table-panel">
      <div className="sub2-desktop-table sub2-key-data-table"><table><thead><tr><th>中转站</th><th>账户</th><th>邮箱</th><th>分组</th><th>角色</th><th>账户状态</th><th>站点余额</th><th>今日请求</th><th>总请求</th><th>同步状态</th><th>同步时间</th><th>操作</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.stationId}><td className="sub2-key-station"><strong>{row.stationName}</strong><small>{row.stationUrl}</small></td><td><strong>{row.account.displayName || row.account.username || "未命名账户"}</strong><small>{row.account.id ? `ID: ${row.account.id}` : "-"}</small></td><td>{row.account.email || "-"}</td><td>{row.account.group || "-"}</td><td>{row.account.role || "-"}</td><td>{row.account.status || "-"}</td><td>{formatMoney(row.account.balance)}</td><td>{formatNumber(row.usage.todayRequests)}</td><td>{formatNumber(row.usage.totalRequests)}</td><td><StatusBadge status={row.syncStatus} /></td><td>{formatTime(row.lastSyncedAt)}</td><td><button className="button-secondary whitespace-nowrap" onClick={() => void onOpenStation(row.stationUrl)}><Server size={15} />打开站点</button></td></tr>)}{!filtered.length && <tr><td colSpan={12}><EmptyState message="暂无已同步的站点账户。请先刷新站点。" /></td></tr>}</tbody></table></div>
      <div className="sub2-mobile-cards">{filtered.map((row) => <article className="sub2-record-card" key={row.stationId}><div><strong>{row.account.displayName || row.account.username || "未命名账户"}</strong><StatusBadge status={row.syncStatus} /></div><small>{row.stationName}</small><dl><div><dt>邮箱</dt><dd>{row.account.email || "-"}</dd></div><div><dt>分组</dt><dd>{row.account.group || "-"}</dd></div><div><dt>角色</dt><dd>{row.account.role || "-"}</dd></div><div><dt>余额</dt><dd>{formatMoney(row.account.balance)}</dd></div><div><dt>今日请求</dt><dd>{formatNumber(row.usage.todayRequests)}</dd></div></dl><div className="sub2-card-actions"><button className="button-secondary" onClick={() => void onOpenStation(row.stationUrl)}><Server size={16} />打开站点</button></div></article>)}{!filtered.length && <EmptyState message="暂无已同步的站点账户。请先刷新站点。" />}</div>
    </DataTable>
  </div>;
}

type RateTableColumn = "model" | "station" | "group" | "multiplier" | "input" | "output" | "synced";
type RateSortKey = "model" | "multiplier" | "input" | "output" | "synced";

const rateTableColumns: ReadonlyArray<{ key: RateTableColumn; label: string }> = [
  { key: "model", label: "模型" },
  { key: "station", label: "中转站" },
  { key: "group", label: "分组" },
  { key: "multiplier", label: "计费倍率" },
  { key: "input", label: "输入倍率" },
  { key: "output", label: "输出倍率" },
  { key: "synced", label: "同步时间" },
];

const isDefaultRate = (row: RateRow) => row.rate.model === "全部模型";
const rateModelLabel = (row: RateRow) => isDefaultRate(row) ? "全模型默认" : row.rate.model;
const formatRatePrice = (value?: number) => value == null ? "-" : `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)}/M`;

export function Sub2Rates({ rows, stations, unavailableStationCount, onRefresh, onOpenStation }: { rows: RateRow[]; stations: Station[]; unavailableStationCount: number; onRefresh: () => Promise<void>; onOpenStation: (url: string) => void | Promise<void> }) {
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState<RateSortKey>("model");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [showColumns, setShowColumns] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [visible, setVisible] = useState<Record<RateTableColumn, boolean>>({ model: true, station: true, group: true, multiplier: true, input: true, output: true, synced: true });
  const hasSplitMultiplier = rows.some((row) => row.rate.inputMultiplier != null || row.rate.outputMultiplier != null);
  const groups = Array.from(new Set(rows.map((row) => row.rate.group))).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const filtered = rows.filter((row) => (station === "all" || row.stationId === station) && (group === "all" || row.rate.group === group) && rateModelLabel(row).toLowerCase().includes(query.toLowerCase()));
  const sorted = [...filtered].sort((left, right) => {
    if (sort === "model") return Number(isDefaultRate(left)) - Number(isDefaultRate(right)) || rateModelLabel(left).localeCompare(rateModelLabel(right), "zh-CN") || left.rate.multiplier - right.rate.multiplier || left.stationName.localeCompare(right.stationName, "zh-CN");
    const leftValue = sort === "multiplier" ? left.rate.multiplier : sort === "input" ? left.rate.inputMultiplier : sort === "output" ? left.rate.outputMultiplier : left.lastSyncedAt;
    const rightValue = sort === "multiplier" ? right.rate.multiplier : sort === "input" ? right.rate.inputMultiplier : sort === "output" ? right.rate.outputMultiplier : right.lastSyncedAt;
    const compared = leftValue == null ? (rightValue == null ? 0 : 1) : rightValue == null ? -1 : leftValue - rightValue;
    return compared * (sortDirection === "asc" ? 1 : -1) || rateModelLabel(left).localeCompare(rateModelLabel(right), "zh-CN");
  });
  const tableColumns = rateTableColumns.filter(({ key }) => hasSplitMultiplier || (key !== "input" && key !== "output"));
  const hiddenColumns = tableColumns.filter(({ key }) => !visible[key]).map(({ key }) => `sub2-rate-column-hidden-${key}`).join(" ");
  const refresh = async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } };
  const selectSort = (key: RateSortKey) => { setSortDirection((direction) => sort === key ? (direction === "asc" ? "desc" : "asc") : "asc"); setSort(key); };
  const sortIcon = (key: RateSortKey) => sort !== key ? <ArrowDownUp size={14} /> : sortDirection === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
  return <div className="sub2-page sub2-keys-page sub2-rates-page">
    <header className="sub2-rate-header"><div><h1>模型倍率</h1><p>已同步 {new Set(rows.map((row) => row.stationId)).size} 个站点 / {rows.length} 条记录</p></div>{unavailableStationCount > 0 && <p className="sub2-rate-unavailable">{unavailableStationCount} 个站点暂无可用倍率数据</p>}</header>
    <section className="sub2-key-page-toolbar">
      <div className="sub2-key-filters"><select aria-label="站点筛选" value={station} onChange={(event) => setStation(event.target.value)}><option value="all">全部站点</option>{stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select aria-label="分组筛选" value={group} onChange={(event) => setGroup(event.target.value)}><option value="all">全部分组</option>{groups.map((item) => <option value={item} key={item}>{item}</option>)}</select><label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型" /></label><select aria-label="排序" value={sort} onChange={(event) => { setSort(event.target.value as RateSortKey); setSortDirection("asc"); }}><option value="model">模型，再按倍率从低到高</option><option value="multiplier">计费倍率从低到高</option><option value="input">输入价格从低到高</option><option value="output">输出价格从低到高</option><option value="synced">同步时间最早</option></select></div>
      <div className="sub2-key-actions"><button className="button-secondary" title="刷新" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} /></button><div className="sub2-column-menu"><button className="button-secondary" title="列设置" onClick={() => setShowColumns((value) => !value)}><Columns3 size={16} /><span>列设置</span></button>{showColumns && <div className="sub2-menu">{tableColumns.map(({ key, label }) => <label key={key}><input type="checkbox" checked={visible[key]} onChange={() => setVisible((current) => ({ ...current, [key]: !current[key] }))} />{label}</label>)}</div>}</div></div>
    </section>
    <DataTable className="sub2-panel sub2-table-panel">
      <div className={`sub2-desktop-table sub2-key-data-table sub2-rate-data-table ${hiddenColumns}`}><table><thead><tr>{tableColumns.map(({ key, label }) => { const sortable = key === "multiplier" || key === "input" || key === "output"; return <th key={key} aria-sort={sort === key ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}>{sortable ? <button className="sub2-rate-sort-button" onClick={() => selectSort(key)} title={`按${label}排序`}><span>{label}</span>{sortIcon(key)}</button> : label}</th>; })}</tr></thead><tbody>{sorted.map((row) => <tr key={`${row.stationId}-${row.rate.group}-${row.rate.model}`}><td><strong>{rateModelLabel(row)}</strong></td><td><button className="sub2-rate-station" title={row.stationUrl} onClick={() => void onOpenStation(row.stationUrl)}><strong>{row.stationName}</strong><small>{row.stationUrl}</small></button></td><td><span className="sub2-request-type">{row.rate.group}</span></td><td className="sub2-rate-value">{row.rate.multiplier.toFixed(3)}x</td>{hasSplitMultiplier && <><td className="sub2-rate-value">{formatRatePrice(row.rate.inputMultiplier)}</td><td className="sub2-rate-value">{formatRatePrice(row.rate.outputMultiplier)}</td></>}<td><StatusBadge status={row.syncStatus ?? "partial"} /><small>{formatTime(row.lastSyncedAt)}</small></td></tr>)}{!sorted.length && <tr><td colSpan={tableColumns.length}><EmptyState message="没有符合筛选条件的倍率数据。" /></td></tr>}</tbody></table></div>
      <div className="sub2-mobile-cards">{sorted.map((row) => <article className="sub2-record-card" key={`${row.stationId}-${row.rate.group}-${row.rate.model}`}><div><strong>{rateModelLabel(row)}</strong><span className="sub2-request-type">{row.rate.group}</span></div><small>{row.stationName}</small><dl><div><dt>计费倍率</dt><dd>{row.rate.multiplier.toFixed(3)}x</dd></div>{hasSplitMultiplier && <><div><dt>输入</dt><dd>{formatRatePrice(row.rate.inputMultiplier)}</dd></div><div><dt>输出</dt><dd>{formatRatePrice(row.rate.outputMultiplier)}</dd></div></>}<div><dt>同步时间</dt><dd>{formatTime(row.lastSyncedAt)}</dd></div></dl></article>)}{!sorted.length && <EmptyState message="没有符合筛选条件的倍率数据。" />}</div>
    </DataTable>
  </div>;
}

function ApiKeyEditor({ row, rows, stations, onClose, onSaved, setError }: { row?: KeyRow; rows: KeyRow[]; stations: Station[]; onClose: () => void; onSaved: () => Promise<void>; setError: (message: string) => void }) {
  const [stationId, setStationId] = useState(row?.stationId ?? stations[0]?.id ?? "");
  const [name, setName] = useState(row?.key.name ?? "");
  const [group, setGroup] = useState(row?.key.group ?? "");
  const [quota, setQuota] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const initialStatus = row?.key.status === "inactive" ? "inactive" : "active";
  const [status, setStatus] = useState(initialStatus);
  const [whitelist, setWhitelist] = useState("");
  const [blacklist, setBlacklist] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [useCustomKey, setUseCustomKey] = useState(false);
  const [enableIpRestriction, setEnableIpRestriction] = useState(false);
  const [enableRateLimit, setEnableRateLimit] = useState(false);
  const [rateLimit5h, setRateLimit5h] = useState("");
  const [rateLimit1d, setRateLimit1d] = useState("");
  const [rateLimit7d, setRateLimit7d] = useState("");
  const [enableExpiration, setEnableExpiration] = useState(Boolean(row?.key.expiresAt));
  const [saving, setSaving] = useState(false);
  const isNewApi = stations.find((station) => station.id === stationId)?.kind === "newapi";
  const stationRows = rows.filter((item) => item.stationId === stationId);
  const fallbackGroups = Array.from(new Set(stationRows.flatMap((item) => item.groups.map((entry) => entry.name))));
  const [groups, setGroups] = useState(fallbackGroups);

  useEffect(() => {
    let active = true;
    setGroups(fallbackGroups);
    if (!stationId || !isTauri()) return () => { active = false; };
    void invoke<{ name: string }[]>("list_station_groups", { stationId })
      .then((result) => {
        if (active) setGroups(result.map((entry) => entry.name));
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => { active = false; };
  }, [stationId, rows, setError]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stationId || !name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        stationId,
        keyId: row?.key.id,
        name: name.trim(),
        group: group || null,
        customKey: !row && useCustomKey ? customKey.trim() || null : null,
        quota: quota.trim() ? Number(quota) : null,
        expiresInDays: enableExpiration && expiresInDays.trim() ? Number(expiresInDays) : null,
        status: row && status === initialStatus ? null : status,
        ipWhitelist: enableIpRestriction ? whitelist.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) : null,
        ipBlacklist: enableIpRestriction ? blacklist.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) : null,
        rateLimit5h: enableRateLimit && rateLimit5h.trim() ? Number(rateLimit5h) : null,
        rateLimit1d: enableRateLimit && rateLimit1d.trim() ? Number(rateLimit1d) : null,
        rateLimit7d: enableRateLimit && rateLimit7d.trim() ? Number(rateLimit7d) : null,
      };
      await invoke(row ? "update_api_key" : "create_api_key", { request: payload });
      await onSaved();
    } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };
  const setExpirationPreset = (days: string) => { setExpiresInDays(days); setEnableExpiration(true); };
  return <FormDialog title={row ? "编辑 API 密钥" : "创建 API 密钥"} ariaLabel={row ? "编辑 API 密钥" : "创建 API 密钥"} onClose={onClose} onSubmit={submit} className="sub2-source-key-dialog" contentClassName="sub2-dialog-body" footer={<><button className="button-secondary form-dialog-cancel" type="button" onClick={onClose} disabled={saving}>取消</button><button className="button-primary form-dialog-submit" disabled={saving || !stationId || !name.trim()}>{saving ? <RefreshCw size={16} className="sub2-spin" /> : null}{row ? "保存" : "创建"}</button></>}>
    {!row && <label>来源站点<select value={stationId} disabled={saving} onChange={(event) => { setStationId(event.target.value); setGroup(""); }}>{stations.map((station) => <option value={station.id} key={station.id}>{station.name} · {station.baseUrl}</option>)}</select></label>}
    <label>密钥名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入密钥名称" /></label>
    <label>分组<select value={group} onChange={(event) => setGroup(event.target.value)}><option value="">请选择分组</option>{groups.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
    {!row && !isNewApi && <section className="sub2-editor-section"><ToggleRow label="自定义密钥" checked={useCustomKey} onChange={setUseCustomKey} />{useCustomKey && <><input value={customKey} onChange={(event) => setCustomKey(event.target.value)} className="sub2-mono-input" placeholder="请输入自定义密钥" /><small>至少 8 个字符，仅允许字母、数字、连字符和下划线。</small></>}</section>}
    {row && <label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">启用</option><option value="inactive">停用</option></select></label>}
    <section className="sub2-editor-section"><ToggleRow label="IP 限制" checked={enableIpRestriction} onChange={setEnableIpRestriction} />{enableIpRestriction && <div className="sub2-editor-stack"><label>IP 白名单<textarea value={whitelist} onChange={(event) => setWhitelist(event.target.value)} placeholder="每行一个 IP 地址" /></label>{!isNewApi && <label>IP 黑名单<textarea value={blacklist} onChange={(event) => setBlacklist(event.target.value)} placeholder="每行一个 IP 地址" /></label>}{isNewApi && <small>该 NewAPI 站点仅支持 IP 白名单。</small>}</div>}</section>
    <section className="sub2-editor-section"><label>额度上限<div className="sub2-money-input"><span>额度</span><input value={quota} inputMode="decimal" onChange={(event) => setQuota(event.target.value)} placeholder="0" /></div><small>填写 0 或留空表示不限制额度。</small></label>{row?.key.usedQuota != null && <div className="sub2-editor-readonly"><span>已用额度</span><strong>{formatMoney(row.key.usedQuota)} / {formatMoney((row.key.usedQuota ?? 0) + (row.key.remainingQuota ?? 0))}</strong></div>}</section>
    {!isNewApi && <section className="sub2-editor-section"><ToggleRow label="费率限制" checked={enableRateLimit} onChange={setEnableRateLimit} />{enableRateLimit && <div className="sub2-editor-rate-grid"><label>5 小时<div className="sub2-money-input"><span>额度</span><input value={rateLimit5h} inputMode="decimal" onChange={(event) => setRateLimit5h(event.target.value)} placeholder="0" /></div></label><label>1 天<div className="sub2-money-input"><span>额度</span><input value={rateLimit1d} inputMode="decimal" onChange={(event) => setRateLimit1d(event.target.value)} placeholder="0" /></div></label><label>7 天<div className="sub2-money-input"><span>额度</span><input value={rateLimit7d} inputMode="decimal" onChange={(event) => setRateLimit7d(event.target.value)} placeholder="0" /></div></label></div>}</section>}
    <section className="sub2-editor-section"><ToggleRow label="过期时间" checked={enableExpiration} onChange={setEnableExpiration} />{enableExpiration && <div className="sub2-editor-stack"><div className="sub2-expiration-presets">{["7", "30", "90"].map((days) => <button type="button" className={expiresInDays === days ? "active" : ""} onClick={() => setExpirationPreset(days)} key={days}>{days} 天</button>)}<button type="button" className={!['7', '30', '90'].includes(expiresInDays) ? "active" : ""} onClick={() => setExpiresInDays("")}>自定义</button></div><label>有效期（天）<input value={expiresInDays} inputMode="numeric" onChange={(event) => setExpiresInDays(event.target.value)} placeholder="请输入天数" /></label></div>}</section>
  </FormDialog>;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="sub2-toggle-row"><span>{label}</span><button className={checked ? "active" : ""} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><i /></button></div>;
}

type UsageMetric = "tokens" | "cost";
type UsageColumns = Record<"key" | "model" | "reasoning" | "endpoint" | "ip" | "source" | "group" | "type" | "billing" | "tokens" | "cost" | "latency" | "time", boolean>;

const todayInput = (date: Date) => date.toISOString().slice(0, 10);
const beginOfDay = (date: string) => new Date(`${date}T00:00:00`).getTime() / 1000;
const endOfDay = (date: string) => new Date(`${date}T23:59:59`).getTime() / 1000;
const compactDuration = (value?: number) => value == null ? "-" : value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
const optionValues = (values: Array<string | undefined>) => Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();

export function Sub2Usage({ rows, stations, onRefresh }: { rows: UsageLog[]; stations: Station[]; onRefresh: () => Promise<void> }) {
  const now = new Date();
  const [startDate, setStartDate] = useState(todayInput(new Date(now.getTime() - 86_400_000)));
  const [endDate, setEndDate] = useState(todayInput(now));
  const [granularity, setGranularity] = useState<"hour" | "day">("hour");
  const [stationId, setStationId] = useState("all");
  const [apiKey, setApiKey] = useState("all");
  const [model, setModel] = useState("all");
  const [group, setGroup] = useState("all");
  const [requestType, setRequestType] = useState("all");
  const [billingType, setBillingType] = useState("all");
  const [billingMode, setBillingMode] = useState("all");
  const [metric, setMetric] = useState<Record<"model" | "group" | "endpoint", UsageMetric>>({ model: "tokens", group: "tokens", endpoint: "tokens" });
  const [showColumns, setShowColumns] = useState(false);
  const [columns, setColumns] = useState<UsageColumns>({ key: true, model: true, reasoning: true, endpoint: true, ip: true, source: true, group: true, type: true, billing: true, tokens: true, cost: true, latency: true, time: true });
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const filtered = rows.filter((row) => row.createdAt >= beginOfDay(startDate) && row.createdAt <= endOfDay(endDate) && (stationId === "all" || row.stationId === stationId) && (apiKey === "all" || row.apiKeyName === apiKey) && (model === "all" || row.model === model) && (group === "all" || row.groupName === group) && (requestType === "all" || row.requestType === requestType) && (billingType === "all" || row.billingType === billingType) && (billingMode === "all" || row.billingMode === billingMode));
  const totals = filtered.reduce((value, row) => ({ requests: value.requests + 1, input: value.input + row.inputTokens, output: value.output + row.outputTokens, cacheCreate: value.cacheCreate + row.cacheCreationTokens, cacheRead: value.cacheRead + row.cacheReadTokens, cost: value.cost + row.actualCost, duration: value.duration + (row.durationMs ?? 0), timed: value.timed + Number(row.durationMs != null) }), { requests: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0, duration: 0, timed: 0 });
  const totalTokens = totals.input + totals.output + totals.cacheCreate + totals.cacheRead;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const activePage = Math.min(page, pages);
  const pageRows = filtered.slice((activePage - 1) * pageSize, activePage * pageSize);
  const reset = () => { setStationId("all"); setApiKey("all"); setModel("all"); setGroup("all"); setRequestType("all"); setBillingType("all"); setBillingMode("all"); setPage(1); };
  const exportCsv = () => {
    const headings = ["API 密钥", "模型", "推理强度", "端点", "IP", "来源站点", "来源网址", "分组", "类型", "计费类型", "计费模式", "输入 Token", "输出 Token", "缓存创建", "缓存读取", "费用", "延迟(ms)", "时间"];
    const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = filtered.map((row) => [row.apiKeyName, row.model, row.reasoningEffort, row.endpoint, row.ipAddress, row.stationName, row.stationUrl, row.groupName, row.requestType, row.billingType, row.billingMode, row.inputTokens, row.outputTokens, row.cacheCreationTokens, row.cacheReadTokens, row.actualCost, row.durationMs, formatTime(row.createdAt)].map(quote).join(","));
    const file = new Blob([`\ufeff${headings.map(quote).join(",")}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file); const link = document.createElement("a"); link.href = url; link.download = `usage_${startDate}_${endDate}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const selectProps = (value: string, setValue: (value: string) => void) => ({ value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { setValue(event.target.value); setPage(1); } });
  return <div className="sub2-page sub2-usage-page">
    <PageHeader title="使用记录" description="按时间、来源站点及请求属性分析已同步的 API 调用。" actions={<button className="button-secondary" onClick={() => void onRefresh()}><RefreshCw size={16} />刷新</button>} />
    <section className="sub2-stat-grid sub2-usage-stat-grid"><StatCard icon={<Activity size={18} />} label="总请求数" value={formatNumber(totals.requests)} note="所选范围内" /><StatCard icon={<LayoutDashboard size={18} />} label="总 Token" value={formatNumber(totalTokens)} note={`输入 ${formatNumber(totals.input)} / 输出 ${formatNumber(totals.output)}`} /><StatCard icon={<Activity size={18} />} label="总消费" value={formatMoney(totals.cost)} note="实际消费" /><StatCard icon={<Timer size={18} />} label="平均耗时" value={compactDuration(totals.timed ? totals.duration / totals.timed : undefined)} note="有延迟记录的请求" /></section>
    <section className="sub2-panel sub2-range-bar"><div className="sub2-range-controls"><label>时间范围<input type="date" value={startDate} max={endDate} onChange={(event) => { setStartDate(event.target.value); setPage(1); }} /></label><span>至</span><label className="sr-only">结束日期<input type="date" value={endDate} min={startDate} onChange={(event) => { setEndDate(event.target.value); setPage(1); }} /></label><div className="sub2-quick-range">{[[1, "近 24 小时"], [7, "近 7 天"], [30, "近 30 天"]].map(([days, label]) => <button key={String(days)} onClick={() => { const end = new Date(); setEndDate(todayInput(end)); setStartDate(todayInput(new Date(end.getTime() - (Number(days) - 1) * 86_400_000))); setGranularity(Number(days) <= 1 ? "hour" : "day"); setPage(1); }}>{label}</button>)}</div></div><label className="sub2-granularity">粒度<select value={granularity} onChange={(event) => setGranularity(event.target.value as "hour" | "day")}><option value="hour">按小时</option><option value="day">按天</option></select></label></section>
    <section className="sub2-chart-grid"><UsageDistribution title="模型分布" rows={filtered} resolve={(row) => row.model || "未知模型"} metric={metric.model} onMetric={(value) => setMetric((current) => ({ ...current, model: value }))} /><UsageDistribution title="分组使用分布" rows={filtered} resolve={(row) => row.groupName || "未标注分组"} metric={metric.group} onMetric={(value) => setMetric((current) => ({ ...current, group: value }))} /><UsageDistribution title="端点分布" rows={filtered} resolve={(row) => row.endpoint || "未标注端点"} metric={metric.endpoint} onMetric={(value) => setMetric((current) => ({ ...current, endpoint: value }))} /><UsageTrend rows={filtered} granularity={granularity} /></section>
    <section className="sub2-panel sub2-filter-panel"><div className="sub2-filter-grid"><FilterSelect label="来源站点" {...selectProps(stationId, setStationId)}><option value="all">全部站点</option>{stations.map((station) => <option value={station.id} key={station.id}>{station.name}</option>)}</FilterSelect><FilterSelect label="API 密钥" {...selectProps(apiKey, setApiKey)}><option value="all">全部 API 密钥</option>{optionValues(rows.map((row) => row.apiKeyName)).map((value) => <option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="模型" {...selectProps(model, setModel)}><option value="all">全部模型</option>{optionValues(rows.map((row) => row.model)).map((value) => <option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="分组" {...selectProps(group, setGroup)}><option value="all">全部分组</option>{optionValues(rows.map((row) => row.groupName)).map((value) => <option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="类型" {...selectProps(requestType, setRequestType)}><option value="all">全部类型</option>{optionValues(rows.map((row) => row.requestType)).map((value) => <option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="计费类型" {...selectProps(billingType, setBillingType)}><option value="all">全部计费类型</option>{optionValues(rows.map((row) => row.billingType)).map((value) => <option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="计费模式" {...selectProps(billingMode, setBillingMode)}><option value="all">全部计费模式</option>{optionValues(rows.map((row) => row.billingMode)).map((value) => <option key={value}>{value}</option>)}</FilterSelect></div><div className="sub2-filter-actions"><button className="button-secondary" onClick={() => void onRefresh()}><RefreshCw size={16} />刷新</button><button className="button-secondary" onClick={reset}>重置</button><div className="sub2-column-menu"><button className="button-secondary" onClick={() => setShowColumns((value) => !value)}><Settings2 size={16} />列设置</button>{showColumns && <div className="sub2-menu">{Object.entries({ key: "API 密钥", model: "模型", reasoning: "推理强度", endpoint: "端点", ip: "IP", source: "来源", group: "分组", type: "类型", billing: "计费", tokens: "Token", cost: "费用", latency: "延迟", time: "时间" }).map(([key, label]) => <label key={key}><input type="checkbox" checked={columns[key as keyof UsageColumns]} onChange={() => setColumns((current) => ({ ...current, [key]: !current[key as keyof UsageColumns] }))} />{label}</label>)}</div>}</div><button className="button-primary" onClick={exportCsv}>导出 CSV</button></div></section>
    <section className="sub2-panel sub2-table-panel"><div className="sub2-result-line">共 <strong>{filtered.length}</strong> 条记录</div><UsageRecordsTable rows={pageRows} columns={columns} /><Pagination page={activePage} pages={pages} onChange={setPage} /></section>
  </div>;
}

function FilterSelect({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) { return <label className="sub2-filter-select">{label}<select {...props}>{children}</select></label>; }

function UsageDistribution({ title, rows, resolve, metric, onMetric }: { title: string; rows: UsageLog[]; resolve: (row: UsageLog) => string; metric: UsageMetric; onMetric: (value: UsageMetric) => void }) {
  const values = new Map<string, { requests: number; tokens: number; cost: number }>();
  rows.forEach((row) => { const key = resolve(row); const current = values.get(key) ?? { requests: 0, tokens: 0, cost: 0 }; current.requests += 1; current.tokens += row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens; current.cost += row.actualCost; values.set(key, current); });
  const items = Array.from(values.entries()).map(([label, value]) => ({ label, ...value })).sort((a, b) => (metric === "tokens" ? b.tokens - a.tokens : b.cost - a.cost)).slice(0, 8);
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ef4444", "#84cc16", "#ec4899"];
  return <article className="sub2-panel sub2-chart-card"><div className="sub2-panel-heading"><h2>{title}</h2><div className="sub2-chart-toggle"><button className={metric === "tokens" ? "active" : ""} onClick={() => onMetric("tokens")}>按 Token</button><button className={metric === "cost" ? "active" : ""} onClick={() => onMetric("cost")}>按实际消费</button></div></div><div className="sub2-distribution"><div className="sub2-doughnut">{items.length ? <Doughnut data={{ labels: items.map((item) => item.label), datasets: [{ data: items.map((item) => metric === "tokens" ? item.tokens : item.cost), backgroundColor: colors, borderWidth: 0, hoverOffset: 3 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: "57%" }} /> : <span>暂无数据</span>}</div><div className="sub2-breakdown"><table><thead><tr><th>项目</th><th>请求</th><th>Token</th><th>实际</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.label}><td><i style={{ backgroundColor: colors[index] }} />{item.label}</td><td>{item.requests}</td><td>{formatNumber(item.tokens)}</td><td>{formatMoney(item.cost)}</td></tr>)}{!items.length && <tr><td colSpan={4}>暂无数据</td></tr>}</tbody></table></div></div></article>;
}

function UsageTrend({ rows, granularity }: { rows: UsageLog[]; granularity: "hour" | "day" }) {
  const buckets = new Map<string, { input: number; output: number; create: number; read: number }>();
  rows.forEach((row) => { const date = new Date(row.createdAt * 1000); const label = granularity === "hour" ? `${todayInput(date)} ${String(date.getHours()).padStart(2, "0")}:00` : todayInput(date); const current = buckets.get(label) ?? { input: 0, output: 0, create: 0, read: 0 }; current.input += row.inputTokens; current.output += row.outputTokens; current.create += row.cacheCreationTokens; current.read += row.cacheReadTokens; buckets.set(label, current); });
  const entries = Array.from(buckets.entries()).sort(([left], [right]) => left.localeCompare(right));
  const source = (label: string, color: string, values: (entry: { input: number; output: number; create: number; read: number }) => number) => ({ label, data: entries.map(([, value]) => values(value)), borderColor: color, backgroundColor: color, pointRadius: 2, tension: .32, fill: false });
  return <article className="sub2-panel sub2-chart-card sub2-trend-card"><div className="sub2-panel-heading"><div><h2>Token 使用趋势</h2><p>按所选粒度汇总</p></div></div><div className="sub2-trend"><Line data={{ labels: entries.map(([label]) => label), datasets: [source("Input", "#3b82f6", (value) => value.input), source("Output", "#10b981", (value) => value.output), source("Cache Creation", "#f59e0b", (value) => value.create), source("Cache Read", "#06b6d4", (value) => value.read)] }} options={{ responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, ticks: { callback: (value) => formatNumber(Number(value)) }, grid: { color: "#eef0f3" } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } } }, plugins: { legend: { position: "top", labels: { usePointStyle: true, boxWidth: 8 } } } }} /></div></article>;
}

function UsageRecordsTable({ rows, columns }: { rows: UsageLog[]; columns: UsageColumns }) { const cells = (row: UsageLog) => ({ key: row.apiKeyName ?? "-", model: row.model || "-", reasoning: row.reasoningEffort ?? "-", endpoint: row.endpoint ?? "-", ip: row.ipAddress ?? "-", source: <><strong>{row.stationName}</strong><small>{row.stationUrl ?? "-"}</small></>, group: row.groupName ?? "-", type: row.requestType || "-", billing: [row.billingType, row.billingMode].filter(Boolean).join(" / ") || "-", tokens: <><strong>{formatNumber(row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens)}</strong><small>输 {formatNumber(row.inputTokens)} / 出 {formatNumber(row.outputTokens)}</small></>, cost: formatMoney(row.actualCost), latency: compactDuration(row.durationMs), time: formatTime(row.createdAt) }); const labels: Record<keyof UsageColumns, string> = { key: "API 密钥", model: "模型", reasoning: "推理强度", endpoint: "端点", ip: "IP", source: "来源", group: "分组", type: "类型", billing: "计费", tokens: "Token", cost: "费用", latency: "延迟", time: "时间" }; const visible = (Object.keys(columns) as Array<keyof UsageColumns>).filter((key) => columns[key]); return <><div className="sub2-desktop-table"><table><thead><tr>{visible.map((key) => <th key={key}>{labels[key]}</th>)}</tr></thead><tbody>{rows.map((row) => { const rowCells = cells(row); return <tr key={row.id}>{visible.map((key) => <td key={key}>{rowCells[key]}</td>)}</tr>; })}{!rows.length && <tr><td colSpan={Math.max(visible.length, 1)}><EmptyState message="没有符合筛选条件的使用记录。" /></td></tr>}</tbody></table></div><div className="sub2-mobile-cards">{rows.map((row) => <article className="sub2-record-card" key={row.id}><div><strong>{row.model || "未知模型"}</strong><span className="sub2-request-type">{row.requestType || "-"}</span></div><small>{formatTime(row.createdAt)}</small><dl>{columns.source && <><div><dt>来源</dt><dd>{row.stationName}</dd></div><div><dt>网址</dt><dd>{row.stationUrl ?? "-"}</dd></div></>}{columns.endpoint && <div><dt>端点</dt><dd>{row.endpoint ?? "-"}</dd></div>}{columns.key && <div><dt>API 密钥</dt><dd>{row.apiKeyName ?? "-"}</dd></div>}{columns.group && <div><dt>分组</dt><dd>{row.groupName ?? "-"}</dd></div>}{columns.tokens && <div><dt>Token</dt><dd>{formatNumber(row.inputTokens + row.outputTokens)}</dd></div>}{columns.cost && <div><dt>费用</dt><dd>{formatMoney(row.actualCost)}</dd></div>}{columns.latency && <div><dt>延迟</dt><dd>{compactDuration(row.durationMs)}</dd></div>}</dl></article>)}{!rows.length && <EmptyState message="没有符合筛选条件的使用记录。" />}</div></>; }

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (value: number) => void }) {
  if (pages <= 1) return null;
  return <nav className="sub2-pagination" aria-label="分页"><button className="sub2-icon-action" disabled={page === 1} onClick={() => onChange(page - 1)}><ChevronLeft size={17} /></button><span>第 {page} / {pages} 页</span><button className="sub2-icon-action" disabled={page === pages} onClick={() => onChange(page + 1)}><ChevronRight size={17} /></button></nav>;
}

/* Removed channel status page implementation.
type ChannelHealth = "normal" | "issue" | "stale" | "never";

const channelHealth = (station: Station, now: number): ChannelHealth => {
  if (!station.lastSyncedAt) return "never";
  if (station.status !== "online") return "issue";
  return station.lastSyncedAt * 1000 < now - 15 * 60_000 ? "stale" : "normal";
};

const channelHealthLabel = (health: ChannelHealth) => ({ normal: "正常", issue: "同步异常", stale: "久未同步", never: "从未同步" })[health];
const channelHealthOrder = (health: ChannelHealth) => ({ issue: 0, stale: 1, never: 2, normal: 3 })[health];

export function Sub2ChannelStatus({ stations, channelSnapshots, onRefresh, onUpdateTags, loading }: { stations: Station[]; channelSnapshots: Record<string, ChannelMonitorSnapshot>; onRefresh: () => Promise<void>; onUpdateTags: (stationId: string, tags: string[]) => Promise<Station>; loading: boolean }) {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [query, setQuery] = useState("");
  const [healthFilters, setHealthFilters] = useState<ChannelHealth[]>([]);
  const [kindFilters, setKindFilters] = useState<string[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [sort, setSort] = useState("health");
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<Station | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [savingTags, setSavingTags] = useState(false);
  const [saveError, setSaveError] = useState("");
  const kinds = [...new Set(stations.map((station) => station.kind).filter(Boolean))].sort();
  const tags = [...new Set(stations.flatMap((station) => station.tags ?? []))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const healthById = new Map(stations.map((station) => [station.id, channelHealth(station, now)]));
  const counts = { normal: 0, issue: 0, stale: 0, never: 0 } as Record<ChannelHealth, number>;
  stations.forEach((station) => { counts[healthById.get(station.id) ?? "never"] += 1; });
  const filtered = stations.filter((station) => {
    const health = healthById.get(station.id) ?? "never";
    const text = `${station.name} ${station.baseUrl} ${(station.tags ?? []).join(" ")}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (!healthFilters.length || healthFilters.includes(health))
      && (!kindFilters.length || kindFilters.includes(station.kind))
      && (!tagFilters.length || tagFilters.every((tag) => (station.tags ?? []).includes(tag)));
  }).sort((a, b) => {
    const aHealth = healthById.get(a.id) ?? "never";
    const bHealth = healthById.get(b.id) ?? "never";
    if (sort === "name") return a.name.localeCompare(b.name, "zh-CN");
    if (sort === "synced") return (b.lastSyncedAt ?? 0) - (a.lastSyncedAt ?? 0);
    return channelHealthOrder(aHealth) - channelHealthOrder(bHealth) || (b.lastSyncedAt ?? 0) - (a.lastSyncedAt ?? 0) || a.name.localeCompare(b.name, "zh-CN");
  });
  const toggle = <T extends string>(value: T, setValue: React.Dispatch<React.SetStateAction<T[]>>) => setValue((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const clearFilters = () => { setQuery(""); setHealthFilters([]); setKindFilters([]); setTagFilters([]); setSort("health"); };
  const openDetails = (station: Station) => { setSelected(station); setTagDraft(""); setSaveError(""); };
  const addTag = () => {
    const tag = tagDraft.trim();
    if (!selected || !tag || selected.tags.includes(tag)) return;
    setSelected({ ...selected, tags: [...selected.tags, tag] });
    setTagDraft("");
  };
  const saveTags = async () => {
    if (!selected) return;
    setSavingTags(true);
    setSaveError("");
    try { setSelected(await onUpdateTags(selected.id, selected.tags)); }
    catch (reason) { setSaveError(String(reason)); }
    finally { setSavingTags(false); }
  };
  const selectedMonitorSnapshot = selected ? channelSnapshots[selected.id] : undefined;
  const selectedMonitors = selectedMonitorSnapshot?.channelMonitors ?? [];
  const selectedMonitorDetails = selectedMonitorSnapshot?.channelMonitorDetails ?? [];
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => void onRefresh(), 60_000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, onRefresh]);
  return <div className="sub2-page sub2-channel-page">
    <section className="sub2-channel-summary" aria-label="渠道状态概览">
      {[
        { key: "all", label: "全部中转", value: stations.length, note: "当前工作区" },
        { key: "normal", label: "正常", value: counts.normal, note: "15 分钟内同步成功" },
        { key: "issue", label: "同步异常", value: counts.issue, note: "最近一次同步失败" },
        { key: "stale", label: "久未同步", value: counts.stale + counts.never, note: counts.never ? `含 ${counts.never} 个从未同步` : "超过 15 分钟" },
      ].map((item) => <button key={item.key} className={`sub2-channel-summary-card ${item.key === "all" ? !healthFilters.length ? "active" : "" : healthFilters.includes(item.key as ChannelHealth) ? "active" : ""}`} onClick={() => setHealthFilters(item.key === "all" ? [] : item.key === "stale" ? ["stale", "never"] : [item.key as ChannelHealth])}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></button>)}
    </section>
    <section className="sub2-channel-toolbar">
      <label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索中转名称、地址或标签" /></label>
      <details className="sub2-channel-filter-menu"><summary>状态{healthFilters.length ? ` · ${healthFilters.length}` : ""}</summary><div>{(["normal", "issue", "stale", "never"] as ChannelHealth[]).map((health) => <label key={health}><input type="checkbox" checked={healthFilters.includes(health)} onChange={() => toggle(health, setHealthFilters)} />{channelHealthLabel(health)}</label>)}</div></details>
      <details className="sub2-channel-filter-menu"><summary>类型{kindFilters.length ? ` · ${kindFilters.length}` : ""}</summary><div>{kinds.map((kind) => <label key={kind}><input type="checkbox" checked={kindFilters.includes(kind)} onChange={() => toggle(kind, setKindFilters)} />{kind}</label>)}</div></details>
      <details className="sub2-channel-filter-menu"><summary>标签{tagFilters.length ? ` · ${tagFilters.length}` : ""}</summary><div>{tags.length ? tags.map((tag) => <label key={tag}><input type="checkbox" checked={tagFilters.includes(tag)} onChange={() => toggle(tag, setTagFilters)} />{tag}</label>) : <small>还没有标签</small>}</div></details>
      <select className="sub2-channel-sort" aria-label="排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="health">状态优先</option><option value="synced">最近同步</option><option value="name">名称</option></select>
      <span className="sub2-channel-result">已显示 {filtered.length} / {stations.length}</span>
      <button className="button-secondary sub2-channel-clear" onClick={clearFilters}>清除筛选</button>
      <button className="sub2-icon-action" title="刷新状态" aria-label="刷新状态" onClick={() => void onRefresh()} disabled={loading}><RefreshCw size={17} className={loading ? "sub2-spin" : ""} /></button>
      <button className={`sub2-auto-refresh ${autoRefresh ? "active" : ""}`} onClick={() => setAutoRefresh((value) => !value)}>{autoRefresh ? "自动刷新：开" : "自动刷新"}</button>
    </section>
    <section className="sub2-panel sub2-channel-table-panel">
      <div className="sub2-desktop-table sub2-channel-table"><table><thead><tr><th>中转</th><th>类型 / 地址</th><th>同步状态</th><th>最后同步</th><th>最近错误</th><th aria-label="操作" /></tr></thead><tbody>{filtered.map((station) => { const health = healthById.get(station.id) ?? "never"; return <tr key={station.id} className={`sub2-channel-row ${health}`} tabIndex={0} role="button" onClick={() => openDetails(station)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetails(station); } }}><td><strong>{station.name}</strong><div className="sub2-channel-tags">{station.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></td><td><span className="sub2-request-type">{station.kind || "API"}</span><small>{station.baseUrl}</small></td><td><ChannelHealthBadge health={health} /></td><td>{formatTime(station.lastSyncedAt)}</td><td className="sub2-channel-error">{station.lastError || "-"}</td><td><button className="sub2-icon-action" title="查看详情" aria-label={`查看 ${station.name} 详情`} onClick={(event) => { event.stopPropagation(); openDetails(station); }}><Pencil size={15} /></button></td></tr>; })}{!filtered.length && <tr><td colSpan={6}><EmptyState message="没有符合筛选条件的中转。" /></td></tr>}</tbody></table></div>
      <div className="sub2-mobile-cards">{filtered.map((station) => { const health = healthById.get(station.id) ?? "never"; return <button className={`sub2-channel-mobile-row ${health}`} key={station.id} onClick={() => openDetails(station)}><div><strong>{station.name}</strong><ChannelHealthBadge health={health} /></div><div className="sub2-channel-tags">{station.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><small>{formatTime(station.lastSyncedAt)} · {station.kind || "API"}</small></button>; })}{!filtered.length && <EmptyState message="没有符合筛选条件的中转。" />}</div>
    </section>
    {selected && <aside className="sub2-channel-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><div className="sub2-channel-drawer" role="dialog" aria-modal="true" aria-label={`${selected.name} 详情`}><header><div><h2>{selected.name}</h2><p>{selected.baseUrl}</p></div><button className="sub2-icon-action" title="关闭" aria-label="关闭" onClick={() => setSelected(null)}><X size={18} /></button></header><div className="sub2-channel-drawer-body"><dl><div><dt>渠道类型</dt><dd>{selected.kind || "API"}</dd></div><div><dt>同步状态</dt><dd><ChannelHealthBadge health={channelHealth(selected, now)} /></dd></div><div><dt>最后同步</dt><dd>{formatTime(selected.lastSyncedAt)}</dd></div></dl><section><h3>远端渠道监控</h3>{selectedMonitorSnapshot?.channelMonitorSupported ? selectedMonitors.length ? <div className="sub2-remote-monitor-list">{selectedMonitors.map((monitor) => <article className="sub2-remote-monitor-card" key={monitor.id}><div className="sub2-remote-monitor-title"><div><strong>{monitor.name}</strong><small>{monitor.provider} · {monitor.groupName || "default"}</small></div><MonitorStatusBadge status={monitor.primaryStatus} /></div><div className="sub2-remote-monitor-model"><span>{monitor.primaryModel}</span>{monitor.extraModels.map((model) => <span key={model.model}>{model.model}</span>)}</div><div className="sub2-remote-monitor-metrics"><div><span>对话延迟</span><strong>{formatMonitorLatency(monitor.primaryLatencyMs)}</strong></div><div><span>端点 Ping</span><strong>{formatMonitorLatency(monitor.primaryPingLatencyMs)}</strong></div><div><span>7 天可用率</span><strong>{formatMonitorPercent(monitor.availability7d)}</strong></div></div><div className="sub2-remote-monitor-timeline" aria-label={`${monitor.name} 最近 60 次监控记录`}>{monitor.timeline.slice(-60).map((point, index) => <i key={`${point.checkedAt}-${index}`} className={point.status} title={`${point.checkedAt} · ${monitorStatusLabel(point.status)} · 对话 ${formatMonitorLatency(point.latencyMs)} · Ping ${formatMonitorLatency(point.pingLatencyMs)}`} />)}</div><small className="sub2-remote-monitor-timeline-label">近 {Math.min(monitor.timeline.length, 60)} 次记录</small></article>)}</div> : <p className="sub2-channel-monitor-empty">该中转已开启渠道监控，但尚未配置监控项。</p> : <p className="sub2-channel-monitor-empty">该中转未提供渠道监控数据，或尚未在远端开启此功能。</p>}</section>{selectedMonitorDetails.map((detail) => <section key={detail.id} className="sub2-channel-model-section"><h3>{detail.name} · 模型状态</h3><div className="sub2-channel-model-table"><table><thead><tr><th>模型</th><th>最新状态</th><th>最新延迟</th><th>7 天可用率</th><th>15 天可用率</th><th>30 天可用率</th><th>7 天平均延迟</th></tr></thead><tbody>{detail.models.map((model) => <tr key={model.model}><td>{model.model}</td><td><MonitorStatusBadge status={model.latestStatus} /></td><td>{formatMonitorLatency(model.latestLatencyMs)}</td><td>{formatMonitorPercent(model.availability7d)}</td><td>{formatMonitorPercent(model.availability15d)}</td><td>{formatMonitorPercent(model.availability30d)}</td><td>{formatMonitorLatency(model.avgLatency7dMs)}</td></tr>)}</tbody></table></div></section>)}<section><h3>标签</h3><div className="sub2-channel-tag-editor">{selected.tags.map((tag) => <span key={tag}>{tag}<button title={`移除 ${tag}`} aria-label={`移除 ${tag}`} onClick={() => setSelected({ ...selected, tags: selected.tags.filter((value) => value !== tag) })}><X size={12} /></button></span>)}</div><div className="sub2-channel-add-tag"><input className="input" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder="输入标签后按回车" /><button className="sub2-icon-action" title="添加标签" aria-label="添加标签" onClick={addTag}><Plus size={16} /></button></div><button className="button-primary sub2-channel-save-tags" disabled={savingTags} onClick={() => void saveTags()}>{savingTags ? "保存中" : "保存标签"}</button>{saveError && <p className="sub2-channel-save-error">{saveError}</p>}</section>{selected.lastError && <section><h3>最近错误</h3><pre>{selected.lastError}</pre></section>}</div></div></aside>}
  </div>;
}

function ChannelHealthBadge({ health }: { health: ChannelHealth }) {
  const tone = health === "normal" ? "good" : health === "issue" ? "bad" : "warn";
  return <span className={`sub2-status sub2-status-${tone}`}><i />{channelHealthLabel(health)}</span>;
}

const formatMonitorLatency = (value?: number) => value == null ? "-" : `${Math.round(value)} ms`;
const formatMonitorPercent = (value?: number) => value == null ? "-" : `${value.toFixed(2)}%`;
const monitorStatusLabel = (status: string) => (({ operational: "正常", degraded: "降级", failed: "失败", error: "错误" }[status] ?? status) || "未知");

function MonitorStatusBadge({ status }: { status: string }) {
  const tone = status === "operational" ? "good" : status === "degraded" ? "warn" : "bad";
  return <span className={`sub2-status sub2-status-${tone}`}><i />{monitorStatusLabel(status)}</span>;
}
*/
