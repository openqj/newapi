import { useCallback, useEffect, useState } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { emit } from "@tauri-apps/api/event";
import { Button, FormDialog, FormField, StatusBadge, TextField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { CONFIG_PROFILE_CHANGED_EVENT, configProfileApi } from "../api";
import type { ClientApplication, ConfigImportPreview, ConfigImportRequest } from "../types";
import "./ConfigImportDialog.css";

const applicationLabels: Record<ClientApplication, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

export type ParsedConfigImport = ConfigImportRequest & {
  detectedBy: "explicit" | "inferred";
};

function firstParam(params: URLSearchParams, names: string[]) {
  return names.map((name) => params.get(name)?.trim()).find((value) => value) ?? "";
}

export function identifyClientApplication(
  value?: string,
  protocol?: string,
  model?: string,
  endpoint?: string,
): { application: ClientApplication; detectedBy: "explicit" | "inferred" } | null {
  const explicit = value?.trim().toLowerCase();
  const aliases: Record<string, ClientApplication> = {
    claude: "claude",
    "claude-code": "claude",
    anthropic: "claude",
    codex: "codex",
    openai: "codex",
    responses: "codex",
    gemini: "gemini",
    "gemini-cli": "gemini",
    google: "gemini",
  };
  if (explicit && aliases[explicit]) return { application: aliases[explicit], detectedBy: "explicit" };

  const text = [protocol, model, endpoint].filter(Boolean).join(" ").toLowerCase();
  if (/claude|anthropic/.test(text)) return { application: "claude", detectedBy: "inferred" };
  if (/gemini|google/.test(text)) return { application: "gemini", detectedBy: "inferred" };
  if (/codex|openai|responses|(^|[^a-z])gpt[-_\d]|(^|[^a-z])o[1-9]/.test(text)) {
    return { application: "codex", detectedBy: "inferred" };
  }
  return null;
}

export function parseConfigImportUrl(value: string): ParsedConfigImport | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "relayhub:") return null;
    const route = `${url.hostname}${url.pathname}`.replace(/^\/+|\/+$/g, "").toLowerCase();
    const resource = url.searchParams.get("resource")?.trim().toLowerCase();
    if (resource !== "provider" || !["v1/import", "import"].includes(route)) return null;

    const endpoint = firstParam(url.searchParams, ["endpoint", "baseUrl", "base_url", "apiEndpoint", "api_endpoint"]);
    const apiKey = firstParam(url.searchParams, ["apiKey", "api_key", "key", "token"]);
    const model = firstParam(url.searchParams, ["model", "modelName", "model_name"]);
    const protocol = firstParam(url.searchParams, ["protocol", "type"]);
    const app = identifyClientApplication(url.searchParams.get("app") ?? undefined, protocol, model, endpoint);
    if (!app || !endpoint || !apiKey) return null;

    return {
      application: app.application,
      detectedBy: app.detectedBy,
      name: firstParam(url.searchParams, ["name", "title", "provider"]) || `${applicationLabels[app.application]} 导入`,
      baseUrl: endpoint.replace(/\/+$/, ""),
      apiKey,
      model: model || undefined,
      protocol: protocol || undefined,
      homepage: firstParam(url.searchParams, ["homepage", "homePage"]) || undefined,
      source: "external",
    };
  } catch {
    return null;
  }
}

export function ConfigImportDialog({ onImported }: { onImported?: () => void }) {
  const { notify } = useToast();
  const [candidate, setCandidate] = useState<ParsedConfigImport | null>(null);
  const [preview, setPreview] = useState<ConfigImportPreview | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    if (busy) return;
    setCandidate(null);
    setPreview(null);
    setName("");
  }, [busy]);

  const prepare = useCallback(async (next: ParsedConfigImport) => {
    setCandidate(next);
    setPreview(null);
    setName(next.name);
    setBusy(true);
    try {
      setPreview(await configProfileApi.previewImport(next));
    } catch (reason) {
      notify(errorMessage(reason, "读取导入配置失败"), "error");
      setCandidate(null);
    } finally {
      setBusy(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    const accept = (urls: string[]) => {
      const next = urls.map(parseConfigImportUrl).find((value): value is ParsedConfigImport => value !== null);
      if (active && next) void prepare(next);
    };
    void getCurrent().then((urls) => urls && accept(urls)).catch(() => undefined);
    void onOpenUrl(accept).then((next) => {
      if (active) unlisten = next;
      else next();
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [prepare]);

  const importProfile = async () => {
    if (!candidate || !preview || !name.trim()) return;
    setBusy(true);
    try {
      const saved = await configProfileApi.importProfile({ ...candidate, name: name.trim() });
      await emit(CONFIG_PROFILE_CHANGED_EVENT, { profileId: saved.id }).catch(() => undefined);
      notify("配置档案已导入，密钥已安全保存", "success");
      onImported?.();
      setCandidate(null);
      setPreview(null);
      setName("");
    } catch (reason) {
      notify(errorMessage(reason, "导入配置档案失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!candidate) return null;

  return <FormDialog
    title="导入配置档案"
    description="已识别外部客户端配置。确认前只展示掩码密钥，明文密钥不会写入 RelayHub 数据库。"
    ariaLabel="导入配置档案"
    onClose={close}
    footer={<>
      <Button variant="secondary" onClick={close} disabled={busy}>取消</Button>
      <Button variant="primary" onClick={() => void importProfile()} disabled={busy || !preview || !name.trim()}>导入档案</Button>
    </>}
  >
    <div className="config-import-detection">
      <StatusBadge status="online">{applicationLabels[candidate.application]}</StatusBadge>
      <span>{candidate.detectedBy === "explicit" ? "协议字段明确识别" : "根据协议、模型和地址自动识别"}</span>
    </div>
    <FormField label="档案名称" required>
      <TextField autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
    </FormField>
    {preview ? <div className="config-import-summary">
      <SummaryItem label="Base URL" value={preview.baseUrl} mono />
      <SummaryItem label="模型" value={preview.model || "未指定"} />
      <SummaryItem label="协议" value={preview.protocol || "自动"} />
      <SummaryItem label="API 密钥" value={preview.maskedApiKey} mono />
      <div className="config-import-binding">
        <span>RelayHub 绑定</span>
        {preview.matchedKeyId ? <strong>{preview.matchedStationName} / {preview.matchedKeyName}</strong> : <strong>独立导入密钥（系统凭据库）</strong>}
      </div>
    </div> : <div className="config-import-loading" role="status">正在检查现有站点和 API 密钥…</div>}
  </FormDialog>;
}

function SummaryItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>;
}
