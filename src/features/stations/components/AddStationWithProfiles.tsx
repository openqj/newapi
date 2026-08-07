import { type FormEvent, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, Eye, EyeOff, Settings } from "lucide-react";
import { Button, FormDialog, IconButton, SelectField, TextField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { profileApi } from "../../profiles";
import type { LoginProfile } from "../../profiles";
import type { MerchantFreeRegistrationOffer, MerchantRateRegistrationRequest } from "../../merchant";
import { stationApi } from "../api";
import type { MerchantFreeRegistrationResult, StationAccountCredentials, StationAccountDraft, StationAccountPrefill, StationConnectionResult, StationSaveResult } from "../types";
import "./AddStationWithProfiles.css";

export function normalizeStationBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.host ? `${url.origin}/` : candidate;
  } catch {
    return candidate;
  }
}

const openRechargeUrl = (url: string) => isTauri() ? openUrl(url) : Promise.resolve(window.open(url, "_blank", "noopener"));

export function AddStationWithProfiles({
  onClose,
  onManageProfiles,
  onAdded,
  demoProfiles,
  initial,
  merchantFreeOffer,
  merchantRateOffer,
  onExistingAccountLogin,
  prefill,
}: {
  onClose: () => void;
  onManageProfiles: () => void;
  onAdded: (keepOpen: boolean, result?: StationSaveResult) => Promise<void>;
  demoProfiles: LoginProfile[];
  initial?: StationAccountDraft;
  merchantFreeOffer?: MerchantFreeRegistrationOffer;
  merchantRateOffer?: MerchantRateRegistrationRequest;
  onExistingAccountLogin?: () => void;
  prefill?: StationAccountPrefill;
}) {
  const { notify } = useToast();
  const merchantOffer = merchantFreeOffer ?? merchantRateOffer;
  const merchantRegistration = Boolean(merchantOffer);
  const [submitting, setSubmitting] = useState(false);
  const [profiles, setProfiles] = useState<LoginProfile[]>([]);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const accountProfileRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(initial?.name ?? merchantOffer?.stationName ?? prefill?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(() => normalizeStationBaseUrl(initial?.baseUrl ?? merchantOffer?.stationUrl ?? prefill?.baseUrl ?? ""));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loadingCredentials, setLoadingCredentials] = useState(Boolean(initial && !merchantRegistration));
  const [credentialError, setCredentialError] = useState("");
  const [kind, setKind] = useState(initial?.kind ?? prefill?.kind ?? "auto");
  const [totp, setTotp] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [sendingVerification, setSendingVerification] = useState(false);
  const [verificationCooldown, setVerificationCooldown] = useState(0);
  const [redemptionResult, setRedemptionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [connectionResult, setConnectionResult] =
    useState<StationConnectionResult | null>(null);
  const loadProfiles = async () => {
    if (!isTauri()) {
      setProfiles(demoProfiles);
      return;
    }
    try {
      setProfiles(await profileApi.list<LoginProfile[]>());
    } catch (reason) { notify(errorMessage(reason, "加载登录配置失败，请稍后重试。"), "error"); }
  };
  useEffect(() => {
    void loadProfiles();
  }, []);
  useEffect(() => {
    if (!initial || merchantRegistration) {
      setLoadingCredentials(false);
      return;
    }
    let cancelled = false;
    setLoadingCredentials(true);
    setCredentialError("");
    const loadCredentials = async () => {
      if (!isTauri()) {
        setUsername(initial.username ?? "");
        setPassword("demo-password");
        setLoadingCredentials(false);
        return;
      }
      try {
        const credentials = await stationApi.credentials<StationAccountCredentials>(initial.id);
        if (cancelled) return;
        setUsername(credentials.username);
        setPassword(credentials.password);
      } catch (reason) {
        if (!cancelled) setCredentialError(errorMessage(reason, "读取已保存的账号和密码失败，请手动输入后重试。"));
      } finally {
        if (!cancelled) setLoadingCredentials(false);
      }
    };
    void loadCredentials();
    return () => {
      cancelled = true;
    };
  }, [initial, merchantRegistration]);
  useEffect(() => {
    if (!showProfileMenu) return;
    const closeProfileMenu = (event: PointerEvent) => {
      if (!accountProfileRef.current?.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    window.addEventListener("pointerdown", closeProfileMenu);
    return () => window.removeEventListener("pointerdown", closeProfileMenu);
  }, [showProfileMenu]);
  useEffect(() => {
    if (verificationCooldown <= 0) return;
    const timer = window.setTimeout(() => setVerificationCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [verificationCooldown]);
  const selectProfile = async (id: string) => {
    if (!id) return;
    try {
      const credential = isTauri()
        ? await profileApi.get<{ username: string; password: string }>(id)
        : {
            username: demoProfiles[0]?.username ?? "",
            password: "demo-password",
          };
      setUsername(credential.username);
      setPassword(credential.password);
      setShowProfileMenu(false);
    } catch (reason) { notify(errorMessage(reason, "读取登录配置失败，请稍后重试。"), "error"); }
  };
  const probe = async () => {
    const normalizedBaseUrl = normalizeStationBaseUrl(baseUrl);
    if (!normalizedBaseUrl) return;
    if (normalizedBaseUrl !== baseUrl) setBaseUrl(normalizedBaseUrl);
    if (!isTauri()) {
      try {
        const hostname = new URL(normalizedBaseUrl).hostname.replace(/^www\./i, "");
        const nameFromHostname = hostname.split(".")[0] || hostname;
        setName(
          nameFromHostname
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, (character) => character.toUpperCase()),
        );
      } catch {
        // Native URL validation will provide feedback when the form is submitted.
      }
      return;
    }
    try {
      const result = await stationApi.probe<{ name: string; kind?: string }>(normalizedBaseUrl);
      setName(result.name);
      if (result.kind) setKind(result.kind);
      setFieldErrors((current) => ({ ...current, baseUrl: "" }));
    } catch (reason) {
      setFieldErrors((current) => ({ ...current, baseUrl: errorMessage(reason, "无法识别该站点，请检查地址。") }));
    }
  };
  const sendVerificationCode = async () => {
    const normalizedBaseUrl = normalizeStationBaseUrl(baseUrl);
    if (!normalizedBaseUrl) {
      setFieldErrors((current) => ({ ...current, baseUrl: "请输入站点地址" }));
      return;
    }
    if (!username.trim() || !username.includes("@")) {
      setFieldErrors((current) => ({ ...current, username: "请输入有效注册邮箱" }));
      return;
    }
    setSendingVerification(true);
    try {
      const message = await stationApi.sendVerificationCode(normalizedBaseUrl, username.trim());
      setVerificationCooldown(60);
      notify(message, "success");
    } catch (reason) {
      notify(errorMessage(reason, "邮箱验证码发送失败，请稍后重试。"), "error");
    } finally {
      setSendingVerification(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loadingCredentials) return;
    const keepOpen = !merchantRegistration &&
      ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)
        ?.value === "continue";
    const normalizedBaseUrl = normalizeStationBaseUrl(baseUrl);
    const nextErrors = {
      baseUrl: normalizedBaseUrl ? "" : "请输入站点地址",
      username: initial || username.trim() ? "" : merchantRegistration ? "请输入注册邮箱或账号" : "请输入登录账号",
      password: initial || password ? "" : merchantRegistration ? "请输入注册密码" : "请输入登录密码",
      verificationCode: !merchantRegistration || verificationCode.trim() ? "" : "请输入邮箱验证码",
    };
    setFieldErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;
    if (normalizedBaseUrl !== baseUrl) setBaseUrl(normalizedBaseUrl);
    setSubmitting(true);
    setConnectionResult(null);
    setRedemptionResult(null);
    try {
      const request = {
        name,
        baseUrl: normalizedBaseUrl,
        username: initial ? username.trim() || null : username,
        password: initial ? password || null : password,
        kind,
        totp: totp || null,
      };
      const registrationRequest = {
        name,
        baseUrl: normalizedBaseUrl,
        email: username.trim(),
        username: null,
        password,
        verificationCode: verificationCode.trim(),
        kind,
      };
      const result = merchantFreeOffer
        ? await stationApi.registerAndRedeemMerchantFreeOffer<MerchantFreeRegistrationResult>({ offerId: merchantFreeOffer.offerId, ...registrationRequest })
        : merchantRateOffer
        ? await stationApi.registerAccount<StationSaveResult>(registrationRequest)
        : initial
        ? await stationApi.update<StationSaveResult>({ ...request, id: initial.id })
        : await stationApi.add<StationSaveResult>(request);
      setConnectionResult(result.connection);
      if (result.connection.success) {
        if (merchantFreeOffer) {
          const merchantResult = result as MerchantFreeRegistrationResult;
          setRedemptionResult({ success: merchantResult.redemptionSuccess, message: merchantResult.redemptionMessage });
          notify(merchantResult.redemptionMessage, merchantResult.redemptionSuccess ? "success" : "error");
          await onAdded(true, result);
        } else if (merchantRateOffer) {
          const [handoff, browser] = await Promise.allSettled([
            onAdded(false, result),
            openRechargeUrl(merchantRateOffer.rechargeUrl),
          ]);
          if (handoff.status === "rejected") throw handoff.reason;
          if (browser.status === "rejected") notify("站点账号已保存，但未能打开卡密充值地址。", "error");
        } else {
          await onAdded(keepOpen, result);
        }
      }
    } catch (reason) {
      const message = errorMessage(reason, merchantRegistration ? "注册或兑换失败，请稍后重试。" : "添加站点失败，请检查登录信息后重试。");
      if (merchantFreeOffer) setRedemptionResult({ success: false, message });
      else notify(message, "error");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <FormDialog
      title={merchantFreeOffer ? "领取免费额度" : merchantRateOffer ? "注册商家站点账号" : initial ? "编辑站点账号" : "添加中转站"}
      description={merchantRegistration ? "使用常用登录邮箱/账号和密码完成站点注册。" : undefined}
      ariaLabel={merchantFreeOffer ? "领取免费额度" : merchantRateOffer ? "注册商家站点账号" : initial ? "编辑站点账号" : "添加中转站"}
      onClose={onClose}
      onSubmit={submit}
      noValidate
      contentClassName="space-y-4"
      footer={
        <>
          {!merchantRegistration && <Button variant="secondary" type="submit" className="form-dialog-submit add-station-continue" name="submitAction" value="continue" disabled={submitting || loadingCredentials}>
            {submitting ? "正在连接" : loadingCredentials ? "正在读取" : initial ? "保存并继续" : "添加并继续"}
          </Button>}
          {merchantRateOffer && onExistingAccountLogin && <Button variant="secondary" className="form-dialog-submit" onClick={onExistingAccountLogin} disabled={submitting}>已有账号登录</Button>}
          <Button variant="secondary" className="form-dialog-cancel" onClick={onClose}>
            {redemptionResult?.success ? "关闭" : "取消"}
          </Button>
          <Button variant="primary" type="submit" className="form-dialog-submit" name="submitAction" value="save" disabled={submitting || loadingCredentials || Boolean(redemptionResult)}>
            {redemptionResult ? (redemptionResult.success ? "已领取" : "请重新领取") : submitting ? (merchantRegistration ? "正在处理中" : "正在连接") : loadingCredentials ? "正在读取" : merchantFreeOffer ? "领取" : merchantRateOffer ? "注册并充值" : "保存"}
          </Button>
        </>
      }
    >
            <label>
              站点名称
              <TextField
                className="mt-1"
                value={name}
                readOnly={merchantRegistration}
                onChange={(event) => setName(event.target.value)}
                placeholder="地址失焦后自动填充站点名称"
              />
            </label>
            <label>
              站点地址
              <TextField
                className="mt-1"
                value={baseUrl}
                inputMode="url"
                readOnly={merchantRegistration}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setFieldErrors((current) => ({ ...current, baseUrl: "" }));
                }}
                onBlur={() => void probe()}
                aria-invalid={Boolean(fieldErrors.baseUrl)}
                placeholder="请输入站点地址，例如 https://api.example.com"
              />
              {fieldErrors.baseUrl && <p className="field-error">{fieldErrors.baseUrl}</p>}
            </label>
            <label>
              {merchantRegistration ? "邮箱/账号" : "账号"}
              <div className="account-input-actions mt-1" ref={accountProfileRef}>
                <TextField
                  value={username}
                  disabled={loadingCredentials}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setFieldErrors((current) => ({ ...current, username: "" }));
                  }}
                  aria-invalid={Boolean(fieldErrors.username)}
                  autoComplete="username"
                  placeholder={merchantRegistration ? "请输入注册邮箱或选择常用登录" : initial ? "留空则保留已保存的账号" : "请输入站点登录账号"}
                />
                <IconButton
                  variant="ghost"
                  className="account-profile-trigger"
                  disabled={loadingCredentials}
                  aria-expanded={showProfileMenu}
                  label="选择常用登录"
                  onClick={() => setShowProfileMenu((visible) => !visible)}
                  icon={<ChevronDown size={16} />}
                />
                {showProfileMenu && (
                  <div className="account-profile-menu" role="menu">
                    {profiles.length === 0 ? (
                      <Button
                        variant="ghost"
                        role="menuitem"
                        onClick={() => {
                          setShowProfileMenu(false);
                          onManageProfiles();
                        }}
                      >
                        添加常用登录
                      </Button>
                    ) : (
                      profiles.map((profile) => (
                        <Button
                          variant="ghost"
                          role="menuitem"
                          key={profile.id}
                          onClick={() => void selectProfile(profile.id)}
                        >
                          <span>{profile.name}</span>
                          <small>{profile.username}</small>
                        </Button>
                      ))
                    )}
                  </div>
                )}
                <SelectField
                  className="account-profile-picker"
                  aria-label="选择常用登录"
                  defaultValue=""
                  title="选择常用登录"
                  disabled={loadingCredentials}
                  onChange={(event) => void selectProfile(event.target.value)}
                >
                  <option value="">手动输入</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {profile.username}
                    </option>
                  ))}
                </SelectField>
                <ChevronDown className="account-profile-chevron" size={16} />
                <IconButton
                  label="管理常用登录"
                  className="account-profile-manage"
                  title="管理常用登录"
                  aria-label="管理常用登录"
                  disabled={loadingCredentials}
                  onClick={onManageProfiles}
                  icon={<Settings size={15} />}
                />
              </div>
              {fieldErrors.username && <p className="field-error">{fieldErrors.username}</p>}
            </label>
            <label>
              密码
              <div className="password-input-actions mt-1">
                <TextField
                  value={password}
                  disabled={loadingCredentials}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setCredentialError("");
                    setFieldErrors((current) => ({ ...current, password: "" }));
                  }}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={credentialError ? "station-credential-error" : undefined}
                  type={showPassword ? "text" : "password"}
                  autoComplete={merchantRegistration ? "new-password" : "current-password"}
                  placeholder={merchantRegistration ? "请设置站点注册密码" : initial ? "留空则保留已保存的密码" : "请输入站点登录密码"}
                />
                <IconButton
                  label={showPassword ? "隐藏密码" : "显示密码"}
                  className="password-visibility-toggle"
                  aria-pressed={showPassword}
                  title={showPassword ? "隐藏密码" : "显示密码"}
                  disabled={loadingCredentials}
                  onClick={() => setShowPassword((visible) => !visible)}
                  icon={showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                />
              </div>
              {loadingCredentials && <p className="field-message" role="status">正在读取已保存的账号和密码…</p>}
              {credentialError && <p id="station-credential-error" className="field-error" role="alert">{credentialError}</p>}
              {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
            </label>
            {merchantRegistration && <label>
              邮箱验证码
              <div className="verification-code-actions mt-1">
                <TextField
                  value={verificationCode}
                  onChange={(event) => {
                    setVerificationCode(event.target.value);
                    setFieldErrors((current) => ({ ...current, verificationCode: "" }));
                    setRedemptionResult(null);
                  }}
                  aria-invalid={Boolean(fieldErrors.verificationCode)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="请输入邮箱收到的验证码"
                />
                <Button variant="secondary" disabled={sendingVerification || verificationCooldown > 0} onClick={() => void sendVerificationCode()}>
                  {sendingVerification ? "发送中" : verificationCooldown > 0 ? `${verificationCooldown} 秒` : "获取验证码"}
                </Button>
              </div>
              {fieldErrors.verificationCode && <p className="field-error">{fieldErrors.verificationCode}</p>}
            </label>}
            {merchantFreeOffer && redemptionResult && <p className={`field-message ${redemptionResult.success ? "success" : "error"}`} role="status">{redemptionResult.message}</p>}
            {!merchantRegistration && <label>
              站点类型
              <SelectField
                className="input mt-1"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="auto">自动识别</option>
                <option value="newapi">New API</option>
                <option value="sub2api">Sub2API</option>
              </SelectField>
            </label>}
            {!merchantRegistration && <label>
              TOTP 验证码（可选）
              <TextField
                className="mt-1"
                value={totp}
                onChange={(event) => setTotp(event.target.value)}
                inputMode="numeric"
                placeholder="启用二步验证时填入"
              />
            </label>}
            {connectionResult && (
              <div className={`test-result ${connectionResult.success ? "success" : "error"}`}>
                {connectionResult.success
                  ? (merchantFreeOffer && redemptionResult?.success ? "注册、登录与兑换已完成" : "站点连接成功")
                  : `${merchantRegistration ? "注册或登录失败" : "站点验证失败"}${connectionResult.reason ? `：${connectionResult.reason}` : ""}`}
              </div>
            )}
    </FormDialog>
  );
}
