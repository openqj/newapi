import { useCallback, useState } from "react";
import { Play } from "lucide-react";
import { useConfirm, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { stationApi, type Station } from "../../stations";
import { apiKeyApi } from "../api";
import { ApiKeyEditor } from "../components/ApiKeyEditor";
import { ApiKeyTable } from "../components/ApiKeyTable";
import { ApiKeyToolbar, keyTableColumns, type KeyTableColumn } from "../components/ApiKeyToolbar";
import type { ApiKeyTestState, KeyRow, ModelTestResult } from "../types";
import "../../../components/Sub2ApiPages.css";
import "../../../components/TablePage.css";
import "./ApiKeysPage.css";

const isActive = (status: string) => status === "active" || status === "有效";
const rowId = (row: KeyRow) => `${row.stationId}:${row.key.id}`;

export function ApiKeysPage({
  rows,
  stations,
  onRefresh,
  onUpdated,
  onCodexApplied,
}: {
  rows: KeyRow[];
  stations: Station[];
  onRefresh: () => Promise<void>;
  onUpdated: () => Promise<void>;
  onCodexApplied?: () => Promise<void>;
}) {
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [testRunning, setTestRunning] = useState(false);
  const [testStates, setTestStates] = useState<Record<string, ApiKeyTestState>>({});
  const refreshStationGroups = useCallback(async (stationId: string) => {
    if (!isTauri()) return;
    await stationApi.refresh(stationId);
    await onUpdated();
  }, [onUpdated]);
  const filtered = rows.filter((row) => (
    (station === "all" || row.stationId === station)
    && (status === "all" || (status === "active" ? isActive(row.key.status) : !isActive(row.key.status)))
    && `${row.stationName} ${row.key.name} ${row.key.maskedKey} ${row.key.group ?? ""}`.toLowerCase().includes(query.toLowerCase())
  ));
  const selectedRows = filtered.filter((row) => selectedIds.includes(rowId(row)));
  const toggleSelected = (row: KeyRow) => {
    const id = rowId(row);
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const toggleAllSelected = () => {
    const visibleIds = filtered.map(rowId);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => allSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  };
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
    const id = rowId(row);
    setSaving(id);
    try {
      if (isTauri()) await apiKeyApi.updateGroup(row.stationId, row.key.id, group);
      await onRefresh();
      notify("分组已更新", "success");
    } catch (reason) {
      showError(reason);
    } finally {
      setSaving(null);
    }
  };
  const applyToCodex = async (row: KeyRow) => {
    const id = `codex:${rowId(row)}`;
    setSaving(id);
    try {
      await apiKeyApi.applyToCodex(row.stationId, row.key.id);
      await onCodexApplied?.();
      notify("API 密钥已启用到 Codex", "success");
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
      setSelectedIds((current) => current.filter((id) => id !== rowId(row)));
      await onUpdated();
      notify("API 密钥已删除", "success");
    } catch (reason) {
      showError(reason);
    }
  };
  const testSelected = async () => {
    if (!selectedRows.length || testRunning) return;
    setTestRunning(true);
    let successCount = 0;
    let failureCount = 0;
    try {
      for (const row of selectedRows) {
        const id = rowId(row);
        const model = row.models.find((value) => value.trim())?.trim();
        setTestStates((current) => ({ ...current, [id]: { status: "testing" } }));
        try {
          if (!model) throw new Error("没有可测试的模型");
          const results = isTauri()
            ? await apiKeyApi.testModels<ModelTestResult[]>(row.stationId, row.key.id, [model], "chat")
            : [{ model, available: true, response: "hi", elapsedMs: 0 }];
          const result = results[0];
          if (!result || result.available === false || result.error) {
            throw new Error(result?.error || "测试未返回有效响应");
          }
          setTestStates((current) => ({ ...current, [id]: { status: "success", message: result.response } }));
          successCount += 1;
        } catch (reason) {
          setTestStates((current) => ({ ...current, [id]: { status: "error", message: errorMessage(reason, "请求失败") } }));
          failureCount += 1;
        }
      }
      notify(`一键测试完成：${successCount} 个正常，${failureCount} 个异常`, failureCount ? "error" : "success");
    } finally {
      setTestRunning(false);
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  const hiddenColumns = keyTableColumns.filter(({ key }) => !visible[key]).map(({ key }) => `sub2-key-column-hidden-${key}`).join(" ");

  return <div className="sub2-page sub2-keys-page sub2-api-keys-page">
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
      onCloseColumns={() => setShowColumns(false)}
      onRefresh={() => void refresh()}
      onCreate={() => setEditor({})}
    />
    <div className="api-key-bulk-actions">
      <button className="button-primary" type="button" disabled={testRunning || selectedRows.length === 0} onClick={() => void testSelected()}><Play size={16} />{testRunning ? "测试中" : "一键测试"}</button>
    </div>
    <ApiKeyTable
      rows={filtered}
      hiddenColumns={hiddenColumns}
      saving={saving}
      selectedIds={selectedIds}
      testStates={testStates}
      onToggleSelected={toggleSelected}
      onToggleAll={toggleAllSelected}
      onReveal={(row) => void reveal(row)}
      onGroupChange={(row, group) => void changeGroup(row, group)}
      onImport={(row) => void importToCcSwitch(row)}
      onApplyToCodex={(row) => void applyToCodex(row)}
      onEdit={(row) => setEditor({ row })}
      onDelete={(row) => void remove(row)}
    />
    {editor && <ApiKeyEditor
      row={editor.row}
      rows={rows}
      stations={stations}
      onRefreshStation={refreshStationGroups}
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
