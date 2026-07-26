import type { LucideIcon } from "lucide-react";
import {
  Activity,
  KeyRound,
  LayoutDashboard,
  RefreshCw,
  ScanSearch,
  ServerCog,
  Settings,
  Tags,
  UsersRound,
} from "lucide-react";

export type AppView =
  | "overview"
  | "accounts"
  | "rates"
  | "keys"
  | "usage"
  | "apiDetection"
  | "remote"
  | "profiles"
  | "offers"
  | "settings";

type NavigationItem = {
  view: Exclude<AppView, "profiles">;
  label: string;
  Icon: LucideIcon;
};

export const primaryNavigation: readonly NavigationItem[] = [
  { view: "overview", label: "总览", Icon: LayoutDashboard },
  { view: "accounts", label: "站点账户", Icon: UsersRound },
  { view: "rates", label: "倍率", Icon: RefreshCw },
  { view: "keys", label: "API 密钥", Icon: KeyRound },
  { view: "usage", label: "使用记录", Icon: Activity },
  { view: "apiDetection", label: "API 检测", Icon: ScanSearch },
  { view: "remote", label: "远程配置", Icon: ServerCog },
  { view: "offers", label: "优惠中心", Icon: Tags },
  { view: "settings", label: "设置", Icon: Settings },
];
