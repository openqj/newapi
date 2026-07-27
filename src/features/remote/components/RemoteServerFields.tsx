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
        \u663e\u793a\u540d\u79f0
        <input className="input mt-1" name="name" defaultValue={server?.name} placeholder="\u53ef\u9009" />
      </label>
      <label className="remote-host-field">
        \u4e3b\u673a\u540d
        <input
          className="input mt-1"
          name="host"
          required
          defaultValue={server?.host}
          placeholder="host.com \u6216 user@host.com"
          onInvalid={(event) => event.currentTarget.setCustomValidity("\u8bf7\u6dfb\u52a0\u670d\u52a1\u5668 IP")}
          onInput={(event) => event.currentTarget.setCustomValidity("")}
        />
      </label>
      <label className="remote-port-field">
        SSH \u7aef\u53e3 <span className="remote-optional-label">(\u53ef\u9009)</span>
        <input className="input mt-1" name="port" type="number" min="1" max="65535" required defaultValue={server?.port ?? 22} />
      </label>
      <label className="remote-username-field">
        \u7528\u6237\u540d
        <input
          className="input mt-1"
          name="username"
          required
          defaultValue={server?.username}
          autoComplete="username"
          onInvalid={(event) => event.currentTarget.setCustomValidity("\u8bf7\u6dfb\u52a0\u7528\u6237\u540d")}
          onInput={(event) => event.currentTarget.setCustomValidity("")}
        />
      </label>
      <input type="hidden" name="relayProvider" value={server?.relayProvider ?? ""} />
      <div className="remote-auth-tabs" role="tablist" aria-label="\u8ba4\u8bc1\u65b9\u5f0f">
        <button className={`test-mode-button ${authType === "password" ? "active" : ""}`} type="button" role="tab" aria-selected={authType === "password"} onClick={() => onAuthTypeChange("password")}>\u5bc6\u7801</button>
        <button className={`test-mode-button ${authType === "key" ? "active" : ""}`} type="button" role="tab" aria-selected={authType === "key"} onClick={() => onAuthTypeChange("key")}>\u8eab\u4efd\u6587\u4ef6</button>
      </div>
      {authType === "password" ? (
        <label className="remote-credential-field">
          \u5bc6\u7801
          <input
            className="input mt-1"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            required={!server || server.authType !== authType}
            type="password"
            autoComplete="current-password"
            placeholder={server ? "\u7559\u7a7a\u4fdd\u7559\u5df2\u4fdd\u5b58\u5bc6\u7801\uff1b\u9700\u66f4\u65b0\u65f6\u91cd\u65b0\u8f93\u5165" : "\u8f93\u5165\u5bc6\u7801"}
            onInvalid={(event) => event.currentTarget.setCustomValidity("\u8bf7\u6dfb\u52a0\u5bc6\u7801")}
            onInput={(event) => event.currentTarget.setCustomValidity("")}
          />
        </label>
      ) : (
        <label className="remote-credential-field">
          SSH\u5bc6\u94a5
          <div className="secret-input-wrap mt-1">
            <input
              className="input private-key-input"
              value={privateKeyPath}
              required
              readOnly
              onClick={onChoosePrivateKey}
              autoComplete="off"
              placeholder="\u9009\u62e9\u5bc6\u94a5\u6587\u4ef6"
              onInvalid={(event) => event.currentTarget.setCustomValidity("\u8bf7\u6dfb\u52a0 SSH\u5bc6\u94a5")}
              onInput={(event) => event.currentTarget.setCustomValidity("")}
            />
            <button className="secret-file-button" type="button" title="\u9009\u62e9\u7535\u8111\u6587\u4ef6" onClick={onChoosePrivateKey}>
              <FolderOpen size={17} />
            </button>
          </div>
        </label>
      )}
    </>
  );
}
