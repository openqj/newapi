import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MessageCircle, Pin, RefreshCw, Store, UserPlus, X } from "lucide-react";
import { EmptyState, FormDialog, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { stationApi, type StationSaveResult } from "../../stations";
import { merchantApi } from "../api";
import { DEMO_MERCHANT_CHANGED_EVENT, DEMO_MERCHANT_STORAGE_KEY, demoMarketplaceData } from "../demoData";
import type { MerchantFreeOffer, MerchantModel, MerchantRateShare } from "../types";
import "./MerchantPages.css";

const external = (url: string) => isTauri() ? openUrl(url) : window.open(url, "_blank", "noopener");
const multiplierValue = (summary: string) => summary.match(/-?\d+(?:\.\d+)?/)?.[0] ?? summary;
const merchantModels: MerchantModel[] = ["claude", "chatgpt", "grok"];
const modelLabel: Record<MerchantModel, string> = { claude: "claude", chatgpt: "chatgpt", grok: "grok" };

export function MerchantMarketplacePage() {
  const { notify } = useToast();
  const [tab, setTab] = useState<"rates" | "free">("rates");
  const [rates, setRates] = useState<MerchantRateShare[]>([]);
  const [offers, setOffers] = useState<MerchantFreeOffer[]>([]);
  const [selectedModel, setSelectedModel] = useState<"all" | MerchantModel>("all");
  const [sortBy, setSortBy] = useState<"latest" | "name" | "value">("latest");
  const [contact, setContact] = useState<MerchantRateShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const demoModeRef = useRef(false);
  const applyDemoData = useCallback(() => {
    const demo = demoMarketplaceData();
    demoModeRef.current = true;
    setRates(demo.rates);
    setOffers(demo.offers);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextRates, nextOffers] = await Promise.all([merchantApi.rates(), merchantApi.freeOffers()]);
      if (!nextRates.length && !nextOffers.length) {
        applyDemoData();
      } else {
        demoModeRef.current = false;
        setRates(nextRates);
        setOffers(nextOffers);
      }
    } catch (reason) {
      applyDemoData();
      notify(errorMessage(reason, "加载商家信息失败，当前显示模拟数据。"), "error");
    }
    finally { setLoading(false); }
  }, [applyDemoData, notify]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refreshDemoData = () => {
      if (demoModeRef.current) applyDemoData();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === DEMO_MERCHANT_STORAGE_KEY) refreshDemoData();
    };
    window.addEventListener("storage", handleStorage);
    let unlisten: (() => void) | undefined;
    if (isTauri()) void listen(DEMO_MERCHANT_CHANGED_EVENT, refreshDemoData).then((dispose) => { unlisten = dispose; });
    return () => {
      window.removeEventListener("storage", handleStorage);
      unlisten?.();
    };
  }, [applyDemoData]);
  const filteredRates = useMemo(() => rates.filter((item) => selectedModel === "all" || (item.model ?? "chatgpt") === selectedModel), [rates, selectedModel]);
  const filteredOffers = useMemo(() => offers.filter((item) => selectedModel === "all" || (item.model ?? "chatgpt") === selectedModel), [offers, selectedModel]);
  const sortedRates = useMemo(() => [...filteredRates].sort((left, right) => {
    if (left.pinned !== right.pinned) return Number(right.pinned) - Number(left.pinned);
    if (sortBy === "name") return left.merchantName.localeCompare(right.merchantName, "zh-CN");
    if (sortBy === "value") return Number(multiplierValue(right.multiplierSummary)) - Number(multiplierValue(left.multiplierSummary));
    return right.publishedAt - left.publishedAt;
  }), [filteredRates, sortBy]);
  const sortedOffers = useMemo(() => [...filteredOffers].sort((left, right) => {
    if (left.pinned !== right.pinned) return Number(right.pinned) - Number(left.pinned);
    if (sortBy === "name") return left.merchantName.localeCompare(right.merchantName, "zh-CN");
    if (sortBy === "value") return right.quota - left.quota;
    return right.publishedAt - left.publishedAt;
  }), [filteredOffers, sortBy]);
  const importOffer = async (offer: MerchantFreeOffer) => {
    if (claiming) return;
    if (demoModeRef.current) {
      notify("模拟免费额度不可导入。", "error");
      return;
    }
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
  const openMerchantCenter = async () => {
    if (!isTauri()) return;
    await emit("relayhub:open-merchant-center");
    const mainWindow = await WebviewWindow.getByLabel("main");
    if (!mainWindow) return;
    await mainWindow.show();
    await mainWindow.setFocus();
  };
  return <main className="merchant-market-window">
    <header className="merchant-market-header"><div className="merchant-market-brand"><button type="button" className="merchant-market-brand-button" title="打开商家端" onClick={() => void openMerchantCenter()}><Store size={17} /><h1>商家信息</h1></button><div className="merchant-market-brand-drag" data-tauri-drag-region /></div><button className="merchant-titlebar-button" title="刷新商家信息" aria-label="刷新商家信息" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? "sub2-spin" : ""} /></button><button className="merchant-titlebar-button merchant-window-close" title="关闭" aria-label="关闭窗口" onClick={() => { if (isTauri()) void getCurrentWindow().close(); }}><X size={17} /></button></header>
    <nav className="merchant-market-tabs" role="tablist" aria-label="商家信息分类"><button className={`merchant-market-tab ${tab === "rates" ? "active" : ""}`} role="tab" aria-selected={tab === "rates"} onClick={() => setTab("rates")}>分组倍率</button><button className={`merchant-market-tab ${tab === "free" ? "active" : ""}`} role="tab" aria-selected={tab === "free"} onClick={() => setTab("free")}>免费额度</button></nav>
    <section className="merchant-market-table" role="tabpanel">
      <div className="merchant-list-toolbar"><label>模型：<select className="merchant-sort-select merchant-model-select" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value as "all" | MerchantModel)}><option value="all">全部</option>{merchantModels.map((model) => <option key={model} value={model}>{modelLabel[model]}</option>)}</select></label><label>排序：<select className="merchant-sort-select" value={sortBy} onChange={(event) => setSortBy(event.target.value as "latest" | "name" | "value")}><option value="latest">最新</option><option value="name">商家名</option><option value="value">{tab === "rates" ? "倍率" : "额度"}</option></select></label></div>
      {tab === "rates" && (sortedRates.length ? <div className="merchant-card-list">{sortedRates.map((item) => <article className="merchant-list-card" key={item.id}><header><span className="merchant-card-status" aria-hidden="true" /><button type="button" className="merchant-station-link" title={`打开 ${item.merchantName}`} onClick={() => void external(item.stationUrl)}><span className="merchant-card-merchant-line"><strong>{item.merchantName}</strong>{item.pinned && <span className="merchant-pinned-badge" title="置顶内容"><Pin size={10} aria-hidden="true" />置顶</span>}</span><small>{item.stationName}</small></button><strong className="merchant-card-highlight merchant-card-primary-value merchant-rate-value" title={`倍率 ${multiplierValue(item.multiplierSummary)} X`}>{multiplierValue(item.multiplierSummary)}<small className="merchant-card-value-unit">X</small></strong></header><div className="merchant-card-stats"><div className="merchant-card-inline-stat"><span>分组</span><strong>{item.groupName}</strong></div><div className="merchant-card-stat-action"><button className="button-secondary merchant-contact-button" title="联系商家" aria-label={`联系 ${item.merchantName}`} onClick={() => setContact(item)}><MessageCircle size={15} />联系</button></div></div></article>)}</div> : <EmptyState message={loading ? "正在加载商家倍率…" : "暂无商家分享的分组倍率。"} />)}
      {tab === "free" && (sortedOffers.length ? <div className="merchant-card-list">{sortedOffers.map((item) => <article className="merchant-list-card" key={item.id}><header><span className="merchant-card-status" aria-hidden="true" /><button type="button" className="merchant-station-link" title={`打开 ${item.merchantName}`} onClick={() => void external(item.stationUrl)}><span className="merchant-card-merchant-line"><strong>{item.merchantName}</strong>{item.pinned && <span className="merchant-pinned-badge" title="置顶内容"><Pin size={10} aria-hidden="true" />置顶</span>}</span><small>{item.stationName}</small></button><strong className="merchant-card-highlight merchant-card-primary-value merchant-quota-value" title={`免费额度 $${item.quota.toFixed(2)} 元`}>${item.quota.toFixed(2)}<small className="merchant-card-value-unit">元</small></strong></header><div className="merchant-card-stats"><div className="merchant-card-inline-stat"><span>站点</span><strong>{item.stationUrl}</strong></div><div className="merchant-card-stat-action"><button className="button-secondary merchant-import-button" disabled={Boolean(claiming)} onClick={() => void importOffer(item)}><UserPlus size={15} />{claiming === item.id ? "导入中" : "导入"}</button></div></div></article>)}</div> : <EmptyState message={loading ? "正在加载免费额度…" : "暂无可领取的免费额度。"} />)}
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
