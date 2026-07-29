import { BadgePercent, CheckCheck, Megaphone, RefreshCw, TriangleAlert, X } from "lucide-react";
import type { NotificationMessage } from "./types";

const notificationIcon = {
  sync: RefreshCw,
  warning: TriangleAlert,
  offer: BadgePercent,
  announcement: Megaphone,
};

function kindLabel(kind: NotificationMessage["kind"]) {
  if (kind === "sync") return "同步";
  if (kind === "warning") return "提醒";
  if (kind === "offer") return "优惠";
  return "公告";
}

export function MessagesDialog({ messages, unreadCount, onClose, onMarkAllRead, onOpen }: {
  messages: NotificationMessage[];
  unreadCount: number;
  onClose: () => void;
  onMarkAllRead: () => void | Promise<void>;
  onOpen: (message: NotificationMessage) => void | Promise<void>;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal messages-dialog" role="dialog" aria-modal="true" aria-label="通知中心">
      <div className="form-dialog-header">
        <div><h2 className="font-semibold">通知中心</h2><p className="form-dialog-description">系统公告、同步状态、数据异常和站点优惠</p></div>
        <div className="messages-header-actions">
          {unreadCount > 0 && <button type="button" className="button-secondary messages-read-all" onClick={() => void onMarkAllRead()}><CheckCheck size={15} />全部已读</button>}
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={17} /></button>
        </div>
      </div>
      <div className="messages-list">
        {messages.map((message) => {
          const Icon = notificationIcon[message.kind];
          return <article className="message-item" key={message.id}>
            <div className={`message-icon ${message.kind}`}><Icon size={16} /></div>
            <div className="message-content">
              <div className="message-title"><h3>{message.title}</h3><span className={`message-kind ${message.kind}`}>{kindLabel(message.kind)}</span></div>
              <p>{message.summary}</p>
              <div className="message-meta"><time>{formatCreatedAt(message.createdAt)}</time><button type="button" className="message-open" onClick={() => void onOpen(message)}>查看</button></div>
            </div>
          </article>;
        })}
        {messages.length === 0 && <p className="messages-empty">暂无通知。</p>}
      </div>
    </section>
  </div>;
}

function formatCreatedAt(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value);
}
