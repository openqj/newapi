import { PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { TableBulkActions } from "../../../components/ui";
import type { KeyRow } from "../../api-keys";

type BulkAction = "switch" | "test" | "delete" | null;

export function RemoteBulkActions({
  count, keyRows, selection, action, onSelectionChange, onSwitch, onTest, onDelete,
}: {
  count: number;
  keyRows: KeyRow[];
  selection: string;
  action: BulkAction;
  onSelectionChange: (value: string) => void;
  onSwitch: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  if (!count) return null;
  return <TableBulkActions summary={`${count} 台已选`}>
    <select className="input remote-bulk-key-select" aria-label="选择批量切换的中转站密钥" value={selection} onChange={(event) => onSelectionChange(event.target.value)} disabled={action !== null}>
      <option value="">选择中转站密钥</option>
      {keyRows.map((row) => <option key={`${row.stationId}:${row.key.id}`} value={`${row.stationId}:${row.key.id}`}>{row.stationName} · {row.key.name || row.key.id}</option>)}
    </select>
    <button className="button-secondary" type="button" disabled={!selection || action !== null} onClick={onSwitch}><RefreshCw size={16} className={action === "switch" ? "animate-spin" : ""} />一键切换</button>
    <button className="button-secondary" type="button" disabled={action !== null} onClick={onTest}><PlugZap size={16} className={action === "test" ? "animate-spin" : ""} />一键测试</button>
    <button className="button-secondary" type="button" disabled={action !== null} onClick={onDelete}><Trash2 size={16} className={action === "delete" ? "animate-spin" : ""} />删除</button>
  </TableBulkActions>;
}
