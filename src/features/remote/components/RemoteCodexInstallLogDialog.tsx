import { useEffect, useRef } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { Button, Dialog, List, ListItem } from "../../../components/ui";
import type { RemoteCodexInstallState } from "../types";

type RemoteCodexInstallLogDialogProps = {
  state: RemoteCodexInstallState;
  onClose: () => void;
};

const phaseLabels: Record<string, string> = {
  connecting: "连接中",
  preparing: "准备环境",
  installing: "安装中",
  verifying: "校验版本",
  completed: "已完成",
};

export function RemoteCodexInstallLogDialog({ state, onClose }: RemoteCodexInstallLogDialogProps) {
  const logEnd = useRef<HTMLDivElement>(null);
  const actionLabel = state.action === "install" ? "安装" : "更新";
  const phaseLabel = phaseLabels[state.phase] ?? state.phase;
  const statusLabel = !state.done
    ? "执行中"
    : state.success === true
      ? "成功"
      : "失败";
  const title = `Codex CLI ${actionLabel}日志`;

  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [state.entries.length]);

  return (
    <Dialog
      title={title}
      description={`${state.server.name} / ${state.server.username}@${state.server.host}`}
      ariaLabel={title}
      className="remote-codex-install-dialog"
      headerClassName="remote-codex-install-header"
      contentClassName="remote-codex-install-content"
      footerClassName="remote-codex-install-footer"
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>关闭</Button>}
    >
      <div className={`remote-codex-install-status ${state.done ? (state.success ? "success" : "error") : "running"}`}>
        {state.done
          ? state.success
            ? <CheckCircle2 size={16} />
            : <CircleAlert size={16} />
          : <LoaderCircle size={16} className="animate-spin" />}
        <span>{state.done ? statusLabel : `${phaseLabel} / ${statusLabel}`}</span>
      </div>
      <List className="remote-codex-install-log-list" role="log" aria-live="polite">
        {state.entries.map((entry, index) => (
          <ListItem className={`remote-codex-install-log-line ${entry.level}`} key={`${index}-${entry.phase}-${entry.message}`}>
            <span className="remote-codex-install-log-phase">{phaseLabels[entry.phase] ?? entry.phase}</span>
            <span className="remote-codex-install-log-message">{entry.message}</span>
          </ListItem>
        ))}
        <div ref={logEnd} role="presentation" />
        {state.entries.length === 0 && <p className="remote-codex-install-empty">等待远程服务器返回日志...</p>}
      </List>
    </Dialog>
  );
}
