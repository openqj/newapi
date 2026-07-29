import { ChevronDown, Play, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { TableBulkActions } from "../../../components/ui";
import type { KeyRow } from "../../api-keys";

type BulkAction = "switch" | "test" | "session" | "delete" | null;

export function RemoteBulkActions({
  count, keyRows, action, onSwitch, onTest, onVerifySession, onDelete,
}: {
  count: number;
  keyRows: KeyRow[];
  action: BulkAction;
  onSwitch: (value: string) => void;
  onTest: () => void;
  onVerifySession: () => void;
  onDelete: () => void;
}) {
  const [switchMenuOpen, setSwitchMenuOpen] = useState(false);

  if (!count) return null;
  return <TableBulkActions summary={`${count} 台已选`}>
    <div className="remote-bulk-action-group">
      <details className="remote-bulk-switch-menu" open={switchMenuOpen} onToggle={(event) => setSwitchMenuOpen(event.currentTarget.open)}>
        <summary className="button-secondary" aria-label="一键切换中转站密钥" onClick={(event) => { if (action !== null) event.preventDefault(); }}><RefreshCw size={16} className={action === "switch" ? "animate-spin" : ""} />一键切换<ChevronDown size={15} /></summary>
        <div className="remote-bulk-switch-options">
          {keyRows.map((row) => <button type="button" key={`${row.stationId}:${row.key.id}`} disabled={action !== null} onClick={() => { setSwitchMenuOpen(false); onSwitch(`${row.stationId}:${row.key.id}`); }}>{row.stationName} · {row.key.name || row.key.id}</button>)}
          {keyRows.length === 0 && <p>暂无可用中转站密钥</p>}
        </div>
      </details>
      <button className="button-secondary" type="button" disabled={action !== null} onClick={onTest}><PlugZap size={16} className={action === "test" ? "animate-spin" : ""} />SSH测试</button>
      <button className="button-secondary" type="button" disabled={action !== null} onClick={onVerifySession}><Play size={16} className={action === "session" ? "animate-spin" : ""} />测试 Codex CLI 会话</button>
      <button className="button-secondary" type="button" disabled={action !== null} onClick={onDelete}><Trash2 size={16} className={action === "delete" ? "animate-spin" : ""} />删除</button>
    </div>
  </TableBulkActions>;
}
