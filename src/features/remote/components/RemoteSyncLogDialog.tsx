import { Dialog, List, ListItem } from "../../../components/ui";
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
  const description = <>{server.name}{server.hostKeyFingerprint ? ` · ${server.hostKeyFingerprint.slice(0, 22)}...` : " · 首次连接后将固定 SSH 指纹"}</>;

  return (
    <Dialog
      title="同步记录"
      description={description}
      ariaLabel="服务器同步记录"
      className="remote-log-dialog"
      contentClassName="remote-log-dialog-content"
      onClose={onClose}
    >
      <List className="remote-log-list">
        {entries.map((entry) => (
          <ListItem className={`remote-log-entry ${entry.status}`} key={entry.id}>
            <p className="font-medium">{entry.action} · {entry.status}</p>
            <p>{entry.summary}</p>
            <p className="text-xs text-slate-400">
              {formatLogTime(entry.createdAt)}
              {entry.configFingerprint ? ` · ${entry.configFingerprint.slice(0, 18)}...` : ""}
            </p>
          </ListItem>
        ))}
        {entries.length === 0 && <p className="empty-cell">暂无同步记录</p>}
      </List>
    </Dialog>
  );
}
