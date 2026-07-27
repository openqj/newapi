export type Rate = {
  group: string;
  model: string;
  multiplier: number;
  inputMultiplier?: number;
  outputMultiplier?: number;
};

export type RateRow = {
  stationId: string;
  stationName: string;
  stationUrl: string;
  lastSyncedAt?: number;
  syncStatus: string;
  rate: Rate;
};
