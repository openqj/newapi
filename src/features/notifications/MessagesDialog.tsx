import { BadgePercent, CheckCheck, Megaphone, RefreshCw, TriangleAlert } from "lucide-react";
import { Button, Dialog, List, ListItem } from "../../components/ui";
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
  return <Dialog
    title="通知中心"
    description="系统公告、同步状态、数据异常和站点优惠"
    ariaLabel="通知中心"
    className="messages-dialog"
    contentClassName="messages-dialog-content"
    onClose={onClose}
    headerActions={unreadCount > 0 && <Button type="button" variant="secondary" className="messages-read-all" onClick={() => void onMarkAllRead()}><CheckCheck size={15} />全部已读</Button>}
  >
    <List className="messages-list">
      {messages.map((message) => {
        const Icon = notificationIcon[message.kind];
        return <ListItem as="article" className="message-item" key={message.id}>
          <div className={`message-icon ${message.kind}`}><Icon size={16} /></div>
          <div className="message-content">
            <div className="message-title"><h3>{message.title}</h3><span className={`message-kind ${message.kind}`}>{kindLabel(message.kind)}</span></div>
            <p>{message.summary}</p>
            <div className="message-meta"><time>{formatCreatedAt(message.createdAt)}</time><Button type="button" variant="ghost" className="message-open" onClick={() => void onOpen(message)}>查看</Button></div>
          </div>
        </ListItem>;
      })}
      {messages.length === 0 && <p className="messages-empty">暂无通知。</p>}
    </List>
  </Dialog>;
}

function formatCreatedAt(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value);
}
