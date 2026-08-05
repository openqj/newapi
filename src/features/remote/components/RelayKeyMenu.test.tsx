import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RelayKeyMenu } from "./RelayKeyMenu";

describe("RelayKeyMenu", () => {
  it("places the local relay action before saved keys", () => {
    const onSelect = vi.fn();
    const onSelectLocal = vi.fn();
    render(
      <RelayKeyMenu
        position={{ top: 0, left: 0, width: 200 }}
        rows={[{
          stationId: "station-1",
          stationName: "Relay",
          stationUrl: "https://relay.example.com",
          groups: [],
          models: [],
          key: { id: "key-1", name: "Key", maskedKey: "sk-****", status: "active" },
        }]}
        saving={false}
        menuRef={null}
        onSelect={onSelect}
        onSelectLocal={onSelectLocal}
      />,
    );

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);

    expect(buttons[0]).toHaveTextContent("本地中转站 / API 密钥");
    expect(onSelectLocal).toHaveBeenCalledTimes(1);
  });
});
