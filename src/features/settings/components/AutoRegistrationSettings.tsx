import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button, Panel, TextField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { registrationApi, type MailOAuthStatus, type MailProvider } from "../../registration/api";
import "./AutoRegistrationSettings.css";

const labels: Record<MailProvider, string> = { gmail: "Gmail", outlook: "Microsoft Outlook", qq: "QQ 邮箱" };

export function AutoRegistrationSettings() {
  const { notify } = useToast();
  const [statuses, setStatuses] = useState<Partial<Record<MailProvider, MailOAuthStatus>>>({});
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!isTauri()) { setLoading(false); return; }
    setLoading(true);
    try {
      const entries = await Promise.all((['gmail', 'outlook', 'qq'] as MailProvider[]).map(async (provider) => [provider, await registrationApi.mailStatus(provider)] as const));
      setStatuses(Object.fromEntries(entries));
    } catch (reason) {
      notify(errorMessage(reason, "无法读取邮箱连接状态"), "error");
    } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  return <section className="auto-registration-settings">
    <MailOAuthCard provider="gmail" status={statuses.gmail} loading={loading} onStatus={(status) => setStatuses((current) => ({ ...current, gmail: status }))} onError={(reason) => notify(errorMessage(reason, "Gmail 配置失败"), "error")} onSuccess={(message) => notify(message, "success")} />
    <MailOAuthCard provider="outlook" status={statuses.outlook} loading={loading} onStatus={(status) => setStatuses((current) => ({ ...current, outlook: status }))} onError={(reason) => notify(errorMessage(reason, "Outlook 配置失败"), "error")} onSuccess={(message) => notify(message, "success")} />
    <QqMailCard status={statuses.qq} loading={loading} onStatus={(status) => setStatuses((current) => ({ ...current, qq: status }))} onError={(reason) => notify(errorMessage(reason, "QQ 邮箱配置失败"), "error")} onSuccess={(message) => notify(message, "success")} />
  </section>;
}

function MailOAuthCard({ provider, status, loading, onStatus, onError, onSuccess }: { provider: "gmail" | "outlook"; status?: MailOAuthStatus; loading: boolean; onStatus: (status: MailOAuthStatus) => void; onError: (reason: unknown) => void; onSuccess: (message: string) => void }) {
  const [clientId, setClientId] = useState(status?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (status?.clientId) setClientId(status.clientId); }, [status?.clientId]);

  const save = async () => {
    if (!clientId.trim()) { onError("请填写 OAuth Client ID"); return; }
    setBusy(true);
    try { onStatus(await registrationApi.saveMailConfig(provider, clientId.trim(), clientSecret.trim())); onSuccess(`${labels[provider]} OAuth 配置已保存`); }
    catch (reason) { onError(reason); } finally { setBusy(false); }
  };
  const connect = async () => {
    setBusy(true);
    try { onStatus(await registrationApi.connectMail(provider)); onSuccess(`${labels[provider]} 已连接`); }
    catch (reason) { onError(reason); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true);
    try { await registrationApi.disconnectMail(provider); onStatus({ provider, configured: Boolean(clientId.trim()), connected: false, email: null, redirectUri: status?.redirectUri ?? "", requiresPassword: false, clientId: clientId || null }); onSuccess(`${labels[provider]} 已断开`); }
    catch (reason) { onError(reason); } finally { setBusy(false); }
  };

  return <Panel className="settings-panel auto-registration-card">
    <header className="auto-registration-card-header">
      <div className="auto-registration-provider"><Mail size={18} /><div><h2>{labels[provider]}</h2><p>OAuth 只读取邮件，用于自动查找站点验证码。</p></div></div>
      <StatusBadge status={status} loading={loading} />
    </header>
    <div className="auto-registration-card-body">
      <div className="auto-registration-form"><label>OAuth Client ID<TextField value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Google Cloud 或 Microsoft Entra 应用 ID" /></label><label>Client Secret（如应用类型要求）<TextField type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="可留空" /></label></div>
    </div>
    <footer className="auto-registration-card-footer">
      <small className="auto-registration-help">回调地址使用本机 loopback，由应用在授权时临时生成；请在 OAuth 应用中允许桌面/本机回调。</small>
      <div className="auto-registration-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => void save()}>保存配置</Button><Button type="button" variant="primary" disabled={busy || !clientId.trim()} onClick={() => void connect()}>{busy ? <><Loader2 size={14} className="register-spin" />处理中…</> : status?.connected ? "重新授权" : "连接 OAuth"}</Button>{status?.connected && <Button type="button" variant="secondary" disabled={busy} onClick={() => void disconnect()}>断开</Button>}</div>
    </footer>
  </Panel>;
}

function QqMailCard({ status, loading, onStatus, onError, onSuccess }: { status?: MailOAuthStatus; loading: boolean; onStatus: (status: MailOAuthStatus) => void; onError: (reason: unknown) => void; onSuccess: (message: string) => void }) {
  const [email, setEmail] = useState(status?.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (status?.email) setEmail(status.email); }, [status?.email]);
  const connect = async () => {
    if (!email.trim() || !password.trim()) { onError("请填写 QQ 邮箱和 IMAP 授权码"); return; }
    setBusy(true);
    try { onStatus(await registrationApi.saveMailPassword("qq", email.trim(), password)); setPassword(""); onSuccess("QQ 邮箱已连接"); }
    catch (reason) { onError(reason); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true);
    try { await registrationApi.disconnectMail("qq"); onStatus({ provider: "qq", configured: false, connected: false, email: null, redirectUri: "", requiresPassword: true, clientId: null }); onSuccess("QQ 邮箱已断开"); }
    catch (reason) { onError(reason); } finally { setBusy(false); }
  };
  return <Panel className="settings-panel auto-registration-card">
    <header className="auto-registration-card-header">
      <div className="auto-registration-provider"><Mail size={18} /><div><h2>QQ 邮箱</h2><p>使用 IMAP 授权码读取收件箱和垃圾邮件文件夹。</p></div></div>
      <StatusBadge status={status} loading={loading} />
    </header>
    <div className="auto-registration-card-body">
      <div className="auto-registration-form auto-registration-form-qq"><label>QQ 邮箱<TextField type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="123456789@qq.com" /></label><label>IMAP 授权码<TextField type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="QQ 邮箱设置中生成的授权码" /></label></div>
    </div>
    <footer className="auto-registration-card-footer">
      <small className="auto-registration-help">请先在 QQ 邮箱设置中开启 IMAP/SMTP。应用保存的是授权码，不是网页登录密码。</small>
      <div className="auto-registration-actions"><Button type="button" variant="primary" disabled={busy} onClick={() => void connect()}>{busy ? "连接中…" : status?.connected ? "更新授权码" : "连接 QQ 邮箱"}</Button>{status?.connected && <Button type="button" variant="secondary" disabled={busy} onClick={() => void disconnect()}>断开</Button>}</div>
    </footer>
  </Panel>;
}

function StatusBadge({ status, loading }: { status?: MailOAuthStatus; loading: boolean }) {
  if (loading) return <span className="auto-registration-status pending"><Loader2 size={13} className="register-spin" />读取中</span>;
  return <span className={`auto-registration-status ${status?.connected ? "connected" : "disconnected"}`}>{status?.connected ? `已连接${status.email ? ` · ${status.email}` : ""}` : "未连接"}</span>;
}
