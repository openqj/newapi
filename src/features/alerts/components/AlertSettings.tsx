import { useEffect, useState } from "react";
import { alertApi } from "../api";
import type { AlertPolicy } from "../types";
import { isTauri } from "../../../lib/platform";
import { errorMessage } from "../../../lib/errors";
import { Button, Switch, TextField, useToast } from "../../../components/ui";

const defaults: AlertPolicy = {
  enabled: false,
  lowBalanceThreshold: 5,
  remainingQuotaPercent: 10,
  quotaResetWarningHours: 24,
  notifyStationFailures: true,
};

export function AlertSettings() {
  const { notify } = useToast();
  const [policy, setPolicy] = useState<AlertPolicy>(defaults);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    void alertApi.policy().then(setPolicy).catch((reason) => notify(errorMessage(reason, "加载告警策略失败。"), "error"));
  }, [notify]);

  const save = async () => {
    if (!isTauri()) return;
    setSaving(true);
    try { setPolicy(await alertApi.savePolicy(policy)); notify("告警策略已保存。", "success"); } catch (reason) { notify(errorMessage(reason, "保存告警策略失败。"), "error"); } finally { setSaving(false); }
  };
  const evaluate = async () => {
    if (!isTauri()) return;
    try { const active = await alertApi.evaluate(); notify(active.length ? `已评估：${active.length} 项告警。` : "已评估：当前没有告警。", active.length ? "info" : "success"); } catch (reason) { notify(errorMessage(reason, "评估告警失败。"), "error"); }
  };
  const inputValue = (value?: number) => value ?? "";
  const numberValue = (value: string) => value === "" ? undefined : Number(value);
  return <div className="flex flex-col gap-3 border-b border-slate-100 p-4 last:border-b-0">
    <div className="flex items-center justify-between gap-4"><div><p className="font-medium">余额、额度与告警</p><p className="mt-1 text-sm text-slate-500">同步后检查站点余额、密钥额度和失败；同类桌面通知每 6 小时最多一次。</p></div><label className="flex items-center gap-2 text-sm"><Switch aria-label="启用余额与告警" checked={policy.enabled} onCheckedChange={(checked) => setPolicy((current) => ({ ...current, enabled: checked }))} />启用</label></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">低余额阈值<TextField className="mt-1" type="number" min="0" step="0.01" disabled={!policy.enabled} value={inputValue(policy.lowBalanceThreshold)} onChange={(event) => setPolicy((current) => ({ ...current, lowBalanceThreshold: numberValue(event.target.value) }))} /></label>
      <label className="text-sm">剩余额度 (%)<TextField className="mt-1" type="number" min="0" max="100" step="1" disabled={!policy.enabled} value={inputValue(policy.remainingQuotaPercent)} onChange={(event) => setPolicy((current) => ({ ...current, remainingQuotaPercent: numberValue(event.target.value) }))} /></label>
      <label className="text-sm">重置前提醒（小时）<TextField className="mt-1" type="number" min="0" max="8760" step="1" disabled={!policy.enabled} value={inputValue(policy.quotaResetWarningHours)} onChange={(event) => setPolicy((current) => ({ ...current, quotaResetWarningHours: numberValue(event.target.value) }))} /><small className="mt-1 block text-xs text-slate-500">仅在站点 API 返回 reset_at、reset_time 或 quota_reset_at 时可用；未提供则不支持重置预警。</small></label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><Switch aria-label="站点同步失败提醒" checked={policy.notifyStationFailures} disabled={!policy.enabled} onCheckedChange={(checked) => setPolicy((current) => ({ ...current, notifyStationFailures: checked }))} />站点同步失败</label>
    </div>
    <div className="flex gap-2"><Button variant="primary" onClick={() => void save()} disabled={saving || !isTauri()}>{saving ? "保存中" : "保存告警策略"}</Button><Button variant="secondary" onClick={() => void evaluate()} disabled={!isTauri()}>立即评估</Button></div>
  </div>;
}
