import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { EmptyState, FormField, Panel, SelectField, StatusBadge, TextField, useConfirm, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import type { KeyRow } from "../../api-keys";
import { CONFIG_PROFILE_CHANGED_EVENT, configProfileApi } from "../api";
import type { ActiveConfigProfile, ClientApplication, ConfigBackupPreview, ConfigBackupSummary, ConfigProfile, ConfigProfileDraft } from "../types";
import "./ConfigProfilesPage.css";

const applicationLabels: Record<ClientApplication, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

const emptyDraft: ConfigProfileDraft = {
  name: "",
  application: "claude",
  stationId: "",
  keyId: "",
  baseUrl: "",
  model: "",
  protocol: "",
};

export function ConfigProfilesPage({ keyRows }: { keyRows: KeyRow[] }) {
  const { notify } = useToast();
  const confirm = useConfirm();
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [active, setActive] = useState<ActiveConfigProfile | null>(null);
  const [backups, setBackups] = useState<ConfigBackupSummary[]>([]);
  const [backupPreview, setBackupPreview] = useState<ConfigBackupPreview | null>(null);
  const [draft, setDraft] = useState<ConfigProfileDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  const stationOptions = useMemo(
    () => Array.from(new Map(keyRows.map((row) => [row.stationId, { id: row.stationId, name: row.stationName }])).values()),
    [keyRows],
  );
  const selectedRows = useMemo(
    () => keyRows.filter((row) => row.stationId === draft.stationId),
    [draft.stationId, keyRows],
  );
  const modelOptions = useMemo(
    () => Array.from(new Set(selectedRows.flatMap((row) => row.models))).filter(Boolean),
    [selectedRows],
  );

  const load = async () => {
    if (!isTauri()) return;
    try {
      const [nextProfiles, nextActive] = await Promise.all([configProfileApi.list(), configProfileApi.active()]);
      setProfiles(nextProfiles);
      setActive(nextActive);
    } catch (reason) {
      notify(errorMessage(reason, "加载配置档案失败"), "error");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen(CONFIG_PROFILE_CHANGED_EVENT, () => void load()).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, []);

  const loadBackups = async () => {
    if (!isTauri()) return;
    try {
      setBackups(await configProfileApi.backups());
    } catch (reason) {
      notify(errorMessage(reason, "加载客户端备份失败"), "error");
    }
  };

  useEffect(() => {
    void loadBackups();
  }, []);

  useEffect(() => {
    if (!draft.stationId && stationOptions[0]) {
      const firstRow = keyRows.find((row) => row.stationId === stationOptions[0].id);
      setDraft((current) => ({ ...current, stationId: stationOptions[0].id, keyId: firstRow?.key.id ?? "" }));
    }
  }, [draft.stationId, keyRows, stationOptions]);

  const updateDraft = (patch: Partial<ConfigProfileDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const resetDraft = () => setDraft({ ...emptyDraft, stationId: stationOptions[0]?.id ?? "", keyId: keyRows[0]?.key.id ?? "" });

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.name?.trim() || !draft.stationId || !draft.keyId) return;
    setBusy(true);
    try {
      if (isTauri()) {
        await configProfileApi.save(draft);
        await load();
      } else {
        const saved: ConfigProfile = {
          ...draft,
          id: draft.id ?? `demo-${Date.now()}`,
          name: draft.name.trim(),
          updatedAt: Date.now(),
        };
        setProfiles((current) => current.some((profile) => profile.id === saved.id) ? current.map((profile) => profile.id === saved.id ? saved : profile) : [...current, saved]);
      }
      notify("配置档案已保存", "success");
      resetDraft();
    } catch (reason) {
      notify(errorMessage(reason, "保存配置档案失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (profile: ConfigProfile) => {
    setBusy(true);
    try {
      if (isTauri()) {
        const result = await configProfileApi.apply(profile.id);
        setActive(result.active);
        notify(result.backupFiles.length > 0 ? `已切换配置，并备份 ${result.backupFiles.length} 个客户端文件` : "已切换配置", "success");
      } else {
        setActive({ profile, appliedAt: Date.now(), lastTestStatus: "notTested" });
        notify("已切换配置", "success");
      }
    } catch (reason) {
      notify(errorMessage(reason, "应用配置档案失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const edit = (profile: ConfigProfile) => setDraft({ ...profile });

  const remove = async (profile: ConfigProfile) => {
    if (!(await confirm({ title: "删除配置档案", description: `确定删除“${profile.name}”吗？`, confirmLabel: "删除", destructive: true }))) return;
    setBusy(true);
    try {
      if (isTauri()) {
        await configProfileApi.remove(profile.id);
        await load();
      }
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      if (draft.id === profile.id) resetDraft();
      notify("配置档案已删除", "success");
    } catch (reason) {
      notify(errorMessage(reason, "删除配置档案失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const previewBackup = async (backup: ConfigBackupSummary) => {
    if (!isTauri()) return;
    setBusy(true);
    try {
      setBackupPreview(await configProfileApi.previewBackup(backup.id));
    } catch (reason) {
      notify(errorMessage(reason, "读取备份预览失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const restorePreview = async () => {
    if (!backupPreview?.canRestore) return;
    if (!(await confirm({
      title: "恢复客户端配置",
      description: `这会覆盖 ${backupPreview.backup.fileName} 当前文件。恢复前会自动备份当前版本。确定继续吗？`,
      confirmLabel: "恢复此版本",
    }))) return;
    setBusy(true);
    try {
      const result = await configProfileApi.restoreBackup(backupPreview.backup.id);
      setBackupPreview(null);
      await loadBackups();
      notify(result.safetyBackupPath ? "配置已恢复，当前版本也已自动备份" : "配置已恢复", "success");
    } catch (reason) {
      notify(errorMessage(reason, "恢复客户端配置失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const keyInfo = (profile: ConfigProfile) => keyRows.find((row) => row.stationId === profile.stationId && row.key.id === profile.keyId);
  const displayBaseUrl = (profile: ConfigProfile) => profile.baseUrl?.trim() || apiBaseUrl(keyInfo(profile)?.stationUrl ?? "");

  return <div className="config-profiles-page">
    <Panel title="当前生效配置" description="这里显示最近一次由 RelayHub 应用到客户端的配置。">
      {active ? <div className="config-active-card">
        <div className="config-active-heading"><div><strong>{active.profile.name}</strong><span>{applicationLabels[active.profile.application]}</span></div><StatusBadge status="online" indicator={<Check size={14} />}>已应用</StatusBadge></div>
        <div className="config-summary-grid">
          <SummaryItem label="供应商" value={keyInfo(active.profile)?.stationName ?? (active.profile.stationId ? active.profile.stationId : "外部导入")} />
          <SummaryItem label="模型" value={active.profile.model || "未指定"} />
          <SummaryItem label="Base URL" value={displayBaseUrl(active.profile)} mono />
          <SummaryItem label="最近测试" value={active.lastTestStatus === "notTested" ? "未执行" : active.lastTestStatus} />
        </div>
      </div> : <EmptyState title="尚未应用配置" description="保存一个配置档案后，点击“应用”即可切换客户端。" />}
    </Panel>

    <Panel title={draft.id ? "编辑配置档案" : "新建配置档案"} description="档案只保存站点和 API 密钥引用，密钥本身继续由 RelayHub 的安全存储管理。">
      <form className="config-profile-form" onSubmit={(event) => void save(event)}>
        <FormField label="档案名称" required><TextField required value={draft.name} placeholder="例如：日常 Claude" onChange={(event) => updateDraft({ name: event.target.value })} /></FormField>
        <FormField label="应用" required><SelectField value={draft.application} onChange={(event) => updateDraft({ application: event.target.value as ClientApplication })}><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="gemini">Gemini CLI</option></SelectField></FormField>
        <FormField label="站点" required><SelectField required value={draft.stationId} onChange={(event) => { const nextStationId = event.target.value; updateDraft({ stationId: nextStationId, keyId: keyRows.find((row) => row.stationId === nextStationId)?.key.id ?? "" }); }}><option value="">选择站点</option>{stationOptions.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</SelectField></FormField>
        <FormField label="API 密钥" required><SelectField required value={draft.keyId} onChange={(event) => updateDraft({ keyId: event.target.value })}><option value="">选择 API 密钥</option>{selectedRows.map((row) => <option key={row.key.id} value={row.key.id}>{row.key.name} · {row.key.maskedKey}</option>)}</SelectField></FormField>
        <FormField label="模型" hint={modelOptions.length > 0 ? "可从已同步模型中选择，也可以直接输入。" : "可直接输入模型名称。"}><TextField list="config-profile-models" value={draft.model ?? ""} placeholder="例如：claude-sonnet-4-5" onChange={(event) => updateDraft({ model: event.target.value })} /><datalist id="config-profile-models">{modelOptions.map((model) => <option key={model} value={model} />)}</datalist></FormField>
        <FormField label="Base URL 覆盖项" hint="留空时使用站点默认 /v1 地址。"><TextField value={draft.baseUrl ?? ""} placeholder="留空使用站点地址" onChange={(event) => updateDraft({ baseUrl: event.target.value })} /></FormField>
        <FormField label="协议标记"><TextField value={draft.protocol ?? ""} placeholder="例如：responses、anthropic、gemini" onChange={(event) => updateDraft({ protocol: event.target.value })} /></FormField>
        <div className="config-profile-form-actions"><button type="button" className="button-secondary" onClick={resetDraft} disabled={busy}>清空</button><button type="submit" className="button-primary" disabled={busy || !draft.name?.trim() || !draft.stationId || !draft.keyId}>{draft.id ? "保存修改" : "保存档案"}</button></div>
      </form>
    </Panel>

    <Panel title="配置档案列表" description="点击应用即可切换对应客户端的本地配置文件。">
      {profiles.length === 0 ? <EmptyState title="还没有配置档案" description="先在上方创建一个 Claude Code、Codex 或 Gemini CLI 档案。" action={<button type="button" className="button-secondary" onClick={() => document.querySelector<HTMLInputElement>(".config-profile-form input")?.focus()}><Plus size={15} />创建档案</button>} /> : <div className="config-profile-list">{profiles.map((profile) => {
        const row = keyInfo(profile);
        const isActive = active?.profile.id === profile.id;
        return <article className={`config-profile-row ${isActive ? "active" : ""}`} key={profile.id}>
          <div className="config-profile-main"><div className="config-profile-title"><strong>{profile.name}</strong>{isActive && <StatusBadge status="online">当前</StatusBadge>}</div><div className="config-profile-meta"><span>{applicationLabels[profile.application]}</span><span>{row?.stationName ?? (profile.stationId ? profile.stationId : "外部导入")}</span><span>{profile.model || "未指定模型"}</span></div><code>{displayBaseUrl(profile)}</code></div>
          <div className="config-profile-actions"><button type="button" className="button-primary" disabled={busy || isActive} onClick={() => void apply(profile)}><Play size={15} />{isActive ? "已应用" : "应用"}</button>{profile.stationId && <button type="button" className="button-secondary" disabled={busy} onClick={() => edit(profile)} aria-label={`编辑${profile.name}`}><Pencil size={15} /></button>}<button type="button" className="button-secondary" disabled={busy} onClick={() => void remove(profile)} aria-label={`删除${profile.name}`}><Trash2 size={15} /></button></div>
        </article>;
      })}</div>}
    </Panel>

    <Panel title="客户端备份" description="每次应用配置前都会生成一个带时间戳的本地备份。恢复前会再次备份当前文件。">
      {backupPreview && <div className="config-backup-preview">
        <div><strong>恢复预览 · {backupPreview.backup.fileName}</strong><span>{applicationLabels[backupPreview.backup.application]} · {formatBackupTime(backupPreview.backup.createdAt)}</span></div>
        <div className="config-backup-preview-metrics"><span>备份文件：{formatBytes(backupPreview.backup.byteSize)}</span><span>当前文件：{backupPreview.targetExists ? formatBytes(backupPreview.targetSize) : "不存在"}</span><span>{backupPreview.canRestore ? "可以恢复" : "备份不可用"}</span></div>
        <div className="config-backup-preview-actions"><button type="button" className="button-secondary" onClick={() => setBackupPreview(null)} disabled={busy}>取消</button><button type="button" className="button-primary" onClick={() => void restorePreview()} disabled={busy || !backupPreview.canRestore}>恢复此版本</button></div>
      </div>}
      {backups.length === 0 ? <EmptyState title="暂无客户端备份" description="应用配置后，这里会出现可预览和恢复的历史版本。" /> : <div className="config-backup-list">{backups.map((backup) => <div className="config-backup-row" key={backup.id}>
        <div className="config-backup-main"><div><strong>{backup.fileName}</strong><StatusBadge status="neutral">{applicationLabels[backup.application]}</StatusBadge></div><span>{formatBackupTime(backup.createdAt)} · {formatBytes(backup.byteSize)}</span><code>{backup.targetPath}</code></div>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => void previewBackup(backup)}>预览恢复</button>
      </div>)}</div>}
    </Panel>
  </div>;
}

function SummaryItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><span>{label}</span><strong className={mono ? "mono" : ""}>{value || "—"}</strong></div>;
}

function apiBaseUrl(url: string) {
  const base = url.trim().replace(/\/+$/, "");
  if (!base) return "未解析";
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function formatBackupTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp * 1000));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
