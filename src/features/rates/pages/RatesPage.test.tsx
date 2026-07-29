import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RatesPage } from "./RatesPage";

describe("RatesPage", () => {
  it("reads the supplied cached rows on entry and refreshes only when requested", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(<RatesPage rows={[]} stations={[]} unavailableStationCount={0} onRefresh={onRefresh} onOpenStation={vi.fn()} />);

    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("刷新"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
