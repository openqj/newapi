import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { Button, TableBulkActions, TablePagination, useConfirm, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { stationApi, type Station } from "../../stations";
import { gatewayApi } from "../../gateway/api";
import { apiKeyApi } from "../api";
import { ApiKeyEditor } from "../components/ApiKeyEditor";
import { ApiKeyTable, type ApiKeySortDirection, type ApiKeySortKey } from "../components/ApiKeyTable";
import { ApiKeyToolbar, keyTableColumns, type KeyTableColumn } from "../components/ApiKeyToolbar";
import { identifyModelType } from "../modelType";
import type { ApiKeyTestState, KeyRow, ModelTestResult } from "../types";
import "../../../components/Sub2ApiPages.css";
import "../../../components/TablePage.css";
import "./ApiKeysPage.css";

const isActive = (status: string) => status === "active" || status === "有效";
const rowId = (row: KeyRow) => `${row.stationId}:${row.key.id}`;
const missingStationCredentialMessage = "未找到该站点的安全凭据";

function compareApiKeyRows(left: KeyRow, right: KeyRow, sortKey: ApiKeySortKey) {
  if (sortKey === "name") {
    return (left.key.name || "").localeCompare(right.key.name || "", "zh-CN", { numeric: true, sensitivity: "base" });
  }
  const leftValue = sortKey === "concurrency"
    ? left.key.currentConcurrency ?? 0
    : sortKey === "expires"
      ? left.key.expiresAt ?? Number.MAX_SAFE_INTEGER
      : sortKey === "status"
        ? (isActive(left.key.status) ? 1 : 0)
        : left.key.createdAt ?? 0;
  const rightValue = sortKey === "concurrency"
    ? right.key.currentConcurrency ?? 0
    : sortKey === "expires"
      ? right.key.expiresAt ?? Number.MAX_SAFE_INTEGER
      : sortKey === "status"
        ? (isActive(right.key.status) ? 1 : 0)
        : right.key.createdAt ?? 0;
  return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
}

export function ApiKeysPage({
  rows,
  stations,
  onRefresh,
  onUpdated,
  openCreateRequest = 0,
  onCodexApplied,
}: {
  rows: KeyRow[];
  stations: Station[];
  onRefresh: () => Promise<void>;
  onUpdated: () => Promise<void>;
  openCreateRequest?: number;
  onCodexApplied?: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const { notify } = useToast();
  const showError = (reason: unknown) => notify(errorMessage(reason), "error");
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [modelType, setModelType] = useState("all");
  const [status, setStatus] = useState("all");
  const [showColumns, setShowColumns] = useState(false);
  const [visible, setVisible] = useState<Record<KeyTableColumn, boolean>>({ station: true, name: true, apiKey: true, group: true, balance: true, concurrency: true, usage: true, expires: true, status: true, created: true, actions: true });
  const [saving, setSaving] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState<{ row?: KeyRow } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [testRunning, setTestRunning] = useState(false);
  const [testStates, setTestStates] = useState<Record<string, ApiKeyTestState>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState<ApiKeySortKey>("created");
  const [sortDirection, setSortDirection] = useState<ApiKeySortDirection>("desc");
  const stationRefreshes = useRef(new Map<string, Promise<void>>());
  useEffect(() => {
    if (openCreateRequest > 0) setEditor({});
  }, [openCreateRequest]);
  const refreshStationGroups = useCallback(async (stationId: string) => {
    if (!isTauri()) return;
    const existing = stationRefreshes.current.get(stationId);
    if (existing) return existing;
    const selectedStation = stations.find((item) => item.id === stationId);
    const refresh = (async () => {
      try {
        if (selectedStation && !["online", "partial"].includes(selectedStation.status)) {
          await stationApi.reauthenticate(stationId, null);
        } else {
          await stationApi.refresh(stationId);
        }
      } catch (reason) {
        // Cached groups are still usable when the station's OS credential is
        // missing; suppress only this expected refresh failure.
        if (!errorMessage(reason).includes(missingStationCredentialMessage)) throw reason;
        return;
      }
      await onUpdated();
    })();
    stationRefreshes.current.set(stationId, refresh);
    const clearRefresh = () => {
      if (stationRefreshes.current.get(stationId) === refresh) stationRefreshes.current.delete(stationId);
    };
    void refresh.then(clearRefresh, clearRefresh);
    return refresh;
  }, [onUpdated, stations]);
  const modelTypes = [...new Set(rows.map((row) => identifyModelType(row.models)))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const filtered = rows.filter((row) => (
    (station === "all" || row.stationId === station)
    && (modelType === "all" || identifyModelType(row.models) === modelType)
    && (status === "all" || (status === "active" ? isActive(row.key.status) : !isActive(row.key.status)))
    && `${row.stationName} ${row.key.name} ${row.key.maskedKey} ${row.key.group ?? ""}`.toLowerCase().includes(query.toLowerCase())
  ));
  const orderedRows = filtered
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const result = compareApiKeyRows(left.row, right.row, sortKey);
      if (result !== 0) return sortDirection === "asc" ? result : -result;
      return left.index - right.index;
    })
    .map(({ row }) => row);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = orderedRows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setPage(1);
  }, [query, station, modelType, status]);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  const selectedRows = orderedRows.filter((row) => selectedIds.includes(rowId(row)));
  const handleSort = (nextKey: ApiKeySortKey) => {
    setPage(1);
    if (sortKey === nextKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  };
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
      notify("API 密钥已写入 Codex 本地配置", "success");
    } catch (reason) {
      showError(reason);
    } finally {
      setSaving(null);
    }
  };
  const addToRoute = async (row: KeyRow) => {
    const id = `route:${rowId(row)}`;
    setSaving(id);
    try {
      const status = await gatewayApi.status();
      if (status.mode !== "localGateway") throw new Error("请先切换到本地路由模式");
      const route = { stationId: row.stationId, keyId: row.key.id };
      const routes = status.routeQueue ?? [];
      if (routes.some((item) => item.stationId === route.stationId && item.keyId === route.keyId)) {
        notify("API 密钥已在本地路由中", "success");
        return;
      }
      await gatewayApi.setRoutes([...routes, route]);
      notify("API 密钥已加入本地路由", "success");
    } catch (reason) {
      showError(reason);
    } finally {
      setSaving(null);
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
  const runTest = async (row: KeyRow) => {
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
      return true;
    } catch (reason) {
      setTestStates((current) => ({ ...current, [id]: { status: "error", message: errorMessage(reason, "请求失败") } }));
      return false;
    }
  };
  const testSingle = async (row: KeyRow) => {
    if (testRunning) return;
    setTestRunning(true);
    try {
      const success = await runTest(row);
      notify(success ? "测试完成：正常" : "测试完成：异常", success ? "success" : "error");
    } finally {
      setTestRunning(false);
    }
  };
  const testSelected = async () => {
    if (!selectedRows.length || testRunning) return;
    setTestRunning(true);
    let successCount = 0;
    let failureCount = 0;
    try {
      for (const row of selectedRows) {
        if (await runTest(row)) successCount += 1;
        else failureCount += 1;
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
      modelType={modelType}
      modelTypes={modelTypes}
      status={status}
      visible={visible}
      refreshing={refreshing}
      showColumns={showColumns}
      onQueryChange={setQuery}
      onStationChange={setStation}
      onModelTypeChange={setModelType}
      onStatusChange={setStatus}
      onToggleColumn={(key) => setVisible((value) => ({ ...value, [key]: !value[key] }))}
      onToggleColumns={() => setShowColumns((value) => !value)}
      onCloseColumns={() => setShowColumns(false)}
      onRefresh={() => void refresh()}
      onCreate={() => setEditor({})}
    />
    <TableBulkActions>
      <Button variant="primary" disabled={testRunning || selectedRows.length === 0} onClick={() => void testSelected()}><Play size={16} />{testRunning ? "测试中" : "一键测试"}</Button>
    </TableBulkActions>
    <ApiKeyTable
      rows={pageRows}
      hiddenColumns={hiddenColumns}
      sortKey={sortKey}
      sortDirection={sortDirection}
      saving={saving}
      selectedIds={selectedIds}
      testStates={testStates}
      onToggleSelected={toggleSelected}
      onToggleAll={toggleAllSelected}
      onSort={handleSort}
      onReveal={(row) => void reveal(row)}
      onGroupChange={(row, group) => void changeGroup(row, group)}
      onApplyToCodex={(row) => void applyToCodex(row)}
      onAddToRoute={(row) => void addToRoute(row)}
      onTest={(row) => void testSingle(row)}
      onEdit={(row) => setEditor({ row })}
      onDelete={(row) => void remove(row)}
    />
    {filtered.length > 0 && <TablePagination page={page} pageCount={pageCount} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
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
