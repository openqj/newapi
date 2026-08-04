import { type FormEvent, useCallback, useEffect, useState } from "react";
import { BadgeCheck, ContactRound, Save, Upload } from "lucide-react";
import { FormField, Panel, TextareaField, TextField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { merchantApi } from "../api";
import type { MerchantFreeCodeInput, MerchantProfile } from "../types";
import "./MerchantPages.css";

const emptyProfile: MerchantProfile = { merchantName: "", description: "", qq: "", qqLink: "", websiteUrl: "", wechatQrUrl: "" };
type MerchantCenterTab = "profile" | "freeCodes" | "rates";

export function buildMerchantCodeBatch({ stationName, stationUrl, quota, expiresAt, codes }: { stationName: string; stationUrl: string; quota: string; expiresAt: string; codes: string }): MerchantFreeCodeInput[] {
  const amount = Number(quota);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("免费额度必须大于 0");
  const normalizedStationName = stationName.trim();
  const normalizedStationUrl = stationUrl.trim();
  if (!normalizedStationName) throw new Error("请输入站点名称");
  if (!normalizedStationUrl) throw new Error("请输入站点地址");
  const expiration = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiration) || expiration <= Date.now()) throw new Error("有效期必须晚于当前时间");
  const redeemCodes = codes.split(/\r?\n/).map((code) => code.trim()).filter(Boolean);
  if (!redeemCodes.length) throw new Error("请输入至少一个兑换码");
  if (redeemCodes.length > 200) throw new Error("每次最多发布 200 个兑换码");
  return redeemCodes.map((redeemCode) => ({ stationName: normalizedStationName, stationUrl: normalizedStationUrl, quota: amount, expiresAt: Math.floor(expiration / 1000), redeemCode }));
}

export function canPublishMerchantRate({ stationName, stationUrl, groupName, multiplierSummary, rechargeUrl, oneToOneRecharge, officialPricing }: { stationName: string; stationUrl: string; groupName: string; multiplierSummary: string; rechargeUrl: string; oneToOneRecharge: boolean; officialPricing: boolean }) {
  return Boolean(stationName.trim() && stationUrl.trim() && groupName.trim() && multiplierSummary.trim() && rechargeUrl.trim() && oneToOneRecharge && officialPricing);
}

export function MerchantCenterPage() {
  const { notify } = useToast();
  const [profile, setProfile] = useState<MerchantProfile>(emptyProfile);
  const [stationName, setStationName] = useState("");
  const [stationUrl, setStationUrl] = useState("");
  const [quota, setQuota] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [codes, setCodes] = useState("");
  const [rateStationName, setRateStationName] = useState("");
  const [rateStationUrl, setRateStationUrl] = useState("");
  const [groupName, setGroupName] = useState("");
  const [multiplierSummary, setMultiplierSummary] = useState("");
  const [rechargeUrl, setRechargeUrl] = useState("");
  const [oneToOneRecharge, setOneToOneRecharge] = useState(false);
  const [officialPricing, setOfficialPricing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [publishingRate, setPublishingRate] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MerchantCenterTab>("profile");
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
      const parsed = buildMerchantCodeBatch({ stationName, stationUrl, quota, expiresAt, codes });
      const result = await merchantApi.importCodes(parsed);
      setCodes("");
      notify(result.skipped ? `已新增 ${result.imported} 个兑换码，跳过 ${result.skipped} 个重复项。` : `已新增 ${result.imported} 个免费额度兑换码。`, "success");
    } catch (reason) { notify(errorMessage(reason, "批量导入失败。"), "error"); }
    finally { setImporting(false); }
  };
  const publishRate = async (event: FormEvent) => {
    event.preventDefault();
    setPublishingRate(true);
    try {
      await merchantApi.publishRate({
        stationName: rateStationName.trim(),
        stationUrl: rateStationUrl.trim(),
        groupName: groupName.trim(),
        multiplierSummary: multiplierSummary.trim(),
        rechargeUrl: rechargeUrl.trim(),
        oneToOneRecharge,
        officialPricing,
      });
      notify("倍率已发布。", "success");
    } catch (reason) { notify(errorMessage(reason, "发布分组倍率失败。"), "error"); }
    finally { setPublishingRate(false); }
  };
  return <div className="merchant-center-page">
    <Panel className="merchant-center-management-card">
      <nav className="merchant-center-tabs" role="tablist" aria-label="商家端功能">
        <button type="button" className={`merchant-center-tab ${activeTab === "profile" ? "active" : ""}`} role="tab" aria-selected={activeTab === "profile"} aria-controls="merchant-center-profile" onClick={() => setActiveTab("profile")}>商家资料</button>
        <button type="button" className={`merchant-center-tab ${activeTab === "freeCodes" ? "active" : ""}`} role="tab" aria-selected={activeTab === "freeCodes"} aria-controls="merchant-center-free-codes" onClick={() => setActiveTab("freeCodes")}>免费额度兑换码</button>
        <button type="button" className={`merchant-center-tab ${activeTab === "rates" ? "active" : ""}`} role="tab" aria-selected={activeTab === "rates"} aria-controls="merchant-center-rates" onClick={() => setActiveTab("rates")}>分组倍率充值</button>
      </nav>
      {activeTab === "profile" && <section id="merchant-center-profile" className="merchant-center-tab-panel" role="tabpanel">
        <div className="merchant-center-tab-heading"><div><h2>商家资料</h2><p>公开展示在商家信息窗口中的名称与充值联系方式。</p></div></div>
        <form className="merchant-profile-form" onSubmit={save}>
          {profileError && <div className="merchant-form-error" role="alert"><span>{profileError}</span><button type="button" className="button-secondary" onClick={() => void loadProfile()} disabled={profileLoading}>重试</button></div>}
          <div className="merchant-form-grid"><FormField label="商家名称" required><TextField required value={profile.merchantName} onChange={(event) => setProfile((current) => ({ ...current, merchantName: event.target.value }))} /></FormField><FormField label="QQ"><TextField value={profile.qq ?? ""} onChange={(event) => setProfile((current) => ({ ...current, qq: event.target.value }))} /></FormField></div>
          <FormField label="商家说明 / 签名"><TextareaField rows={3} maxLength={160} value={profile.description ?? ""} onChange={(event) => setProfile((current) => ({ ...current, description: event.target.value }))} placeholder="例如：稳定高速 · 新用户专享" /></FormField>
          <FormField label="商家网址"><TextField type="url" value={profile.websiteUrl ?? ""} onChange={(event) => setProfile((current) => ({ ...current, websiteUrl: event.target.value }))} placeholder="https://example.com" /></FormField>
          <FormField label="QQ / QQ群福利链接"><TextField type="url" value={profile.qqLink ?? ""} onChange={(event) => setProfile((current) => ({ ...current, qqLink: event.target.value }))} placeholder="https://qm.qq.com/..." /></FormField>
          <FormField label="微信二维码图片地址"><TextField type="url" value={profile.wechatQrUrl ?? ""} onChange={(event) => setProfile((current) => ({ ...current, wechatQrUrl: event.target.value }))} placeholder="https://..." /></FormField>
          <div className="merchant-form-actions"><button className="button-primary" disabled={saving || profileLoading || !profile.merchantName.trim()}><Save size={16} />{saving ? "保存中" : profileLoading ? "加载中" : "保存资料"}</button></div>
        </form>
      </section>}
      {activeTab === "freeCodes" && <section id="merchant-center-free-codes" className="merchant-center-tab-panel" role="tabpanel">
        <div className="merchant-center-tab-heading"><div><h2>免费额度兑换码</h2><p>商家资料中的名称和说明会公开展示。用户领取后，已有站点账号将自动兑换额度。</p></div></div>
        <form className="merchant-profile-form" onSubmit={importBatch}>
          <div className="merchant-form-grid"><FormField label="站点名称" required><TextField required value={stationName} onChange={(event) => setStationName(event.target.value)} /></FormField><FormField label="免费额度" required><TextField type="number" min="0.01" step="0.01" required value={quota} onChange={(event) => setQuota(event.target.value)} /></FormField><FormField label="有效期至" required><TextField type="datetime-local" required value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></FormField></div>
          <FormField label="站点地址" required><TextField type="url" required value={stationUrl} onChange={(event) => setStationUrl(event.target.value)} placeholder="https://" /></FormField>
          <FormField label="批量兑换码" required><TextareaField required rows={9} value={codes} onChange={(event) => setCodes(event.target.value)} placeholder={"每行一个兑换码\nRH-FREE-XXXX-XXXX"} /></FormField>
          <div className={`merchant-import-meta ${pendingCodeCount > 200 ? "invalid" : ""}`}><ContactRound size={16} /><span>{pendingCodeCount} / 200 个待发布兑换码</span></div>
          <div className="merchant-form-actions"><button className="button-primary" disabled={importing || pendingCodeCount > 200 || !stationName.trim() || !stationUrl.trim() || !quota.trim() || !expiresAt || !codes.trim()}><Upload size={16} />{importing ? "发布中" : "批量发布"}</button></div>
        </form>
      </section>}
      {activeTab === "rates" && <section id="merchant-center-rates" className="merchant-center-tab-panel" role="tabpanel">
        <div className="merchant-center-tab-heading"><div><h2>分组倍率充值</h2><p>用户点击充值后注册自己的站点账号；注册登录成功后会打开兑换窗口和卡密充值页。</p></div></div>
        <form className="merchant-profile-form" onSubmit={publishRate}>
          <div className="merchant-form-grid"><FormField label="站点名称" required><TextField required value={rateStationName} onChange={(event) => setRateStationName(event.target.value)} /></FormField><FormField label="分组名称" required><TextField required value={groupName} onChange={(event) => setGroupName(event.target.value)} /></FormField></div>
          <div className="merchant-form-grid"><FormField label="站点地址" required><TextField type="url" required value={rateStationUrl} onChange={(event) => setRateStationUrl(event.target.value)} placeholder="https://" /></FormField><FormField label="卡密充值地址" required><TextField type="url" required value={rechargeUrl} onChange={(event) => setRechargeUrl(event.target.value)} placeholder="https://" /></FormField></div>
          <FormField label="倍率说明" required><TextField required maxLength={500} value={multiplierSummary} onChange={(event) => setMultiplierSummary(event.target.value)} placeholder="例如：GPT-4o 0.5x" /></FormField>
          <div className="merchant-rate-commitments"><label><input type="checkbox" checked={oneToOneRecharge} onChange={(event) => setOneToOneRecharge(event.target.checked)} />￥1 = $1 充值兑换</label><label><input type="checkbox" checked={officialPricing} onChange={(event) => setOfficialPricing(event.target.checked)} />使用官方定价模式</label></div>
          <div className="merchant-form-actions"><button className="button-primary" disabled={publishingRate || !canPublishMerchantRate({ stationName: rateStationName, stationUrl: rateStationUrl, groupName, multiplierSummary, rechargeUrl, oneToOneRecharge, officialPricing })}><BadgeCheck size={16} />{publishingRate ? "发布中" : "发布倍率"}</button></div>
        </form>
      </section>}
    </Panel>
  </div>;
}
