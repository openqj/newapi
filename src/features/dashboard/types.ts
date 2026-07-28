import type { KeyRow } from "../api-keys";
import type { Station } from "../stations";
import type { UsageLog, UsageSummary } from "../usage";

export type DashboardView = "overview" | "keys" | "usage";
export type DashboardUsageSummary = UsageSummary & { costsAreIsolated?: boolean };

export type DashboardPageProps = {
  stations: Station[];
  keys: KeyRow[];
  summary: DashboardUsageSummary;
  usageRows: UsageLog[];
  onRefresh: () => Promise<void>;
  onNavigate: (view: DashboardView) => void;
};
