import { X } from "lucide-react";

type OfferMessage = { id: string; title: string; summary: string; publishedAt?: number };

export function MessagesDialog({ stationName, offers, onClose }: { stationName: string; offers: OfferMessage[]; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal messages-dialog" role="dialog" aria-modal="true" aria-label="消息"><div className="form-dialog-header"><div><h2 className="font-semibold">消息</h2><p className="form-dialog-description">{stationName} 的最新公告</p></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={17} /></button></div><div className="messages-list">{offers.map((offer) => <article className="message-item" key={offer.id}><h3>{offer.title}</h3><p>{offer.summary}</p><time>{formatPublishedAt(offer.publishedAt)}</time></article>)}{offers.length === 0 && <p className="messages-empty">暂无消息。</p>}</div></section></div>;
}

function formatPublishedAt(value?: number) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000) : "尚未同步";
}
