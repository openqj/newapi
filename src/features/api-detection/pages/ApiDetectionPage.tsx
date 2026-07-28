import { FormEvent, useEffect, useMemo, useState } from "react";
import { detectModelAuthenticity, diagnoseStation, discoverSavedKeyModels, testSavedKeyModels } from "../api";
import type {
  DetectionResult,
  ModelTestResult,
  ProviderDoctorReport,
  SavedApiKeyRow,
} from "../types";
import { demoResult, modelOptions, protocolForModel } from "../utils";
import { useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { DetectionResultPanel } from "../components/DetectionResultPanel";
import { DetectionHistory } from "../components/DetectionHistory";
import { DetectionDiagnostics } from "../components/DetectionDiagnostics";
import { DetectionConfigForm } from "../components/DetectionConfigForm";
import "./ApiDetectionPage.css";

type HistoryItem = DetectionResult & {
  id: string;
  endpoint: string;
  model: string;
  createdAt: number;
};

export function ApiDetectionPage({ keyRows }: { keyRows: SavedApiKeyRow[] }) {
  const { notify } = useToast();
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [savedKeyId, setSavedKeyId] = useState("");
  const [model, setModel] = useState(modelOptions[1].value);
  const [selectedModels, setSelectedModels] = useState<string[]>([modelOptions[1].value]);
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, string[]>>({});
  const [discoveryFromCache, setDiscoveryFromCache] = useState(false);
  const [discoveryRunning, setDiscoveryRunning] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string>();
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchTestMode, setBatchTestMode] = useState<"chat" | "responses">("chat");
  const [batchResults, setBatchResults] = useState<ModelTestResult[]>();
  const [doctorReport, setDoctorReport] = useState<ProviderDoctorReport>();
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DetectionResult>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedTrace, setExpandedTrace] = useState<string>();
  const [expandedHistoryId, setExpandedHistoryId] = useState<string>();
  const showError = (reason: unknown) =>
    notify(errorMessage(reason, "检测失败，请检查连接配置后重试。"), "error");

  const selectedSavedKey = useMemo(
    () => keyRows.find((row) => `${row.stationId}-${row.key.id}` === savedKeyId),
    [keyRows, savedKeyId],
  );

  const availableModels = useMemo(() => {
    const discovered = savedKeyId ? discoveredModels[savedKeyId] : undefined;
    return discovered?.length ? discovered : modelOptions.map((option) => option.value);
  }, [discoveredModels, savedKeyId]);

  useEffect(() => {
    if (!savedKeyId || discoveredModels[savedKeyId]) return;
    const savedKey = keyRows.find((row) => `${row.stationId}-${row.key.id}` === savedKeyId);
    if (!savedKey) return;
    let cancelled = false;
    void discoverSavedKeyModels(savedKey.stationId, savedKey.key.id)
      .then((result) => {
        if (cancelled) return;
        setDiscoveredModels((current) => ({ ...current, [savedKeyId]: result.models }));
        setDiscoveryFromCache(result.fromCache);
        setDiscoveryError(result.error ? `${result.error}${result.models.length ? "；正在使用较早的缓存列表" : ""}` : undefined);
        if (result.models[0]) {
          setModel((current) => result.models.includes(current) ? current : result.models[0]);
          setSelectedModels((current) => {
            const retained = current.filter((item) => result.models.includes(item));
            return retained.length ? retained : [result.models[0]];
          });
        }
      })
      .catch((reason) => !cancelled && setDiscoveryError(errorMessage(reason, "模型列表加载失败")));
    return () => { cancelled = true; };
  }, [discoveredModels, keyRows, savedKeyId]);

  const chooseSavedKey = (value: string) => {
    setSavedKeyId(value);
    const next = keyRows.find((row) => `${row.stationId}-${row.key.id}` === value);
    if (!next) return;
    setEndpoint(next.stationUrl);
    setApiKey("");
    setBatchResults(undefined);
    setDiscoveryError(undefined);
    setDiscoveryFromCache(false);
    if (next.models[0]) {
      setModel(next.models[0]);
      setSelectedModels([next.models[0]]);
    }
  };

  const toggleModel = (value: string) => {
    setModel(value);
    setSelectedModels((current) => {
      if (current.includes(value)) return current.filter((item) => item !== value);
      if (current.length >= 50) {
        notify("一次最多测试 50 个模型", "error");
        return current;
      }
      return [...current, value];
    });
  };

  const refreshDiscoveredModels = async () => {
    if (!selectedSavedKey) return;
    setDiscoveryRunning(true);
    setDiscoveryError(undefined);
    try {
      const result = await discoverSavedKeyModels(selectedSavedKey.stationId, selectedSavedKey.key.id, true);
      setDiscoveredModels((current) => ({ ...current, [savedKeyId]: result.models }));
      setDiscoveryFromCache(result.fromCache);
      setDiscoveryError(result.error ? `${result.error}${result.models.length ? "；正在使用较早的缓存列表" : ""}` : undefined);
      if (result.models[0]) {
        setModel((current) => result.models.includes(current) ? current : result.models[0]);
        setSelectedModels((current) => {
          const retained = current.filter((item) => result.models.includes(item));
          return retained.length ? retained : [result.models[0]];
        });
      }
    } catch (reason) {
      setDiscoveryError(errorMessage(reason, "模型列表刷新失败"));
    } finally {
      setDiscoveryRunning(false);
    }
  };

  const runBatchTest = async () => {
    if (!selectedSavedKey || !selectedModels.length) return;
    setBatchRunning(true);
    try {
      setBatchResults(await testSavedKeyModels(
        selectedSavedKey.stationId,
        selectedSavedKey.key.id,
        selectedModels,
        batchTestMode,
      ));
    } catch (reason) {
      showError(reason);
    } finally {
      setBatchRunning(false);
    }
  };

  const runDoctor = async () => {
    if (!selectedSavedKey) return;
    setDoctorRunning(true);
    try { setDoctorReport(await diagnoseStation(selectedSavedKey.stationId, selectedSavedKey.key.id)); }
    catch (reason) { showError(reason); }
    finally { setDoctorRunning(false); }
  };

  const runDetection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((!savedKeyId && (!endpoint.trim() || !apiKey.trim())) || !model.trim()) {
      notify("请填写接口地址、API Key 和目标模型。", "error");
      return;
    }
    setRunning(true);
    setResult(undefined);
    setExpandedTrace(undefined);
    try {
      const protocol = protocolForModel(model);
      const next = await detectModelAuthenticity(
        savedKeyId && selectedSavedKey
          ? { model, protocol, stationId: selectedSavedKey.stationId, keyId: selectedSavedKey.key.id }
          : { endpoint, apiKey, model, protocol },
        demoResult,
      );
      const item: HistoryItem = {
        ...next,
        id: `${Date.now()}`,
        endpoint,
        model,
        createdAt: Date.now(),
      };
      setResult(next);
      setExpandedHistoryId(item.id);
      setHistory((current) => [item, ...current].slice(0, 8));
    } catch (reason) {
      showError(reason);
    } finally {
      setRunning(false);
    }
  };

  const selectHistoryItem = (item: HistoryItem) => {
    setExpandedHistoryId((current) => current === item.id ? undefined : item.id);
    setExpandedTrace(undefined);
    setResult(item);
  };

  return (
    <div className="api-detection-page">
      <section className="api-detection-main-module">
        <DetectionConfigForm keyRows={keyRows} savedKeyId={savedKeyId} endpoint={endpoint} apiKey={apiKey} showKey={showKey} selectedSavedKey={selectedSavedKey} availableModels={availableModels} selectedModels={selectedModels} discoveryError={discoveryError} discoveryFromCache={discoveryFromCache} discoveredCount={discoveredModels[savedKeyId]?.length} discoveryRunning={discoveryRunning} running={running} onSubmit={runDetection} onSavedKeyChange={chooseSavedKey} onEndpointChange={setEndpoint} onApiKeyChange={setApiKey} onShowKeyChange={() => setShowKey((value) => !value)} onRefreshModels={() => void refreshDiscoveredModels()} onToggleModel={toggleModel} />

      <DetectionDiagnostics selected={Boolean(selectedSavedKey)} selectedCount={selectedModels.length} doctor={doctorReport} doctorRunning={doctorRunning} batchResults={batchResults} batchRunning={batchRunning} batchMode={batchTestMode} onBatchModeChange={setBatchTestMode} onDoctor={() => void runDoctor()} onBatch={() => void runBatchTest()} />
      {result && <DetectionResultPanel result={result} expandedTrace={expandedTrace} onToggleTrace={(name) => setExpandedTrace(expandedTrace === name ? undefined : name)} />}
      </section>

      <DetectionHistory history={history} expandedId={expandedHistoryId} onSelect={selectHistoryItem} onClear={() => { setHistory([]); setExpandedHistoryId(undefined); }} />
    </div>
  );
}
