import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupRateSelect } from "./GroupRateSelect";

describe("GroupRateSelect", () => {
  afterEach(cleanup);

  it("renders outside its parent and closes when clicking elsewhere", () => {
    render(<><GroupRateSelect value="vip" groups={[{ name: "vip", multiplier: 0.5 }]} onChange={vi.fn()} /><button type="button">Outside</button></>);

    fireEvent.click(screen.getByRole("button", { name: "请选择分组: vip 0.500x" }));
    expect(screen.getByRole("option", { name: "vip 0.500x" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("option", { name: "vip 0.500x" })).not.toBeInTheDocument();
  });

  it("shows a group description in the option without adding an empty subtitle", () => {
    render(<GroupRateSelect value="vip" groups={[{ name: "vip", description: "高速通道", multiplier: 0.5 }, { name: "free", multiplier: 1 }]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "请选择分组: vip 高速通道 0.500x" }));

    expect(screen.getByRole("option", { name: "vip 高速通道 0.500x" })).toHaveTextContent("高速通道");
    expect(screen.getByRole("option", { name: "free 1.000x" }).querySelector("small")).toBeNull();
  });

  it("uses the provider tone for the selected group", () => {
    render(<GroupRateSelect value="Claude-Max" groups={[{ name: "Claude-Max", multiplier: 0.7 }]} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "请选择分组: Claude-Max 0.700x" })).toHaveClass("group-rate-select-tone-orange");
  });

  it("uses a bracketed suffix as a fallback subtitle", () => {
    render(<GroupRateSelect value="【Kiro】有点问题现在只有70缓" groups={[{ name: "【Kiro】有点问题现在只有70缓", multiplier: 0.7 }]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "请选择分组: 【Kiro】 有点问题现在只有70缓 0.700x" }));

    expect(screen.getByRole("option", { name: "【Kiro】 有点问题现在只有70缓 0.700x" })).toHaveTextContent("有点问题现在只有70缓");
  });
});
