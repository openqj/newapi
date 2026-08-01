import { type FormEvent, useEffect, useState } from "react";
import { ContactRound, Save, Upload } from "lucide-react";
import { FormField, Panel, TextareaField, TextField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { merchantApi } from "../api";
import type { MerchantFreeCodeInput, MerchantProfile } from "../types";
import "./MerchantPages.css";

const emptyProfile: MerchantProfile = { merchantName: "", qq: "", qqLink: "", wechatQrUrl: "" };

export function MerchantCenterPage() {
  const { notify } = useToast();
  const [profile, setProfile] = useState<MerchantProfile>(emptyProfile);
  const [stationName, setStationName] = useState("");
  const [stationUrl, setStationUrl] = useState("");
  const [quota, setQuota] = useState("");
  const [codes, setCodes] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => { void merchantApi.profile().then((value) => value && setProfile(value)).catch(() => undefined); }, []);
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
      const amount = Number(quota);
      if (!Number.isFinite(amount) || amount < 0) throw new Error("请输入有效的免费额度");
      const parsed: MerchantFreeCodeInput[] = codes.split(/\r?\n/).map((code) => code.trim()).filter(Boolean).map((redeemCode) => ({ stationName: stationName.trim(), stationUrl: stationUrl.trim(), quota: amount, redeemCode }));
      await merchantApi.importCodes(parsed);
      setCodes("");
      notify(`已发布 ${parsed.length} 个免费额度兑换码。`, "success");
    } catch (reason) { notify(errorMessage(reason, "批量导入失败。"), "error"); }
    finally { setImporting(false); }
  };
  return <div className="merchant-center-page">
    <Panel title="商家资料" description="公开展示在商家信息窗口中的名称与充值联系方式。">
      <form className="merchant-profile-form" onSubmit={save}>
        <div className="merchant-form-grid"><FormField label="商家名称" required><TextField required value={profile.merchantName} onChange={(event) => setProfile((current) => ({ ...current, merchantName: event.target.value }))} /></FormField><FormField label="QQ"><TextField value={profile.qq ?? ""} onChange={(event) => setProfile((current) => ({ ...current, qq: event.target.value }))} /></FormField></div>
        <FormField label="QQ / QQ群福利链接"><TextField type="url" value={profile.qqLink ?? ""} onChange={(event) => setProfile((current) => ({ ...current, qqLink: event.target.value }))} placeholder="https://qm.qq.com/..." /></FormField>
        <FormField label="微信二维码图片地址"><TextField type="url" value={profile.wechatQrUrl ?? ""} onChange={(event) => setProfile((current) => ({ ...current, wechatQrUrl: event.target.value }))} placeholder="https://..." /></FormField>
        <div className="merchant-form-actions"><button className="button-primary" disabled={saving || !profile.merchantName.trim()}><Save size={16} />{saving ? "保存中" : "保存资料"}</button></div>
      </form>
    </Panel>
    <Panel title="免费额度兑换码" description="填写一次站点信息，再批量发布每行一个的兑换码。用户领取后使用自己的站点账号导入。">
      <form className="merchant-profile-form" onSubmit={importBatch}>
        <div className="merchant-form-grid"><FormField label="站点名称" required><TextField required value={stationName} onChange={(event) => setStationName(event.target.value)} /></FormField><FormField label="免费额度" required><TextField type="number" min="0" step="0.01" required value={quota} onChange={(event) => setQuota(event.target.value)} /></FormField></div>
        <FormField label="站点地址" required><TextField type="url" required value={stationUrl} onChange={(event) => setStationUrl(event.target.value)} placeholder="https://" /></FormField>
        <FormField label="批量兑换码" required><TextareaField required rows={9} value={codes} onChange={(event) => setCodes(event.target.value)} placeholder={"每行一个兑换码\nRH-FREE-XXXX-XXXX"} /></FormField>
        <div className="merchant-import-meta"><ContactRound size={16} /><span>{codes.split(/\r?\n/).filter((line) => line.trim()).length} 个待发布兑换码</span></div>
        <div className="merchant-form-actions"><button className="button-primary" disabled={importing || !stationName.trim() || !stationUrl.trim() || !quota.trim() || !codes.trim()}><Upload size={16} />{importing ? "发布中" : "批量发布"}</button></div>
      </form>
    </Panel>
  </div>;
}
