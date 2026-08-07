import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpToLine, CreditCard, RefreshCw, ShieldCheck, Store, UserPlus, X } from "lucide-react";
import { Button, EmptyState, FormDialog, IconButton, List, ListItem, SelectField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { merchantApi, MERCHANT_FREE_CLAIM_REQUEST_EVENT, MERCHANT_FREE_CLAIM_RESULT_EVENT, MERCHANT_OFFERS_CHANGED_EVENT, MERCHANT_RATE_REGISTER_REQUEST_EVENT } from "../api";
import { DEMO_MERCHANT_CHANGED_EVENT, DEMO_MERCHANT_STORAGE_KEY, demoMarketplaceData } from "../demoData";
import type { MerchantFreeClaimResult, MerchantFreeOffer, MerchantProfile, MerchantRateShare, MerchantTier } from "../types";
import "./MerchantPages.css";

const external = (url: string) => isTauri() ? openUrl(url) : window.open(url, "_blank", "noopener");
const multiplierValue = (summary: string) => summary.match(/\d+(?:\.\d+)?/)?.[0] ?? summary;
const tierLabel: Record<MerchantTier, string> = { diamond: "钻石", gold: "金牌", silver: "银牌" };
const demoPreviewEnabled = import.meta.env.DEV && !isTauri();

export function MerchantMarketplacePage() {
  const { notify } = useToast();
  const [tab, setTab] = useState<"rates" | "free">("rates");
  const [rates, setRates] = useState<MerchantRateShare[]>([]);
  const [offers, setOffers] = useState<MerchantFreeOffer[]>([]);
  const [sortBy, setSortBy] = useState<"latest" | "name" | "value">("latest");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [recharging, setRecharging] = useState<string | null>(null);
  const [merchantInfo, setMerchantInfo] = useState<MerchantProfile | null>(null);
  const demoModeRef = useRef(false);
  const applyDemoData = useCallback(() => {
    const demo = demoMarketplaceData();
    demoModeRef.current = true;
    setRates(demo.rates);
    setOffers(demo.offers);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextRates, nextOffers] = await Promise.all([merchantApi.rates(), merchantApi.freeOffers()]);
      if (demoPreviewEnabled && !nextRates.length && !nextOffers.length) {
        applyDemoData();
      } else {
        demoModeRef.current = false;
        setRates(nextRates);
        setOffers(nextOffers);
      }
    } catch (reason) {
      const message = errorMessage(reason, "加载商家信息失败。");
      if (demoPreviewEnabled) {
        applyDemoData();
        notify(`${message} 当前显示开发预览数据。`, "error");
      } else {
        demoModeRef.current = false;
        setRates([]);
        setOffers([]);
        setLoadError(message);
      }
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
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen(MERCHANT_OFFERS_CHANGED_EVENT, () => void load()).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [load]);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<MerchantFreeClaimResult>(MERCHANT_FREE_CLAIM_RESULT_EVENT, (event) => {
      setClaiming((current) => current === event.payload.offerId ? null : current);
      if (event.payload.success && event.payload.completed) setOffers((current) => current.filter((item) => item.id !== event.payload.offerId));
      notify(event.payload.message, event.payload.success ? "success" : "error");
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [notify]);
  const sortedRates = useMemo(() => [...rates].sort((left, right) => {
    if (left.pinned !== right.pinned) return Number(right.pinned) - Number(left.pinned);
    if (sortBy === "name") return left.merchantName.localeCompare(right.merchantName, "zh-CN");
    if (sortBy === "value") return Number(multiplierValue(right.multiplierSummary)) - Number(multiplierValue(left.multiplierSummary));
    return right.publishedAt - left.publishedAt;
  }), [rates, sortBy]);
  const sortedOffers = useMemo(() => [...offers].sort((left, right) => {
    if (left.pinned !== right.pinned) return Number(right.pinned) - Number(left.pinned);
    if (sortBy === "name") return left.merchantName.localeCompare(right.merchantName, "zh-CN");
    if (sortBy === "value") return right.quota - left.quota;
    return right.publishedAt - left.publishedAt;
  }), [offers, sortBy]);
  const merchantForCardEvent = (event: MouseEvent<HTMLElement>) => {
    const card = (event.target as HTMLElement).closest(".merchant-list-card");
    if (!card) return undefined;
    const cards = Array.from(event.currentTarget.querySelectorAll(".merchant-list-card"));
    const index = cards.indexOf(card);
    return tab === "rates" ? sortedRates[index] : sortedOffers[index];
  };
  const openMerchantCard = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const merchant = merchantForCardEvent(event);
    if (merchant) setMerchantInfo(merchant);
  };
  const openMerchantDescription = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target as HTMLElement).closest(".merchant-station-link small")) return;
    event.preventDefault();
    event.stopPropagation();
    const merchant = merchantForCardEvent(event);
    if (merchant) setMerchantInfo(merchant);
  };
  const importOffer = async (offer: MerchantFreeOffer) => {
    if (claiming) return;
    if (demoModeRef.current) {
      notify("模拟免费额度不可导入。", "error");
      return;
    }
    setClaiming(offer.id);
    try {
      await emitTo("main", MERCHANT_FREE_CLAIM_REQUEST_EVENT, { offerId: offer.id, stationName: offer.stationName, stationUrl: offer.stationUrl });
      const mainWindow = await WebviewWindow.getByLabel("main");
      await mainWindow?.show();
      await mainWindow?.setFocus();
    } catch (reason) {
      setClaiming(null);
      notify(errorMessage(reason, "领取免费额度失败。"), "error");
    }
  };
  const rechargeRate = async (rate: MerchantRateShare) => {
    if (recharging) return;
    if (demoModeRef.current) {
      notify("模拟分组倍率不可充值。", "error");
      return;
    }
    if (!rate.oneToOneRecharge || !rate.officialPricing || !rate.rechargeUrl) {
      notify("该商家未提供符合条件的充值服务。", "error");
      return;
    }
    setRecharging(rate.id);
    try {
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (!mainWindow) throw new Error("主窗口不可用");
      await emitTo("main", MERCHANT_RATE_REGISTER_REQUEST_EVENT, {
        stationName: rate.stationName,
        stationUrl: rate.stationUrl,
        rechargeUrl: rate.rechargeUrl,
      });
      await mainWindow.show();
      await mainWindow.setFocus();
    } catch (reason) {
      notify(errorMessage(reason, "无法打开注册窗口，请稍后重试。"), "error");
    } finally { setRecharging(null); }
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
    <header className="merchant-market-header"><div className="merchant-market-brand"><Button variant="ghost" className="merchant-market-brand-button" title="打开商家端" onClick={() => void openMerchantCenter()}><Store size={17} /><h1>商家信息</h1></Button><div className="merchant-market-brand-drag" data-tauri-drag-region /></div><IconButton variant="ghost" className="merchant-titlebar-button" label="刷新商家信息" onClick={() => void load()} disabled={loading} icon={<RefreshCw size={16} className={loading ? "sub2-spin" : ""} />} /><IconButton variant="ghost" className="merchant-titlebar-button merchant-window-close" label="关闭" onClick={() => { if (isTauri()) void getCurrentWindow().close(); }} icon={<X size={17} />} /></header>
    <nav className="merchant-market-tabs" role="tablist" aria-label="商家信息分类"><Button variant="ghost" className={`merchant-market-tab ${tab === "rates" ? "active" : ""}`} role="tab" aria-selected={tab === "rates"} onClick={() => setTab("rates")}>分组倍率</Button><Button variant="ghost" className={`merchant-market-tab ${tab === "free" ? "active" : ""}`} role="tab" aria-selected={tab === "free"} onClick={() => setTab("free")}>免费额度</Button></nav>
    <section className="merchant-market-table" role="tabpanel" onClick={openMerchantCard} onClickCapture={openMerchantDescription}>
      <div className="merchant-list-toolbar"><label>排序：<SelectField className="merchant-sort-select" value={sortBy} onChange={(event) => setSortBy(event.target.value as "latest" | "name" | "value")}><option value="latest">最新</option><option value="name">商家名</option><option value="value">{tab === "rates" ? "倍率" : "额度"}</option></SelectField></label></div>
      {loadError && <div className="merchant-load-error" role="alert"><span>{loadError}</span><Button variant="secondary" onClick={() => void load()} disabled={loading}>重试</Button></div>}
      {tab === "rates" && (sortedRates.length ? <List className="merchant-card-list">{sortedRates.map((item) => <ListItem as="article" className={`merchant-list-card ${item.pinned ? "merchant-list-card-pinned" : ""}`} key={item.id}>{item.pinned && <span className="merchant-pinned-badge" title="置顶内容" aria-label="置顶内容"><ArrowUpToLine size={11} aria-hidden="true" /></span>}<header><span className="merchant-card-status" aria-hidden="true" /><Button variant="ghost" className="merchant-station-link" title={`打开 ${item.merchantName}`} onClick={() => void external(item.stationUrl)}><span className="merchant-card-merchant-line"><strong>{item.merchantName}</strong><MerchantTierBadge tier={item.tier} /></span><small>{item.description || "暂无商家说明"}</small></Button><strong className="merchant-card-highlight merchant-card-primary-value merchant-rate-value" title={`倍率 ${multiplierValue(item.multiplierSummary)}x`}>{multiplierValue(item.multiplierSummary)}<small className="merchant-card-value-unit">x</small></strong></header><div className="merchant-card-stats"><div className="merchant-card-inline-stat"><span>分组</span><strong>{item.groupName}</strong></div><div className="merchant-card-stat-action"><Button variant="secondary" className="merchant-import-button" title="充值" disabled={Boolean(recharging) || !item.oneToOneRecharge || !item.officialPricing || !item.rechargeUrl} onClick={() => void rechargeRate(item)}><CreditCard size={15} />{recharging === item.id ? "准备充值" : "充值"}</Button></div></div></ListItem>)}</List> : <EmptyState message={loading ? "正在加载商家倍率…" : loadError ? "商家倍率加载失败，请重试。" : "暂无商家分享的分组倍率。"} />)}
      {tab === "free" && (sortedOffers.length ? <List className="merchant-card-list">{sortedOffers.map((item) => <ListItem as="article" className={`merchant-list-card ${item.pinned ? "merchant-list-card-pinned" : ""}`} key={item.id}>{item.pinned && <span className="merchant-pinned-badge" title="置顶内容" aria-label="置顶内容"><ArrowUpToLine size={11} aria-hidden="true" /></span>}<header><span className="merchant-card-status" aria-hidden="true" /><Button variant="ghost" className="merchant-station-link" title={`打开 ${item.merchantName}`} onClick={() => void external(item.stationUrl)}><span className="merchant-card-merchant-line"><strong>{item.merchantName}</strong><MerchantTierBadge tier={item.tier} /></span><small>{item.description || "暂无商家说明"}</small></Button><strong className="merchant-card-highlight merchant-card-primary-value merchant-quota-value" title={`免费额度 $${item.quota.toFixed(2)} 元`}>${item.quota.toFixed(2)}<small className="merchant-card-value-unit">元</small></strong></header><div className="merchant-card-stats"><div className="merchant-card-inline-stat"><strong>已有{item.claimedCount}人领取</strong></div><div className="merchant-card-stat-action"><Button variant="secondary" className="merchant-import-button" disabled={Boolean(claiming)} onClick={() => void importOffer(item)}><UserPlus size={15} />{claiming === item.id ? "领取中" : "领取"}</Button></div></div></ListItem>)}</List> : <EmptyState message={loading ? "正在加载免费额度…" : loadError ? "免费额度加载失败，请重试。" : "暂无可领取的免费额度。"} />)}
    </section>
    {merchantInfo && <MerchantInfoDialog merchant={merchantInfo} onClose={() => setMerchantInfo(null)} />}
  </main>;
}

function MerchantTierBadge({ tier }: { tier?: MerchantTier }) {
  if (!tier) return null;
  return <span className={`merchant-tier-badge merchant-tier-${tier}`} title={`${tierLabel[tier]}商家`} aria-label={`${tierLabel[tier]}商家`}><ShieldCheck size={13} aria-hidden="true" /></span>;
}

function MerchantInfoDialog({ merchant, onClose }: { merchant: MerchantProfile; onClose: () => void }) {
  return <FormDialog title={merchant.merchantName} description={merchant.description || "暂无商家说明"} ariaLabel={`${merchant.merchantName} 商家信息`} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>关闭</Button>}>
    <div className="merchant-contact-dialog">
      <div className="merchant-qq-contact"><span>QQ</span><strong>{merchant.qq || "未填写"}</strong>{merchant.qqLink && <Button variant="primary" onClick={() => void external(merchant.qqLink!)}>打开联系链接</Button>}</div>
      <div className="merchant-wechat-contact"><span>微信二维码</span>{merchant.wechatQrUrl ? <img src={merchant.wechatQrUrl} alt={`${merchant.merchantName} 微信二维码`} /> : <p>商家暂未上传二维码</p>}</div>
    </div>
  </FormDialog>;
}
