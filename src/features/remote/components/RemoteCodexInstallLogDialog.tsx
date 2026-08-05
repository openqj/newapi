import { useEffect, useRef } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, X } from "lucide-react";
import type { RemoteCodexInstallState } from "../types";

type RemoteCodexInstallLogDialogProps = {
  state: RemoteCodexInstallState;
  onClose: () => void;
};

const phaseLabels: Record<string, string> = {
  connecting: "\u8fde\u63a5\u4e2d",
  preparing: "\u51c6\u5907\u73af\u5883",
  installing: "\u5b89\u88c5\u4e2d",
  verifying: "\u6821\u9a8c\u7248\u672c",
  completed: "\u5df2\u5b8c\u6210",
};

export function RemoteCodexInstallLogDialog({ state, onClose }: RemoteCodexInstallLogDialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const actionLabel = state.action === "install" ? "\u5b89\u88c5" : "\u66f4\u65b0";
  const phaseLabel = phaseLabels[state.phase] ?? state.phase;
  const statusLabel = !state.done
    ? "\u6267\u884c\u4e2d"
    : state.success === true
      ? "\u6210\u529f"
      : "\u5931\u8d25";

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [state.entries.length]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal remote-codex-install-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Codex CLI ${actionLabel}\u65e5\u5fd7`}
      >
        <header className="remote-codex-install-header">
          <div>
            <h2>{`Codex CLI ${actionLabel}\u65e5\u5fd7`}</h2>
            <p>{state.server.name} / {state.server.username}@{state.server.host}</p>
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            type="button"
            aria-label={"\u5173\u95ed"}
            title={"\u5173\u95ed"}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>
        <div className={`remote-codex-install-status ${state.done ? (state.success ? "success" : "error") : "running"}`}>
          {state.done
            ? state.success
              ? <CheckCircle2 size={16} />
              : <CircleAlert size={16} />
            : <LoaderCircle size={16} className="animate-spin" />}
          <span>{state.done ? statusLabel : `${phaseLabel} / ${statusLabel}`}</span>
        </div>
        <div className="remote-codex-install-log-list" role="log" aria-live="polite">
          {state.entries.map((entry, index) => (
            <div className={`remote-codex-install-log-line ${entry.level}`} key={`${index}-${entry.phase}-${entry.message}`}>
              <span className="remote-codex-install-log-phase">{phaseLabels[entry.phase] ?? entry.phase}</span>
              <span className="remote-codex-install-log-message">{entry.message}</span>
            </div>
          ))}
          <div ref={logEnd} />
          {state.entries.length === 0 && <p className="remote-codex-install-empty">{"\u7b49\u5f85\u8fdc\u7a0b\u670d\u52a1\u5668\u8fd4\u56de\u65e5\u5fd7..."}</p>}
        </div>
        <footer className="remote-codex-install-footer">
          <button type="button" className="button-secondary" onClick={onClose}>{"\u5173\u95ed"}</button>
        </footer>
      </section>
    </div>
  );
}
