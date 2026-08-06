import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { AlertCircle, CheckCircle2, Eye, EyeOff, ScrollText } from "lucide-react";
import { FormDialog } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { profileApi } from "../../profiles";
import { normalizeStationBaseUrl } from "../../stations/components/AddStationWithProfiles";
import { stationApi, STATIONS_CHANGED_EVENT } from "../../stations/api";
import type { StationSaveResult } from "../../stations/types";
import { registrationApi, type MailCodeResult, type MailProvider } from "../api";
import "../../../App.css";
import "./RegisterAccountPage.css";

const mailProviders: MailProvider[] = ["gmail", "outlook", "qq"];

type RegistrationState = "idle" | "running" | "waiting-code" | "success" | "error";
type LogLevel = "info" | "success" | "warning" | "error";
type RegistrationKind = "auto" | "newapi" | "sub2api";

type RegistrationLog = {
  id: number;
  time: string;
  message: string;
  level: LogLevel;
};

type PendingRegistration = {
  name: string;
  baseUrl: string;
  kind: RegistrationKind;
  email: string;
  username: string;
  password: string;
};

function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${Array.from(bytes, (byte) => (byte % 36).toString(36)).join("")}!Aa9`;
}

function generateUsername(seed = "") {
  const localPart = seed.split("@")[0]?.replace(/[^a-zA-Z0-9_-]/g, "") || "user";
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${localPart.slice(0, 24)}${suffix}`;
}

function isVerificationFailure(reason: unknown) {
  const message = errorMessage(reason, "").toLowerCase();
  return message.includes("验证码")
    || message.includes("verification code")
    || message.includes("verify_code")
    || (message.includes("verification") && (message.includes("invalid") || message.includes("expired") || message.includes("required")));
}

function providerLabel(provider: MailProvider) {
  return provider === "gmail" ? "Gmail" : provider === "outlook" ? "Outlook" : "QQ 邮箱";
}

async function findConnectedMailbox() {
  if (!isTauri()) throw new Error("自动注册窗口只能在桌面应用中使用");
  const statuses = await Promise.all(
    mailProviders.map(async (provider) => {
      const status = await registrationApi.mailStatus(provider).catch(() => null);
      return { provider, status };
    }),
  );
  const connected = statuses.find(({ status }) => status?.connected && status.email);
  if (!connected) throw new Error("未找到已连接邮箱，请先到“设置 → 常用登录”配置 Gmail、Outlook 或 QQ 邮箱");
  return { provider: connected.provider, email: connected.status!.email! };
}

export function RegisterAccountPage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<RegistrationState>("idle");
  const [resultMessage, setResultMessage] = useState("");
  const [logs, setLogs] = useState<RegistrationLog[]>([]);
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const verificationInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (state === "waiting-code") verificationInputRef.current?.focus();
  }, [state]);

  useEffect(() => {
    const logEnd = logEndRef.current;
    if (logEnd && typeof logEnd.scrollIntoView === "function") logEnd.scrollIntoView({ block: "nearest" });
  }, [logs.length]);

  const close = () => {
    if (isTauri()) void getCurrentWindow().close();
  };

  const appendLog = (message: string, level: LogLevel = "info") => {
    setLogs((current) => [
      ...current,
      {
        id: current.length,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        message,
        level,
      },
    ]);
  };

  const completeRegistration = async (draft: PendingRegistration, code: string) => {
    appendLog("正在提交注册请求…");
    try {
      const result = await stationApi.registerAccount<StationSaveResult>({
        name: draft.name,
        baseUrl: draft.baseUrl,
        kind: draft.kind,
        email: draft.email,
        username: draft.username,
        password: draft.password,
        verificationCode: code,
      });
      await emit(STATIONS_CHANGED_EVENT).catch(() => undefined);
      appendLog("站点账号注册成功", "success");
      appendLog("正在保存站点凭据和常用登录…");
      const profileUsername = result.station.kind === "newapi" ? draft.username : draft.email;
      await profileApi.save({ name: `${result.station.name} 登录`, username: profileUsername, email: draft.email, password: draft.password });
      appendLog("已导入站点账号和常用登录", "success");
      setPending(null);
      setState("success");
      setResultMessage(`注册并导入成功：${result.station.name}`);
      return true;
    } catch (reason) {
      if (isVerificationFailure(reason)) {
        const message = errorMessage(reason, "验证码校验失败");
        appendLog(`验证码校验失败：${message}`, "warning");
        setPending(draft);
        setState("waiting-code");
        setResultMessage("自动识别的验证码无效，请修改验证码后点击“继续注册”");
        return false;
      }
      throw reason;
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const normalized = normalizeStationBaseUrl(baseUrl);
    if (!normalized) {
      setState("error");
      setResultMessage("请输入中转站网址");
      setLogs([{ id: 0, time: new Date().toLocaleTimeString(), message: "请输入中转站网址", level: "error" }]);
      return;
    }

    const continuingWithManualCode = state === "waiting-code" && pending !== null;
    if (continuingWithManualCode) {
      const code = verificationCode.trim();
      if (!code) {
        appendLog("请先在验证码输入框中填写验证码", "error");
        setResultMessage("请先填写验证码");
        verificationInputRef.current?.focus();
        return;
      }
      const draft: PendingRegistration = {
        ...pending,
        baseUrl: normalized,
        email: email.trim() || pending.email,
        username: username.trim() || pending.username,
        password: password.trim() || pending.password,
      };
      setEmail(draft.email);
      setUsername(draft.username);
      setPassword(draft.password);
      setPending(draft);
      setSubmitting(true);
      setState("running");
      setResultMessage("");
      appendLog("正在使用手工填写的验证码继续注册…");
      try {
        await completeRegistration(draft, code);
      } catch (reason) {
        const message = errorMessage(reason, "自动注册失败，请检查输入内容");
        appendLog(`注册失败：${message}`, "error");
        setState("error");
        setResultMessage(message);
        setPending(null);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    setState("running");
    setResultMessage("");
    setPending(null);
    setLogs([]);
    appendLog("开始自动注册");

    try {
      appendLog("正在读取站点配置…");
      const probe = await stationApi.probe<{ name: string; kind?: string; requiresEmailVerification?: boolean }>(normalized);
      const requiresEmailVerification = probe.requiresEmailVerification !== false;
      const kind: RegistrationKind = probe.kind === "newapi" || probe.kind === "sub2api" ? probe.kind : "auto";
      const kindLabel = kind === "newapi" ? "NewAPI" : kind === "sub2api" ? "Sub2API" : "自动识别";
      appendLog(`站点识别完成：${kindLabel}`, "success");

      const manualCode = verificationCode.trim();
      let mailbox: { provider: MailProvider; email: string } | null = null;
      if (requiresEmailVerification && (!manualCode || !email.trim())) {
        appendLog("正在读取已连接邮箱…");
        mailbox = await findConnectedMailbox();
        appendLog(`已连接 ${providerLabel(mailbox.provider)}，邮箱已准备就绪`, "success");
        if (!email.trim()) {
          setEmail(mailbox.email);
          appendLog("已自动填充邮箱输入框");
        }
      } else if (email.trim()) {
        appendLog("使用邮箱输入框中的地址");
      }

      const resolvedEmail = email.trim() || mailbox?.email || "";
      if (requiresEmailVerification && (!resolvedEmail || !resolvedEmail.includes("@"))) {
        throw new Error("请输入有效注册邮箱");
      }
      const resolvedUsername = username.trim() || generateUsername(resolvedEmail || normalized);
      const resolvedPassword = password.trim() || generatePassword();
      setUsername(resolvedUsername);
      setPassword(resolvedPassword);
      appendLog(username.trim() ? "使用用户名输入框中的值" : "已自动生成并填充用户名输入框");
      appendLog(password.trim() ? "使用密码输入框中的值" : "已自动生成并填充密码输入框");

      const draft: PendingRegistration = {
        name: probe.name,
        baseUrl: normalized,
        kind,
        email: resolvedEmail,
        username: resolvedUsername,
        password: resolvedPassword,
      };
      setPending(draft);

      let code = manualCode;
      if (requiresEmailVerification && !code) {
        if (!mailbox) throw new Error("未找到已连接邮箱，请先配置邮箱或手工填写验证码");
        const startedAt = Math.floor(Date.now() / 1000);
        appendLog("正在发送验证码…");
        await stationApi.sendVerificationCode(normalized, resolvedEmail);
        appendLog("验证码已发送，正在从收件箱读取…", "success");
        try {
          const mailResult: MailCodeResult = await registrationApi.pollCode(mailbox.provider, mailbox.email, normalized, startedAt);
          code = mailResult.code;
          appendLog("已收到验证码邮件", "success");
          if (mailResult.subject) appendLog(`邮件主题：${mailResult.subject}`);
          if (mailResult.from) appendLog(`发件人：${mailResult.from}`);
          if (mailResult.receivedAt) appendLog(`收到时间：${mailResult.receivedAt}`);
          appendLog(mailResult.content ? `邮件内容：${mailResult.content}` : "邮件内容：未提取到正文", mailResult.content ? "info" : "warning");
          setVerificationCode(code);
          appendLog("已自动识别并填充验证码输入框", "success");
        } catch (reason) {
          const message = errorMessage(reason, "未能自动识别验证码");
          appendLog(`自动识别验证码失败：${message}`, "warning");
          setState("waiting-code");
          setResultMessage("请手工填写验证码后点击“继续注册”");
          return;
        }
      } else if (code) {
        appendLog("使用验证码输入框中的手工值");
      } else {
        appendLog("站点未要求邮箱验证码，跳过收件箱步骤");
      }

      await completeRegistration(draft, code);
    } catch (reason) {
      const message = errorMessage(reason, "自动注册失败，请检查站点地址和邮箱配置");
      appendLog(`注册流程失败：${message}`, "error");
      setState("error");
      setResultMessage(message);
      setPending(null);
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel = submitting ? "注册中…" : state === "waiting-code" ? "继续注册" : state === "error" ? "重新注册" : "注册";

  return <main className="register-account-page">
    <FormDialog
      title="自动注册站点账号"
      ariaLabel="自动注册站点账号"
      onClose={close}
      onSubmit={submit}
      noValidate
      hideHeader
      className="register-account-dialog"
      contentClassName="register-account-content"
      footer={
        <>
          <button type="button" className="button-secondary form-dialog-cancel" onClick={close} disabled={submitting}>取消</button>
          <button type="submit" className="button-primary form-dialog-submit" disabled={submitting || !baseUrl.trim()}>{submitLabel}</button>
        </>
      }
    >
      <div className="register-fields">
        <label>
          中转站网址
          <input className="input mt-1" required type="text" inputMode="url" autoComplete="url" placeholder="https://relay.example.com" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={submitting || state === "waiting-code"} />
        </label>
        <label>
          用户名
          <input className="input mt-1" type="text" autoComplete="username" placeholder="自动生成或手工填写" value={username} onChange={(event) => setUsername(event.target.value)} disabled={submitting} />
        </label>
        <label>
          邮箱
          <input className="input mt-1" type="email" autoComplete="email" placeholder="自动填充已连接邮箱" value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} />
        </label>
        <label>
          密码
          <div className="password-input-actions mt-1">
            <input className="input" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="自动生成或手工填写" value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} />
            <button type="button" className="password-visibility-toggle" title={showPassword ? "隐藏密码" : "显示密码"} aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} disabled={submitting}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        <label>
          邮箱验证码
          <input ref={verificationInputRef} className="input mt-1" type="text" inputMode="text" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} placeholder="自动识别或手工填写" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} disabled={submitting} aria-invalid={state === "waiting-code" || undefined} />
        </label>
      </div>

      {state === "waiting-code" && <p className="register-manual-hint" role="status"><AlertCircle size={15} />自动验证码不可用，请核对邮箱中的验证码后继续。</p>}

      <section className="register-log-panel" aria-label="注册日志">
        <header className="register-log-heading"><span><ScrollText size={15} />注册日志</span><small>{logs.length} 条</small></header>
        <ol className="register-log" role="log" aria-live="polite">
          {logs.map((entry, index) => <li key={entry.id} ref={index === logs.length - 1 ? logEndRef : undefined} className={`register-log-entry ${entry.level}`}>
            <span className="register-log-index">{String(index + 1).padStart(2, "0")}</span>
            <time>{entry.time}</time>
            {entry.level === "success" ? <CheckCircle2 size={14} aria-hidden="true" /> : entry.level === "warning" || entry.level === "error" ? <AlertCircle size={14} aria-hidden="true" /> : <i aria-hidden="true" />}
            <span>{entry.message}</span>
          </li>)}
        </ol>
      </section>

      {resultMessage && <div className={`register-result ${state}`} role={state === "error" ? "alert" : "status"}>{resultMessage}</div>}
    </FormDialog>
  </main>;
}
