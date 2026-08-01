import { type FormEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, Settings } from "lucide-react";
import { FormDialog, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { profileApi } from "../../profiles";
import type { LoginProfile } from "../../profiles";
import type { ClaimedMerchantCode } from "../../merchant";
import { stationApi } from "../api";
import type { StationAccountDraft, StationCodeImportResult, StationConnectionResult, StationSaveResult } from "../types";
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

export function AddStationWithProfiles({
  onClose,
  onManageProfiles,
  onAdded,
  demoProfiles,
  initial,
  merchantImport,
}: {
  onClose: () => void;
  onManageProfiles: () => void;
  onAdded: (keepOpen: boolean) => Promise<void>;
  demoProfiles: LoginProfile[];
  initial?: StationAccountDraft;
  merchantImport?: ClaimedMerchantCode;
}) {
  const { notify } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [profiles, setProfiles] = useState<LoginProfile[]>([]);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const accountProfileRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(initial?.name ?? merchantImport?.stationName ?? "");
  const [baseUrl, setBaseUrl] = useState(() => normalizeStationBaseUrl(initial?.baseUrl ?? merchantImport?.stationUrl ?? ""));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [kind, setKind] = useState(initial?.kind ?? "auto");
  const [totp, setTotp] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [sendingVerification, setSendingVerification] = useState(false);
  const [verificationCooldown, setVerificationCooldown] = useState(0);
  const [redeemCode, setRedeemCode] = useState(merchantImport?.redeemCode ?? "");
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
    const keepOpen = !merchantImport &&
      ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)
        ?.value === "continue";
    const normalizedBaseUrl = normalizeStationBaseUrl(baseUrl);
    const nextErrors = {
      baseUrl: normalizedBaseUrl ? "" : "请输入站点地址",
      username: initial || username.trim() ? "" : merchantImport ? "请输入注册邮箱" : "请输入登录账号",
      password: initial || password ? "" : merchantImport ? "请输入注册密码" : "请输入登录密码",
      verificationCode: !merchantImport || verificationCode.trim() ? "" : "请输入邮箱验证码",
      redeemCode: !merchantImport || redeemCode.trim() ? "" : "请输入兑换码",
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
      const result = merchantImport
        ? await stationApi.importWithCode<StationCodeImportResult>({ name, baseUrl: normalizedBaseUrl, email: username, password, verificationCode, redeemCode })
        : initial
        ? await stationApi.update<StationSaveResult>({ ...request, id: initial.id })
        : await stationApi.add<StationSaveResult>(request);
      setConnectionResult(result.connection);
      if (result.connection.success) {
        if (merchantImport) {
          const message = (result as StationCodeImportResult).redemptionMessage ?? "兑换成功，免费额度已到账。";
          setRedemptionResult({ success: true, message });
          notify(message, "success");
          await onAdded(true);
        } else {
          await onAdded(keepOpen);
        }
      }
    } catch (reason) {
      const message = errorMessage(reason, merchantImport ? "兑换失败，请检查账号和兑换码后重试。" : "添加站点失败，请检查登录信息后重试。");
      if (merchantImport) setRedemptionResult({ success: false, message });
      else notify(message, "error");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <FormDialog
      title={merchantImport ? "导入免费额度" : initial ? "编辑站点账号" : "添加中转站"}
      description={merchantImport ? "注册商家中转站账号并兑换免费额度，成功后自动添加到站点账号。" : undefined}
      ariaLabel={merchantImport ? "导入免费额度" : initial ? "编辑站点账号" : "添加中转站"}
      onClose={onClose}
      onSubmit={submit}
      noValidate
      contentClassName="space-y-4"
      footer={
        <>
          {!merchantImport && <button className="button-secondary form-dialog-submit add-station-continue" name="submitAction" value="continue" disabled={submitting}>
            {submitting ? "正在连接" : initial ? "保存并继续" : "添加并继续"}
          </button>}
          <button type="button" className="button-secondary form-dialog-cancel" onClick={onClose}>
            {redemptionResult?.success ? "关闭" : "取消"}
          </button>
          <button className="button-primary form-dialog-submit" name="submitAction" value="save" disabled={submitting || redemptionResult?.success}>
            {redemptionResult?.success ? "已导入" : submitting ? (merchantImport ? "正在导入" : "正在连接") : merchantImport ? "导入" : "保存"}
          </button>
        </>
      }
    >
            <label>
              站点名称
              <input
                className="input mt-1"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="地址失焦后自动填充站点名称"
              />
            </label>
            <label>
              站点地址
              <input
                className="input mt-1"
                value={baseUrl}
                inputMode="url"
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
              {merchantImport ? "注册邮箱" : "账号"}
              {merchantImport ? <input
                className="input mt-1"
                type="email"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setFieldErrors((current) => ({ ...current, username: "" }));
                }}
                aria-invalid={Boolean(fieldErrors.username)}
                autoComplete="email"
                placeholder="请输入用于注册的邮箱"
              /> : <div className="account-input-actions mt-1" ref={accountProfileRef}>
                <input
                  className="input"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setFieldErrors((current) => ({ ...current, username: "" }));
                  }}
                  aria-invalid={Boolean(fieldErrors.username)}
                  autoComplete="username"
                placeholder={initial ? "留空则保留已保存的账号" : "请输入站点登录账号"}
                />
                <button
                  type="button"
                  className="account-profile-trigger"
                  aria-expanded={showProfileMenu}
                  title="选择常用登录"
                  onClick={() => setShowProfileMenu((visible) => !visible)}
                >
                  <ChevronDown size={16} />
                </button>
                {showProfileMenu && (
                  <div className="account-profile-menu" role="menu">
                    {profiles.length === 0 ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowProfileMenu(false);
                          onManageProfiles();
                        }}
                      >
                        添加常用登录
                      </button>
                    ) : (
                      profiles.map((profile) => (
                        <button
                          type="button"
                          role="menuitem"
                          key={profile.id}
                          onClick={() => void selectProfile(profile.id)}
                        >
                          <span>{profile.name}</span>
                          <small>{profile.username}</small>
                        </button>
                      ))
                    )}
                  </div>
                )}
                <select
                  className="account-profile-picker"
                  aria-label="选择常用登录"
                  defaultValue=""
                  title="选择常用登录"
                  onChange={(event) => void selectProfile(event.target.value)}
                >
                  <option value="">手动输入</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {profile.username}
                    </option>
                  ))}
                </select>
                <ChevronDown className="account-profile-chevron" size={16} />
                <button
                  type="button"
                  className="account-profile-manage"
                  title="管理常用登录"
                  aria-label="管理常用登录"
                  onClick={onManageProfiles}
                >
                  <Settings size={15} />
                </button>
              </div>}
              {fieldErrors.username && <p className="field-error">{fieldErrors.username}</p>}
            </label>
            <label>
              密码
              <input
                className="input mt-1"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setFieldErrors((current) => ({ ...current, password: "" }));
                }}
                aria-invalid={Boolean(fieldErrors.password)}
                type="password"
                autoComplete={merchantImport ? "new-password" : "current-password"}
                placeholder={merchantImport ? "请设置站点注册密码" : initial ? "留空则保留已保存的密码" : "请输入站点登录密码"}
              />
              {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
            </label>
            {merchantImport && <label>
              邮箱验证码
              <div className="verification-code-actions mt-1">
                <input
                  className="input"
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
                <button type="button" className="button-secondary" disabled={sendingVerification || verificationCooldown > 0} onClick={() => void sendVerificationCode()}>
                  {sendingVerification ? "发送中" : verificationCooldown > 0 ? `${verificationCooldown} 秒` : "获取验证码"}
                </button>
              </div>
              {fieldErrors.verificationCode && <p className="field-error">{fieldErrors.verificationCode}</p>}
            </label>}
            {merchantImport && <label>
              兑换码
              <input
                className="input mt-1"
                value={redeemCode}
                onChange={(event) => {
                  setRedeemCode(event.target.value);
                  setFieldErrors((current) => ({ ...current, redeemCode: "" }));
                  setRedemptionResult(null);
                }}
                aria-invalid={Boolean(fieldErrors.redeemCode) || redemptionResult?.success === false}
                autoComplete="off"
                placeholder="请输入兑换码"
              />
              {fieldErrors.redeemCode && <p className="field-error">{fieldErrors.redeemCode}</p>}
              {redemptionResult && <p className={`field-message ${redemptionResult.success ? "success" : "error"}`} role="status">{redemptionResult.message}</p>}
            </label>}
            {!merchantImport && <label>
              站点类型
              <select
                className="input mt-1"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="auto">自动识别</option>
                <option value="newapi">New API</option>
                <option value="sub2api">Sub2API</option>
              </select>
            </label>}
            {!merchantImport && <label>
              TOTP 验证码（可选）
              <input
                className="input mt-1"
                value={totp}
                onChange={(event) => setTotp(event.target.value)}
                inputMode="numeric"
                placeholder="启用二步验证时填入"
              />
            </label>}
            {connectionResult && (
              <div className={`test-result ${connectionResult.success ? "success" : "error"}`}>
                {connectionResult.success
                  ? (merchantImport ? "注册、登录与兑换已完成" : "站点连接成功")
                  : `${merchantImport ? "注册或登录失败" : "站点验证失败"}${connectionResult.reason ? `：${connectionResult.reason}` : ""}`}
              </div>
            )}
    </FormDialog>
  );
}
