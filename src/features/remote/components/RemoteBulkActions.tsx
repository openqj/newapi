import { Play, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { Button, SelectDropdown, TableBulkActions, type SelectDropdownOption } from "../../../components/ui";
import type { KeyRow } from "../../api-keys";
import { LOCAL_RELAY_SELECTION } from "../hooks";

type BulkAction = "switch" | "test" | "session" | "delete" | null;

export function RemoteBulkActions({
  count, keyRows, action, onSwitch, onSwitchLocal, onTest, onVerifySession, onDelete,
}: {
  count: number;
  keyRows: KeyRow[];
  action: BulkAction;
  onSwitch: (value: string) => void;
  onSwitchLocal: () => void;
  onTest: () => void;
  onVerifySession: () => void;
  onDelete: () => void;
}) {
  const switchOptions: SelectDropdownOption[] = [
    { value: LOCAL_RELAY_SELECTION, label: "本地中转站 / API 密钥", searchText: "本地中转站 API 密钥" },
    ...keyRows.map((row) => ({
      value: `${row.stationId}:${row.key.id}`,
      label: `${row.stationName} · ${row.key.name || row.key.id}`,
      searchText: `${row.stationName} ${row.key.name || row.key.id}`,
    })),
  ].map((option) => ({ ...option, disabled: action !== null || count === 0 }));

  return <TableBulkActions>
    <div className="remote-bulk-action-group">
      <SelectDropdown
        value=""
        options={switchOptions}
        onChange={(value) => value === LOCAL_RELAY_SELECTION ? onSwitchLocal() : onSwitch(value)}
        ariaLabel="一键切换中转站密钥"
        placeholder="一键切换"
        disabled={action !== null || count === 0}
        className="remote-bulk-switch-dropdown"
        renderValue={() => <><RefreshCw size={16} className={action === "switch" ? "animate-spin" : ""} /><span>一键切换</span></>}
        showSelectedIndicator={false}
      />
      <Button variant="secondary" disabled={action !== null || count === 0} onClick={onTest}><PlugZap size={16} className={action === "test" ? "animate-spin" : ""} />SSH测试</Button>
      <Button variant="secondary" disabled={action !== null || count === 0} onClick={onVerifySession}><Play size={16} className={action === "session" ? "animate-spin" : ""} />测试 Codex CLI 会话</Button>
      <Button variant="secondary" disabled={action !== null || count === 0} onClick={onDelete}><Trash2 size={16} className={action === "delete" ? "animate-spin" : ""} />删除</Button>
    </div>
  </TableBulkActions>;
}
