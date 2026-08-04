export type ClientApplication = "claude" | "codex" | "gemini";

export type ConfigProfile = {
  id: string;
  name: string;
  application: ClientApplication;
  stationId: string;
  keyId: string;
  baseUrl?: string;
  model?: string;
  protocol?: string;
  homepage?: string;
  source?: string;
  secretRef?: string;
  updatedAt: number;
};

export type ConfigProfileDraft = Omit<ConfigProfile, "id" | "updatedAt"> & {
  id?: string;
};

export type ActiveConfigProfile = {
  profile: ConfigProfile;
  appliedAt: number;
  lastTestStatus: "notTested" | string;
};

export type ConfigProfileApplyResult = {
  active: ActiveConfigProfile;
  backupFiles: string[];
};

export type ConfigBackupSummary = {
  id: string;
  application: ClientApplication;
  fileName: string;
  backupPath: string;
  targetPath: string;
  createdAt: number;
  byteSize: number;
};

export type ConfigBackupPreview = {
  backup: ConfigBackupSummary;
  targetExists: boolean;
  targetSize: number;
  canRestore: boolean;
};

export type ConfigBackupRestoreResult = {
  backup: ConfigBackupSummary;
  safetyBackupPath?: string;
};

export type ConfigImportRequest = {
  application: ClientApplication;
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
  protocol?: string;
  homepage?: string;
  source?: string;
};

export type ConfigImportPreview = {
  application: ClientApplication;
  name: string;
  baseUrl: string;
  model?: string;
  protocol?: string;
  homepage?: string;
  maskedApiKey: string;
  matchedStationId?: string;
  matchedStationName?: string;
  matchedKeyId?: string;
  matchedKeyName?: string;
};
