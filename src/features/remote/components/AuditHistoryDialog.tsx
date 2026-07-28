import { useEffect, useMemo, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { useConfirm, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { remoteApi } from "../api";

type AuditValue = string | number | boolean | null | undefined;
type AuditPayload = {
  before?: Record<string, AuditValue>;
  after?: Record<string, AuditValue>;
  rollback?: { kind?: string; note?: string };
};
type AuditEvent = { id: number; stationId: string; action: string; detail: string; payload?: AuditPayload; createdAt: number };
type Filter = "all" | "remote" | "keys";

const labels: Record<string, string> = {
  id: "服务器 ID", name: "名称", host: "主机", port: "端口", username: "用户名", authType: "认证方式",
  hostKeyFingerprint: "SSH 主机指纹", relayProvider: "Relay Provider", relayUrl: "Relay 地址",
  maskedKey: "已脱敏密钥", group: "分组", status: "状态", remainingQuota: "剩余额度", totalQuota: "总额度",
  unlimitedQuota: "不限额度", currentConcurrency: "并发数", usedQuota: "已用额度", todaySpent: "今日消费",
  last30DaysSpent: "近 30 天消费", expiresAt: "过期时间", createdAt: "创建时间",
};

function isSensitiveField(key: string) {
  return /(password|secret|token|credential|private.?key|relay.?key|key.?source|key.?masked)/i.test(key) && key !== "hostKeyFingerprint";
}

function printable(key: string, value: AuditValue) {
  if (isSensitiveField(key)) return "[已脱敏]";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function changes(event: AuditEvent) {
  const before = event.payload?.before ?? {};
  const after = event.payload?.after ?? {};
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((key) => before[key] !== after[key])
    .filter((key) => !isSensitiveField(key))
    .map((key) => ({ key, before: printable(key, before[key]), after: printable(key, after[key]) }));
}

function eventKind(event: AuditEvent): Filter | "other" {
  if (event.action.startsWith("remote.")) return "remote";
  if (event.action.startsWith("key.")) return "keys";
  return "other";
}

function canRollback(event: AuditEvent) {
  return event.payload?.rollback?.kind === "remote-relay-config" ||
    ["remote.server.update", "remote.server.delete"].includes(event.action);
}

export function AuditHistoryDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const confirm = useConfirm();
  const { notify } = useToast();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState<number>();
  const [filter, setFilter] = useState<Filter>("all");
  const load = async () => {
    setLoading(true);
    try { setEvents(await remoteApi.auditEvents<AuditEvent[]>()); }
    catch (reason) { notify(errorMessage(reason, "加载变更历史失败。"), "error"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => events.filter((event) => filter === "all" || eventKind(event) === filter), [events, filter]);
  const rollback = async (event: AuditEvent) => {
    const remoteRelay = event.payload?.rollback?.kind === "remote-relay-config";
    const description = remoteRelay
      ? "将使用本机系统凭据库中保存的快照恢复远端 Codex relay。若远端配置已在之后变更，恢复会安全地停止。SSH 凭据不会变更。"
      : "仅恢复非敏感的本地服务器元数据。SSH 凭据、私钥路径、relay 密钥和远端 Codex 文件均不会变更。";
    if (!(await confirm({ title: remoteRelay ? "恢复远端 Relay 配置" : "恢复本地服务器元数据", description, confirmLabel: "恢复", destructive: true }))) return;
    setRollingBack(event.id);
    try {
      await remoteApi.rollbackAudit(event.id);
      await onChanged();
      await load();
      notify(remoteRelay ? "远端 Codex relay 配置已恢复。" : "本地服务器元数据已恢复。", "success");
    } catch (reason) { notify(errorMessage(reason, "恢复配置失败。"), "error"); }
    finally { setRollingBack(undefined); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="变更历史">
    <section className="w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div><h2 className="text-base font-semibold">配置与密钥变更历史</h2><p className="mt-1 text-sm text-slate-500">仅显示已脱敏字段。远端 relay 回滚所需密钥只保存在本机系统凭据库中。</p></div>
        <button className="icon-button" type="button" onClick={onClose} title="关闭"><X size={18} /></button>
      </header>
      <div className="flex gap-2 border-b border-slate-100 px-5 py-3">
        {([ ["all", "全部"], ["remote", "远程配置"], ["keys", "API 密钥"] ] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? "button-primary" : "button-secondary"} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      <div className="max-h-[60vh] overflow-auto p-5">
        {loading ? <p className="text-sm text-slate-500">加载中...</p> : filtered.length === 0 ? <p className="text-sm text-slate-500">此筛选条件下暂无变更。</p> : <ol className="space-y-4">{filtered.map((event) => {
          const diff = changes(event);
          return <li key={event.id} className="border-b border-slate-100 pb-4 last:border-b-0">
            <div className="flex items-start justify-between gap-4"><div><p className="font-medium">{event.detail}</p><p className="mt-1 text-xs text-slate-500">{new Date(event.createdAt * 1000).toLocaleString()} · {event.action} · {event.stationId}</p></div>
              {canRollback(event) && <button type="button" className="button-secondary shrink-0" disabled={rollingBack === event.id} onClick={() => void rollback(event)}><RotateCcw size={15} />{rollingBack === event.id ? "恢复中" : "恢复"}</button>}
            </div>
            {diff.length > 0 && <dl className="mt-3 grid grid-cols-[minmax(7rem,auto)_1fr_1fr] gap-x-3 gap-y-1 rounded bg-slate-50 p-3 text-xs"><dt className="font-medium text-slate-500">字段</dt><dd className="font-medium text-slate-500">变更前</dd><dd className="font-medium text-slate-500">变更后</dd>{diff.map((row) => <div key={row.key} className="contents"><dt>{labels[row.key] ?? row.key}</dt><dd className="break-all text-slate-600">{row.before}</dd><dd className="break-all text-slate-900">{row.after}</dd></div>)}</dl>}
            {event.payload?.rollback?.note && <p className={`mt-2 text-xs ${event.payload.rollback.kind === "unavailable" ? "text-amber-700" : "text-slate-500"}`}>{event.payload.rollback.note}</p>}
          </li>;
        })}</ol>}
      </div>
      <footer className="flex justify-end border-t border-slate-100 px-5 py-3"><button type="button" className="button-secondary" onClick={onClose}>关闭</button></footer>
    </section>
  </div>;
}
