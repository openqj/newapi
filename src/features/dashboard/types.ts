import type { AccountRow } from "../accounts";
import type { KeyRow } from "../api-keys";
import type { RemoteServer } from "../remote";
import type { Station } from "../stations";
import type { UsageLog, UsageSummary } from "../usage";

export type DashboardView = "overview" | "accounts" | "keys" | "usage" | "apiDetection" | "remote";
export type DashboardUsageSummary = UsageSummary & { costsAreIsolated?: boolean };

export type DashboardPageProps = {
  stations: Station[];
  keys: KeyRow[];
  remoteServers: RemoteServer[];
  accountRows: AccountRow[];
  summary: DashboardUsageSummary;
  usageRows: UsageLog[];
  onRefresh: () => Promise<void>;
  onNavigate: (view: DashboardView) => void;
  onOpenUpdates: () => void;
};
