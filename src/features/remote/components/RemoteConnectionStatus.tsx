import type { RemoteConnectionResult, RemoteServer } from "../types";

type RemoteConnectionStatusProps = {
  server?: RemoteServer;
  pendingHostKeyFingerprint: string | null;
  hostKeyConfirmed: boolean;
  onHostKeyConfirmedChange: (confirmed: boolean) => void;
  connectionResult: RemoteConnectionResult | null;
};

export function RemoteConnectionStatus({
  server,
  pendingHostKeyFingerprint,
  hostKeyConfirmed,
  onHostKeyConfirmedChange,
  connectionResult,
}: RemoteConnectionStatusProps) {
  return (
    <>
      {pendingHostKeyFingerprint && !server && (
        <label className="remote-credential-field text-xs text-slate-600 break-all">
          SSH 主机指纹: {pendingHostKeyFingerprint}
          <span className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={hostKeyConfirmed}
              onChange={(event) => onHostKeyConfirmedChange(event.currentTarget.checked)}
            />
            我已通过可信渠道确认该主机指纹
          </span>
        </label>
      )}
      {server?.hostKeyFingerprint && (
        <p className="text-xs text-slate-500 break-all">
          SSH host fingerprint: {server.hostKeyFingerprint}
        </p>
      )}
      {server?.lastSyncError && (
        <p className="text-xs text-rose-600">Last sync: {server.lastSyncError}</p>
      )}
      {connectionResult && (
        <div className={`test-result ${connectionResult.success ? "success" : "error"}`}>
          <span>
            {connectionResult.success
              ? "SSH 端口连接成功"
              : `连接失败${connectionResult.code ? ` (错误代码 ${connectionResult.code})` : ""}${connectionResult.reason ? `：${connectionResult.reason}` : ""}`}
          </span>
        </div>
      )}
    </>
  );
}
