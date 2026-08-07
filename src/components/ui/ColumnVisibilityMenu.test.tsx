import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColumnVisibilityMenu } from "./ColumnVisibilityMenu";

describe("ColumnVisibilityMenu", () => {
  afterEach(() => cleanup());

  it("opens, toggles a column, and closes on outside interaction", () => {
    const onOpenChange = vi.fn();
    const onToggle = vi.fn();
    render(
      <ColumnVisibilityMenu
        columns={[{ key: "name", label: "Name" }, { key: "status", label: "Status" }]}
        visible={{ name: true, status: false }}
        open={false}
        onOpenChange={onOpenChange}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "列设置" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("renders the shared menu when open and forwards column changes", () => {
    const onOpenChange = vi.fn();
    const onToggle = vi.fn();
    render(
      <ColumnVisibilityMenu
        columns={[{ key: "name", label: "Name" }, { key: "status", label: "Status" }]}
        visible={{ name: true, status: false }}
        open
        onOpenChange={onOpenChange}
        onToggle={onToggle}
      />,
    );

    const menu = screen.getByRole("menu", { name: "列设置" });
    expect(menu).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Status" }));
    expect(onToggle).toHaveBeenCalledWith("status");
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
