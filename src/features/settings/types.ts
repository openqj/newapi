export type UpdateDownloadEvent = {
  event: string;
  data?: { contentLength?: number; chunkLength?: number };
};

export type PendingDesktopUpdate = {
  version: string;
  downloadAndInstall: (onEvent?: (event: UpdateDownloadEvent) => void) => Promise<void>;
};

export type DesktopUpdateState = "idle" | "checking" | "downloading" | "latest" | "error";
