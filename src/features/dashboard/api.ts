/**
 * Dashboard is an aggregate read-model and owns no Tauri command. Keeping this
 * adapter makes its refresh boundary explicit without leaking command details
 * into the page or future dashboard implementations.
 */
export const dashboardApi = {
  refresh: (refresh: () => Promise<void>) => refresh(),
};
