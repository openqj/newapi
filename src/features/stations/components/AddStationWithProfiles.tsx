import { type FormEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, Settings } from "lucide-react";
import { FormDialog } from "../../../components/ui";
import { isTauri } from "../../../lib/platform";
import { profileApi } from "../../profiles";
import type { LoginProfile } from "../../profiles";
import { stationApi } from "../api";
import type { StationConnectionResult, StationSaveResult } from "../types";

export function AddStationWithProfiles({
  onClose,
  onManageProfiles,
  onAdded,
  setError,
  demoProfiles,
}: {
  onClose: () => void;
  onManageProfiles: () => void;
  onAdded: (keepOpen: boolean) => Promise<void>;
  setError: (message: string) => void;
  demoProfiles: LoginProfile[];
}) {
  const [submitting, setSubmitting] = useState(false);
  const [profiles, setProfiles] = useState<LoginProfile[]>([]);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const accountProfileRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [kind, setKind] = useState("auto");
  const [totp, setTotp] = useState("");
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
    } catch (reason) {
      setError(String(reason));
    }
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
  const normalizeBaseUrl = (value: string) => {
    const trimmed = value.trim();
    return trimmed && !/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;
  };
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
    } catch (reason) {
      setError(String(reason));
    }
  };
  const probe = async () => {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
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
      setFieldErrors((current) => ({ ...current, baseUrl: String(reason) }));
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const keepOpen =
      ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)
        ?.value === "continue";
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const nextErrors = {
      baseUrl: normalizedBaseUrl ? "" : "请输入站点地址",
      username: username.trim() ? "" : "请输入登录账号",
      password: password ? "" : "请输入登录密码",
    };
    setFieldErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;
    if (normalizedBaseUrl !== baseUrl) setBaseUrl(normalizedBaseUrl);
    setSubmitting(true);
    setConnectionResult(null);
    try {
      const result = await stationApi.add<StationSaveResult>({
          name,
          baseUrl: normalizedBaseUrl,
          username,
          password,
          kind,
          totp: totp || null,
        });
      setConnectionResult(result.connection);
      if (result.connection.success) {
        await onAdded(keepOpen);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <FormDialog
      title="添加中转站"
      ariaLabel="添加中转站"
      onClose={onClose}
      onSubmit={submit}
      noValidate
      contentClassName="space-y-4"
      footer={
        <>
          <button type="button" className="button-secondary form-dialog-cancel" onClick={onClose}>
            取消
          </button>
          <button className="button-secondary form-dialog-submit" name="submitAction" value="continue" disabled={submitting}>
            {submitting ? "正在连接" : "添加并继续"}
          </button>
          <button className="button-primary form-dialog-submit" name="submitAction" value="save" disabled={submitting}>
            {submitting ? "正在连接" : "保存"}
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
              账号
              <div className="account-input-actions mt-1" ref={accountProfileRef}>
                <input
                  className="input"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setFieldErrors((current) => ({ ...current, username: "" }));
                  }}
                  aria-invalid={Boolean(fieldErrors.username)}
                  autoComplete="username"
                  placeholder="请输入站点登录账号"
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
              </div>
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
                autoComplete="current-password"
                placeholder="请输入站点登录密码"
              />
              {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
            </label>
            <label>
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
            </label>
            <label>
              TOTP 验证码（可选）
              <input
                className="input mt-1"
                value={totp}
                onChange={(event) => setTotp(event.target.value)}
                inputMode="numeric"
                placeholder="启用二步验证时填入"
              />
            </label>
            {connectionResult && (
              <div className={`test-result ${connectionResult.success ? "success" : "error"}`}>
                {connectionResult.success
                  ? "站点连接成功"
                  : `站点验证失败${connectionResult.reason ? `：${connectionResult.reason}` : ""}`}
              </div>
            )}
    </FormDialog>
  );
}
