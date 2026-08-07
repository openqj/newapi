import { type FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button, FormDialog, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import { remoteApi } from "../api";
import { RemoteConnectionStatus } from "../components/RemoteConnectionStatus";
import { RemoteServerFields } from "../components/RemoteServerFields";
import type { GenerateSshKeyResult, RemoteConnectionResult, RemoteServer, RemoteServerSaveResult } from "../types";

export function RemoteServerDialog({
  server,
  onClose,
  onSaved,
}: {
  server?: RemoteServer;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { notify } = useToast();
  const [authType, setAuthType] = useState<"password" | "key">(
    server?.authType === "key" ? "key" : "password",
  );
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState(server?.privateKeyPath ?? "");
  const [saving, setSaving] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
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
      notify(errorMessage(reason), "error");
    }
  };
  const generateKey = async (form: HTMLFormElement | null) => {
    if (!form) return;
    const values = new FormData(form);
    const host = String(values.get("host") ?? "").trim();
    const username = String(values.get("username") ?? "").trim();
    if (!host || !username || !password) {
      notify("请先填写服务器主机、用户名和密码。", "error");
      return;
    }
    setGeneratingKey(true);
    setConnectionResult(null);
    try {
      const trustedHostKeyFingerprint = server?.hostKeyFingerprint
        ?? (hostKeyConfirmed ? pendingHostKeyFingerprint : null);
      const result = isTauri()
        ? await remoteApi.generateSshKey<GenerateSshKeyResult>({
            host,
            port: Number(values.get("port") || 22),
            username,
            password,
            hostKeyFingerprint: trustedHostKeyFingerprint,
          })
        : {
            privateKeyPath: `C:\\Users\\me\\.ssh\\relayhub_${host}_ed25519`,
            connection: { success: true, status: "online" } as RemoteConnectionResult,
          };
      setConnectionResult(result.connection);
      if (result.connection.requiresHostKeyConfirmation && result.connection.hostKeyFingerprint) {
        setPendingHostKeyFingerprint(result.connection.hostKeyFingerprint);
        setHostKeyConfirmed(false);
        return;
      }
      if (result.connection.success && result.privateKeyPath) {
        setPrivateKeyPath(result.privateKeyPath);
        setAuthType("key");
        setPassword("");
        if (result.connection.hostKeyFingerprint) setHostKeyConfirmed(true);
        notify(`SSH 密钥已生成并安装，私钥已保存到 ${result.privateKeyPath}`, "success");
      }
    } catch (reason) {
      notify(errorMessage(reason), "error");
    } finally {
      setGeneratingKey(false);
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
      notify(errorMessage(reason), "error");
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
          {authType === "password" && (
            <Button
              variant="secondary"
              className="ssh-generate-key-button"
              disabled={generatingKey || !password}
              onClick={(event) => void generateKey(event.currentTarget.form)}
            >
              <KeyRound size={16} />
              {generatingKey ? "生成中..." : "生成 SSH 密钥"}
            </Button>
          )}
          <Button variant="secondary" className="form-dialog-cancel" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" className="form-dialog-submit" type="submit" disabled={saving}>
            {saving
              ? (server ? "保存并测试中" : "登录中")
              : (server ? "保存并测试连接" : "登录")}
          </Button>
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
