import { type FormEvent, useState } from "react";
import { FormDialog } from "../../../components/ui";
import { isTauri } from "../../../lib/platform";
import { remoteApi } from "../api";
import { RemoteConnectionStatus } from "../components/RemoteConnectionStatus";
import { RemoteServerFields } from "../components/RemoteServerFields";
import type { RemoteConnectionResult, RemoteServer, RemoteServerSaveResult } from "../types";

export function RemoteServerDialog({
  server,
  onClose,
  onSaved,
  setError,
}: {
  server?: RemoteServer;
  onClose: () => void;
  onSaved: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [authType, setAuthType] = useState<"password" | "key">(
    server?.authType === "key" ? "key" : "password",
  );
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState(server?.privateKeyPath ?? "");
  const [saving, setSaving] = useState(false);
  const [connectionResult, setConnectionResult] = useState<RemoteConnectionResult | null>(null);
  const [pendingHostKeyFingerprint, setPendingHostKeyFingerprint] = useState<string | null>(null);
  const [hostKeyConfirmed, setHostKeyConfirmed] = useState(false);
  const choosePrivateKey = async () => {
    try {
      const path = isTauri()
        ? await remoteApi.choosePrivateKey()
        : "C:\\Users\\me\\.ssh\\id_ed25519";
      if (path) setPrivateKeyPath(path);
    } catch (reason) {
      setError(String(reason));
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!server && pendingHostKeyFingerprint && !hostKeyConfirmed) {
      setConnectionResult({ success: false, status: "warning", reason: "请确认 SSH 主机指纹后再保存服务器", hostKeyFingerprint: pendingHostKeyFingerprint, requiresHostKeyConfirmation: true });
      return;
    }
    setSaving(true);
    setConnectionResult(null);
    const form = new FormData(event.currentTarget);
    try {
      let connection: RemoteConnectionResult;
      if (isTauri()) {
        const result = await remoteApi.save<RemoteServerSaveResult>(server?.id, {
            ...(server ? { id: server.id } : {}),
            name: form.get("name"),
            host: form.get("host"),
            port: Number(form.get("port") || 22),
            username: form.get("username"),
            authType,
            password: authType === "password" ? password : null,
            privateKeyPath: authType === "key" ? privateKeyPath : null,
            privateKeyPassphrase: null,
            relayProvider: String(form.get("relayProvider") || "").trim() || null,
            hostKeyFingerprint: !server && hostKeyConfirmed ? pendingHostKeyFingerprint : null,
          });
        connection = result.connection;
      } else {
        connection = { success: true, status: "online" };
      }
      setConnectionResult(connection);
      if (connection.requiresHostKeyConfirmation && connection.hostKeyFingerprint) {
        setPendingHostKeyFingerprint(connection.hostKeyFingerprint);
        setHostKeyConfirmed(false);
        return;
      }
      if (connection.success) {
        await onSaved();
        onClose();
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      title={server ? "管理 SSH 连接" : "添加 SSH 连接"}
      ariaLabel={server ? "管理 SSH 连接" : "添加 SSH 连接"}
      onClose={onClose}
      onSubmit={submit}
      className="remote-server-dialog"
      contentClassName="remote-server-form"
      footer={
        <>
          <button className="button-secondary form-dialog-cancel" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button-primary form-dialog-submit" disabled={saving}>
            {saving
              ? (server ? "保存并测试中" : "登录中")
              : (server ? "保存并测试连接" : "登录")}
          </button>
        </>
      }
    >
          <RemoteServerFields
            server={server}
            authType={authType}
            onAuthTypeChange={setAuthType}
            password={password}
            onPasswordChange={setPassword}
            privateKeyPath={privateKeyPath}
            onChoosePrivateKey={() => void choosePrivateKey()}
          />
          <RemoteConnectionStatus
            server={server}
            pendingHostKeyFingerprint={pendingHostKeyFingerprint}
            hostKeyConfirmed={hostKeyConfirmed}
            onHostKeyConfirmedChange={setHostKeyConfirmed}
            connectionResult={connectionResult}
          />
    </FormDialog>
  );
}
