import { type FormEvent, useEffect, useState } from "react";
import { ContactRound, Save, Upload } from "lucide-react";
import { FormField, Panel, TextareaField, TextField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { merchantApi } from "../api";
import type { MerchantFreeAccountInput, MerchantProfile } from "../types";
import "./MerchantPages.css";

const emptyProfile: MerchantProfile = { merchantName: "", qq: "", qqLink: "", wechatQrUrl: "" };

function parseAccounts(value: string): MerchantFreeAccountInput[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [stationName, stationUrl, username, password, quota, stationKind = "auto"] = line.split("|").map((item) => item.trim());
    if (!stationName || !stationUrl || !username || !password || !quota) throw new Error(`第 ${index + 1} 行缺少字段`);
    const amount = Number(quota);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`第 ${index + 1} 行额度无效`);
    if (!["auto", "newapi", "sub2api"].includes(stationKind)) throw new Error(`第 ${index + 1} 行站点类型无效`);
    return { stationName, stationUrl, username, password, quota: amount, stationKind: stationKind as MerchantFreeAccountInput["stationKind"] };
  });
}

export function MerchantCenterPage() {
  const { notify } = useToast();
  const [profile, setProfile] = useState<MerchantProfile>(emptyProfile);
  const [accounts, setAccounts] = useState("");
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
      const parsed = parseAccounts(accounts);
      await merchantApi.importAccounts(parsed);
      setAccounts("");
      notify(`已发布 ${parsed.length} 个免费额度账号。`, "success");
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
    <Panel title="免费额度账号" description="批量发布可由用户一键导入 RelayHub 的中转站账号。">
      <form className="merchant-profile-form" onSubmit={importBatch}>
        <FormField label="批量账号" required><TextareaField required rows={9} value={accounts} onChange={(event) => setAccounts(event.target.value)} placeholder="站点名称|https://站点地址|账号|密码|免费额度|auto" /></FormField>
        <div className="merchant-import-meta"><ContactRound size={16} /><span>{accounts.split(/\r?\n/).filter((line) => line.trim()).length} 个待发布账号</span></div>
        <div className="merchant-form-actions"><button className="button-primary" disabled={importing || !accounts.trim()}><Upload size={16} />{importing ? "发布中" : "批量发布"}</button></div>
      </form>
    </Panel>
  </div>;
}
