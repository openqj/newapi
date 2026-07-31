import { useCallback, useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Gift, MessageCircle, RefreshCw, Store, UserPlus } from "lucide-react";
import { EmptyState, FormDialog, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { stationApi, type StationSaveResult } from "../../stations";
import { merchantApi } from "../api";
import type { MerchantFreeOffer, MerchantRateShare } from "../types";
import "./MerchantPages.css";

const external = (url: string) => isTauri() ? openUrl(url) : window.open(url, "_blank", "noopener");

export function MerchantMarketplacePage() {
  const { notify } = useToast();
  const [tab, setTab] = useState<"rates" | "free">("rates");
  const [rates, setRates] = useState<MerchantRateShare[]>([]);
  const [offers, setOffers] = useState<MerchantFreeOffer[]>([]);
  const [contact, setContact] = useState<MerchantRateShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextRates, nextOffers] = await Promise.all([merchantApi.rates(), merchantApi.freeOffers()]);
      setRates(nextRates);
      setOffers(nextOffers);
    } catch (reason) { notify(errorMessage(reason, "加载商家信息失败。"), "error"); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);
  const importOffer = async (offer: MerchantFreeOffer) => {
    if (claiming) return;
    setClaiming(offer.id);
    let claimed = false;
    try {
      const account = await merchantApi.claimAccount(offer.id);
      claimed = true;
      const result = await stationApi.add<StationSaveResult>({ name: account.stationName, baseUrl: account.stationUrl, username: account.username, password: account.password, kind: account.stationKind, totp: null });
      if (!result.connection.success) throw new Error(result.connection.reason ?? "站点账号验证失败");
      await emit("relayhub:stations-changed");
      setOffers((current) => current.filter((item) => item.id !== offer.id));
      notify(`${offer.stationName} 已添加到 RelayHub。`, "success");
    } catch (reason) {
      if (claimed) await merchantApi.releaseAccount(offer.id).catch(() => undefined);
      notify(errorMessage(reason, "导入免费额度失败。"), "error");
    } finally { setClaiming(null); }
  };
  return <main className="merchant-market-window">
    <header className="merchant-market-header"><div className="merchant-market-brand"><Store size={20} /><div><h1>商家信息</h1><p>RelayHub 中转站共享</p></div></div><button className="button-secondary merchant-refresh" title="刷新商家信息" aria-label="刷新商家信息" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? "sub2-spin" : ""} /></button></header>
    <nav className="merchant-market-tabs" role="tablist" aria-label="商家信息分类"><button className={`test-mode-button ${tab === "rates" ? "active" : ""}`} role="tab" aria-selected={tab === "rates"} onClick={() => setTab("rates")}><Store size={16} />分组倍率</button><button className={`test-mode-button ${tab === "free" ? "active" : ""}`} role="tab" aria-selected={tab === "free"} onClick={() => setTab("free")}><Gift size={16} />免费额度</button></nav>
    <section className="merchant-market-table" role="tabpanel">
      {tab === "rates" && (rates.length ? <table><thead><tr><th>商家名称</th><th>分组倍率</th><th>充值联系</th></tr></thead><tbody>{rates.map((item) => <tr key={item.id}><td><strong>{item.merchantName}</strong><small>{item.stationName}</small></td><td><strong>{item.groupName}</strong><small>{item.multiplierSummary}</small></td><td><button className="button-secondary merchant-contact-button" onClick={() => setContact(item)}><MessageCircle size={15} />联系</button></td></tr>)}</tbody></table> : <EmptyState message={loading ? "正在加载商家倍率…" : "暂无商家分享的分组倍率。"} />)}
      {tab === "free" && (offers.length ? <table><thead><tr><th>商家名称</th><th>免费额度</th><th>导入</th></tr></thead><tbody>{offers.map((item) => <tr key={item.id}><td><strong>{item.merchantName}</strong><small>{item.stationName}</small></td><td><strong>{item.quota.toFixed(2)} 元</strong><small>{item.stationUrl}</small></td><td><button className="button-primary merchant-import-button" disabled={Boolean(claiming)} onClick={() => void importOffer(item)}><UserPlus size={15} />{claiming === item.id ? "导入中" : "导入"}</button></td></tr>)}</tbody></table> : <EmptyState message={loading ? "正在加载免费额度…" : "暂无可领取的免费额度。"} />)}
    </section>
    {contact && <ContactDialog merchant={contact} onClose={() => setContact(null)} />}
  </main>;
}

function ContactDialog({ merchant, onClose }: { merchant: MerchantRateShare; onClose: () => void }) {
  return <FormDialog title={merchant.merchantName} description={merchant.stationName} ariaLabel="商家充值联系" onClose={onClose} footer={<button type="button" className="button-secondary" onClick={onClose}>关闭</button>}>
    <div className="merchant-contact-dialog">
      <div className="merchant-qq-contact"><span>QQ</span><strong>{merchant.qq || "未填写"}</strong>{merchant.qqLink && <button type="button" className="button-primary" onClick={() => void external(merchant.qqLink!)}><MessageCircle size={16} />QQ 福利</button>}</div>
      <div className="merchant-wechat-contact"><span>微信二维码</span>{merchant.wechatQrUrl ? <img src={merchant.wechatQrUrl} alt={`${merchant.merchantName} 微信二维码`} /> : <p>商家暂未上传二维码</p>}</div>
    </div>
  </FormDialog>;
}
