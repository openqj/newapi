type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function scheduleIdle(callback: () => void, timeout = 1500) {
  if (typeof window === "undefined") {
    callback();
    return () => undefined;
  }

  const idleWindow = window as IdleWindow;
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const id = idleWindow.requestIdleCallback(callback, { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(callback, 0);
  return () => window.clearTimeout(id);
}
