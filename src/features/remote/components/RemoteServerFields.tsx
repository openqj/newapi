import { FolderOpen } from "lucide-react";
import type { RemoteServer } from "../types";

type RemoteServerFieldsProps = {
  server?: RemoteServer;
  authType: "password" | "key";
  onAuthTypeChange: (authType: "password" | "key") => void;
  password: string;
  onPasswordChange: (password: string) => void;
  privateKeyPath: string;
  onChoosePrivateKey: () => void;
};

export function RemoteServerFields({
  server,
  authType,
  onAuthTypeChange,
  password,
  onPasswordChange,
  privateKeyPath,
  onChoosePrivateKey,
}: RemoteServerFieldsProps) {
  return (
    <>
      <label className="remote-name-field">
        显示名称
        <input className="input mt-1" name="name" defaultValue={server?.name} placeholder="可选" />
      </label>
      <label className="remote-host-field">
        主机名
        <input
          className="input mt-1"
          name="host"
          required
          defaultValue={server?.host}
          placeholder="host.com 或 user@host.com"
          onInvalid={(event) => event.currentTarget.setCustomValidity("请添加服务器 IP")}
          onInput={(event) => event.currentTarget.setCustomValidity("")}
        />
      </label>
      <label className="remote-port-field">
        SSH 端口 <span className="remote-optional-label">(可选)</span>
        <input className="input mt-1" name="port" type="number" min="1" max="65535" required defaultValue={server?.port ?? 22} />
      </label>
      <label className="remote-username-field">
        用户名
        <input
          className="input mt-1"
          name="username"
          required
          defaultValue={server?.username}
          autoComplete="username"
          onInvalid={(event) => event.currentTarget.setCustomValidity("请添加用户名")}
          onInput={(event) => event.currentTarget.setCustomValidity("")}
        />
      </label>
      <input type="hidden" name="relayProvider" value={server?.relayProvider ?? ""} />
      <div className="remote-auth-tabs" role="tablist" aria-label="认证方式">
        <button className={`test-mode-button ${authType === "password" ? "active" : ""}`} type="button" role="tab" aria-selected={authType === "password"} onClick={() => onAuthTypeChange("password")}>密码</button>
        <button className={`test-mode-button ${authType === "key" ? "active" : ""}`} type="button" role="tab" aria-selected={authType === "key"} onClick={() => onAuthTypeChange("key")}>身份文件</button>
      </div>
      {authType === "password" ? (
        <label className="remote-credential-field">
          密码
          <input
            className="input mt-1"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            required={!server || server.authType !== authType}
            type="password"
            autoComplete="current-password"
            placeholder={server ? "留空保留已保存密码；需更新时重新输入" : "输入密码"}
            onInvalid={(event) => event.currentTarget.setCustomValidity("请添加密码")}
            onInput={(event) => event.currentTarget.setCustomValidity("")}
          />
        </label>
      ) : (
        <label className="remote-credential-field">
          SSH密钥
          <div className="secret-input-wrap mt-1">
            <input
              className="input private-key-input"
              value={privateKeyPath}
              required
              readOnly
              onClick={onChoosePrivateKey}
              autoComplete="off"
              placeholder="选择密钥文件"
              onInvalid={(event) => event.currentTarget.setCustomValidity("请添加 SSH 密钥")}
              onInput={(event) => event.currentTarget.setCustomValidity("")}
            />
            <button className="secret-file-button" type="button" title="选择电脑文件" onClick={onChoosePrivateKey}>
              <FolderOpen size={17} />
            </button>
          </div>
        </label>
      )}
    </>
  );
}
