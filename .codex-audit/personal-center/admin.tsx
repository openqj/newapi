import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AdminConsole, type PersonalCenterAdminTab } from "../../src/features/personal-center/pages/PersonalCenterPage";
import type { MembershipAccess, NotificationPreferences, PersonalCenterAuditEntry, PersonalCenterLoginEvent, PersonalCenterNotification } from "../../src/features/personal-center/types";
import "../../src/App.css";

const now = Math.floor(Date.now() / 1000);
const memberships: MembershipAccess[] = [
  { stationId: "prod-main", accountId: "acme-ops", userEmail: "ops@example.com", plan: "专业版", accessLevel: "manager", enabled: true, expiresAt: now + 86400 * 21, privileges: ["usage", "apiKeys", "notifications"], updatedAt: now - 86400 * 2 },
  { stationId: "prod-main", accountId: "studio-team", userEmail: "studio@example.com", plan: "标准版", accessLevel: "member", enabled: false, expiresAt: now + 86400 * 90, privileges: ["usage"], updatedAt: now - 86400 * 7 },
  { stationId: "backup-east", accountId: "research", userEmail: "research@example.com", plan: "试用版", accessLevel: "viewer", enabled: true, expiresAt: now + 86400 * 5, privileges: [], updatedAt: now - 86400 },
];
const sentNotifications: PersonalCenterNotification[] = [
  { id: "notice-1", audience: "members", kind: "warning", title: "本周维护提醒", body: "周日 02:00-03:00 进行服务维护，请提前安排任务。", destination: "personalCenter", publishedAt: now - 86400 },
  { id: "notice-2", audience: "all", kind: "info", title: "用量报表已更新", body: "新的按站点与模型统计已上线。", destination: "overview", publishedAt: now - 86400 * 3, revokedAt: now - 86400 },
];
const loginEvents: PersonalCenterLoginEvent[] = [
  { id: 1, email: "ops@example.com", ipAddress: "198.51.100.24", userAgent: "Chrome / Windows", outcome: "success", createdAt: now - 1800 },
  { id: 2, email: "unknown@example.com", ipAddress: "203.0.113.18", userAgent: "Safari / iPhone", outcome: "failure", failureReason: "invalid_credentials", createdAt: now - 7200 },
];
const auditRecords: PersonalCenterAuditEntry[] = [
  { id: 1, action: "membership.updated", subject: "prod-main:acme-ops", detail: "专业版 / manager", createdAt: now - 7200 },
  { id: 2, action: "notification.revoked", subject: "notice-2", detail: "用量报表已更新", createdAt: now - 86400 },
];
const tabs: Array<{ id: PersonalCenterAdminTab; label: string }> = [
  { id: "notifications", label: "通知中心" },
  { id: "users", label: "用户概览" },
  { id: "membership", label: "会员权限" },
  { id: "merchants", label: "商家信息" },
  { id: "audit", label: "操作审计" },
];

function Harness() {
  const [activeTab, setActiveTab] = useState<PersonalCenterAdminTab>("notifications");
  const [preferences, setPreferences] = useState<NotificationPreferences>({ desktopEnabled: true, syncEnabled: true, alertEnabled: true, offerEnabled: false });
  return <>
    <style>{`
      html, body, #root { min-height: 100%; margin: 0; }
      body { background: #f8fafc; color: #111827; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .audit-app { display: grid; min-height: 100vh; grid-template-columns: 13.5rem minmax(0, 1fr); }
      .audit-sidebar { border-right: 1px solid #e5e7eb; background: #fff; padding: 1.35rem .9rem; }
      .audit-brand { margin: .1rem .55rem 2rem; color: #111827; font-size: 1rem; font-weight: 800; letter-spacing: .08em; }
      .audit-sidebar-label { margin: 0 .6rem .5rem; color: #94a3b8; font-size: .65rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .audit-sidebar-nav { display: grid; gap: .25rem; }
      .audit-sidebar-nav button { border: 0; border-radius: 7px; background: transparent; padding: .7rem .65rem; color: #64748b; cursor: default; font: inherit; font-size: .8rem; text-align: left; }
      .audit-sidebar-nav button.active { background: #111827; color: #fff; font-weight: 700; }
      .audit-main { min-width: 0; }
      .audit-topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-bottom: 1px solid #e5e7eb; background: #fff; padding: 1.1rem 1.5rem; }
      .audit-topbar h1 { margin: 0; font-size: 1.05rem; }
      .audit-topbar p { margin: .25rem 0 0; color: #64748b; font-size: .75rem; }
      .audit-account { color: #475569; font-size: .75rem; }
      .audit-content { max-width: 78rem; margin: 0 auto; padding: 1.25rem 1.5rem 2rem; }
      .audit-context { margin-bottom: 1rem; color: #64748b; font-size: .75rem; }
      .audit-tabs { display: flex; gap: .35rem; margin-bottom: 1rem; overflow-x: auto; border-bottom: 1px solid #e5e7eb; padding-bottom: .45rem; }
      .audit-tabs button { flex: 0 0 auto; border: 0; border-radius: 6px; background: transparent; padding: .55rem .75rem; color: #64748b; cursor: pointer; font: inherit; font-size: .78rem; }
      .audit-tabs button.active { background: #111827; color: #fff; font-weight: 700; }
      @media (max-width: 760px) { .audit-app { display: block; } .audit-sidebar { display: none; } .audit-topbar { padding: 1rem; } .audit-content { padding: 1rem .75rem 1.5rem; } .audit-account { display: none; } }
    `}</style>
    <div className="audit-app">
      <aside className="audit-sidebar"><div className="audit-brand">RELAYHUB</div><p className="audit-sidebar-label">工作台</p><nav className="audit-sidebar-nav"><button>概览</button><button>站点账户</button><button>API 密钥</button><button className="active">个人中心</button><button>设置</button></nav></aside>
      <div className="audit-main">
        <header className="audit-topbar"><div><h1>个人中心 / 管理员端</h1><p>管理通知、用户权限和操作记录</p></div><span className="audit-account">admin@example.com · 管理员</span></header>
        <main className="audit-content"><div className="audit-context">个人中心 &nbsp;/&nbsp; 管理员设置</div><nav className="audit-tabs" aria-label="管理员端页面"><>{tabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</></nav>
          <AdminConsole activeTab={activeTab} preferences={preferences} memberships={memberships} auditRecords={auditRecords} loginEvents={loginEvents} sentNotifications={sentNotifications} onPreferencesChange={setPreferences} onAddMembership={() => undefined} onManageMembership={() => undefined} onViewAudit={() => undefined} onPublishNotification={() => undefined} onEditNotification={() => undefined} onRevokeNotification={() => undefined} onDeleteNotification={() => undefined} />
        </main>
      </div>
    </div>
  </>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
