export type UpdateDownloadEvent = {
  event: string;
  data?: { contentLength?: number; chunkLength?: number };
};

export type PendingDesktopUpdate = {
  version: string;
  downloadAndInstall: (onEvent?: (event: UpdateDownloadEvent) => void) => Promise<void>;
};

export type DesktopUpdateState = "idle" | "checking" | "downloading" | "latest" | "error";

export type CodexIntegrationStatus = {
  preserveOfficialLogin: boolean;
  configDirectory: string;
};

export type CloudAuthStatus = {
  configured: boolean;
  email?: string;
  isAdmin?: boolean;
};

export type CloudBackupSummary = {
  id: string;
  createdAt: string;
  byteSize: number;
};

export type CloudBackupPreview = {
  id: string;
  stationCount: number;
  loginProfileCount: number;
  remoteServerCount: number;
};
