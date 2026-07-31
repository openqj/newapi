import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, ChevronRight, ClipboardList, Crown, KeyRound, LogIn, Pencil, Plus, ShieldCheck, SlidersHorizontal, Smartphone, Store, Trash2, Undo2, UserPlus, UsersRound } from "lucide-react";
import type { AppView } from "../../../app/routes";
import type { AccountRow } from "../../accounts";
import { FormDialog, FormField, Panel, PasswordField, SelectField, TextareaField, TextField, useConfirm, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { CloudBackupPanel } from "../../settings/components/CloudBackupPanel";
import { settingsApi } from "../../settings/api";
import type { CloudAuthStatus } from "../../settings/types";
import { MerchantAdminPage } from "../../merchant/pages/MerchantAdminPage";
import { MerchantCenterPage } from "../../merchant/pages/MerchantCenterPage";
import { useMembershipAccess, usePersonalCenterAuditHistory } from "../hooks";
import { personalCenterApi, signalPersonalCenterAuthChanged } from "../api";
import type { MembershipAccess, NotificationPreferences, PersonalCenterAuditEntry, PersonalCenterLoginEvent, PersonalCenterNotification, PublishNotificationRequest } from "../types";
import "./PersonalCenterPage.css";

export type AdminConsoleProps = {
  activeTab?: PersonalCenterAdminTab;
  preferences?: NotificationPreferences;
  memberships?: MembershipAccess[];
  auditRecords?: PersonalCenterAuditEntry[];
  loginEvents?: PersonalCenterLoginEvent[];
  sentNotifications?: PersonalCenterNotification[];
  loading?: boolean;
  onPreferencesChange?: (preferences: NotificationPreferences) => void;
  onAddMembership?: () => void;
  onManageMembership?: (membership: MembershipAccess) => void;
  onViewAudit?: () => void;
  onPublishNotification?: () => void;
  onEditNotification?: (notification: PersonalCenterNotification) => void;
  onRevokeNotification?: (notification: PersonalCenterNotification) => void;
  onDeleteNotification?: (notification: PersonalCenterNotification) => void;
};

export type PersonalCenterAdminTab = "notifications" | "users" | "membership" | "merchants" | "audit";

const defaultPreferences: NotificationPreferences = { desktopEnabled: true, syncEnabled: true, alertEnabled: true, offerEnabled: false };
const developmentAdminEmail = "dev@relayhub.local";
const developmentMemberEmail = "member@relayhub.local";
const developmentMerchantEmail = "merchant@relayhub.local";
const epochMilliseconds = (value: number) => value < 10_000_000_000 ? value * 1000 : value;
const formatTime = (value?: number | null) => {
  if (!value) return "长期有效";
  const date = new Date(epochMilliseconds(value));
  return Number.isNaN(date.getTime()) ? "未知时间" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(date);
};

function PreferenceSwitch({ checked, label, description, onChange }: { checked: boolean; label: string; description: string; onChange: () => void }) {
  return <label className="personal-center-preference"><span><strong>{label}</strong><small>{description}</small></span><input className="personal-center-switch" type="checkbox" checked={checked} onChange={onChange} aria-label={label} /></label>;
}

const audienceLabels = { all: "所有客户端", members: "会员客户端", guests: "未登录客户端", user: "指定用户" };

function notificationStatus(notification: PersonalCenterNotification) {
  if (notification.revokedAt) return "已撤回";
  if (notification.expiresAt && epochMilliseconds(notification.expiresAt) <= Date.now()) return "已过期";
  return "生效中";
}

export function AdminConsole({ activeTab = "notifications", preferences = defaultPreferences, memberships = [], auditRecords = [], loginEvents = [], sentNotifications = [], loading, onPreferencesChange, onAddMembership, onManageMembership, onViewAudit, onPublishNotification, onEditNotification, onRevokeNotification, onDeleteNotification }: AdminConsoleProps) {
  const activeMemberships = useMemo(() => memberships.filter((item) => item.enabled), [memberships]);
  const updatePreference = (key: keyof NotificationPreferences) => onPreferencesChange?.({ ...preferences, [key]: !preferences[key] });

  return <div className="personal-admin-console">
    {loading ? <div className="personal-admin-empty">正在加载管理员数据…</div> : <div className="personal-admin-content">
      {activeTab === "notifications" && <div className="personal-admin-grid">
        <section className="personal-admin-section"><div className="personal-admin-section-title"><BellRing size={17} /><div><h3>通知规则</h3><p>选择需要同步至个人中心的消息类型。</p></div></div><div className="personal-center-preferences">
          <PreferenceSwitch label="桌面通知" description="在应用运行时显示重要提醒" checked={preferences.desktopEnabled} onChange={() => updatePreference("desktopEnabled")} />
          <PreferenceSwitch label="同步状态" description="备份、恢复和账号同步完成后提醒" checked={preferences.syncEnabled} onChange={() => updatePreference("syncEnabled")} />
          <PreferenceSwitch label="安全告警" description="账号异常、权限变更等高优先级消息" checked={preferences.alertEnabled} onChange={() => updatePreference("alertEnabled")} />
          <PreferenceSwitch label="套餐优惠" description="接收站点公告与套餐更新" checked={preferences.offerEnabled} onChange={() => updatePreference("offerEnabled")} />
        </div></section>
        <section className="personal-admin-callout"><SlidersHorizontal size={20} /><div><strong>发布云端通知</strong><p>向全体用户或指定个人中心账户发送实时通知。</p><button type="button" className="button-primary" onClick={onPublishNotification}>发布通知 <ChevronRight size={15} /></button></div></section>
        <section className="personal-admin-section personal-admin-notification-history"><div className="personal-admin-section-title"><ClipboardList size={17} /><div><h3>已发云端通知</h3><p>保留已发记录；撤回会立刻停止展示，删除会永久移除记录。</p></div></div>{sentNotifications.length ? <div className="personal-admin-notification-list">{sentNotifications.map((notification) => <article key={notification.id}><div><div className="personal-admin-notification-heading"><strong>{notification.title}</strong><span className={notification.revokedAt ? "personal-admin-state" : "personal-admin-state enabled"}>{notificationStatus(notification)}</span></div><p>{notification.body}</p><small>{audienceLabels[notification.audience]}{notification.targetEmail ? ` · ${notification.targetEmail}` : ""} · 发布于 {formatTime(notification.publishedAt)}</small></div><aside><button type="button" className="button-secondary" onClick={() => onEditNotification?.(notification)} disabled={Boolean(notification.revokedAt)}><Pencil size={14} />修改</button>{!notification.revokedAt && <button type="button" className="button-secondary" onClick={() => onRevokeNotification?.(notification)}><Undo2 size={14} />撤回</button>}<button type="button" className="button-secondary" onClick={() => onDeleteNotification?.(notification)}><Trash2 size={14} />删除</button></aside></article>)}</div> : <div className="personal-admin-empty">暂无已发云端通知。</div>}</section>
      </div>}
      {activeTab === "users" && <div className="personal-admin-grid">
        <section className="personal-admin-section"><div className="personal-admin-section-title"><UsersRound size={17} /><div><h3>已连接用户</h3><p>通过站点账户绑定到当前个人中心的成员。</p></div></div><div className="personal-admin-metrics"><div><span>绑定账户</span><strong>{memberships.length}</strong></div><div><span>已启用权限</span><strong>{activeMemberships.length}</strong></div><div><span>即将到期</span><strong>{memberships.filter((item) => item.expiresAt && epochMilliseconds(item.expiresAt) - Date.now() < 30 * 86400000).length}</strong></div></div>
          {memberships.length ? <div className="personal-admin-user-list">{memberships.slice(0, 3).map((item) => <div key={`${item.stationId}-${item.accountId}`}><span className={item.enabled ? "personal-admin-avatar enabled" : "personal-admin-avatar"}>{item.accountId.slice(0, 1).toUpperCase()}</span><p><strong>{item.accountId}</strong><small>{item.stationId} · {item.plan}</small></p><span className={item.enabled ? "personal-admin-state enabled" : "personal-admin-state"}>{item.enabled ? "已启用" : "已停用"}</span></div>)}</div> : <div className="personal-admin-empty">尚未绑定用户。连接站点账户后会在这里显示。</div>}
        </section>
        <section className="personal-admin-section"><div className="personal-admin-section-title"><ShieldCheck size={17} /><div><h3>最近登录</h3><p>由登录服务记录的来源 IP、结果与设备信息。</p></div></div>{loginEvents.length ? <div className="personal-admin-audit-list">{loginEvents.slice(0, 5).map((event) => <article key={event.id}><span className={`personal-admin-audit-dot ${event.outcome}`} /><div><strong>{event.email}</strong><p>{event.ipAddress ?? "未知 IP"} · {event.outcome === "success" ? "登录成功" : "登录失败"}{event.userAgent ? ` · ${event.userAgent.slice(0, 60)}` : ""}</p></div><time>{formatTime(event.createdAt)}</time></article>)}</div> : <div className="personal-admin-empty">尚无服务端登录记录。</div>}</section>
      </div>}
      {activeTab === "membership" && <section className="personal-admin-section"><div className="personal-admin-section-title personal-admin-section-actions"><div className="personal-admin-section-title"><Crown size={17} /><div><h3>会员与权限</h3><p>为站点账户分配套餐、访问等级和有效期。</p></div></div><button type="button" className="button-primary" onClick={onAddMembership}><Plus size={16} />新增权限</button></div>
        {memberships.length ? <div className="personal-admin-memberships">{memberships.map((item) => <article key={`${item.stationId}-${item.accountId}`} className="personal-admin-membership"><div><span className="personal-admin-plan">{item.plan}</span><h4>{item.accountId}</h4><p>{item.userEmail} · {item.stationId} · {item.accessLevel} · 更新于 {formatTime(item.updatedAt)}</p><div className="personal-admin-privileges">{item.privileges.length ? item.privileges.map((privilege) => <span key={privilege}>{privilege}</span>) : <span>未配置额外权限</span>}</div></div><aside><span className={item.enabled ? "personal-admin-state enabled" : "personal-admin-state"}>{item.enabled ? "已启用" : "已停用"}</span><small>有效期：{formatTime(item.expiresAt)}</small><button type="button" className="button-secondary" onClick={() => onManageMembership?.(item)}>编辑权限</button></aside></article>)}</div> : <div className="personal-admin-empty">暂无会员权限记录。新增权限后将显示在这里。</div>}
      </section>}
      {activeTab === "audit" && <section className="personal-admin-section"><div className="personal-admin-section-title personal-admin-section-actions"><div className="personal-admin-section-title"><ClipboardList size={17} /><div><h3>操作审计</h3><p>保留通知、成员与权限设置的最近变更记录。</p></div></div><button type="button" className="button-secondary" onClick={onViewAudit}>查看完整记录 <ChevronRight size={15} /></button></div>
        {auditRecords.length ? <div className="personal-admin-audit-list">{auditRecords.slice(0, 5).map((record) => <article key={record.id}><span className="personal-admin-audit-dot" /><div><strong>{record.action}</strong><p>{record.subject} · {record.detail}</p></div><time>{formatTime(record.createdAt)}</time></article>)}</div> : <div className="personal-admin-empty">尚无操作记录。管理员配置变更后会自动留存审计信息。</div>}
      </section>}
    </div>}
  </div>;
}

type PersonalCenterPageProps = {
  accountRows: AccountRow[];
  preferences: NotificationPreferences;
  onPreferencesChange: (preferences: NotificationPreferences) => Promise<boolean>;
  onAuthChanged?: (status: CloudAuthStatus) => void;
  onNavigate?: (view: AppView) => void;
};

export function PersonalCenterPage({ accountRows, preferences, onPreferencesChange, onAuthChanged, onNavigate }: PersonalCenterPageProps) {
  const confirm = useConfirm();
  const { notify } = useToast();
  const [auth, setAuth] = useState<CloudAuthStatus | null>(null);
  const [editing, setEditing] = useState<MembershipAccess | null>(null);
  const [isEditorOpen, setEditorOpen] = useState(false);
  const [isNotificationEditorOpen, setNotificationEditorOpen] = useState(false);
  const [editingNotification, setEditingNotification] = useState<PersonalCenterNotification | null>(null);
  const [publishingNotification, setPublishingNotification] = useState(false);
  const [sentNotifications, setSentNotifications] = useState<PersonalCenterNotification[]>([]);
  const [sentNotificationsLoading, setSentNotificationsLoading] = useState(false);
  const [loginEvents] = useState<PersonalCenterLoginEvent[]>([]);
  const [activeSection, setActiveSection] = useState<"overview" | "merchant" | "admin">("overview");
  const [activeAdminTab, setActiveAdminTab] = useState<PersonalCenterAdminTab>("notifications");
  const authLoadVersion = useRef(0);
  const { memberships, loading: membershipsLoading, saving, saveMembership, deleteMembership, loadMemberships } = useMembershipAccess({ loadOnMount: false });
  const { entries, loading: auditLoading, loadAuditHistory } = usePersonalCenterAuditHistory({ loadOnMount: false, limit: 100 });
  const isDevelopmentBypass = import.meta.env.DEV && (auth?.email === developmentAdminEmail || auth?.email === developmentMemberEmail || auth?.email === developmentMerchantEmail);

  useEffect(() => {
    if (!isTauri()) {
      const status = { configured: true };
      setAuth(status);
      onAuthChanged?.(status);
      return;
    }
    const version = ++authLoadVersion.current;
    void settingsApi.cloudAuthStatus().then((status) => {
      if (version !== authLoadVersion.current) return;
      setActiveSection(status.role === "admin" || status.isAdmin ? "admin" : "overview");
      setAuth(status);
      onAuthChanged?.(status);
    }).catch(() => {
      if (version === authLoadVersion.current) setAuth({ configured: false });
    });
  }, [onAuthChanged]);

  const acceptAuthStatus = useCallback((status: CloudAuthStatus) => {
    authLoadVersion.current += 1;
    setActiveSection(status.role === "admin" || status.isAdmin ? "admin" : "overview");
    setAuth(status);
    onAuthChanged?.(status);
  }, [onAuthChanged]);

  const openNewMembership = () => {
    if (!accountRows.length) return;
    setEditing(null);
    setEditorOpen(true);
  };
  const save = async (membership: MembershipAccess) => {
    if (await saveMembership(membership)) {
      setEditorOpen(false);
      await loadAuditHistory();
    }
  };
  const remove = async (membership: MembershipAccess) => {
    const approved = await confirm({
      title: "撤销会员权限",
      description: `确定撤销 ${membership.accountId} 的云端会员权限吗？该账户不会从站点删除。`,
      confirmLabel: "撤销权限",
      destructive: true,
    });
    if (approved && await deleteMembership(membership.stationId, membership.accountId)) {
      setEditorOpen(false);
      await loadAuditHistory();
    }
  };
  const publishNotification = async (request: PublishNotificationRequest) => {
    setPublishingNotification(true);
    try {
      if (editingNotification) await personalCenterApi.updateNotification(editingNotification.id, request);
      else await personalCenterApi.publishNotification(request);
      setNotificationEditorOpen(false);
      setEditingNotification(null);
      await loadSentNotifications();
      notify(editingNotification ? "通知已修改。" : "通知已发布并同步到服务器。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "发布通知失败。"), "error");
    } finally {
      setPublishingNotification(false);
    }
  };
  const loadSentNotifications = async () => {
    setSentNotificationsLoading(true);
    try {
      setSentNotifications(await personalCenterApi.sentNotifications());
    } catch (reason) {
      notify(errorMessage(reason, "加载已发云端通知失败。"), "error");
    } finally {
      setSentNotificationsLoading(false);
    }
  };
  const selectAdminTab = (tab: PersonalCenterAdminTab) => {
    setActiveSection("admin");
    setActiveAdminTab(tab);
    if (tab === "notifications") void loadSentNotifications();
    if (tab === "users" || tab === "membership") void loadMemberships();
    if (tab === "audit") void loadAuditHistory();
  };
  const revokeNotification = async (notification: PersonalCenterNotification) => {
    const approved = await confirm({ title: "撤回云端通知", description: `确定撤回“${notification.title}”吗？用户将不再看到此通知，但已发记录会保留。`, confirmLabel: "撤回通知", destructive: true });
    if (!approved) return;
    try {
      await personalCenterApi.revokeNotification(notification.id);
      await loadSentNotifications();
      notify("通知已撤回。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "撤回通知失败。"), "error");
    }
  };
  const deleteNotification = async (notification: PersonalCenterNotification) => {
    const approved = await confirm({ title: "删除云端通知记录", description: `确定永久删除“${notification.title}”吗？此操作不可恢复。`, confirmLabel: "删除记录", destructive: true });
    if (!approved) return;
    try {
      await personalCenterApi.deleteNotification(notification.id);
      await loadSentNotifications();
      notify("通知记录已删除。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "删除通知记录失败。"), "error");
    }
  };

  useEffect(() => {
    if (auth?.isAdmin) void loadSentNotifications();
  }, [auth?.isAdmin]);

  if (!auth) return <Panel className="personal-center-panel"><p className="personal-admin-empty">正在加载个人中心…</p></Panel>;
  if (!auth.email) return <PersonalCenterLogin auth={auth} onAuthenticated={acceptAuthStatus} />;

  const role = auth.role ?? (auth.isAdmin ? "admin" : "member");
  const canSync = role === "pro" || role === "merchant" || role === "admin";
  const canMerchant = role === "merchant" || role === "admin";
  const canAdmin = role === "admin";

  return <>
    <PersonalCenterHeaderNav role={role} activeSection={activeSection} activeAdminTab={activeAdminTab} canSync={canSync} canMerchant={canMerchant} canAdmin={canAdmin} onSelectSection={setActiveSection} onSelectAdminTab={selectAdminTab} onNavigate={onNavigate} />
    {activeSection === "merchant" && canMerchant ? <MerchantCenterPage /> : activeSection === "admin" && canAdmin && activeAdminTab === "merchants" ? <MerchantAdminPage /> : activeSection === "admin" && canAdmin ? <AdminConsole
      activeTab={activeAdminTab}
      preferences={preferences}
      memberships={memberships}
      auditRecords={entries}
      loginEvents={loginEvents}
      sentNotifications={sentNotifications}
      loading={membershipsLoading || auditLoading || sentNotificationsLoading}
      onPreferencesChange={(next) => { void onPreferencesChange(next); }}
      onAddMembership={openNewMembership}
      onManageMembership={(membership) => { setEditing(membership); setEditorOpen(true); }}
      onViewAudit={() => void loadAuditHistory()}
      onPublishNotification={() => { setEditingNotification(null); setNotificationEditorOpen(true); }}
      onEditNotification={(notification) => { setEditingNotification(notification); setNotificationEditorOpen(true); }}
      onRevokeNotification={(notification) => void revokeNotification(notification)}
      onDeleteNotification={(notification) => void deleteNotification(notification)}
    /> : <><Panel className="personal-center-panel personal-standard-panel" title="我的会员权限" description="管理员分配的站点权限由服务器同步到当前账户。">
      {membershipsLoading ? <p className="personal-admin-empty">正在同步会员权限…</p> : memberships.length ? <div className="personal-admin-memberships">{memberships.map((item) => <article key={`${item.stationId}-${item.accountId}`} className="personal-admin-membership"><div><span className="personal-admin-plan">{item.plan}</span><h4>{item.accountId}</h4><p>{item.stationId} · {item.accessLevel} · 更新于 {formatTime(item.updatedAt)}</p><div className="personal-admin-privileges">{item.privileges.length ? item.privileges.map((privilege) => <span key={privilege}>{privilege}</span>) : <span>未配置额外权限</span>}</div></div><aside><span className={item.enabled ? "personal-admin-state enabled" : "personal-admin-state"}>{item.enabled ? "已启用" : "已停用"}</span><small>有效期：{formatTime(item.expiresAt)}</small></aside></article>)}</div> : <div className="personal-admin-empty">当前账户尚未分配会员权限。</div>}
    </Panel><MobileAppConnection email={auth.email} /></>}
    {!isDevelopmentBypass && <CloudBackupPanel onAuthChanged={(status) => { acceptAuthStatus(status); signalPersonalCenterAuthChanged(status); }} />}
    {auth.isAdmin && isEditorOpen && <MembershipEditor accountRows={accountRows} membership={editing} saving={saving} onClose={() => setEditorOpen(false)} onSave={save} onDelete={remove} />}
    {auth.isAdmin && isNotificationEditorOpen && <NotificationEditor notification={editingNotification} saving={publishingNotification} onClose={() => { setNotificationEditorOpen(false); setEditingNotification(null); }} onSave={publishNotification} />}
  </>;
}

function PersonalCenterHeaderNav({ role, activeSection, activeAdminTab, canSync, canMerchant, canAdmin, onSelectSection, onSelectAdminTab, onNavigate }: { role: "member" | "pro" | "merchant" | "admin"; activeSection: "overview" | "merchant" | "admin"; activeAdminTab: PersonalCenterAdminTab; canSync: boolean; canMerchant: boolean; canAdmin: boolean; onSelectSection: (section: "overview" | "merchant" | "admin") => void; onSelectAdminTab: (tab: PersonalCenterAdminTab) => void; onNavigate?: (view: AppView) => void }) {
  const adminItems: Array<{ id: PersonalCenterAdminTab; label: string; Icon: typeof BellRing }> = [
    { id: "notifications", label: "通知中心", Icon: BellRing },
    { id: "users", label: "用户概览", Icon: UsersRound },
    { id: "membership", label: "会员权限", Icon: Crown },
    { id: "merchants", label: "商家信息", Icon: Store },
    { id: "audit", label: "操作审计", Icon: ClipboardList },
  ];

  return <nav className="personal-center-header-nav" aria-label="个人中心功能导航">
    <div className="personal-center-header-nav-items">
      <button type="button" className={`personal-center-header-nav-item ${activeSection === "overview" ? "active" : ""}`} aria-current={activeSection === "overview" ? "page" : undefined} onClick={() => onSelectSection("overview")}>个人概览</button>
      {canSync && <button type="button" className="personal-center-header-nav-item" onClick={() => onNavigate?.("remote")}>同步功能</button>}
      {canMerchant && <button type="button" className={`personal-center-header-nav-item ${activeSection === "merchant" ? "active" : ""}`} aria-current={activeSection === "merchant" ? "page" : undefined} onClick={() => onSelectSection("merchant")}>商家端</button>}
      {canAdmin && adminItems.map(({ id, label, Icon }) => <button key={id} type="button" className={`personal-center-header-nav-item personal-center-admin-nav-item ${activeSection === "admin" && activeAdminTab === id ? "active" : ""}`} aria-current={activeSection === "admin" && activeAdminTab === id ? "page" : undefined} onClick={() => onSelectAdminTab(id)}><Icon size={15} />{label}</button>)}
    </div>
    <span className="personal-center-role-badge">{role === "admin" ? "管理员" : role === "merchant" ? "商家" : role === "pro" ? "Pro 会员" : "普通账号"}</span>
  </nav>;
}

function MobileAppConnection({ email }: { email?: string }) {
  return <Panel className="personal-center-panel mobile-app-connection-panel">
    <div className="mobile-app-connection-icon"><Smartphone size={20} /></div>
    <div className="mobile-app-connection-content">
      <h2>连接手机 App</h2>
      <p>RelayHub Mobile 与桌面端共用个人中心账户。连接后可在手机端查看设备状态、当前密钥与用量概览。</p>
      <ol>
        <li>在手机端打开 RelayHub Mobile。</li>
        <li>使用下方个人中心账户登录。</li>
        <li>等待手机端显示“已连接”或“数据已同步”。</li>
      </ol>
    </div>
    <div className="mobile-app-connection-account"><span>连接账户</span><strong>{email ?? "未获取"}</strong></div>
  </Panel>;
}

function NotificationEditor({ notification, saving, onClose, onSave }: { notification: PersonalCenterNotification | null; saving: boolean; onClose: () => void; onSave: (request: PublishNotificationRequest) => Promise<void> }) {
  const [audience, setAudience] = useState<"all" | "members" | "guests" | "user">(notification?.audience ?? "all");
  const [targetEmail, setTargetEmail] = useState(notification?.targetEmail ?? "");
  const [kind, setKind] = useState<"info" | "warning" | "offer">(notification?.kind ?? "info");
  const [title, setTitle] = useState(notification?.title ?? "");
  const [body, setBody] = useState(notification?.body ?? "");
  const [destination, setDestination] = useState<"overview" | "offers" | "personalCenter">(notification?.destination ?? "personalCenter");
  const [expiresAt, setExpiresAt] = useState(notification?.expiresAt ? new Date(epochMilliseconds(notification.expiresAt)).toISOString().slice(0, 10) : "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({
      audience,
      targetEmail: audience === "user" ? targetEmail : undefined,
      kind,
      title,
      body,
      destination,
      expiresAt: expiresAt ? Math.floor(new Date(`${expiresAt}T23:59:59`).getTime() / 1000) : undefined,
    });
  };
  return <FormDialog title={notification ? "修改云端通知" : "发布云端通知"} description="在线用户将通过 Realtime 秒级收到；离线用户下次启动或恢复窗口时补拉。" ariaLabel="云端通知" onClose={onClose} onSubmit={submit} footer={<><button type="button" className="button-secondary" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="button-primary" disabled={saving || !title.trim() || !body.trim() || (audience === "user" && !targetEmail.includes("@"))}>{saving ? "保存中" : notification ? "保存修改" : "发布通知"}</button></>}>
    <div className="personal-membership-form">
      <div className="personal-membership-grid"><FormField label="接收范围"><SelectField value={audience} onChange={(event) => setAudience(event.target.value as "all" | "members" | "guests" | "user")}><option value="all">所有客户端</option><option value="members">会员客户端</option><option value="guests">未登录客户端</option><option value="user">指定用户</option></SelectField></FormField><FormField label="通知类型"><SelectField value={kind} onChange={(event) => setKind(event.target.value as "info" | "warning" | "offer")}><option value="info">系统公告</option><option value="warning">安全提醒</option><option value="offer">套餐优惠</option></SelectField></FormField></div>
      {audience === "user" && <FormField label="个人中心账户"><TextField type="email" required value={targetEmail} onChange={(event) => setTargetEmail(event.target.value)} placeholder="user@example.com" /></FormField>}
      <FormField label="通知标题"><TextField required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></FormField>
      <FormField label="通知内容"><TextareaField required maxLength={2000} rows={5} value={body} onChange={(event) => setBody(event.target.value)} /></FormField>
      <div className="personal-membership-grid"><FormField label="打开后前往"><SelectField value={destination} onChange={(event) => setDestination(event.target.value as "overview" | "offers" | "personalCenter")}><option value="personalCenter">个人中心</option><option value="overview">仪表盘</option><option value="offers">优惠中心</option></SelectField></FormField><FormField label="有效期"><TextField type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></FormField></div>
    </div>
  </FormDialog>;
}

function PersonalCenterLogin({ auth, onAuthenticated }: { auth: CloudAuthStatus; onAuthenticated: (auth: CloudAuthStatus) => void }) {
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (registering && password !== passwordConfirmation) {
      notify("两次输入的密码不一致。", "error");
      return;
    }
    if (!isTauri()) {
      notify("登录仅能在 RelayHub 桌面应用中完成。", "info");
      return;
    }
    setBusy(true);
    try {
      const status = registering ? await settingsApi.cloudSignUp(email, password) : await settingsApi.cloudSignIn(email, password);
      onAuthenticated(status);
      signalPersonalCenterAuthChanged(status);
      setPassword("");
      setPasswordConfirmation("");
      notify(status.email ? "已登录个人中心。" : "注册成功，请完成邮箱验证后登录。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "登录失败，请检查邮箱和密码。"), "error");
    } finally {
      setBusy(false);
    }
  };
  const resetPassword = async () => {
    try {
      await settingsApi.cloudRequestPasswordReset(email);
      notify("密码重置邮件已发送。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "无法发送密码重置邮件。"), "error");
    }
  };
  const devSignIn = (email: string, requestedRole: "member" | "merchant" | "admin" | boolean) => {
    const role = typeof requestedRole === "boolean" ? (requestedRole ? "admin" : "member") : requestedRole;
    const status: CloudAuthStatus = { configured: true, email, isAdmin: role === "admin", role };
    const isAdmin = role === "admin";
    onAuthenticated(status);
    signalPersonalCenterAuthChanged(status);
    notify(isAdmin ? "已用开发管理员账号进入个人中心。" : "已用开发普通用户账号进入个人中心。", "success");
  };

  return <Panel className="personal-center-panel personal-login-panel">
    <div className="personal-login-heading">
      <span className="personal-login-icon"><ShieldCheck size={20} /></span>
      <div><h2>{registering ? "注册个人中心" : "登录个人中心"}</h2><p>{auth.configured ? "使用云端账户登录，管理备份、通知与会员权限。" : "个人中心服务尚未配置。"}</p></div>
    </div>
    {auth.configured ? <form className="personal-login-form" onSubmit={submit}>
      <div className="personal-login-fields">
        <FormField label="邮箱" required><TextField type="email" autoComplete="email" required placeholder="请输入邮箱地址" value={email} onChange={(event) => setEmail(event.target.value)} /></FormField>
        <FormField label="密码" required><PasswordField autoComplete={registering ? "new-password" : "current-password"} required minLength={8} placeholder={registering ? "请设置至少 8 位密码" : "请输入账户密码"} value={password} onChange={(event) => setPassword(event.target.value)} /></FormField>
        {registering && <FormField label="确认密码" required><PasswordField autoComplete="new-password" required minLength={8} placeholder="请再次输入密码" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} /></FormField>}
      </div>
      <div className="personal-login-actions">
        {import.meta.env.DEV && !registering && <button type="button" className="button-secondary" disabled={busy} onClick={() => devSignIn(developmentMerchantEmail, "merchant")}><Store size={16} />一键登录商家</button>}
        <button type="button" className="button-secondary" disabled={busy} onClick={() => { setRegistering((value) => !value); setPasswordConfirmation(""); }}><UserPlus size={16} />{registering ? "已有账户" : "注册账户"}</button>
        {!registering && <button type="button" className="button-secondary" disabled={busy || !email} onClick={() => void resetPassword()}><KeyRound size={16} />忘记密码</button>}
        {import.meta.env.DEV && !registering && <><button type="button" className="button-secondary" disabled={busy} onClick={() => devSignIn(developmentAdminEmail, true)}><LogIn size={16} />一键登录管理员</button><button type="button" className="button-secondary" disabled={busy} onClick={() => devSignIn(developmentMemberEmail, false)}><LogIn size={16} />一键登录会员</button></>}
        <button type="submit" className="button-primary personal-login-submit" disabled={busy}><LogIn size={16} />{busy ? "请稍候" : registering ? "创建账户" : "登录"}</button>
      </div>
    </form> : <p className="cloud-backup-unavailable">Supabase 服务未配置，暂时无法登录个人中心。</p>}
  </Panel>;
}

const privilegeOptions = [
  ["usage", "用量记录"],
  ["apiKeys", "API 密钥"],
  ["billing", "账单信息"],
  ["notifications", "通知规则"],
  ["members", "成员管理"],
  ["admin", "管理员设置"],
] as const;

function MembershipEditor({ accountRows, membership, saving, onClose, onSave, onDelete }: {
  accountRows: AccountRow[];
  membership: MembershipAccess | null;
  saving: boolean;
  onClose: () => void;
  onSave: (membership: MembershipAccess) => Promise<void>;
  onDelete: (membership: MembershipAccess) => Promise<void>;
}) {
  const initialAccount = membership ? `${membership.stationId}:${membership.accountId}` : accountRows[0] ? `${accountRows[0].stationId}:${accountRows[0].account.id}` : "";
  const [account, setAccount] = useState(initialAccount);
  const [userEmail, setUserEmail] = useState(membership?.userEmail ?? "");
  const [plan, setPlan] = useState(membership?.plan ?? "standard");
  const [accessLevel, setAccessLevel] = useState(membership?.accessLevel ?? "member");
  const [enabled, setEnabled] = useState(membership?.enabled ?? true);
  const [expiresAt, setExpiresAt] = useState(membership?.expiresAt ? new Date(epochMilliseconds(membership.expiresAt)).toISOString().slice(0, 10) : "");
  const [privileges, setPrivileges] = useState<string[]>(membership?.privileges ?? ["usage"]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const separator = account.indexOf(":");
    if (separator < 1) return;
    const timestamp = expiresAt ? Math.floor(new Date(`${expiresAt}T23:59:59`).getTime() / 1000) : undefined;
    void onSave({
      stationId: account.slice(0, separator),
      accountId: account.slice(separator + 1),
      userEmail,
      plan,
      accessLevel,
      enabled,
      expiresAt: timestamp,
      privileges,
      updatedAt: membership?.updatedAt ?? 0,
    });
  };
  const togglePrivilege = (value: string) => setPrivileges((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  return <FormDialog title={membership ? "编辑会员权限" : "新增会员权限"} description="权限会同步到服务器，并自动下发给对应的个人中心账户。" ariaLabel="会员权限" onClose={onClose} onSubmit={submit} footer={<><button type="button" className="button-secondary" onClick={onClose} disabled={saving}>取消</button>{membership && <button type="button" className="button-secondary" onClick={() => void onDelete(membership)} disabled={saving}>撤销权限</button>}<button type="submit" className="button-primary" disabled={saving || !account || !userEmail.includes("@")}>{saving ? "保存中" : "保存权限"}</button></>}>
    <div className="personal-membership-form">
      <FormField label="站点账户"><SelectField value={account} onChange={(event) => setAccount(event.target.value)} disabled={Boolean(membership)}>{accountRows.map((row) => <option key={`${row.stationId}:${row.account.id}`} value={`${row.stationId}:${row.account.id}`}>{row.stationName} · {row.account.displayName || row.account.username || row.account.id}</option>)}</SelectField></FormField>
      <FormField label="个人中心账户"><TextField type="email" required placeholder="user@example.com" value={userEmail} onChange={(event) => setUserEmail(event.target.value)} /></FormField>
      <div className="personal-membership-grid"><FormField label="会员套餐"><TextField required value={plan} onChange={(event) => setPlan(event.target.value)} /></FormField><FormField label="访问级别"><SelectField value={accessLevel} onChange={(event) => setAccessLevel(event.target.value)}><option value="viewer">只读</option><option value="member">会员</option><option value="manager">管理员</option><option value="admin">超级管理员</option></SelectField></FormField></div>
      <div className="personal-membership-grid"><FormField label="有效期"><TextField type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></FormField><label className="personal-membership-enabled"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用此会员权限</label></div>
      <fieldset className="personal-membership-privileges"><legend>附加权限</legend>{privilegeOptions.map(([value, label]) => <label key={value}><input type="checkbox" checked={privileges.includes(value)} onChange={() => togglePrivilege(value)} />{label}</label>)}</fieldset>
    </div>
  </FormDialog>;
}
