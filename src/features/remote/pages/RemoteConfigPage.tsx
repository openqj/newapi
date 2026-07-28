import { useEffect, useRef, useState } from "react";
import type { KeyRow } from "../../api-keys";
import { AuditHistoryDialog } from "../components/AuditHistoryDialog";
import { RelayKeyMenu } from "../components/RelayKeyMenu";
import { RemoteBulkActions } from "../components/RemoteBulkActions";
import { RemoteConfigToolbar } from "../components/RemoteConfigToolbar";
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
  const [openSelection, setOpenSelection] = useState<string | null>(null);
  const [selectionMenuPosition, setSelectionMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const openSelectionAnchorRef = useRef<HTMLElement | null>(null);
  const selectionMenuRef = useRef<HTMLDivElement | null>(null);
  const {
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
    selectedKeyLabel,
    saveRelay,
    deletingServer,
    deleteServer,
    testingServer,
    setTestingServer,
    testServer,
    verifyingSession,
    verifyCodexSession,
    cancelServerOperation,
    codexAction,
    manageCodex,
    loadingLogs,
    showSyncLogs,
    testResult,
    setTestResult,
    syncLogs,
    setSyncLogs,
  } = useRemoteServerActions({ keyRows, onChanged, onCredentialsRequired: setEditingServer });
  const {
    selectedServerIds,
    selection: bulkSelection,
    setSelection: setBulkSelection,
    action: bulkAction,
    selectedServers,
    toggleServer: toggleServerSelection,
    toggleAllServers,
    switchSelectedServers,
    testSelectedServers,
    deleteSelectedServers,
  } = useRemoteBulkActions({
    servers,
    keyRows,
    onChanged,
    onSavingChange: setSaving,
    onTestingChange: setTestingServer,
    onResult: setTestResult,
    onKeyAssigned: (serverId, keyValue) => setSelection((current) => ({ ...current, [serverId]: keyValue })),
  });

  useEffect(() => {
    if (!openSelection) return;
    const closeSelection = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!openSelectionAnchorRef.current?.contains(target) && !selectionMenuRef.current?.contains(target)) {
        setOpenSelection(null);
        setSelectionMenuPosition(null);
      }
    };
    document.addEventListener("mousedown", closeSelection);
    return () => document.removeEventListener("mousedown", closeSelection);
  }, [openSelection]);

  return (
    <>
      <RemoteConfigToolbar onAdd={() => setShowAdd(true)} onShowAuditHistory={() => setShowAuditHistory(true)} />
      <RemoteBulkActions
        count={selectedServers.length}
        keyRows={keyRows}
        selection={bulkSelection}
        action={bulkAction}
        onSelectionChange={setBulkSelection}
        onSwitch={() => void switchSelectedServers()}
        onTest={() => void testSelectedServers()}
        onDelete={() => void deleteSelectedServers()}
      />
      <RemoteServerTable
        servers={servers}
        keyRows={keyRows}
        selectedServerIds={selectedServerIds}
        openSelection={openSelection}
        saving={saving}
        savingRelay={savingRelay}
        testingServer={testingServer}
        verifyingSession={verifyingSession}
        loadingLogs={loadingLogs}
        codexAction={codexAction}
        deletingServer={deletingServer}
        editingRelay={editingRelay}
        selectedKeyLabel={selectedKeyLabel}
        relayDraft={relayDraft}
        onToggleAll={toggleAllServers}
        onToggleSelected={toggleServerSelection}
        onSelectMenuToggle={(server, details) => {
          if (!details.open) {
            setOpenSelection(null);
            setSelectionMenuPosition(null);
            return;
          }
          const { bottom, left, width } = details.getBoundingClientRect();
          openSelectionAnchorRef.current = details;
          setSelectionMenuPosition({ top: bottom + 1, left, width });
          setOpenSelection(server.id);
        }}
        onCloseSelection={() => setOpenSelection(null)}
        onSwitchKey={(server, value) => void switchKey(server, value)}
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
      {openSelection && selectionMenuPosition && (
        <RelayKeyMenu
          position={selectionMenuPosition}
          rows={keyRows}
          saving={saving === openSelection}
          menuRef={selectionMenuRef}
          onSelect={(value) => {
            const server = servers.find((item) => item.id === openSelection);
            if (!server) return;
            setOpenSelection(null);
            setSelectionMenuPosition(null);
            void switchKey(server, value);
          }}
        />
      )}
      {showAdd && <RemoteServerDialog onClose={() => setShowAdd(false)} onSaved={onChanged} />}
      {showAuditHistory && <AuditHistoryDialog onClose={() => setShowAuditHistory(false)} onChanged={onChanged} />}
      {editingServer && <RemoteServerDialog server={editingServer} onClose={() => setEditingServer(null)} onSaved={onChanged} />}
    </>
  );
}
