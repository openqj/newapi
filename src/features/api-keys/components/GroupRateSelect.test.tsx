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
});
