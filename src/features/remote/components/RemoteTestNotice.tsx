import { X } from "lucide-react";
import { IconButton } from "../../../components/ui";

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
      <IconButton
        label="关闭提示"
        title="关闭提示"
        onClick={onClose}
        icon={<X size={16} />}
      />
    </div>
  );
}
