import { type FormEvent, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { FormDialog } from "../../../components/FormDialog";
import { isTauri } from "../../../lib/platform";
import type { Station } from "../../stations";
import { apiKeyApi } from "../api";
import { GroupRateSelect } from "./GroupRateSelect";
import { useApiKeyEditorSubmit } from "../hooks";
import type { GroupOption, KeyRow } from "../types";

type ApiKeyEditorProps = {
  row?: KeyRow;
  rows: KeyRow[];
  stations: Station[];
  onRefreshStation?: (stationId: string) => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (reason: unknown) => void;
};

const keyNamePresets = ["直转", "本地路由", "开发测试", "日常使用"];

const formatMoney = (value?: number) => value == null ? "-" : `${value.toFixed(4)} 额度`;

export function ApiKeyEditor({ row, rows, stations, onRefreshStation, onClose, onSaved, onError }: ApiKeyEditorProps) {
  const [stationId, setStationId] = useState(row?.stationId ?? stations[0]?.id ?? "");
  const [name, setName] = useState(row?.key.name ?? "");
  const [group, setGroup] = useState(row?.key.group ?? "");
  const [quota, setQuota] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const initialStatus = row?.key.status === "inactive" ? "inactive" : "active";
  const [status, setStatus] = useState(initialStatus);
  const [whitelist, setWhitelist] = useState("");
  const [blacklist, setBlacklist] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [useCustomKey, setUseCustomKey] = useState(false);
  const [enableIpRestriction, setEnableIpRestriction] = useState(false);
  const [enableRateLimit, setEnableRateLimit] = useState(false);
  const [rateLimit5h, setRateLimit5h] = useState("");
  const [rateLimit1d, setRateLimit1d] = useState("");
  const [rateLimit7d, setRateLimit7d] = useState("");
  const [enableExpiration, setEnableExpiration] = useState(Boolean(row?.key.expiresAt));
  const isNewApi = stations.find((station) => station.id === stationId)?.kind === "newapi";
  const stationRows = rows.filter((item) => item.stationId === stationId);
  const fallbackGroups = Array.from(new Map(stationRows.flatMap((item) => item.groups.map((entry) => [entry.name, entry]))).values());
  const [groups, setGroups] = useState(fallbackGroups);
  const { saving, submit: saveApiKey } = useApiKeyEditorSubmit({ row, onSaved, onError });
  const onRefreshStationRef = useRef(onRefreshStation);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onRefreshStationRef.current = onRefreshStation;
    onErrorRef.current = onError;
  }, [onError, onRefreshStation]);

  useEffect(() => {
    let active = true;
    setGroups(fallbackGroups);
    if (!stationId || !isTauri()) return () => { active = false; };
    void (async () => {
      try {
        await onRefreshStationRef.current?.(stationId);
        const result = await apiKeyApi.groups<GroupOption[]>(stationId);
        if (active) setGroups(result);
      } catch (reason) {
        if (active) onErrorRef.current(reason);
      }
    })();
    return () => { active = false; };
  // The refresh updates `rows` in the parent.  Do not include it here: doing
  // so starts the same station refresh again after every successful update.
  }, [stationId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await saveApiKey({
      stationId, name, group, customKey, useCustomKey, quota, expiresInDays, enableExpiration,
      status, initialStatus, whitelist, blacklist, enableIpRestriction,
      rateLimit5h, rateLimit1d, rateLimit7d, enableRateLimit,
    });
  };
  const setExpirationPreset = (days: string) => { setExpiresInDays(days); setEnableExpiration(true); };
  const title = row ? "编辑 API 密钥" : "创建 API 密钥";

  return (
    <FormDialog
      title={title}
      ariaLabel={title}
      onClose={onClose}
      onSubmit={submit}
      className="sub2-source-key-dialog"
      contentClassName="sub2-dialog-body"
      footer={<><button className="button-secondary form-dialog-cancel" type="button" onClick={onClose} disabled={saving}>取消</button><button className="button-primary form-dialog-submit" disabled={saving || !stationId || !name.trim()}>{saving && <RefreshCw size={16} className="sub2-spin" />}{row ? "保存" : "创建"}</button></>}
    >
      {!row && <label>来源站点<select value={stationId} disabled={saving} onChange={(event) => { setStationId(event.target.value); setGroup(""); }}>{stations.map((station) => <option value={station.id} key={station.id}>{station.name} / {station.baseUrl}</option>)}</select></label>}
      <label>密钥名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入密钥名称" /></label>
      {!row && <div className="sub2-key-name-presets" aria-label="密钥名称预设">{keyNamePresets.map((preset) => <button type="button" className={name === preset ? "button-primary" : "button-secondary"} onClick={() => setName(preset)} key={preset}>{preset}</button>)}</div>}
      <label>分组<GroupRateSelect className="sub2-editor-group-rate-select" value={group} groups={groups} onChange={setGroup} disabled={saving} allowEmpty searchable /></label>
      {!row && !isNewApi && <section className="sub2-editor-section"><ToggleRow label="自定义密钥" checked={useCustomKey} onChange={setUseCustomKey} />{useCustomKey && <><input value={customKey} onChange={(event) => setCustomKey(event.target.value)} className="sub2-mono-input" placeholder="请输入自定义密钥" /><small>至少 8 个字符，仅允许字母、数字、连字符和下划线。</small></>}</section>}
      {row && <label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">启用</option><option value="inactive">停用</option></select></label>}
      <section className="sub2-editor-section"><ToggleRow label="IP 限制" checked={enableIpRestriction} onChange={setEnableIpRestriction} />{enableIpRestriction && <div className="sub2-editor-stack"><label>IP 白名单<textarea value={whitelist} onChange={(event) => setWhitelist(event.target.value)} placeholder="每行一个 IP 地址" /></label>{!isNewApi && <label>IP 黑名单<textarea value={blacklist} onChange={(event) => setBlacklist(event.target.value)} placeholder="每行一个 IP 地址" /></label>}{isNewApi && <small>该 NewAPI 站点仅支持 IP 白名单。</small>}</div>}</section>
      <section className="sub2-editor-section"><label>额度上限<input value={quota} inputMode="decimal" onChange={(event) => setQuota(event.target.value)} placeholder="0" /><small>填写 0 或留空表示不限额。</small></label>{row?.key.usedQuota != null && <div className="sub2-editor-readonly"><span>已用额度</span><strong>{formatMoney(row.key.usedQuota)} / {formatMoney((row.key.usedQuota ?? 0) + (row.key.remainingQuota ?? 0))}</strong></div>}</section>
      {!isNewApi && <section className="sub2-editor-section"><ToggleRow label="费率限制" checked={enableRateLimit} onChange={setEnableRateLimit} />{enableRateLimit && <div className="sub2-editor-rate-grid"><RateLimitField label="5 小时" value={rateLimit5h} onChange={setRateLimit5h} /><RateLimitField label="1 天" value={rateLimit1d} onChange={setRateLimit1d} /><RateLimitField label="7 天" value={rateLimit7d} onChange={setRateLimit7d} /></div>}</section>}
      <section className="sub2-editor-section"><ToggleRow label="过期时间" checked={enableExpiration} onChange={setEnableExpiration} />{enableExpiration && <div className="sub2-editor-stack"><div className="sub2-expiration-presets">{["7", "30", "90"].map((days) => <button type="button" className={expiresInDays === days ? "active" : ""} onClick={() => setExpirationPreset(days)} key={days}>{days} 天</button>)}<button type="button" className={!['7', '30', '90'].includes(expiresInDays) ? "active" : ""} onClick={() => setExpiresInDays("")}>自定义</button></div><label>有效期（天）<input value={expiresInDays} inputMode="numeric" onChange={(event) => setExpiresInDays(event.target.value)} placeholder="请输入天数" /></label></div>}</section>
    </FormDialog>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="sub2-toggle-row"><span>{label}</span><button className={checked ? "active" : ""} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><i /></button></div>;
}

function RateLimitField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label>{label}<input value={value} inputMode="decimal" onChange={(event) => onChange(event.target.value)} placeholder="0" /></label>;
}
