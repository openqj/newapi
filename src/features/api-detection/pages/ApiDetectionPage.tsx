import { FormEvent, useEffect, useMemo, useState } from "react";
import { Brain } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { detectModelAuthenticity, detectModelIntelligence, diagnoseStation, discoverSavedKeyModels, testSavedKeyModels } from "../api";
import type {
  DetectionResult,
  DetectionProgress,
  IntelligenceDetectionResult,
  ModelTestResult,
  ProviderDoctorReport,
  SavedApiKeyRow,
} from "../types";
import { demoResult, endpointDisplay, modelOptions, protocolForModel } from "../utils";
import { useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { DetectionResultPanel } from "../components/DetectionResultPanel";
import { DetectionHistory } from "../components/DetectionHistory";
import { DetectionDiagnostics } from "../components/DetectionDiagnostics";
import { DetectionConfigForm } from "../components/DetectionConfigForm";
import { IntelligenceTestPanel } from "../components/IntelligenceTestPanel";
import "./ApiDetectionPage.css";

type HistoryItem = DetectionResult & {
  id: string;
  endpoint: string;
  model: string;
  createdAt: number;
  trendLabel?: "本次下降" | "持续漂移" | "结果不稳定";
};

type TrendRecord = {
  createdAt: number;
  score: number;
  behaviorScore?: number;
  sourceClassification?: string;
  observedModelCount?: number;
  observedFingerprintCount?: number;
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
  const [progress, setProgress] = useState<DetectionProgress>();
  const [result, setResult] = useState<DetectionResult>();
  const [intelligenceResult, setIntelligenceResult] = useState<IntelligenceDetectionResult>();
  const [intelligenceRunning, setIntelligenceRunning] = useState(false);
  const [intelligenceBaseline, setIntelligenceBaseline] = useState<number>();
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
            const retained = current.find((item) => result.models.includes(item));
            return [retained ?? result.models[0]];
          });
        }
      })
      .catch((reason) => !cancelled && setDiscoveryError(errorMessage(reason, "模型列表加载失败")));
    return () => { cancelled = true; };
  }, [discoveredModels, keyRows, savedKeyId]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<DetectionProgress>("relayhub:detection-progress", (event) => setProgress(event.payload)).then((dispose) => { unlisten = dispose; });
    return () => { unlisten?.(); };
  }, []);

  const chooseSavedKey = (value: string) => {
    setSavedKeyId(value);
    setResult(undefined);
    setIntelligenceResult(undefined);
    setExpandedTrace(undefined);
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
    setResult(undefined);
    setIntelligenceResult(undefined);
    setExpandedTrace(undefined);
    setSelectedModels([value]);
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
          const retained = current.find((item) => result.models.includes(item));
          return [retained ?? result.models[0]];
        });
      }
    } catch (reason) {
      setDiscoveryError(errorMessage(reason, "模型列表刷新失败"));
    } finally {
      setDiscoveryRunning(false);
    }
  };

  const runIntelligence = async () => {
    if ((!savedKeyId && (!endpoint.trim() || !apiKey.trim())) || !model.trim()) {
      notify("请填写接口地址、API Key 和目标模型", "error");
      return;
    }
    setIntelligenceRunning(true);
    try {
      const storageKey = `api-detection-intelligence:${(selectedSavedKey?.stationUrl ?? endpoint).trim()}:${model.trim()}`;
      const previous = Number(window.localStorage.getItem(storageKey));
      setIntelligenceBaseline(Number.isFinite(previous) && previous > 0 ? previous : undefined);
      const next = await detectModelIntelligence(
        savedKeyId && selectedSavedKey
          ? { model, protocol: protocolForModel(model), stationId: selectedSavedKey.stationId, keyId: selectedSavedKey.key.id }
          : { endpoint, apiKey, model, protocol: protocolForModel(model) },
      );
      setIntelligenceResult(next);
      window.localStorage.setItem(storageKey, String(next.score));
    } catch (reason) {
      showError(reason);
    } finally {
      setIntelligenceRunning(false);
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
    setProgress(undefined);
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
      const trendKey = `api-detection-trend:${endpointDisplay((selectedSavedKey?.stationUrl ?? endpoint).trim())}:${model.trim()}`;
      const previousTrend = (() => {
        try { return JSON.parse(window.localStorage.getItem(trendKey) ?? "[]") as TrendRecord[]; } catch { return []; }
      })();
      const recent = previousTrend.slice(-4);
      const previousScore = recent.length ? recent[recent.length - 1].score : undefined;
      const scoreDrop = previousScore !== undefined && previousScore - next.score >= 8;
      const routeDrift = Boolean(next.behavior && (next.behavior.observedModels.length > 1 || next.behavior.observedFingerprints.length > 1 || next.source?.classification === "unknown_proxy"));
      const scoreRange = [...recent.map((item) => item.score), next.score].reduce((range, score) => ({ min: Math.min(range.min, score), max: Math.max(range.max, score) }), { min: 100, max: 0 });
      const unstable = scoreRange.max - scoreRange.min >= 15 || Boolean(next.behavior && next.behavior.latencySpreadMs >= 8000);
      const trendLabel = unstable ? "结果不稳定" : routeDrift ? "持续漂移" : scoreDrop ? "本次下降" : undefined;
      const trendRecord: TrendRecord = { createdAt: Date.now(), score: next.score, behaviorScore: next.behavior?.score, sourceClassification: next.source?.classification, observedModelCount: next.behavior?.observedModels.length, observedFingerprintCount: next.behavior?.observedFingerprints.length };
      try { window.localStorage.setItem(trendKey, JSON.stringify([...previousTrend, trendRecord].slice(-20))); } catch { /* local history is optional */ }
      const item: HistoryItem = {
        ...next,
        id: `${Date.now()}`,
        endpoint,
        model,
        createdAt: Date.now(),
        trendLabel,
      };
      setResult({ ...next, model, endpoint, detectedAt: Date.now() });
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
        <DetectionConfigForm keyRows={keyRows} savedKeyId={savedKeyId} endpoint={endpoint} apiKey={apiKey} showKey={showKey} selectedSavedKey={selectedSavedKey} availableModels={availableModels} selectedModels={selectedModels} discoveryError={discoveryError} discoveryFromCache={discoveryFromCache} discoveredCount={discoveredModels[savedKeyId]?.length} discoveryRunning={discoveryRunning} running={running} progress={progress} onSubmit={runDetection} onSavedKeyChange={chooseSavedKey} onEndpointChange={(value) => { setEndpoint(value); setResult(undefined); setIntelligenceResult(undefined); setExpandedTrace(undefined); }} onApiKeyChange={(value) => { setApiKey(value); setResult(undefined); setIntelligenceResult(undefined); setExpandedTrace(undefined); }} onShowKeyChange={() => setShowKey((value) => !value)} onRefreshModels={() => void refreshDiscoveredModels()} onToggleModel={toggleModel} />

        <section className="api-intelligence-action" aria-label="检测智商">
          <div><div className="api-intelligence-kicker"><Brain size={15} /> 独立能力测试</div><h2>检测智商</h2><p>固定推理题重复测试，用于观察 ChatGPT 是否出现降智或结果波动。</p></div>
          <button type="button" className="button-secondary" onClick={() => void runIntelligence()} disabled={intelligenceRunning || running}><Brain size={16} />{intelligenceRunning ? "检测中" : "检测智商"}</button>
        </section>
        {intelligenceResult && <IntelligenceTestPanel result={intelligenceResult} model={model} baselineScore={intelligenceBaseline} />}

      <DetectionDiagnostics selected={Boolean(selectedSavedKey)} selectedCount={selectedModels.length} doctor={doctorReport} doctorRunning={doctorRunning} batchResults={batchResults} batchRunning={batchRunning} batchMode={batchTestMode} onBatchModeChange={setBatchTestMode} onDoctor={() => void runDoctor()} onBatch={() => void runBatchTest()} />
      {result && <DetectionResultPanel result={result} expandedTrace={expandedTrace} onToggleTrace={(name) => setExpandedTrace(expandedTrace === name ? undefined : name)} />}
      </section>

      <DetectionHistory history={history} expandedId={expandedHistoryId} onSelect={selectHistoryItem} onClear={() => { setHistory([]); setExpandedHistoryId(undefined); }} />
    </div>
  );
}
