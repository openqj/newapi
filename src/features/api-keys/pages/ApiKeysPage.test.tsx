import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationProvider, ToastProvider } from "../../../components/ui";
import { ApiKeysPage } from "./ApiKeysPage";

describe("ApiKeysPage", () => {
  it("reads the supplied cached rows on entry and refreshes only when requested", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <ToastProvider>
        <ConfirmationProvider>
          <ApiKeysPage rows={[]} stations={[]} onRefresh={onRefresh} onUpdated={vi.fn().mockResolvedValue(undefined)} />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("刷新"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
