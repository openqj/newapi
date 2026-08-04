import { createContext, lazy, Suspense, useContext, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  KeyRound,
  LayoutDashboard,
  RefreshCw,
  ScanSearch,
  ServerCog,
  Settings,
  Store,
  Tags,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { AccountRow } from "../features/accounts";
import type { KeyRow } from "../features/api-keys";
import type { AccountRole } from "../features/merchant";
import type { CloudAuthStatus, SettingsTab } from "../features/settings";
import type { NotificationPreferences } from "../features/personal-center";
import type { LoginProfile } from "../features/profiles";
import type { RateRow } from "../features/rates";
import type { RemoteServer } from "../features/remote";
import type { Station, StationSnapshot } from "../features/stations";
import type { UsageLog, UsageSummary } from "../features/usage";

const AccountsPage = lazy(() => import("../features/accounts/pages/AccountsPage").then(({ AccountsPage }) => ({ default: AccountsPage })));
const ApiDetectionPage = lazy(() => import("../features/api-detection/pages/ApiDetectionPage").then(({ ApiDetectionPage }) => ({ default: ApiDetectionPage })));
const ApiKeysPage = lazy(() => import("../features/api-keys/pages/ApiKeysPage").then(({ ApiKeysPage }) => ({ default: ApiKeysPage })));
const DashboardPage = lazy(() => import("../features/dashboard/pages/DashboardPage").then(({ DashboardPage }) => ({ default: DashboardPage })));
const OffersPage = lazy(() => import("../features/offers/pages/OffersPage").then(({ OffersPage }) => ({ default: OffersPage })));
const PersonalCenterPage = lazy(() => import("../features/personal-center/pages/PersonalCenterPage").then(({ PersonalCenterPage }) => ({ default: PersonalCenterPage })));
const MerchantCenterPage = lazy(() => import("../features/merchant/pages/MerchantCenterPage").then(({ MerchantCenterPage }) => ({ default: MerchantCenterPage })));
const RatesPage = lazy(() => import("../features/rates/pages/RatesPage").then(({ RatesPage }) => ({ default: RatesPage })));
const RemoteConfigPage = lazy(() => import("../features/remote/pages/RemoteConfigPage").then(({ RemoteConfigPage }) => ({ default: RemoteConfigPage })));
const SettingsPage = lazy(() => import("../features/settings/pages/SettingsPage").then(({ SettingsPage }) => ({ default: SettingsPage })));
const UsagePage = lazy(() => import("../features/usage/pages/UsagePage").then(({ UsagePage }) => ({ default: UsagePage })));

export type AppView =
  | "overview"
  | "accounts"
  | "rates"
  | "keys"
  | "usage"
  | "apiDetection"
  | "remote"
  | "offers"
  | "merchantCenter"
  | "personalCenter"
  | "settings";

/**
 * Dependencies supplied by the application shell to a feature page.
 *
 * Page modules remain independent of the shell: a new view only needs a
 * registry entry and the data/actions it consumes here.
 */
export type AppRouteContext = {
  stations: Station[];
  snapshot: Pick<StationSnapshot, "offers" | "syncStatuses">;
  keyRows: KeyRow[];
  rateRows: RateRow[];
  accountRows: AccountRow[];
  usageSummary: UsageSummary;
  usageLogs: UsageLog[];
  remoteServers: RemoteServer[];
  demoLoginProfiles: LoginProfile[];
  settingsTab: SettingsTab;
  onSettingsTabChange: (tab: SettingsTab) => void;
  backgroundRefreshMinutes: number;
  onBackgroundRefreshMinutesChange: (minutes: number) => void;
  personalCenterNotificationPreferences: NotificationPreferences;
  personalCenterAuth: CloudAuthStatus | null;
  accountRole: AccountRole;
  onPersonalCenterAuthChanged: (status: CloudAuthStatus) => void;
  onSavePersonalCenterNotificationPreferences: (preferences: NotificationPreferences) => Promise<boolean>;
  navigate: (view: AppView) => void;
  onAddStation: () => void;
  onEditStationAccount: (row: AccountRow) => void;
  merchantRateRechargeStationId: string | null;
  onMerchantRateRechargeOpened: () => void;
  onRefreshAll: () => Promise<void>;
  onRefreshRatesAndKeys: () => Promise<void>;
  onRefreshUsageLogs: () => Promise<void>;
  onRefreshRemoteServers: () => Promise<void>;
  onRefreshSupportingData: () => Promise<void>;
  onCodexRelayChanged: () => Promise<void>;
  onOpenStation: (url: string) => void | Promise<void>;
};

const RouteContext = createContext<AppRouteContext | null>(null);

export function AppRouteProvider({ value, children }: { value: AppRouteContext; children: ReactNode }) {
  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>;
}

function useAppRouteContext() {
  const context = useContext(RouteContext);
  if (!context) throw new Error("路由页面必须在 AppRouteProvider 内渲染。");
  return context;
}

export type AppRoute = {
  view: AppView;
  navigation?: {
    label: string;
    Icon: LucideIcon;
    roles?: readonly AccountRole[];
  };
  createPage: (context: AppRouteContext) => ReactNode;
};

export type NavigationItem = {
  view: AppView;
  label: string;
  Icon: LucideIcon;
};

export const appRoutes: Readonly<Record<AppView, AppRoute>> = {
  overview: {
    view: "overview",
    navigation: { label: "概览", Icon: LayoutDashboard },
    createPage: ({ stations, keyRows, accountRows, usageSummary, usageLogs, onRefreshAll, navigate }) => (
      <DashboardPage
        stations={stations}
        keys={keyRows}
        accountRows={accountRows}
        summary={usageSummary}
        usageRows={usageLogs}
        onRefresh={onRefreshAll}
        onNavigate={navigate}
      />
    ),
  },
  accounts: {
    view: "accounts",
    navigation: { label: "站点账户", Icon: UsersRound },
    createPage: ({ accountRows, stations, onRefreshAll, onRefreshSupportingData, onOpenStation, onAddStation, onEditStationAccount, merchantRateRechargeStationId, onMerchantRateRechargeOpened }) => (
      <AccountsPage
        rows={accountRows}
        stations={stations}
        onRefresh={onRefreshAll}
        onUpdated={onRefreshSupportingData}
        onOpenStation={onOpenStation}
        onAdd={onAddStation}
        onEdit={onEditStationAccount}
        autoRedeemStationId={merchantRateRechargeStationId}
        onAutoRedeemOpened={onMerchantRateRechargeOpened}
      />
    ),
  },
  rates: {
    view: "rates",
    navigation: { label: "分组倍率", Icon: RefreshCw },
    createPage: ({ rateRows, stations, onRefreshRatesAndKeys, onOpenStation }) => (
      <RatesPage
        rows={rateRows}
        stations={stations}
        unavailableStationCount={stations.filter((station) => !rateRows.some((row) => row.stationId === station.id)).length}
        onRefresh={onRefreshRatesAndKeys}
        onOpenStation={onOpenStation}
      />
    ),
  },
  keys: {
    view: "keys",
    navigation: { label: "API 密钥", Icon: KeyRound },
    createPage: ({ keyRows, stations, onRefreshRatesAndKeys, onRefreshSupportingData, onCodexRelayChanged }) => (
      <ApiKeysPage rows={keyRows} stations={stations} onRefresh={onRefreshRatesAndKeys} onUpdated={onRefreshSupportingData} onCodexApplied={onCodexRelayChanged} />
    ),
  },
  usage: {
    view: "usage",
    navigation: { label: "使用记录", Icon: Activity },
    createPage: ({ usageLogs, stations, onRefreshUsageLogs }) => (
      <UsagePage rows={usageLogs} stations={stations} onRefresh={onRefreshUsageLogs} />
    ),
  },
  apiDetection: {
    view: "apiDetection",
    navigation: { label: "API鉴定", Icon: ScanSearch },
    createPage: ({ keyRows }) => <ApiDetectionPage keyRows={keyRows} />,
  },
  remote: {
    view: "remote",
    navigation: { label: "远程配置", Icon: ServerCog },
    createPage: ({ remoteServers, keyRows, onRefreshRemoteServers }) => (
      <RemoteConfigPage servers={remoteServers} keyRows={keyRows} onChanged={onRefreshRemoteServers} />
    ),
  },
  offers: {
    view: "offers",
    navigation: { label: "优惠中心", Icon: Tags },
    createPage: ({ snapshot }) => <OffersPage offers={snapshot.offers} />,
  },
  merchantCenter: {
    view: "merchantCenter",
    navigation: { label: "商家端", Icon: Store, roles: ["merchant", "admin"] },
    createPage: () => <MerchantCenterPage />,
  },
  personalCenter: {
    view: "personalCenter",
    navigation: { label: "个人中心", Icon: UserRound },
    createPage: ({ accountRows, personalCenterNotificationPreferences, personalCenterAuth, onSavePersonalCenterNotificationPreferences, onPersonalCenterAuthChanged }) => (
      <PersonalCenterPage
        accountRows={accountRows}
        preferences={personalCenterNotificationPreferences}
        initialAuth={personalCenterAuth}
        onPreferencesChange={onSavePersonalCenterNotificationPreferences}
        onAuthChanged={onPersonalCenterAuthChanged}
      />
    ),
  },
  settings: {
    view: "settings",
    navigation: { label: "设置", Icon: Settings },
    createPage: ({ demoLoginProfiles, keyRows, snapshot, settingsTab, onSettingsTabChange, backgroundRefreshMinutes, onBackgroundRefreshMinutesChange }) => <SettingsPage demoProfiles={demoLoginProfiles} keyRows={keyRows} syncStatuses={snapshot.syncStatuses} backgroundRefreshMinutes={backgroundRefreshMinutes} onBackgroundRefreshMinutesChange={onBackgroundRefreshMinutesChange} activeTab={settingsTab} onActiveTabChange={onSettingsTabChange} />,
  },
};

function RegisteredRoutePage({ view }: { view: AppView }) {
  const context = useAppRouteContext();
  return <Suspense fallback={<div className="min-h-48" role="status" aria-label="Loading page" />}>{appRoutes[view].createPage(context)}</Suspense>;
}

export function createRoutePage(view: AppView): ReactNode {
  return <RegisteredRoutePage view={view} />;
}

export function getPrimaryNavigation(context?: AppRouteContext): readonly NavigationItem[] {
  return (Object.values(appRoutes) as AppRoute[])
    .filter((route): route is AppRoute & { navigation: NonNullable<AppRoute["navigation"]> } => Boolean(route.navigation))
    .filter((route) => route.view !== "merchantCenter" && route.view !== "offers")
    .filter((route) => !route.navigation.roles || route.navigation.roles.includes(context?.accountRole ?? "member"))
    .map(({ view, navigation }) => ({ view, ...navigation }));
}

/** Backwards-compatible static navigation for consumers without route context. */
export const primaryNavigation = getPrimaryNavigation();
