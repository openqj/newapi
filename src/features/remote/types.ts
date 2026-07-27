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

export type RemoteSyncLog = {
  id: number;
  serverId: string;
  status: string;
  action: string;
  summary: string;
  configFingerprint?: string;
  createdAt: number;
};
