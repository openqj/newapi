import { type FormEvent, useEffect, useState } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { Button, FormDialog, FormField, PasswordField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { signalPersonalCenterAuthChanged } from "../../personal-center";
import { settingsApi } from "../api";

export type PasswordRecoverySession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export function parsePasswordRecoveryUrl(value: string): PasswordRecoverySession | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "relayhub:" || url.hostname !== "auth" || url.pathname !== "/reset-password") return null;
    const params = new URLSearchParams(url.hash.slice(1));
    if (params.get("type") !== "recovery") return null;
    const accessToken = params.get("access_token") ?? "";
    const refreshToken = params.get("refresh_token") ?? "";
    if (!accessToken || !refreshToken) return null;
    const expiresIn = Number(params.get("expires_in") ?? 3600);
    return { accessToken, refreshToken, expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600 };
  } catch {
    return null;
  }
}

export function PasswordResetDialog() {
  const { notify } = useToast();
  const [session, setSession] = useState<PasswordRecoverySession | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    const accept = (urls: string[]) => {
      const recovery = urls.map(parsePasswordRecoveryUrl).find((value) => value !== null);
      if (active && recovery) setSession(recovery);
    };
    void getCurrent().then((urls) => urls && accept(urls)).catch(() => undefined);
    void onOpenUrl(accept).then((next) => {
      if (active) unlisten = next;
      else next();
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  if (!session) return null;

  const close = () => {
    setSession(null);
    setPassword("");
    setConfirmation("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      notify("两次输入的新密码不一致。", "error");
      return;
    }
    setBusy(true);
    try {
      const status = await settingsApi.cloudCompletePasswordReset(
        session.accessToken,
        session.refreshToken,
        session.expiresIn,
        password,
      );
      signalPersonalCenterAuthChanged(status);
      close();
      notify("密码已更新，云端账户已登录。", "success");
    } catch (reason) {
      notify(errorMessage(reason), "error");
    } finally {
      setBusy(false);
    }
  };

  return <FormDialog
    title="设置新密码"
    description="为云端账户设置一个新的登录密码。"
    ariaLabel="设置新密码"
    onClose={close}
    onSubmit={submit}
    footer={<>
      <Button type="button" variant="secondary" onClick={close} disabled={busy}>取消</Button>
      <Button type="submit" variant="primary" disabled={busy}>更新密码</Button>
    </>}
  >
    <FormField label="新密码" hint="至少 8 个字符">
      <PasswordField autoFocus required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
    </FormField>
    <FormField label="确认新密码">
      <PasswordField required minLength={8} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
    </FormField>
  </FormDialog>;
}
