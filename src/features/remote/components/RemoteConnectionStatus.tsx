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
          SSH \u4e3b\u673a\u6307\u7eb9: {pendingHostKeyFingerprint}
          <span className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={hostKeyConfirmed}
              onChange={(event) => onHostKeyConfirmedChange(event.currentTarget.checked)}
            />
            \u6211\u5df2\u901a\u8fc7\u53ef\u4fe1\u6e20\u9053\u786e\u8ba4\u8be5\u4e3b\u673a\u6307\u7eb9
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
              ? "SSH \u7aef\u53e3\u8fde\u63a5\u6210\u529f"
              : `\u8fde\u63a5\u5931\u8d25${connectionResult.code ? ` (\u9519\u8bef\u4ee3\u7801 ${connectionResult.code})` : ""}${connectionResult.reason ? `\uff1a${connectionResult.reason}` : ""}`}
          </span>
        </div>
      )}
    </>
  );
}
