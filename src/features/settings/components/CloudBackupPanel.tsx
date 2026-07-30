import { type FormEvent, useEffect, useState } from "react";
import { Cloud, HardDriveUpload, LogIn, LogOut, RotateCcw, Trash2 } from "lucide-react";
import { FormDialog, FormField, Panel, PasswordField, useConfirm, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { settingsApi } from "../api";
import { signalPersonalCenterAuthChanged } from "../../personal-center";
import type { CloudAuthStatus, CloudBackupPreview, CloudBackupSummary } from "../types";

type RecoveryAction = { kind: "backup" } | { kind: "restore"; id: string } | null;
type RestoreCandidate = { id: string; password: string; preview: CloudBackupPreview };

const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatDate = (value: string) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未知时间";

export function CloudBackupPanel({ onAuthChanged }: { onAuthChanged?: (status: CloudAuthStatus) => void }) {
  const { notify } = useToast();
  const confirm = useConfirm();
  const [auth, setAuth] = useState<CloudAuthStatus>({ configured: false });
  const [backups, setBackups] = useState<CloudBackupSummary[]>([]);
  const [localPreview, setLocalPreview] = useState<CloudBackupPreview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recoveryAction, setRecoveryAction] = useState<RecoveryAction>(null);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [candidate, setCandidate] = useState<RestoreCandidate | null>(null);

  const load = async () => {
    if (!isTauri()) return;
    const [status, local] = await Promise.all([
      settingsApi.cloudAuthStatus(),
      settingsApi.localCloudBackupPreview(),
    ]);
    setAuth(status);
    setLocalPreview(local);
  };

  useEffect(() => { void load().catch((reason) => notify(errorMessage(reason), "error")); }, []);

  const authenticate = async (event: FormEvent) => {
    event.preventDefault();
    if (registering && password !== passwordConfirmation) {
      notify("两次输入的密码不一致。", "error");
      return;
    }
    setBusy(true);
    try {
      const status = registering ? await settingsApi.cloudSignUp(email, password) : await settingsApi.cloudSignIn(email, password);
      setAuth(status);
      onAuthChanged?.(status);
      signalPersonalCenterAuthChanged(status);
      setPassword("");
      setPasswordConfirmation("");
      if (status.email) {
        await load();
        notify("已登录云端账户。", "success");
      } else {
        notify("注册成功，请先完成邮箱验证后再登录。", "success");
      }
    } catch (reason) {
      notify(errorMessage(reason), "error");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await settingsApi.cloudSignOut();
    const next = { ...auth, email: undefined, isAdmin: false };
    setAuth(next);
    onAuthChanged?.(next);
    signalPersonalCenterAuthChanged(next);
    setBackups([]);
  };

  const deleteBackup = async (backup: CloudBackupSummary) => {
    const approved = await confirm({
      title: "删除云端备份",
      description: `确定删除 ${formatDate(backup.createdAt)} 创建的备份吗？此操作无法撤销。`,
      confirmLabel: "删除",
      destructive: true,
    });
    if (!approved) return;
    setBusy(true);
    try {
      await settingsApi.deleteCloudBackup(backup.id);
      setBackups((current) => current.filter(({ id }) => id !== backup.id));
      notify("云端备份已删除。", "success");
    } catch (reason) {
      notify(errorMessage(reason), "error");
    } finally {
      setBusy(false);
    }
  };

  const requestPasswordReset = async () => {
    try {
      await settingsApi.cloudRequestPasswordReset(email);
      notify("密码重置邮件已发送，请通过邮件链接返回 RelayHub 完成重置。", "success");
    } catch (reason) {
      notify(errorMessage(reason), "error");
    }
  };

  const submitRecovery = async (event: FormEvent) => {
    event.preventDefault();
    if (!recoveryAction) return;
    setBusy(true);
    try {
      if (recoveryAction.kind === "backup") {
        await settingsApi.createCloudBackup(recoveryPassword);
        setRecoveryAction(null);
        setRecoveryPassword("");
        setBackups(await settingsApi.cloudBackups());
        notify("已创建加密云端备份。", "success");
      } else {
        const preview = await settingsApi.previewCloudBackup(recoveryAction.id, recoveryPassword);
        setCandidate({ id: recoveryAction.id, password: recoveryPassword, preview });
        setRecoveryAction(null);
        setRecoveryPassword("");
      }
    } catch (reason) {
      notify(errorMessage(reason), "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!candidate) return;
    void (async () => {
      const { preview } = candidate;
      const approved = await confirm({
        title: "恢复云端备份",
        description: `将覆盖本地数据：${preview.stationCount} 个站点、${preview.loginProfileCount} 个登录资料和 ${preview.remoteServerCount} 个远程服务器。`,
        confirmLabel: "确认恢复",
        destructive: true,
      });
      if (!approved) {
        setCandidate(null);
        return;
      }
      setBusy(true);
      try {
        await settingsApi.restoreCloudBackup(candidate.id, candidate.password);
        notify("恢复完成，页面将重新加载本地数据。", "success");
        window.setTimeout(() => window.location.reload(), 800);
      } catch (reason) {
        notify(errorMessage(reason), "error");
      } finally {
        setCandidate(null);
        setBusy(false);
      }
    })();
  }, [candidate, confirm, notify]);

  return <Panel className="personal-center-panel">
    <header className="cloud-backup-header"><Cloud size={20} /><div><h2>云端备份</h2><p>端到端加密，云端无法读取站点密码和中转密钥。</p></div></header>
    {!auth.configured && <div className="cloud-backup-unavailable">未配置 Supabase。请设置 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 后重新启动应用。</div>}
    {auth.configured && !auth.email && <form className="cloud-auth-form" onSubmit={authenticate}>
      <FormField label="邮箱"><input className="input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></FormField>
      <FormField label="账号密码"><PasswordField autoComplete={registering ? "new-password" : "current-password"} required value={password} onChange={(event) => setPassword(event.target.value)} /></FormField>
      {registering && <FormField label="确认密码"><PasswordField autoComplete="new-password" required value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} /></FormField>}
      <div className="cloud-auth-actions"><button type="submit" className="button-primary" disabled={busy}><LogIn size={16} />{registering ? "注册账户" : "登录"}</button><button type="button" className="button-secondary" disabled={busy} onClick={() => { setRegistering((value) => !value); setPasswordConfirmation(""); }}>{registering ? "已有账户" : "创建账户"}</button>{!registering && <button type="button" className="button-secondary" disabled={busy || !email} onClick={() => void requestPasswordReset()}>忘记密码</button>}</div>
    </form>}
    {auth.configured && auth.email && <>
      <div className="cloud-backup-comparison">
        <div><strong>本地数据</strong><small>{localPreview ? `${localPreview.stationCount} 个站点 · ${localPreview.loginProfileCount} 个登录资料 · ${localPreview.remoteServerCount} 个远程服务器` : "正在读取本地数据…"}</small></div>
        <div><strong>云端状态</strong><small>{backups[0] ? `最近备份：${formatDate(backups[0].createdAt)} · ${formatSize(backups[0].byteSize)}` : "点击同步到云端后更新"}</small></div>
      </div>
      <div className="cloud-account-row"><div><strong>{auth.email}</strong><small>已登录</small></div><button type="button" className="button-secondary" onClick={() => void signOut()} disabled={busy}><LogOut size={16} />退出</button></div>
      <div className="cloud-backup-actions"><button type="button" className="button-primary" onClick={() => setRecoveryAction({ kind: "backup" })} disabled={busy}><HardDriveUpload size={16} />同步到云端</button><span>保留全部历史备份</span></div>
      <div className="cloud-backup-list">{backups.map((backup) => <div key={backup.id} className="cloud-backup-row"><div><strong>{formatDate(backup.createdAt)}</strong><small>{formatSize(backup.byteSize)}</small></div><div className="cloud-backup-row-actions"><button type="button" className="button-secondary" disabled={busy} onClick={() => setRecoveryAction({ kind: "restore", id: backup.id })}><RotateCcw size={16} />恢复</button><button type="button" className="icon-button" aria-label="删除云端备份" title="删除云端备份" disabled={busy} onClick={() => void deleteBackup(backup)}><Trash2 size={16} /></button></div></div>)}{backups.length === 0 && <p>尚未创建云端备份。</p>}</div>
    </>}
    {recoveryAction && <FormDialog title={recoveryAction.kind === "backup" ? "创建加密备份" : "解锁云端备份"} description="恢复密码仅用于本次操作，不会被保存。" ariaLabel="恢复密码" onClose={() => { setRecoveryAction(null); setRecoveryPassword(""); }} onSubmit={submitRecovery} footer={<><button type="button" className="button-secondary" onClick={() => { setRecoveryAction(null); setRecoveryPassword(""); }}>取消</button><button type="submit" className="button-primary" disabled={busy}>{recoveryAction.kind === "backup" ? "创建备份" : "预览备份"}</button></>}><FormField label="恢复密码" hint="至少 12 个字符"><PasswordField autoFocus required minLength={12} value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} /></FormField></FormDialog>}
  </Panel>;
}
