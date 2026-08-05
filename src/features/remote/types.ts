export type RemoteServer = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  privateKeyPath?: string;
  codexVersion?: string;
  codexLatestVersion?: string;
  codexUpdateAvailable?: boolean;
  hostKeyFingerprint?: string;
  relayUrl?: string;
  relayProvider?: string;
  relayKeySource?: string;
  relayKeyMasked?: string;
  relayConfigFingerprint?: string;
  connectionStatus?: "online" | "warning" | "error";
  connectionError?: string;
  lastSyncedAt?: number;
  lastSyncStatus?: string;
  lastSyncError?: string;
  updatedAt: number;
};

export type RemoteConnectionResult = {
  success: boolean;
  status: "online" | "warning" | "error";
  code?: number;
  reason?: string;
  hostKeyFingerprint?: string;
  requiresHostKeyConfirmation?: boolean;
};

export type RemoteServerSaveResult = {
  server: RemoteServer;
  connection: RemoteConnectionResult;
};

export type GenerateSshKeyResult = {
  privateKeyPath?: string;
  publicKeyPath?: string;
  connection: RemoteConnectionResult;
};

export type RemoteSyncLog = {
  id: number;
  serverId: string;
  status: string;
  action: string;
  summary: string;
  configFingerprint?: string;
  createdAt: number;
};

export type RemoteCodexInstallLog = {
  serverId: string;
  phase: string;
  level: "info" | "output" | "success" | "error";
  message: string;
  done: boolean;
  success?: boolean | null;
};

export type RemoteCodexInstallState = {
  server: RemoteServer;
  action: "install" | "update";
  phase: string;
  entries: RemoteCodexInstallLog[];
  done: boolean;
  success?: boolean;
};
