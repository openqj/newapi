import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RatesPage } from "./RatesPage";
import { ToastProvider } from "../../../components/ui";

describe("RatesPage", () => {
  it("reads the supplied cached rows on entry and refreshes only when requested", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(<ToastProvider><RatesPage rows={[]} stations={[]} unavailableStationCount={0} onRefresh={onRefresh} onOpenStation={vi.fn()} /></ToastProvider>);

    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("刷新"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows an available group description without a model column", () => {
    render(<ToastProvider><RatesPage rows={[{ stationId: "station-1", stationName: "站点 A", stationUrl: "https://example.com", syncStatus: "online", rate: { group: "vip", groupDescription: "高速通道", model: "全部模型", multiplier: 0.8 } }]} stations={[]} unavailableStationCount={0} onRefresh={vi.fn()} onOpenStation={vi.fn()} /></ToastProvider>);

    expect(screen.getAllByText("高速通道")).toHaveLength(2);
    expect(screen.getAllByPlaceholderText("搜索分组")).toHaveLength(2);
    expect(screen.queryByRole("columnheader", { name: "模型" })).not.toBeInTheDocument();
    expect(screen.getByTitle("按计费倍率排序").querySelector(".lucide-arrow-up-down")).not.toBeNull();
  });
});
