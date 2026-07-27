import { X } from "lucide-react";

type RemoteTestNoticeProps = {
  result: {
    success: boolean;
    message: string;
  };
  onClose: () => void;
};

export function RemoteTestNotice({ result, onClose }: RemoteTestNoticeProps) {
  return (
    <div
      className={`remote-test-notice test-result ${result.success ? "success" : "error"}`}
      role={result.success ? "status" : "alert"}
    >
      <span>{result.message}</span>
      <button
        className="icon-button"
        type="button"
        title="\u5173\u95ed\u63d0\u793a"
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  );
}
