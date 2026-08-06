import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupRateSelect } from "./GroupRateSelect";

describe("GroupRateSelect", () => {
  afterEach(cleanup);

  it("renders outside its parent and closes when clicking elsewhere", () => {
    render(<><GroupRateSelect value="vip" groups={[{ name: "vip", multiplier: 0.5 }]} onChange={vi.fn()} /><button type="button">Outside</button></>);

    fireEvent.click(screen.getByRole("button", { name: "请选择分组: vip 0.500x" }));
    expect(screen.getByRole("option", { name: "vip 0.500x 倍率" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("option", { name: "vip 0.500x 倍率" })).not.toBeInTheDocument();
  });

  it("shows the placeholder as an empty trigger when no group is selected", () => {
    render(<GroupRateSelect value="" groups={[{ name: "vip", multiplier: 0.5 }]} onChange={vi.fn()} allowEmpty />);

    const trigger = screen.getByRole("button", { name: /选择分组/ });
    expect(trigger).toHaveClass("group-rate-select-trigger-empty");
    expect(trigger).toHaveTextContent(/选择分组/);
    expect(trigger.querySelector("strong")).toBeNull();
  });

  it("keeps the group title visible in the trigger and option", () => {
    render(<GroupRateSelect value="临时超低价cc-kiro" groups={[{ name: "临时超低价cc-kiro", description: "限时福利", multiplier: 0.03 }]} onChange={vi.fn()} showSelectionLabel />);

    const trigger = screen.getByRole("button", { name: "请选择分组: 临时超低价cc-kiro 限时福利 0.030x" });
    expect(trigger).toHaveTextContent("临时超低价cc-kiro");

    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "临时超低价cc-kiro 限时福利 0.030x 倍率" })).toHaveTextContent("临时超低价cc-kiro");
  });

  it("keeps the combined up-down icon on the group trigger", () => {
    render(<GroupRateSelect value="vip" groups={[{ name: "vip", multiplier: 0.5 }]} onChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "请选择分组: vip 0.500x" });
    expect(trigger.querySelector(".lucide-chevrons-up-down")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.querySelector(".lucide-chevrons-up-down")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.querySelector(".lucide-chevrons-up-down")).toBeInTheDocument();
  });

  it("shows a group description in the option without adding an empty subtitle", () => {
    render(<GroupRateSelect value="vip" groups={[{ name: "vip", description: "高速通道", multiplier: 0.5 }, { name: "free", multiplier: 1 }]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "请选择分组: vip 高速通道 0.500x" }));

    expect(screen.getByRole("option", { name: "vip 高速通道 0.500x 倍率" })).toHaveTextContent("高速通道");
    expect(screen.getByRole("option", { name: "free 1.000x 倍率" }).querySelector("small")).toBeNull();
    expect(screen.getByRole("option", { name: /vip/ }).querySelector(".group-rate-select-option-check")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /free/ }).querySelector(".group-rate-select-option-check")).toBeNull();
  });

  it("keeps the search icon inside the input", () => {
    render(<GroupRateSelect value="vip" groups={[{ name: "vip", multiplier: 0.5 }]} onChange={vi.fn()} searchable />);

    fireEvent.click(screen.getByRole("button"));

    const searchInput = screen.getByRole("textbox");
    expect(searchInput.parentElement).toHaveClass("group-rate-select-search");
    expect(searchInput.parentElement?.querySelector("svg")).toBeInTheDocument();
  });

  it("uses the provider tone for the selected group", () => {
    render(<GroupRateSelect value="Claude-Max" groups={[{ name: "Claude-Max", multiplier: 0.7 }]} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "请选择分组: Claude-Max 0.700x" })).toHaveClass("group-rate-select-tone-orange");
  });

  it("uses a bracketed suffix as a fallback subtitle", () => {
    render(<GroupRateSelect value="【Kiro】有点问题现在只有70缓" groups={[{ name: "【Kiro】有点问题现在只有70缓", multiplier: 0.7 }]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "请选择分组: 【Kiro】 有点问题现在只有70缓 0.700x" }));

    expect(screen.getByRole("option", { name: "【Kiro】 有点问题现在只有70缓 0.700x 倍率" })).toHaveTextContent("有点问题现在只有70缓");
  });
});
