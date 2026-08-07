import { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button, Dialog, List, ListItem, useConfirm, useToast } from "../../../components/ui";
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

  return <Dialog title="配置与密钥变更历史" description="仅显示已脱敏字段。远端 relay 回滚所需密钥只保存在本机系统凭据库中。" ariaLabel="变更历史" className="audit-history-dialog" contentClassName="audit-history-dialog-content" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>关闭</Button>}>
      <div className="flex gap-2 border-b border-slate-100 px-5 py-3">
        {([ ["all", "全部"], ["remote", "远程配置"], ["keys", "API 密钥"] ] as const).map(([value, label]) => <Button key={value} variant={filter === value ? "primary" : "secondary"} onClick={() => setFilter(value)}>{label}</Button>)}
      </div>
      <div className="audit-history-list max-h-[60vh] overflow-auto p-5">
        {loading ? <p className="text-sm text-slate-500">加载中...</p> : filtered.length === 0 ? <p className="text-sm text-slate-500">此筛选条件下暂无变更。</p> : <List as="ol" className="space-y-4">{filtered.map((event) => {
          const diff = changes(event);
          return <ListItem as="li" key={event.id} className="border-b border-slate-100 pb-4 last:border-b-0">
            <div className="flex items-start justify-between gap-4"><div><p className="font-medium">{event.detail}</p><p className="mt-1 text-xs text-slate-500">{new Date(event.createdAt * 1000).toLocaleString()} · {event.action} · {event.stationId}</p></div>
              {canRollback(event) && <Button variant="secondary" className="shrink-0" disabled={rollingBack === event.id} onClick={() => void rollback(event)}><RotateCcw size={15} />{rollingBack === event.id ? "恢复中" : "恢复"}</Button>}
            </div>
            {diff.length > 0 && <dl className="mt-3 grid grid-cols-[minmax(7rem,auto)_1fr_1fr] gap-x-3 gap-y-1 rounded bg-slate-50 p-3 text-xs"><dt className="font-medium text-slate-500">字段</dt><dd className="font-medium text-slate-500">变更前</dd><dd className="font-medium text-slate-500">变更后</dd>{diff.map((row) => <div key={row.key} className="contents"><dt>{labels[row.key] ?? row.key}</dt><dd className="break-all text-slate-600">{row.before}</dd><dd className="break-all text-slate-900">{row.after}</dd></div>)}</dl>}
            {event.payload?.rollback?.note && <p className={`mt-2 text-xs ${event.payload.rollback.kind === "unavailable" ? "text-amber-700" : "text-slate-500"}`}>{event.payload.rollback.note}</p>}
          </ListItem>;
        })}</List>}
      </div>
  </Dialog>;
}
