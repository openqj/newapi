import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui";
import { useStations } from "./hooks";
import type { StationSnapshot } from "./types";

const { cancelSync, list, refreshAll, snapshot, syncProgress } = vi.hoisted(() => ({
  cancelSync: vi.fn(),
  list: vi.fn(),
  refreshAll: vi.fn(),
  snapshot: vi.fn(),
  syncProgress: vi.fn(),
}));

vi.mock("../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("./api", () => ({ stationApi: { cancelSync, list, refreshAll, snapshot, syncProgress } }));

const emptySnapshot: StationSnapshot = { rates: [], apiKeys: [], offers: [], unavailable: [] };

function RefreshProbe() {
  const { refreshAll: refresh } = useStations({ emptySnapshot });
  return <button type="button" onClick={() => { void refresh(); void refresh(); }}>刷新</button>;
}

function ScopedRefreshProbe({ onSyncComplete, onComplete }: { onSyncComplete: () => void; onComplete: () => void }) {
  const { refreshAll: refresh } = useStations({ emptySnapshot, onSyncComplete });
  return <button type="button" onClick={() => void refresh(onComplete)}>刷新指定数据</button>;
}

function AutoRefreshProbe() {
  useStations({ emptySnapshot, autoRefresh: true });
  return null;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("useStations", () => {
  it("shares one in-flight full refresh and permits a later refresh", async () => {
    let resolveFirstRefresh: () => void = () => undefined;
    const firstRefresh = new Promise<void>((resolve) => { resolveFirstRefresh = resolve; });
    list.mockResolvedValue([]);
    refreshAll.mockReturnValueOnce(firstRefresh).mockResolvedValueOnce([]);
    syncProgress.mockResolvedValue(null);

    render(<ToastProvider><RefreshProbe /></ToastProvider>);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(refreshAll).toHaveBeenCalledTimes(1);

    resolveFirstRefresh();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(refreshAll).toHaveBeenCalledTimes(2);
  });

  it("uses a page-specific completion callback when supplied", async () => {
    const defaultComplete = vi.fn();
    const scopedComplete = vi.fn();
    list.mockResolvedValue([]);
    refreshAll.mockResolvedValue([]);

    render(<ToastProvider><ScopedRefreshProbe onSyncComplete={defaultComplete} onComplete={scopedComplete} /></ToastProvider>);
    await waitFor(() => expect(list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "刷新指定数据" }));
    await waitFor(() => expect(scopedComplete).toHaveBeenCalled());
    expect(defaultComplete).not.toHaveBeenCalled();
  });

  it("refreshes after connectivity returns without retrying while offline", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    list.mockResolvedValue([]);
    refreshAll.mockResolvedValue([]);
    syncProgress.mockResolvedValue(null);

    render(<ToastProvider><AutoRefreshProbe /></ToastProvider>);
    await waitFor(() => expect(list).toHaveBeenCalled());
    refreshAll.mockClear();

    fireEvent(window, new Event("online"));
    expect(refreshAll).not.toHaveBeenCalled();

    online.mockReturnValue(true);
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(refreshAll).toHaveBeenCalledTimes(1));
  });
});
