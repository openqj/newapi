import { type FormEvent, useCallback, useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { Pencil, Pin, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { FormDialog, FormField, Panel, SelectField, TextareaField, TextField, useConfirm, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { merchantApi } from "../api";
import { DEMO_MERCHANT_CHANGED_EVENT, type DemoMerchantState, loadDemoMerchantState, saveDemoMerchantState } from "../demoData";
import type { AdminMerchantFreeCode, AdminMerchantFreeCodeInput, AdminMerchantProfile, AdminMerchantProfileInput, AdminMerchantRateShare, AdminMerchantRateShareInput, MerchantTier } from "../types";
import "./MerchantPages.css";

const rateInput = (item: AdminMerchantRateShare, pinned = item.pinned): AdminMerchantRateShareInput => ({ id: item.id, merchantId: item.merchantId, stationName: item.stationName, stationUrl: item.stationUrl, groupName: item.groupName, multiplierSummary: item.multiplierSummary, pinned });
const freeCodeInput = (item: AdminMerchantFreeCode, pinned = item.pinned): AdminMerchantFreeCodeInput => ({ id: item.id, merchantId: item.merchantId, stationName: item.stationName, stationUrl: item.stationUrl, redeemCode: item.redeemCode, quota: item.quota, pinned });
const tierLabel: Record<MerchantTier, string> = { diamond: "钻石", gold: "金牌", silver: "银牌" };
const demoId = (kind: "rate" | "account") => `demo-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const pinnedFirst = <T extends { pinned: boolean }>(items: T[]) => [...items].sort((left, right) => Number(right.pinned) - Number(left.pinned));

export function MerchantAdminPage() {
  const confirm = useConfirm();
  const { notify } = useToast();
  const [profiles, setProfiles] = useState<AdminMerchantProfile[]>([]);
  const [rates, setRates] = useState<AdminMerchantRateShare[]>([]);
  const [accounts, setAccounts] = useState<AdminMerchantFreeCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<AdminMerchantProfile | null>(null);
  const [editingRate, setEditingRate] = useState<AdminMerchantRateShare | "new" | null>(null);
  const [editingAccount, setEditingAccount] = useState<AdminMerchantFreeCode | "new" | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [managementTab, setManagementTab] = useState<"profiles" | "rates" | "accounts">("profiles");

  const applyDemoState = useCallback((state: DemoMerchantState) => {
    setDemoMode(true);
    setProfiles(state.profiles);
    setRates(pinnedFirst(state.rates));
    setAccounts(pinnedFirst(state.accounts));
  }, []);

  const commitDemoState = useCallback(async (state: DemoMerchantState) => {
    saveDemoMerchantState(state);
    applyDemoState(state);
    if (isTauri()) await emit(DEMO_MERCHANT_CHANGED_EVENT).catch(() => undefined);
  }, [applyDemoState]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProfiles, nextRates, nextAccounts] = await Promise.all([merchantApi.adminProfiles(), merchantApi.adminRates(), merchantApi.adminFreeCodes()]);
      if (!nextProfiles.length && !nextRates.length && !nextAccounts.length) {
        await commitDemoState(loadDemoMerchantState());
      } else {
        setDemoMode(false);
        setProfiles(nextProfiles);
        setRates(nextRates);
        setAccounts(nextAccounts);
      }
    } catch (reason) {
      await commitDemoState(loadDemoMerchantState());
      notify(errorMessage(reason, "加载商家信息管理列表失败，当前使用本机模拟数据。"), "error");
    } finally {
      setLoading(false);
    }
  }, [commitDemoState, notify]);

  useEffect(() => { void load(); }, [load]);

  const saveRate = async (input: AdminMerchantRateShareInput) => {
    setSavingId(input.id ?? "new-rate");
    try {
      if (demoMode) {
        const state = loadDemoMerchantState();
        const existing = input.id ? state.rates.find((item) => item.id === input.id) : undefined;
        const merchantName = state.profiles.find((item) => item.userId === input.merchantId)?.merchantName ?? existing?.merchantName ?? "模拟商家";
        const item: AdminMerchantRateShare = { ...input, id: input.id ?? demoId("rate"), merchantName, publishedAt: existing?.publishedAt ?? Date.now() };
        await commitDemoState({ ...state, rates: existing ? state.rates.map((current) => current.id === item.id ? item : current) : [item, ...state.rates] });
      } else {
        await merchantApi.saveAdminRate(input);
      }
      setEditingRate(null);
      if (!demoMode) await load();
      notify("分组倍率信息已保存。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "保存分组倍率失败。"), "error");
    } finally {
      setSavingId(null);
    }
  };

  const saveProfile = async (input: AdminMerchantProfileInput) => {
    setSavingId(input.userId);
    try {
      if (demoMode) {
        const state = loadDemoMerchantState();
        await commitDemoState({
          profiles: state.profiles.map((item) => item.userId === input.userId ? input : item),
          rates: state.rates.map((item) => item.merchantId === input.userId ? { ...item, merchantName: input.merchantName } : item),
          accounts: state.accounts.map((item) => item.merchantId === input.userId ? { ...item, merchantName: input.merchantName } : item),
        });
      } else {
        await merchantApi.saveAdminProfile(input);
      }
      setEditingProfile(null);
      if (!demoMode) await load();
      notify("商家资料已保存。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "保存商家资料失败。"), "error");
    } finally {
      setSavingId(null);
    }
  };

  const saveAccount = async (input: AdminMerchantFreeCodeInput) => {
    setSavingId(input.id ?? "new-account");
    try {
      if (demoMode) {
        const state = loadDemoMerchantState();
        const existing = input.id ? state.accounts.find((item) => item.id === input.id) : undefined;
        const merchantName = state.profiles.find((item) => item.userId === input.merchantId)?.merchantName ?? existing?.merchantName ?? "模拟商家";
        const item: AdminMerchantFreeCode = { ...input, id: input.id ?? demoId("account"), merchantName, claimed: existing?.claimed ?? false, createdAt: existing?.createdAt ?? Date.now() };
        await commitDemoState({ ...state, accounts: existing ? state.accounts.map((current) => current.id === item.id ? item : current) : [item, ...state.accounts] });
      } else {
        await merchantApi.saveAdminFreeCode(input);
      }
      setEditingAccount(null);
      if (!demoMode) await load();
      notify("免费额度信息已保存。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "保存免费额度失败。"), "error");
    } finally {
      setSavingId(null);
    }
  };

  const deleteRate = async (item: AdminMerchantRateShare) => {
    const approved = await confirm({ title: "删除分组倍率", description: `确定删除 ${item.merchantName} 的 ${item.groupName} 分组倍率吗？`, confirmLabel: "删除", destructive: true });
    if (!approved) return;
    setSavingId(item.id);
    try {
      if (demoMode) {
        const state = loadDemoMerchantState();
        await commitDemoState({ ...state, rates: state.rates.filter((current) => current.id !== item.id) });
      } else {
        await merchantApi.deleteAdminRate(item.id);
        await load();
      }
      notify("分组倍率已删除。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "删除分组倍率失败。"), "error");
    } finally {
      setSavingId(null);
    }
  };

  const deleteAccount = async (item: AdminMerchantFreeCode) => {
    const approved = await confirm({ title: "删除免费额度", description: `确定删除 ${item.merchantName} 的 ${item.stationName} 免费额度兑换码吗？`, confirmLabel: "删除", destructive: true });
    if (!approved) return;
    setSavingId(item.id);
    try {
      if (demoMode) {
        const state = loadDemoMerchantState();
        await commitDemoState({ ...state, accounts: state.accounts.filter((current) => current.id !== item.id) });
      } else {
        await merchantApi.deleteAdminFreeCode(item.id);
        await load();
      }
      notify("免费额度已删除。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "删除免费额度失败。"), "error");
    } finally {
      setSavingId(null);
    }
  };

  return <div className="merchant-admin-page">
    <Panel title="副窗口商家信息管理" description="维护商家信息副窗口中的分组倍率和免费额度；置顶内容会固定显示在列表最前。">
      <div className="merchant-admin-toolbar"><span className="merchant-admin-toolbar-status">{demoMode && <span className="merchant-demo-badge">模拟数据，仅本机预览</span>}{profiles.length ? `已识别 ${profiles.length} 个商家资料` : "请先由商家保存资料后再新增列表项"}</span><button type="button" className="button-secondary" onClick={() => void load()} disabled={loading || Boolean(savingId)}><RefreshCw size={16} className={loading ? "sub2-spin" : ""} />刷新</button></div>
    </Panel>

    <Panel className="merchant-admin-management-card">
      <nav className="merchant-admin-tabs" role="tablist" aria-label="商家信息管理分类">
        <button type="button" className={`merchant-admin-tab ${managementTab === "profiles" ? "active" : ""}`} role="tab" aria-selected={managementTab === "profiles"} aria-controls="merchant-admin-profiles" onClick={() => setManagementTab("profiles")}>商家资料</button>
        <button type="button" className={`merchant-admin-tab ${managementTab === "rates" ? "active" : ""}`} role="tab" aria-selected={managementTab === "rates"} aria-controls="merchant-admin-rates" onClick={() => setManagementTab("rates")}>分组倍率列表</button>
        <button type="button" className={`merchant-admin-tab ${managementTab === "accounts" ? "active" : ""}`} role="tab" aria-selected={managementTab === "accounts"} aria-controls="merchant-admin-accounts" onClick={() => setManagementTab("accounts")}>免费额度列表</button>
      </nav>
      {managementTab === "profiles" && <section id="merchant-admin-profiles" className="merchant-admin-tab-panel" role="tabpanel">
        <div className="merchant-admin-tab-heading"><div><h3>商家资料</h3><p>编辑副窗口联系弹窗中显示的商家名称、QQ、福利链接、微信二维码和等级徽章。</p></div></div>
        <div className="merchant-admin-table-wrap"><table><thead><tr><th>商家</th><th>等级</th><th>QQ</th><th>QQ / QQ 群福利链接</th><th>微信二维码</th><th>操作</th></tr></thead><tbody>{profiles.length ? profiles.map((item) => <tr key={item.userId}><td><strong>{item.merchantName}</strong><small>{item.userId}</small></td><td><MerchantTierBadge tier={item.tier} /></td><td>{item.qq || "未填写"}</td><td>{item.qqLink || "未填写"}</td><td>{item.wechatQrUrl ? "已上传" : "未上传"}</td><td><button type="button" className="button-secondary" onClick={() => setEditingProfile(item)} disabled={Boolean(savingId)}><Pencil size={14} />编辑</button></td></tr>) : <tr><td colSpan={6}>{loading ? "正在加载…" : "暂无商家资料。"}</td></tr>}</tbody></table></div>
      </section>}
      {managementTab === "rates" && <section id="merchant-admin-rates" className="merchant-admin-tab-panel" role="tabpanel">
        <div className="merchant-admin-tab-heading"><div><h3>分组倍率列表</h3><p>展示在副窗口“分组倍率”页签。</p></div><button type="button" className="button-primary" onClick={() => setEditingRate("new")} disabled={!profiles.length || Boolean(savingId)}><Plus size={16} />新增倍率</button></div>
        <div className="merchant-admin-table-wrap"><table><thead><tr><th>商家</th><th>站点 / 分组</th><th>倍率</th><th>排序</th><th>操作</th></tr></thead><tbody>{rates.length ? rates.map((item) => <tr key={item.id}><td><strong>{item.merchantName}</strong></td><td><strong>{item.stationName}</strong><small>{item.groupName} · {item.stationUrl}</small></td><td>{item.multiplierSummary}</td><td><button type="button" className="button-secondary merchant-admin-pin-button" onClick={() => void saveRate(rateInput(item, !item.pinned))} disabled={Boolean(savingId)}><Pin size={14} />{item.pinned ? "取消置顶" : "置顶"}</button></td><td><div className="merchant-admin-row-actions"><button type="button" className="button-secondary" title="编辑" aria-label={`编辑 ${item.merchantName} 的倍率`} onClick={() => setEditingRate(item)} disabled={Boolean(savingId)}><Pencil size={14} /></button><button type="button" className="button-secondary" title="删除" aria-label={`删除 ${item.merchantName} 的倍率`} onClick={() => void deleteRate(item)} disabled={Boolean(savingId)}><Trash2 size={14} /></button></div></td></tr>) : <tr><td colSpan={5}>{loading ? "正在加载…" : "暂无分组倍率信息。"}</td></tr>}</tbody></table></div>
      </section>}
      {managementTab === "accounts" && <section id="merchant-admin-accounts" className="merchant-admin-tab-panel" role="tabpanel">
        <div className="merchant-admin-tab-heading"><div><h3>免费额度列表</h3><p>管理商家提供的兑换码；用户导入时使用自己的站点登录账号完成兑换。</p></div><button type="button" className="button-primary" onClick={() => setEditingAccount("new")} disabled={!profiles.length || Boolean(savingId)}><Plus size={16} />新增兑换码</button></div>
        <div className="merchant-admin-table-wrap"><table><thead><tr><th>商家</th><th>站点</th><th>兑换码</th><th>免费额度</th><th>状态</th><th>排序</th><th>操作</th></tr></thead><tbody>{accounts.length ? accounts.map((item) => <tr key={item.id}><td><strong>{item.merchantName}</strong></td><td><strong>{item.stationName}</strong><small>{item.stationUrl}</small></td><td><span className="api-key-mask">{item.redeemCode}</span></td><td>{item.quota.toFixed(2)} 元</td><td>{item.claimed ? "已领取" : "可导入"}</td><td><button type="button" className="button-secondary merchant-admin-pin-button" onClick={() => void saveAccount(freeCodeInput(item, !item.pinned))} disabled={Boolean(savingId)}><Pin size={14} />{item.pinned ? "取消置顶" : "置顶"}</button></td><td><div className="merchant-admin-row-actions"><button type="button" className="button-secondary" title="编辑" aria-label={`编辑 ${item.merchantName} 的免费额度`} onClick={() => setEditingAccount(item)} disabled={Boolean(savingId)}><Pencil size={14} /></button><button type="button" className="button-secondary" title="删除" aria-label={`删除 ${item.merchantName} 的免费额度`} onClick={() => void deleteAccount(item)} disabled={Boolean(savingId)}><Trash2 size={14} /></button></div></td></tr>) : <tr><td colSpan={7}>{loading ? "正在加载…" : "暂无免费额度信息。"}</td></tr>}</tbody></table></div>
      </section>}
    </Panel>

    {editingRate && <RateEditor profiles={profiles} rate={editingRate === "new" ? undefined : editingRate} saving={savingId === "new-rate" || (editingRate !== "new" && savingId === editingRate.id)} onClose={() => setEditingRate(null)} onSave={saveRate} />}
    {editingAccount && <FreeAccountEditor profiles={profiles} account={editingAccount === "new" ? undefined : editingAccount} saving={savingId === "new-account" || (editingAccount !== "new" && savingId === editingAccount.id)} onClose={() => setEditingAccount(null)} onSave={saveAccount} />}
    {editingProfile && <ProfileEditor profile={editingProfile} saving={savingId === editingProfile.userId} onClose={() => setEditingProfile(null)} onSave={saveProfile} />}
  </div>;
}

function ProfileEditor({ profile, saving, onClose, onSave }: { profile: AdminMerchantProfile; saving: boolean; onClose: () => void; onSave: (input: AdminMerchantProfileInput) => Promise<void> }) {
  const [merchantName, setMerchantName] = useState(profile.merchantName);
  const [description, setDescription] = useState(profile.description ?? "");
  const [qq, setQq] = useState(profile.qq ?? "");
  const [qqLink, setQqLink] = useState(profile.qqLink ?? "");
  const [wechatQrUrl, setWechatQrUrl] = useState(profile.wechatQrUrl ?? "");
  const [tier, setTier] = useState<MerchantTier | "">(profile.tier ?? "");
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave({ userId: profile.userId, merchantName, description, qq, qqLink, wechatQrUrl, tier: tier || undefined }); };
  return <FormDialog title="编辑商家资料" description="这些资料会显示在副窗口的联系弹窗中。" ariaLabel="商家资料" onClose={onClose} onSubmit={submit} footer={<><button type="button" className="button-secondary" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="button-primary" disabled={saving || !merchantName.trim()}>{saving ? "保存中" : "保存"}</button></>}>
    <div className="merchant-admin-editor"><FormField label="商家名称" required><TextField autoFocus required value={merchantName} onChange={(event) => setMerchantName(event.target.value)} /></FormField><FormField label="商家说明 / 签名"><TextareaField rows={3} maxLength={160} value={description} onChange={(event) => setDescription(event.target.value)} /></FormField><FormField label="等级徽章"><SelectField value={tier} onChange={(event) => setTier(event.target.value as MerchantTier | "")}><option value="">无</option><option value="diamond">钻石</option><option value="gold">金牌</option><option value="silver">银牌</option></SelectField></FormField><FormField label="QQ"><TextField value={qq} onChange={(event) => setQq(event.target.value)} /></FormField><FormField label="QQ / QQ 群福利链接"><TextField type="url" placeholder="https://qm.qq.com/..." value={qqLink} onChange={(event) => setQqLink(event.target.value)} /></FormField><FormField label="微信二维码图片地址"><TextField type="url" placeholder="https://..." value={wechatQrUrl} onChange={(event) => setWechatQrUrl(event.target.value)} /></FormField></div>
  </FormDialog>;
}

function MerchantTierBadge({ tier }: { tier?: MerchantTier }) {
  if (!tier) return <span className="merchant-admin-tier-empty">无</span>;
  return <span className={`merchant-tier-badge merchant-tier-${tier}`} title={tierLabel[tier]} aria-label={tierLabel[tier]}><ShieldCheck size={13} aria-hidden="true" /></span>;
}

function RateEditor({ profiles, rate, saving, onClose, onSave }: { profiles: AdminMerchantProfile[]; rate?: AdminMerchantRateShare; saving: boolean; onClose: () => void; onSave: (input: AdminMerchantRateShareInput) => Promise<void> }) {
  const [merchantId, setMerchantId] = useState(rate?.merchantId ?? profiles[0]?.userId ?? "");
  const [stationName, setStationName] = useState(rate?.stationName ?? "");
  const [stationUrl, setStationUrl] = useState(rate?.stationUrl ?? "");
  const [groupName, setGroupName] = useState(rate?.groupName ?? "");
  const [multiplierSummary, setMultiplierSummary] = useState(rate?.multiplierSummary ?? "");
  const [pinned, setPinned] = useState(rate?.pinned ?? false);
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave({ id: rate?.id, merchantId, stationName, stationUrl, groupName, multiplierSummary, pinned }); };
  return <FormDialog title={rate ? "编辑分组倍率" : "新增分组倍率"} description="选择已认证商家后，内容会直接同步到副窗口。" ariaLabel="分组倍率信息" onClose={onClose} onSubmit={submit} footer={<><button type="button" className="button-secondary" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="button-primary" disabled={saving || !merchantId || !stationName.trim() || !stationUrl.trim() || !groupName.trim() || !multiplierSummary.trim()}>{saving ? "保存中" : "保存"}</button></>}>
    <div className="merchant-admin-editor"><FormField label="商家" required><SelectField value={merchantId} onChange={(event) => setMerchantId(event.target.value)}>{profiles.map((profile) => <option key={profile.userId} value={profile.userId}>{profile.merchantName}</option>)}</SelectField></FormField><FormField label="站点名称" required><TextField autoFocus required value={stationName} onChange={(event) => setStationName(event.target.value)} /></FormField><FormField label="站点地址" required><TextField type="url" required placeholder="https://" value={stationUrl} onChange={(event) => setStationUrl(event.target.value)} /></FormField><FormField label="分组名称" required><TextField required value={groupName} onChange={(event) => setGroupName(event.target.value)} /></FormField><FormField label="分组倍率" required><TextField required value={multiplierSummary} onChange={(event) => setMultiplierSummary(event.target.value)} placeholder="例如 0.8x" /></FormField><label className="merchant-admin-pin-toggle"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />置顶到副窗口列表首位</label></div>
  </FormDialog>;
}

function FreeAccountEditor({ profiles, account, saving, onClose, onSave }: { profiles: AdminMerchantProfile[]; account?: AdminMerchantFreeCode; saving: boolean; onClose: () => void; onSave: (input: AdminMerchantFreeCodeInput) => Promise<void> }) {
  const [merchantId, setMerchantId] = useState(account?.merchantId ?? profiles[0]?.userId ?? "");
  const [stationName, setStationName] = useState(account?.stationName ?? "");
  const [stationUrl, setStationUrl] = useState(account?.stationUrl ?? "");
  const [redeemCode, setRedeemCode] = useState(account?.redeemCode ?? "");
  const [quota, setQuota] = useState(String(account?.quota ?? ""));
  const [pinned, setPinned] = useState(account?.pinned ?? false);
  const parsedQuota = Number(quota);
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave({ id: account?.id, merchantId, stationName, stationUrl, redeemCode, quota: parsedQuota, pinned }); };
  return <FormDialog title={account ? "编辑免费额度" : "新增免费额度"} description="兑换码会在用户点击导入后由服务端单独配发，不会在公开列表中显示。" ariaLabel="免费额度信息" onClose={onClose} onSubmit={submit} footer={<><button type="button" className="button-secondary" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="button-primary" disabled={saving || !merchantId || !stationName.trim() || !stationUrl.trim() || !redeemCode.trim() || !Number.isFinite(parsedQuota) || parsedQuota < 0}>{saving ? "保存中" : "保存"}</button></>}>
    <div className="merchant-admin-editor"><FormField label="商家" required><SelectField value={merchantId} onChange={(event) => setMerchantId(event.target.value)}>{profiles.map((profile) => <option key={profile.userId} value={profile.userId}>{profile.merchantName}</option>)}</SelectField></FormField><FormField label="站点名称" required><TextField autoFocus required value={stationName} onChange={(event) => setStationName(event.target.value)} /></FormField><FormField label="站点地址" required><TextField type="url" required placeholder="https://" value={stationUrl} onChange={(event) => setStationUrl(event.target.value)} /></FormField><FormField label="兑换码" required><TextField required autoComplete="off" value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} /></FormField><FormField label="免费额度" required><TextField type="number" min="0" step="0.01" required value={quota} onChange={(event) => setQuota(event.target.value)} /></FormField><label className="merchant-admin-pin-toggle"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />置顶到副窗口列表首位</label></div>
  </FormDialog>;
}
