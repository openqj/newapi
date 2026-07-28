import { History, Plus } from "lucide-react";

export function RemoteConfigToolbar({ onAdd, onShowAuditHistory }: { onAdd: () => void; onShowAuditHistory: () => void }) {
  return <div className="flex items-end justify-between">
    <div>
      <p className="text-sm text-slate-500">服务器连接与中转路由</p>
      <h1 className="mt-1 text-2xl font-semibold">远程配置</h1>
    </div>
    <div className="flex gap-2">
      <button className="button-secondary" type="button" onClick={onShowAuditHistory} title="Configuration history"><History size={16} /></button>
      <button className="button-primary" type="button" onClick={onAdd}><Plus size={16} />添加服务器</button>
    </div>
  </div>;
}
