import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupRateSelect } from "./GroupRateSelect";

describe("GroupRateSelect", () => {
  it("renders outside its parent and closes when clicking elsewhere", () => {
    render(<><GroupRateSelect value="vip" groups={[{ name: "vip", multiplier: 0.5 }]} onChange={vi.fn()} /><button type="button">Outside</button></>);

    fireEvent.click(screen.getByRole("button", { name: "请选择分组: vip 0.500x" }));
    expect(screen.getByRole("option", { name: "vip 0.500x" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("option", { name: "vip 0.500x" })).not.toBeInTheDocument();
  });
});
