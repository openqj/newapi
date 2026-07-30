import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, History, RefreshCw } from "lucide-react";
import { alertApi } from "../api";
import type { AlertHistoryItem, AlertPolicy } from "../types";
import { isTauri } from "../../../lib/platform";
import { errorMessage } from "../../../lib/errors";
import { useToast } from "../../../components/ui";

const defaults: AlertPolicy = {
  enabled: true,
  lowBalanceThreshold: 5,
  remainingQuotaPercent: 10,
  quotaResetWarningHours: 24,
  notifyStationFailures: true,
};

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(timestamp * 1000));
}

function HistoryPanel({ entries, loading, onRefresh, onViewMore }: { entries: AlertHistoryItem[]; loading: boolean; onRefresh: () => void; onViewMore?: () => void }) {
  const summary = useMemo(() => entries.reduce((result, item) => {
    if (item.status === "resolved") result.resolved += 1;
    else result.active += 1;
    return result;
  }, { active: 0, resolved: 0 }), [entries]);
  return <div className="mt-3 border-t border-slate-100 pt-3">
    <div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-medium"><History size={16} />告警历史与趋势</p><p className="mt-1 text-xs text-slate-500">最近 {entries.length} 条评估：{summary.active} 条触发，{summary.resolved} 条已恢复。</p></div><div className="flex shrink-0 gap-2"><button type="button" className="button-secondary" title="刷新告警历史" aria-label="刷新告警历史" onClick={onRefresh} disabled={loading || !isTauri()}><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>{onViewMore && <button type="button" className="button-secondary" onClick={onViewMore}>查看更多</button>}</div></div>
    <div className="mt-3 max-h-56 overflow-auto rounded-md border border-slate-200">
      {entries.length ? <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 font-medium">时间</th><th className="px-3 py-2 font-medium">事件</th><th className="px-3 py-2 font-medium">站点</th><th className="px-3 py-2 font-medium">状态</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="whitespace-nowrap px-3 py-2 text-slate-500">{formatTime(entry.occurredAt)}</td><td className="px-3 py-2"><span className={entry.severity === "critical" ? "text-rose-700" : entry.severity === "warning" ? "text-amber-700" : "text-sky-700"}>{entry.title}</span><small className="mt-0.5 block text-slate-500">{entry.detail}</small></td><td className="px-3 py-2">{entry.stationName}</td><td className="px-3 py-2">{entry.status === "resolved" ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} />已恢复</span> : <span className="inline-flex items-center gap-1 text-amber-700"><AlertCircle size={13} />触发</span>}</td></tr>)}</tbody></table> : <p className="p-4 text-center text-xs text-slate-500">尚无告警评估记录。同步站点或点击“立即评估”后将显示趋势。</p>}
    </div>
  </div>;
}

export function AlertSettings({ onViewHistory }: { onViewHistory?: () => void }) {
  const { notify } = useToast();
  const [policy, setPolicy] = useState<AlertPolicy>(defaults);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadHistory = async () => {
    if (!isTauri()) return;
    setLoadingHistory(true);
    try { setHistory(await alertApi.history()); } catch (reason) { notify(errorMessage(reason, "加载告警历史失败。"), "error"); } finally { setLoadingHistory(false); }
  };
  useEffect(() => {
    if (!isTauri()) return;
    void alertApi.policy().then(setPolicy).catch((reason) => notify(errorMessage(reason, "加载告警策略失败。"), "error"));
    void loadHistory();
  // The initial app settings load must run once; loadHistory is intentionally stable for this call.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify]);

  const save = async () => {
    if (!isTauri()) return;
    setSaving(true);
    try { setPolicy(await alertApi.savePolicy(policy)); notify("告警策略已保存。", "success"); } catch (reason) { notify(errorMessage(reason, "保存告警策略失败。"), "error"); } finally { setSaving(false); }
  };
  const evaluate = async () => {
    if (!isTauri()) return;
    setLoadingHistory(true);
    try { const active = await alertApi.evaluate(); await loadHistory(); notify(active.length ? `已评估：${active.length} 项告警。` : "已评估：当前没有告警。", active.length ? "info" : "success"); } catch (reason) { notify(errorMessage(reason, "评估告警失败。"), "error"); setLoadingHistory(false); }
  };
  const inputValue = (value?: number) => value ?? "";
  const numberValue = (value: string) => value === "" ? undefined : Number(value);
  return <div className="flex flex-col gap-3 border-b border-slate-100 p-4 last:border-b-0">
    <div className="flex items-center justify-between gap-4"><div><p className="font-medium">余额、额度与告警</p><p className="mt-1 text-sm text-slate-500">同步后检查站点余额、密钥额度和失败；同类桌面通知每 6 小时最多一次。</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.enabled} onChange={(event) => setPolicy((current) => ({ ...current, enabled: event.target.checked }))} />启用</label></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">低余额阈值<input className="input mt-1" type="number" min="0" step="0.01" disabled={!policy.enabled} value={inputValue(policy.lowBalanceThreshold)} onChange={(event) => setPolicy((current) => ({ ...current, lowBalanceThreshold: numberValue(event.target.value) }))} /></label>
      <label className="text-sm">剩余额度 (%)<input className="input mt-1" type="number" min="0" max="100" step="1" disabled={!policy.enabled} value={inputValue(policy.remainingQuotaPercent)} onChange={(event) => setPolicy((current) => ({ ...current, remainingQuotaPercent: numberValue(event.target.value) }))} /></label>
      <label className="text-sm">重置前提醒（小时）<input className="input mt-1" type="number" min="0" max="8760" step="1" disabled={!policy.enabled} value={inputValue(policy.quotaResetWarningHours)} onChange={(event) => setPolicy((current) => ({ ...current, quotaResetWarningHours: numberValue(event.target.value) }))} /><small className="mt-1 block text-xs text-slate-500">仅在站点 API 返回 reset_at、reset_time 或 quota_reset_at 时可用；未提供则不支持重置预警。</small></label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={policy.notifyStationFailures} disabled={!policy.enabled} onChange={(event) => setPolicy((current) => ({ ...current, notifyStationFailures: event.target.checked }))} />站点同步失败</label>
    </div>
    <div className="flex gap-2"><button type="button" className="button-primary" onClick={() => void save()} disabled={saving || !isTauri()}>{saving ? "保存中" : "保存告警策略"}</button><button type="button" className="button-secondary" onClick={() => void evaluate()} disabled={loadingHistory || !isTauri()}>立即评估</button></div>
    <HistoryPanel entries={history} loading={loadingHistory} onRefresh={() => void loadHistory()} onViewMore={onViewHistory} />
  </div>;
}
