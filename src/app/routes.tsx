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
  Tags,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { AccountRow } from "../features/accounts";
import type { KeyRow } from "../features/api-keys";
import type { Offer } from "../features/offers";
import type { NotificationPreferences } from "../features/personal-center";
import type { LoginProfile } from "../features/profiles";
import type { RateRow } from "../features/rates";
import type { RemoteServer } from "../features/remote";
import type { Station } from "../features/stations";
import type { UsageLog, UsageSummary } from "../features/usage";

const AccountsPage = lazy(() => import("../features/accounts/pages/AccountsPage").then(({ AccountsPage }) => ({ default: AccountsPage })));
const AlertHistoryPage = lazy(() => import("../features/alerts/pages/AlertHistoryPage").then(({ AlertHistoryPage }) => ({ default: AlertHistoryPage })));
const ApiDetectionPage = lazy(() => import("../features/api-detection/pages/ApiDetectionPage").then(({ ApiDetectionPage }) => ({ default: ApiDetectionPage })));
const ApiKeysPage = lazy(() => import("../features/api-keys/pages/ApiKeysPage").then(({ ApiKeysPage }) => ({ default: ApiKeysPage })));
const DashboardPage = lazy(() => import("../features/dashboard/pages/DashboardPage").then(({ DashboardPage }) => ({ default: DashboardPage })));
const OffersPage = lazy(() => import("../features/offers/pages/OffersPage").then(({ OffersPage }) => ({ default: OffersPage })));
const PersonalCenterPage = lazy(() => import("../features/personal-center/pages/PersonalCenterPage").then(({ PersonalCenterPage }) => ({ default: PersonalCenterPage })));
const LoginProfilesPage = lazy(() => import("../features/profiles/pages/LoginProfilesPage").then(({ LoginProfilesPage }) => ({ default: LoginProfilesPage })));
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
  | "profiles"
  | "offers"
  | "personalCenter"
  | "settings"
  | "alertHistory";

/**
 * Dependencies supplied by the application shell to a feature page.
 *
 * Page modules remain independent of the shell: a new view only needs a
 * registry entry and the data/actions it consumes here.
 */
export type AppRouteContext = {
  stations: Station[];
  snapshot: { offers: Offer[] };
  keyRows: KeyRow[];
  rateRows: RateRow[];
  accountRows: AccountRow[];
  usageSummary: UsageSummary;
  usageLogs: UsageLog[];
  remoteServers: RemoteServer[];
  demoLoginProfiles: LoginProfile[];
  personalCenterNotificationPreferences: NotificationPreferences;
  onSavePersonalCenterNotificationPreferences: (preferences: NotificationPreferences) => Promise<boolean>;
  onReloadPersonalCenterNotificationPreferences: () => Promise<void>;
  personalCenterAccess: {
    authenticated: boolean;
    isAdmin: boolean;
    privileges: ReadonlySet<string>;
  };
  navigate: (view: AppView) => void;
  onAddStation: () => void;
  onEditStationAccount: (row: AccountRow) => void;
  onRefreshAll: () => Promise<void>;
  onRefreshUsageLogs: () => Promise<void>;
  onRefreshRemoteServers: () => Promise<void>;
  onRefreshSupportingData: () => Promise<void>;
  onCodexRelayChanged: () => Promise<void>;
  onOpenStation: (url: string) => void | Promise<void>;
};

const RouteContext = createContext<AppRouteContext | null>(null);

function can(context: AppRouteContext, privilege: string) {
  return !context.personalCenterAccess.authenticated
    || context.personalCenterAccess.isAdmin
    || context.personalCenterAccess.privileges.has(privilege);
}

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
    /** Allows future feature flags or permissions without changing AppSidebar. */
    isVisible?: (context: AppRouteContext) => boolean;
  };
  /** Allows a page to be unavailable while retaining its stable view name. */
  isPageVisible?: (context: AppRouteContext) => boolean;
  createPage: (context: AppRouteContext) => ReactNode;
};

export type NavigationItem = {
  view: Exclude<AppView, "profiles">;
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
    navigation: { label: "站点账户", Icon: UsersRound, isVisible: (context) => can(context, "usage") },
    isPageVisible: (context) => can(context, "usage"),
    createPage: ({ accountRows, stations, onRefreshAll, onRefreshSupportingData, onOpenStation, onAddStation, onEditStationAccount }) => (
      <AccountsPage
        rows={accountRows}
        stations={stations}
        onRefresh={onRefreshAll}
        onUpdated={onRefreshSupportingData}
        onOpenStation={onOpenStation}
        onAdd={onAddStation}
        onEdit={onEditStationAccount}
      />
    ),
  },
  rates: {
    view: "rates",
    navigation: { label: "倍率", Icon: RefreshCw, isVisible: (context) => can(context, "billing") },
    isPageVisible: (context) => can(context, "billing"),
    createPage: ({ rateRows, stations, onRefreshAll, onOpenStation }) => (
      <RatesPage
        rows={rateRows}
        stations={stations}
        unavailableStationCount={stations.filter((station) => !rateRows.some((row) => row.stationId === station.id)).length}
        onRefresh={onRefreshAll}
        onOpenStation={onOpenStation}
      />
    ),
  },
  keys: {
    view: "keys",
    navigation: { label: "API 密钥", Icon: KeyRound, isVisible: (context) => can(context, "apiKeys") },
    isPageVisible: (context) => can(context, "apiKeys"),
    createPage: ({ keyRows, stations, onRefreshAll, onRefreshSupportingData, onCodexRelayChanged }) => (
      <ApiKeysPage rows={keyRows} stations={stations} onRefresh={onRefreshAll} onUpdated={onRefreshSupportingData} onCodexApplied={onCodexRelayChanged} />
    ),
  },
  usage: {
    view: "usage",
    navigation: { label: "使用记录", Icon: Activity, isVisible: (context) => can(context, "usage") },
    isPageVisible: (context) => can(context, "usage"),
    createPage: ({ usageLogs, stations, onRefreshUsageLogs }) => (
      <UsagePage rows={usageLogs} stations={stations} onRefresh={onRefreshUsageLogs} />
    ),
  },
  apiDetection: {
    view: "apiDetection",
    navigation: { label: "API鉴定", Icon: ScanSearch, isVisible: (context) => can(context, "apiKeys") },
    isPageVisible: (context) => can(context, "apiKeys"),
    createPage: ({ keyRows }) => <ApiDetectionPage keyRows={keyRows} />,
  },
  remote: {
    view: "remote",
    navigation: { label: "远程配置", Icon: ServerCog, isVisible: (context) => can(context, "admin") },
    isPageVisible: (context) => can(context, "admin"),
    createPage: ({ remoteServers, keyRows, onRefreshRemoteServers }) => (
      <RemoteConfigPage servers={remoteServers} keyRows={keyRows} onChanged={onRefreshRemoteServers} />
    ),
  },
  profiles: {
    view: "profiles",
    createPage: ({ demoLoginProfiles }) => (
      <LoginProfilesPage demoProfiles={demoLoginProfiles} />
    ),
  },
  offers: {
    view: "offers",
    navigation: { label: "优惠中心", Icon: Tags, isVisible: (context) => can(context, "billing") },
    isPageVisible: (context) => can(context, "billing"),
    createPage: ({ snapshot }) => <OffersPage offers={snapshot.offers} />,
  },
  personalCenter: {
    view: "personalCenter",
    navigation: { label: "个人中心", Icon: UserRound },
    createPage: ({ accountRows, personalCenterNotificationPreferences, onSavePersonalCenterNotificationPreferences, onReloadPersonalCenterNotificationPreferences }) => (
      <PersonalCenterPage
        accountRows={accountRows}
        preferences={personalCenterNotificationPreferences}
        onPreferencesChange={onSavePersonalCenterNotificationPreferences}
        onPreferencesReload={onReloadPersonalCenterNotificationPreferences}
      />
    ),
  },
  settings: {
    view: "settings",
    navigation: { label: "设置", Icon: Settings, isVisible: (context) => can(context, "admin") },
    isPageVisible: (context) => can(context, "admin"),
    createPage: ({ navigate }) => <SettingsPage onManageProfiles={() => navigate("profiles")} onViewAlertHistory={() => navigate("alertHistory")} />,
  },
  alertHistory: {
    view: "alertHistory",
    createPage: ({ navigate }) => <AlertHistoryPage onBack={() => navigate("settings")} />,
  },
};

function RegisteredRoutePage({ view }: { view: AppView }) {
  const context = useAppRouteContext();
  const route = appRoutes[view];
  if (route.isPageVisible?.(context) === false) return null;
  return <Suspense fallback={<div className="min-h-48" role="status" aria-label="Loading page" />}>{route.createPage(context)}</Suspense>;
}

export function createRoutePage(view: AppView): ReactNode {
  return <RegisteredRoutePage view={view} />;
}

export function getPrimaryNavigation(context?: AppRouteContext): readonly NavigationItem[] {
  return (Object.values(appRoutes) as AppRoute[])
    .filter((route): route is AppRoute & { navigation: NonNullable<AppRoute["navigation"]> } => Boolean(route.navigation))
    .filter((route) => !context || route.navigation.isVisible?.(context) !== false)
    .map(({ view, navigation }) => ({ view: view as Exclude<AppView, "profiles">, ...navigation }));
}

/** Backwards-compatible static navigation for consumers without route context. */
export const primaryNavigation = getPrimaryNavigation();
