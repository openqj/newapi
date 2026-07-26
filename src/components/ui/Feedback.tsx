import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

type NoticeKind = "success" | "error" | "info";
type Notice = { id: number; kind: NoticeKind; message: string };
type NoticeContextValue = { notify: (message: string, kind?: NoticeKind) => void };
const NoticeContext = /*#__PURE__*/ createContext<NoticeContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notice[]>([]);
  const notify = useCallback((message: string, kind: NoticeKind = "info") => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);

  return <NoticeContext.Provider value={{ notify }}>{children}{createPortal(<div className="toast-region" aria-live="polite">{items.map((item) => <div className={`toast toast-${item.kind}`} key={item.id}>{item.kind === "success" ? <CircleCheck size={17} /> : item.kind === "error" ? <CircleAlert size={17} /> : <Info size={17} />}<span>{item.message}</span><button type="button" aria-label="关闭提示" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><X size={16} /></button></div>)}</div>, document.body)}</NoticeContext.Provider>;
}

export function useToast() {
  const context = useContext(NoticeContext);
  if (!context) throw new Error("useToast 必须在 ToastProvider 内使用。");
  return context;
}

export function InlineAlert({ children, kind = "error", onDismiss }: { children: ReactNode; kind?: NoticeKind; onDismiss?: () => void }) {
  const Icon = kind === "success" ? CircleCheck : kind === "error" ? CircleAlert : Info;
  return <div className={`inline-alert inline-alert-${kind}`} role={kind === "error" ? "alert" : "status"}><Icon size={16} /><span>{children}</span>{onDismiss && <button type="button" aria-label="关闭提示" onClick={onDismiss}><X size={16} /></button>}</div>;
}

type DialogProps = { title: string; description?: ReactNode; children?: ReactNode; onClose: () => void; footer: ReactNode };
function OverlayDialog({ title, description, children, onClose, footer }: DialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal overlay-dialog" role="dialog" aria-modal="true" aria-labelledby="overlay-dialog-title"><header className="form-dialog-header"><div><h2 id="overlay-dialog-title" className="font-semibold">{title}</h2>{description && <p className="form-dialog-description">{description}</p>}</div><button ref={closeButton} type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={17} /></button></header>{children && <div className="form-dialog-content">{children}</div>}<footer className="form-dialog-footer">{footer}</footer></section></div>, document.body);
}

type ConfirmOptions = { title?: string; description: ReactNode; confirmLabel?: string; destructive?: boolean };
type ConfirmContextValue = { confirm: (options: ConfirmOptions) => Promise<boolean> };
const ConfirmContext = /*#__PURE__*/ createContext<ConfirmContextValue | null>(null);

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (value: boolean) => void } | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })), []);
  const settle = useCallback((value: boolean) => {
    setPending((current) => { current?.resolve(value); return null; });
  }, []);
  return <ConfirmContext.Provider value={{ confirm }}>{children}{pending && <OverlayDialog title={pending.options.title ?? "请确认操作"} description={pending.options.description} onClose={() => settle(false)} footer={<><button type="button" className="button-secondary" onClick={() => settle(false)}>取消</button><button type="button" className={pending.options.destructive ? "button-danger" : "button-primary"} onClick={() => settle(true)}>{pending.options.confirmLabel ?? "确认"}</button></>}/>}</ConfirmContext.Provider>;
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm 必须在 ConfirmationProvider 内使用。");
  return context.confirm;
}

type PromptOptions = { title: string; description?: ReactNode; label: string; initialValue?: string; inputMode?: "text" | "numeric"; confirmLabel?: string };
type PromptContextValue = { prompt: (options: PromptOptions) => Promise<string | null> };
const PromptContext = /*#__PURE__*/ createContext<PromptContextValue | null>(null);

export function PromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ options: PromptOptions; resolve: (value: string | null) => void } | null>(null);
  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => setPending({ options, resolve })), []);
  const settle = useCallback((value: string | null) => setPending((current) => { current?.resolve(value); return null; }), []);
  return <PromptContext.Provider value={{ prompt }}>{children}{pending && <PromptDialog pending={pending} onClose={() => settle(null)} onSubmit={(value) => settle(value)} />}</PromptContext.Provider>;
}

function PromptDialog({ pending, onClose, onSubmit }: { pending: { options: PromptOptions }; onClose: () => void; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState(pending.options.initialValue ?? "");
  return <OverlayDialog title={pending.options.title} description={pending.options.description} onClose={onClose} footer={<><button type="button" className="button-secondary" onClick={onClose}>取消</button><button type="button" className="button-primary" onClick={() => onSubmit(value)}>{pending.options.confirmLabel ?? "确认"}</button></>}><label className="form-field"><span>{pending.options.label}</span><input autoFocus className="input" value={value} inputMode={pending.options.inputMode} onChange={(event) => setValue(event.target.value)} /></label></OverlayDialog>;
}

export function usePrompt() {
  const context = useContext(PromptContext);
  if (!context) throw new Error("usePrompt 必须在 PromptProvider 内使用。");
  return context.prompt;
}
