import { useState } from "react";
import { useConfirm, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import type { Station } from "../../stations";
import { apiKeyApi } from "../api";
import { ApiKeyEditor } from "../components/ApiKeyEditor";
import { ApiKeyTable } from "../components/ApiKeyTable";
import { ApiKeyToolbar, keyTableColumns, type KeyTableColumn } from "../components/ApiKeyToolbar";
import type { KeyRow } from "../types";
import "../../../components/Sub2ApiPages.css";
import "../../../components/TablePage.css";
import "./ApiKeysPage.css";

const isActive = (status: string) => status === "active" || status === "有效";

export function ApiKeysPage({ rows, stations, onUpdated }: { rows: KeyRow[]; stations: Station[]; onUpdated: () => Promise<void> }) {
  const confirm = useConfirm();
  const { notify } = useToast();
  const showError = (reason: unknown) => notify(errorMessage(reason), "error");
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [status, setStatus] = useState("all");
  const [showColumns, setShowColumns] = useState(false);
  const [visible, setVisible] = useState<Record<KeyTableColumn, boolean>>({ station: true, name: true, apiKey: true, group: true, concurrency: true, usage: true, expires: true, status: true, created: true, actions: true });
  const [saving, setSaving] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState<{ row?: KeyRow } | null>(null);
  const filtered = rows.filter((row) => (
    (station === "all" || row.stationId === station)
    && (status === "all" || (status === "active" ? isActive(row.key.status) : !isActive(row.key.status)))
    && `${row.stationName} ${row.key.name} ${row.key.maskedKey} ${row.key.group ?? ""}`.toLowerCase().includes(query.toLowerCase())
  ));
  const reveal = async (row: KeyRow) => {
    try {
      const key = await apiKeyApi.reveal(row.stationId, row.key.id);
      await navigator.clipboard.writeText(key);
      window.setTimeout(() => void navigator.clipboard.writeText(""), 30_000);
      notify("API 密钥已复制", "success");
    } catch (reason) {
      showError(reason);
    }
  };
  const changeGroup = async (row: KeyRow, group: string) => {
    if (group === row.key.group) return;
    const id = `${row.stationId}:${row.key.id}`;
    setSaving(id);
    try {
      if (isTauri()) await apiKeyApi.updateGroup(row.stationId, row.key.id, group);
      await onUpdated();
      notify("分组已更新", "success");
    } catch (reason) {
      showError(reason);
    } finally {
      setSaving(null);
    }
  };
  const toggleStatus = async (row: KeyRow) => {
    const id = `${row.stationId}:${row.key.id}`;
    setSaving(id);
    try {
      await apiKeyApi.update({ stationId: row.stationId, keyId: row.key.id, status: isActive(row.key.status) ? "inactive" : "active" });
      await onUpdated();
      notify("API 密钥状态已更新", "success");
    } catch (reason) {
      showError(reason);
    } finally {
      setSaving(null);
    }
  };
  const importToCcSwitch = async (row: KeyRow) => {
    try {
      await apiKeyApi.importToCcSwitch(row.stationId, row.key.id, "codex");
    } catch (reason) {
      showError(reason);
    }
  };
  const remove = async (row: KeyRow) => {
    const approved = await confirm({
      title: "删除 API 密钥",
      description: `确定删除“${row.key.name || row.key.id}”吗？此操作无法撤销。`,
      confirmLabel: "删除",
      destructive: true,
    });
    if (!approved) return;
    try {
      await apiKeyApi.remove(row.stationId, row.key.id);
      await onUpdated();
      notify("API 密钥已删除", "success");
    } catch (reason) {
      showError(reason);
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await onUpdated();
    } finally {
      setRefreshing(false);
    }
  };
  const hiddenColumns = keyTableColumns.filter(({ key }) => !visible[key]).map(({ key }) => `sub2-key-column-hidden-${key}`).join(" ");

  return <div className="sub2-page sub2-keys-page">
    <ApiKeyToolbar
      stations={stations}
      query={query}
      station={station}
      status={status}
      visible={visible}
      refreshing={refreshing}
      showColumns={showColumns}
      onQueryChange={setQuery}
      onStationChange={setStation}
      onStatusChange={setStatus}
      onToggleColumn={(key) => setVisible((value) => ({ ...value, [key]: !value[key] }))}
      onToggleColumns={() => setShowColumns((value) => !value)}
      onRefresh={() => void refresh()}
      onCreate={() => setEditor({})}
    />
    <ApiKeyTable
      rows={filtered}
      hiddenColumns={hiddenColumns}
      saving={saving}
      onReveal={(row) => void reveal(row)}
      onGroupChange={(row, group) => void changeGroup(row, group)}
      onImport={(row) => void importToCcSwitch(row)}
      onToggleStatus={(row) => void toggleStatus(row)}
      onEdit={(row) => setEditor({ row })}
      onDelete={(row) => void remove(row)}
    />
    {editor && <ApiKeyEditor
      row={editor.row}
      rows={rows}
      stations={stations}
      onClose={() => setEditor(null)}
      onSaved={async () => {
        const wasEditing = Boolean(editor.row);
        setEditor(null);
        await onUpdated();
        notify(wasEditing ? "API 密钥已保存" : "API 密钥已创建", "success");
      }}
      onError={showError}
    />}
  </div>;
}
