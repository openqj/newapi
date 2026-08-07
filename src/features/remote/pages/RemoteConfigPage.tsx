import { useState } from "react";
import type { KeyRow } from "../../api-keys";
import { AuditHistoryDialog } from "../components/AuditHistoryDialog";
import { RemoteBulkActions } from "../components/RemoteBulkActions";
import { RemoteConfigToolbar } from "../components/RemoteConfigToolbar";
import { RemoteCodexInstallLogDialog } from "../components/RemoteCodexInstallLogDialog";
import { RemoteServerDialog } from "../components/RemoteServerDialog";
import { RemoteServerTable } from "../components/RemoteServerTable";
import { RemoteSyncLogDialog } from "../components/RemoteSyncLogDialog";
import { RemoteTestNotice } from "../components/RemoteTestNotice";
import { useRemoteBulkActions, useRemoteServerActions } from "../hooks";
import type { RemoteServer } from "../types";
import "./RemoteConfigPage.css";

export function RemoteConfigPage({
  servers,
  keyRows,
  onChanged,
}: {
  servers: RemoteServer[];
  keyRows: KeyRow[];
  onChanged: () => Promise<void>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showAuditHistory, setShowAuditHistory] = useState(false);
  const [editingServer, setEditingServer] = useState<RemoteServer | null>(null);
  const {
    selection,
    setSelection,
    saving,
    setSaving,
    relayDraft,
    updateRelayDraft,
    savingRelay,
    editingRelay,
    setEditingRelay,
    cancelRelayEditing,
    switchKey,
    switchLocalRelay,
    selectedKeyLabel,
    saveRelay,
    deletingServer,
    deleteServer,
    testingServer,
    setTestingServer,
    testServer,
    verifyingSession,
    setVerifyingSession,
    verifyCodexSession,
    cancelServerOperation,
    codexAction,
    manageCodex,
    codexInstallState,
    setCodexInstallState,
    loadingLogs,
    showSyncLogs,
    testResult,
    setTestResult,
    syncLogs,
    setSyncLogs,
  } = useRemoteServerActions({ keyRows, onChanged, onCredentialsRequired: setEditingServer });
  const {
    selectedServerIds,
    action: bulkAction,
    selectedServers,
    toggleServer: toggleServerSelection,
    toggleAllServers,
    switchSelectedServers,
    switchSelectedLocal,
    testSelectedServers,
    verifySelectedCodexSessions,
    deleteSelectedServers,
  } = useRemoteBulkActions({
    servers,
    keyRows,
    onChanged,
    onSavingChange: setSaving,
    onTestingChange: setTestingServer,
    onVerifyingSessionChange: setVerifyingSession,
    onResult: setTestResult,
    onKeyAssigned: (serverId, keyValue) => setSelection((current) => ({ ...current, [serverId]: keyValue })),
  });

  return (
    <>
      <RemoteConfigToolbar onAdd={() => setShowAdd(true)} onShowAuditHistory={() => setShowAuditHistory(true)} />
      <RemoteBulkActions
        count={selectedServers.length}
        keyRows={keyRows}
        action={bulkAction}
        onSwitch={(value) => void switchSelectedServers(value)}
        onSwitchLocal={() => void switchSelectedLocal()}
        onTest={() => void testSelectedServers()}
        onVerifySession={() => void verifySelectedCodexSessions()}
        onDelete={() => void deleteSelectedServers()}
      />
      <RemoteServerTable
        servers={servers}
        keyRows={keyRows}
        selectedServerIds={selectedServerIds}
        saving={saving}
        savingRelay={savingRelay}
        testingServer={testingServer}
        verifyingSession={verifyingSession}
        loadingLogs={loadingLogs}
        codexAction={codexAction}
        deletingServer={deletingServer}
        editingRelay={editingRelay}
        selectedKeyValue={(serverId) => selection[serverId] ?? ""}
        selectedKeyLabel={selectedKeyLabel}
        relayDraft={relayDraft}
        onToggleAll={toggleAllServers}
        onToggleSelected={toggleServerSelection}
        onSwitchKey={(server, value) => void switchKey(server, value)}
        onSwitchLocal={(server) => void switchLocalRelay(server)}
        onOpenEditor={setEditingServer}
        onTest={(server) => void testServer(server)}
        onShowLogs={(server) => void showSyncLogs(server)}
        onVerifySession={(server) => void verifyCodexSession(server)}
        onCancelOperation={(server) => void cancelServerOperation(server)}
        onDelete={(server) => void deleteServer(server)}
        onManageCodex={(server, action) => void manageCodex(server, action)}
        onStartRelayEdit={(server, field) => setEditingRelay({ serverId: server.id, field })}
        onCancelRelayEdit={cancelRelayEditing}
        onRelayDraftChange={updateRelayDraft}
        onSaveRelay={(server) => void saveRelay(server)}
      />
      {testResult && <RemoteTestNotice result={testResult} onClose={() => setTestResult(null)} />}
      {syncLogs && <RemoteSyncLogDialog server={syncLogs.server} entries={syncLogs.entries} onClose={() => setSyncLogs(null)} />}
      {codexInstallState && <RemoteCodexInstallLogDialog state={codexInstallState} onClose={() => setCodexInstallState(null)} />}
      {showAdd && <RemoteServerDialog onClose={() => setShowAdd(false)} onSaved={onChanged} />}
      {showAuditHistory && <AuditHistoryDialog onClose={() => setShowAuditHistory(false)} onChanged={onChanged} />}
      {editingServer && <RemoteServerDialog server={editingServer} onClose={() => setEditingServer(null)} onSaved={onChanged} />}
    </>
  );
}
