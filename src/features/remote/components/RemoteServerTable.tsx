import { DataTable, EmptyState } from "../../../components/ui";
import type { KeyRow } from "../../api-keys";
import { RemoteServerRow, type RelayDraft, type RelayEditing } from "./RemoteServerRow";
import type { RemoteServer } from "../types";

type RemoteServerTableProps = {
  servers: RemoteServer[];
  keyRows: KeyRow[];
  selectedServerIds: string[];
  saving: string | null;
  savingRelay: string | null;
  testingServer: string | null;
  verifyingSession: string | null;
  loadingLogs: string | null;
  codexAction: string | null;
  deletingServer: string | null;
  editingRelay: RelayEditing;
  selectedKeyValue: (serverId: string) => string;
  selectedKeyLabel: (serverId: string) => string;
  relayDraft: (server: RemoteServer) => RelayDraft;
  onToggleAll: () => void;
  onToggleSelected: (serverId: string) => void;
  onSwitchKey: (server: RemoteServer, value: string) => void;
  onSwitchLocal: (server: RemoteServer) => void;
  onOpenEditor: (server: RemoteServer) => void;
  onTest: (server: RemoteServer) => void;
  onShowLogs: (server: RemoteServer) => void;
  onVerifySession: (server: RemoteServer) => void;
  onCancelOperation: (server: RemoteServer) => void;
  onDelete: (server: RemoteServer) => void;
  onManageCodex: (server: RemoteServer, action: "install" | "update") => void;
  onStartRelayEdit: (server: RemoteServer, field: "url" | "key") => void;
  onCancelRelayEdit: (server: RemoteServer, field: "url" | "key") => void;
  onRelayDraftChange: (server: RemoteServer, patch: Partial<RelayDraft>) => void;
  onSaveRelay: (server: RemoteServer) => void;
};

export function RemoteServerTable({
  servers, keyRows, selectedServerIds, saving, savingRelay, testingServer,
  verifyingSession, loadingLogs, codexAction, deletingServer, editingRelay, selectedKeyValue, selectedKeyLabel,
  relayDraft, onToggleAll, onToggleSelected, onSwitchKey, onSwitchLocal,
  onOpenEditor, onTest, onShowLogs, onVerifySession, onCancelOperation, onDelete,
  onManageCodex, onStartRelayEdit, onCancelRelayEdit, onRelayDraftChange, onSaveRelay,
}: RemoteServerTableProps) {
  return <DataTable
    className="mt-5"
    ariaLabel="远程服务器"
    isEmpty={servers.length === 0}
    empty={<EmptyState message="尚未添加远程服务器。" />}
    desktop={<table className="remote-config-table">
      <colgroup><col className="remote-config-select-column" /><col className="remote-config-id-column" /><col className="remote-config-status-column" /><col span={8} /><col className="remote-config-actions-column" /></colgroup>
      <thead><tr>
        <th className="remote-config-select-cell"><input type="checkbox" aria-label="全选远程服务器" checked={servers.length > 0 && selectedServerIds.length === servers.length} onChange={onToggleAll} /></th>
        <th>ID</th><th>状态</th><th>别名</th><th>主机</th><th>端口</th><th>身份文件</th><th>版本</th><th>中转站地址</th><th>中转站密钥</th><th>一键切换</th><th>管理</th>
      </tr></thead>
      <tbody>{servers.map((server, index) => <RemoteServerRow
        key={server.id}
        server={server}
        index={index}
        keyRows={keyRows}
        selected={selectedServerIds.includes(server.id)}
        selectedKeyValue={selectedKeyValue(server.id)}
        selectedKeyLabel={selectedKeyLabel(server.id)}
        saving={saving === server.id}
        savingRelay={savingRelay === server.id}
        testing={testingServer === server.id}
        verifyingSession={verifyingSession === server.id}
        loadingLogs={loadingLogs === server.id}
        codexAction={codexAction === server.id}
        deleting={deletingServer === server.id}
        editingRelay={editingRelay}
        relayDraft={relayDraft(server)}
        onToggleSelected={() => onToggleSelected(server.id)}
        onSwitchKey={(value) => onSwitchKey(server, value)}
        onSwitchLocal={() => onSwitchLocal(server)}
        onOpenEditor={() => onOpenEditor(server)}
        onTest={() => onTest(server)}
        onShowLogs={() => onShowLogs(server)}
        onVerifySession={() => onVerifySession(server)}
        onCancelOperation={() => onCancelOperation(server)}
        onDelete={() => onDelete(server)}
        onManageCodex={(action) => onManageCodex(server, action)}
        onStartRelayEdit={(field) => onStartRelayEdit(server, field)}
        onCancelRelayEdit={(field) => onCancelRelayEdit(server, field)}
        onRelayDraftChange={(patch) => onRelayDraftChange(server, patch)}
        onSaveRelay={() => onSaveRelay(server)}
      />)}</tbody>
    </table>}
  />;
}
