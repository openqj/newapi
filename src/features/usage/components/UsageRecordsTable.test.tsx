import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UsageRecordsDesktop } from "./UsageRecordsTable";
import type { UsageLog } from "../types";

const columns = {
  key: false,
  model: false,
  reasoning: false,
  endpoint: false,
  ip: false,
  source: false,
  group: false,
  type: false,
  billing: false,
  tokens: false,
  cost: true,
  latency: false,
  time: false,
};

const row: UsageLog = {
  id: "usage-detail-1",
  stationId: "station-1",
  stationName: "Sub2API",
  stationUrl: "https://relay.example.com",
  model: "gpt-4o",
  inputTokens: 6135,
  outputTokens: 279,
  cacheCreationTokens: 6430,
  cacheReadTokens: 12970,
  actualCost: 0.003716,
  inputCost: 0.030675,
  outputCost: 0.006975,
  cacheCreationCost: 0.016075,
  cacheReadCost: 0.003891,
  totalCost: 0.057616,
  rateMultiplier: 0.04,
  serviceTier: "standard",
  requestType: "stream",
  durationMs: 1000,
  createdAt: 1_754_000_000,
};

describe("UsageRecordsDesktop cost details", () => {
  afterEach(() => cleanup());

  it("shows Sub2API cost breakdown on hover", () => {
    render(<UsageRecordsDesktop rows={[row]} columns={columns} />);

    const trigger = screen.getByRole("button", { name: "查看费用明细" });
    fireEvent.mouseEnter(trigger);

    expect(screen.getByText("费用明细")).toBeInTheDocument();
    expect(screen.getByText("$0.030675")).toBeInTheDocument();
    expect(screen.getByText("$5.0000 / 1M Token")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("0.040x")).toBeInTheDocument();
    expect(screen.getByText("$0.003716")).toBeInTheDocument();
  });

  it("keeps the detail open after a click and closes it with Escape", () => {
    render(<UsageRecordsDesktop rows={[row]} columns={columns} />);

    const trigger = screen.getByRole("button", { name: "查看费用明细" });
    fireEvent.click(trigger);
    fireEvent.mouseLeave(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows a fallback when a legacy row has no cost breakdown", () => {
    const legacyRow = { ...row, id: "legacy-usage", inputCost: undefined, outputCost: undefined, cacheCreationCost: undefined, cacheReadCost: undefined };
    render(<UsageRecordsDesktop rows={[legacyRow]} columns={columns} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "查看费用明细" }));

    expect(screen.getByText("当前记录未提供费用拆分")).toBeInTheDocument();
    expect(screen.getByText("$0.057616")).toBeInTheDocument();
  });
});
