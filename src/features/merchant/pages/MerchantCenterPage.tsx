import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ContactRound, Save, Upload } from "lucide-react";
import { FormField, Panel, TextareaField, TextField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { merchantApi } from "../api";
import type { MerchantFreeCodeInput, MerchantProfile } from "../types";
import "./MerchantPages.css";

const emptyProfile: MerchantProfile = { merchantName: "", description: "", qq: "", qqLink: "", wechatQrUrl: "" };

export function buildMerchantCodeBatch({ stationName, stationUrl, quota, codes }: { stationName: string; stationUrl: string; quota: string; codes: string }): MerchantFreeCodeInput[] {
  const amount = Number(quota);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("免费额度必须大于 0");
  const normalizedStationName = stationName.trim();
  const normalizedStationUrl = stationUrl.trim();
  if (!normalizedStationName) throw new Error("请输入站点名称");
  if (!normalizedStationUrl) throw new Error("请输入站点地址");
  const redeemCodes = codes.split(/\r?\n/).map((code) => code.trim()).filter(Boolean);
  if (!redeemCodes.length) throw new Error("请输入至少一个兑换码");
  if (redeemCodes.length > 200) throw new Error("每次最多发布 200 个兑换码");
  return redeemCodes.map((redeemCode) => ({ stationName: normalizedStationName, stationUrl: normalizedStationUrl, quota: amount, redeemCode }));
}

export function MerchantCenterPage() {
  const { notify } = useToast();
  const [profile, setProfile] = useState<MerchantProfile>(emptyProfile);
  const [stationName, setStationName] = useState("");
  const [stationUrl, setStationUrl] = useState("");
  const [quota, setQuota] = useState("");
  const [codes, setCodes] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const pendingCodeCount = codes.split(/\r?\n/).filter((line) => line.trim()).length;
  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const value = await merchantApi.profile();
      if (value) setProfile(value);
    } catch (reason) {
      setProfileError(errorMessage(reason, "加载商家资料失败。"));
    } finally {
      setProfileLoading(false);
    }
  }, []);
  useEffect(() => { void loadProfile(); }, [loadProfile]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      setProfile(await merchantApi.saveProfile(profile));
      notify("商家资料已保存。", "success");
    } catch (reason) { notify(errorMessage(reason, "保存商家资料失败。"), "error"); }
    finally { setSaving(false); }
  };
  const importBatch = async (event: FormEvent) => {
    event.preventDefault();
    setImporting(true);
    try {
      const parsed = buildMerchantCodeBatch({ stationName, stationUrl, quota, codes });
      const result = await merchantApi.importCodes(parsed);
      setCodes("");
      notify(result.skipped ? `已新增 ${result.imported} 个兑换码，跳过 ${result.skipped} 个重复项。` : `已新增 ${result.imported} 个免费额度兑换码。`, "success");
    } catch (reason) { notify(errorMessage(reason, "批量导入失败。"), "error"); }
    finally { setImporting(false); }
  };
  return <div className="merchant-center-page">
    <Panel title="商家资料" description="公开展示在商家信息窗口中的名称与充值联系方式。">
      <form className="merchant-profile-form" onSubmit={save}>
        {profileError && <div className="merchant-form-error" role="alert"><span>{profileError}</span><button type="button" className="button-secondary" onClick={() => void loadProfile()} disabled={profileLoading}>重试</button></div>}
        <div className="merchant-form-grid"><FormField label="商家名称" required><TextField required value={profile.merchantName} onChange={(event) => setProfile((current) => ({ ...current, merchantName: event.target.value }))} /></FormField><FormField label="QQ"><TextField value={profile.qq ?? ""} onChange={(event) => setProfile((current) => ({ ...current, qq: event.target.value }))} /></FormField></div>
        <FormField label="商家说明 / 签名"><TextareaField rows={3} maxLength={160} value={profile.description ?? ""} onChange={(event) => setProfile((current) => ({ ...current, description: event.target.value }))} placeholder="例如：稳定高速 · 新用户专享" /></FormField>
        <FormField label="QQ / QQ群福利链接"><TextField type="url" value={profile.qqLink ?? ""} onChange={(event) => setProfile((current) => ({ ...current, qqLink: event.target.value }))} placeholder="https://qm.qq.com/..." /></FormField>
        <FormField label="微信二维码图片地址"><TextField type="url" value={profile.wechatQrUrl ?? ""} onChange={(event) => setProfile((current) => ({ ...current, wechatQrUrl: event.target.value }))} placeholder="https://..." /></FormField>
        <div className="merchant-form-actions"><button className="button-primary" disabled={saving || profileLoading || !profile.merchantName.trim()}><Save size={16} />{saving ? "保存中" : profileLoading ? "加载中" : "保存资料"}</button></div>
      </form>
    </Panel>
    <Panel title="免费额度兑换码" description="填写一次站点信息，再批量发布每行一个的兑换码。用户领取后使用自己的站点账号导入。">
      <form className="merchant-profile-form" onSubmit={importBatch}>
        <div className="merchant-form-grid"><FormField label="站点名称" required><TextField required value={stationName} onChange={(event) => setStationName(event.target.value)} /></FormField><FormField label="免费额度" required><TextField type="number" min="0.01" step="0.01" required value={quota} onChange={(event) => setQuota(event.target.value)} /></FormField></div>
        <FormField label="站点地址" required><TextField type="url" required value={stationUrl} onChange={(event) => setStationUrl(event.target.value)} placeholder="https://" /></FormField>
        <FormField label="批量兑换码" required><TextareaField required rows={9} value={codes} onChange={(event) => setCodes(event.target.value)} placeholder={"每行一个兑换码\nRH-FREE-XXXX-XXXX"} /></FormField>
        <div className={`merchant-import-meta ${pendingCodeCount > 200 ? "invalid" : ""}`}><ContactRound size={16} /><span>{pendingCodeCount} / 200 个待发布兑换码</span></div>
        <div className="merchant-form-actions"><button className="button-primary" disabled={importing || pendingCodeCount > 200 || !stationName.trim() || !stationUrl.trim() || !quota.trim() || !codes.trim()}><Upload size={16} />{importing ? "发布中" : "批量发布"}</button></div>
      </form>
    </Panel>
  </div>;
}
