import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, BellRing, CircleAlert, CircleCheck, RefreshCw, TriangleAlert } from "lucide-react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { EmptyState, PageHeader, Panel, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { alertApi } from "../api";
import type { AlertHistoryItem } from "../types";
import "../../../components/Sub2ApiPages.css";
import "./AlertHistoryPage.css";

ChartJS.register(BarElement, CategoryScale, Legend, LinearScale, Tooltip);

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const formatTime = (timestamp: number) => new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp * 1000));

function recentDays() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (6 - index));
    return day;
  });
}

export function AlertHistoryPage({ onBack }: { onBack: () => void }) {
  const { notify } = useToast();
  const [entries, setEntries] = useState<AlertHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!isTauri()) return;
    setLoading(true);
    try {
      setEntries(await alertApi.history(200));
    } catch (reason) {
      notify(errorMessage(reason, "加载告警历史失败。"), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  // The page loads its data once; refresh is invoked explicitly afterward.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => entries.reduce((result, item) => {
    if (item.status === "active") result.active += 1;
    else result.resolved += 1;
    if (item.severity === "critical") result.critical += 1;
    return result;
  }, { active: 0, resolved: 0, critical: 0 }), [entries]);

  const trend = useMemo(() => recentDays().map((day) => {
    const key = dayKey(day);
    return entries.reduce((result, item) => {
      if (dayKey(new Date(item.occurredAt * 1000)) === key) result[item.status] += 1;
      return result;
    }, { active: 0, resolved: 0 });
  }), [entries]);
  const labels = recentDays().map((day) => `${day.getMonth() + 1}/${day.getDate()}`);

  return <div className="sub2-page alert-history-page">
    <PageHeader
      title="告警历史与趋势"
      description="集中查看最近 200 条告警记录及近 7 日变化。"
      actions={<div className="flex gap-2"><button type="button" className="button-secondary" onClick={onBack}><ArrowLeft size={16} />返回设置</button><button type="button" className="button-secondary" onClick={() => void refresh()} disabled={loading || !isTauri()}><RefreshCw size={16} className={loading ? "animate-spin" : ""} />刷新</button></div>}
    />
    <section className="sub2-stat-grid alert-history-summary" aria-label="告警汇总">
      <StatCard icon={<BellRing size={18} />} label="记录总数" value={String(entries.length)} note="最近 200 条记录" />
      <StatCard icon={<CircleAlert size={18} />} label="当前触发" value={String(summary.active)} note="仍需处理的告警" tone="warning" />
      <StatCard icon={<CircleCheck size={18} />} label="已恢复" value={String(summary.resolved)} note="状态已恢复正常" tone="success" />
      <StatCard icon={<TriangleAlert size={18} />} label="严重告警" value={String(summary.critical)} note="记录范围内的严重项" tone="danger" />
    </section>
    <Panel className="alert-history-trend" title="近 7 日趋势" description="按告警触发与恢复时间汇总。">
      <div className="alert-history-chart">
        <Bar
          data={{
            labels,
            datasets: [
              { label: "触发", data: trend.map((item) => item.active), backgroundColor: "#f59e0b", borderRadius: 3 },
              { label: "已恢复", data: trend.map((item) => item.resolved), backgroundColor: "#16a34a", borderRadius: 3 },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#eef0f3" } } },
            plugins: { legend: { position: "top", labels: { usePointStyle: true, boxWidth: 8 } } },
          }}
        />
      </div>
    </Panel>
    <Panel className="alert-history-records" title="告警记录" description={entries.length ? `共 ${entries.length} 条，按发生时间倒序显示。` : "暂无告警记录。"}>
      {entries.length ? <div className="alert-history-table-wrap"><table><thead><tr><th>时间</th><th>事件</th><th>站点</th><th>严重程度</th><th>状态</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td className="alert-history-time">{formatTime(entry.occurredAt)}</td><td><strong>{entry.title}</strong><small>{entry.detail}</small></td><td>{entry.stationName}</td><td><Severity severity={entry.severity} /></td><td><Status status={entry.status} /></td></tr>)}</tbody></table></div> : <EmptyState message={loading ? "正在加载告警历史..." : "尚无告警评估记录。"} />}
    </Panel>
  </div>;
}

function StatCard({ icon, label, value, note, tone = "neutral" }: { icon: ReactNode; label: string; value: string; note: string; tone?: "neutral" | "warning" | "success" | "danger" }) {
  return <article className={`sub2-stat-card alert-history-stat-${tone}`}><span className="sub2-stat-icon">{icon}</span><p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
}

function Severity({ severity }: { severity: AlertHistoryItem["severity"] }) {
  const label = severity === "critical" ? "严重" : severity === "warning" ? "警告" : "提示";
  return <span className={`alert-history-badge alert-history-severity-${severity}`}>{label}</span>;
}

function Status({ status }: { status: AlertHistoryItem["status"] }) {
  return <span className={`alert-history-badge alert-history-status-${status}`}>{status === "resolved" ? "已恢复" : "触发"}</span>;
}
