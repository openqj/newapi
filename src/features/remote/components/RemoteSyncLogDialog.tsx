import { X } from "lucide-react";
import type { RemoteServer, RemoteSyncLog } from "../types";

type RemoteSyncLogDialogProps = {
  server: RemoteServer;
  entries: RemoteSyncLog[];
  onClose: () => void;
};

const formatLogTime = (time: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(time * 1000);

export function RemoteSyncLogDialog({
  server,
  entries,
  onClose,
}: RemoteSyncLogDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal remote-log-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="\u670d\u52a1\u5668\u540c\u6b65\u8bb0\u5f55"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold">\u540c\u6b65\u8bb0\u5f55</h2>
            <p className="mt-1 text-xs text-slate-500">
              {server.name}
              {server.hostKeyFingerprint
                ? ` \u00b7 ${server.hostKeyFingerprint.slice(0, 22)}...`
                : " \u00b7 \u9996\u6b21\u8fde\u63a5\u540e\u5c06\u56fa\u5b9a SSH \u6307\u7eb9"}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            title="\u5173\u95ed"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <div className="remote-log-list">
          {entries.map((entry) => (
            <div className={`remote-log-entry ${entry.status}`} key={entry.id}>
              <p className="font-medium">{entry.action} \u00b7 {entry.status}</p>
              <p>{entry.summary}</p>
              <p className="text-xs text-slate-400">
                {formatLogTime(entry.createdAt)}
                {entry.configFingerprint
                  ? ` \u00b7 ${entry.configFingerprint.slice(0, 18)}...`
                  : ""}
              </p>
            </div>
          ))}
          {entries.length === 0 && (
            <p className="empty-cell">\u6682\u65e0\u540c\u6b65\u8bb0\u5f55</p>
          )}
        </div>
      </section>
    </div>
  );
}
