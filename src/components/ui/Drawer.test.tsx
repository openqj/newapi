import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "./Drawer";

describe("Drawer", () => {
  afterEach(() => {
    cleanup();
  });

  it("provides dialog semantics and closes from the shared controls", () => {
    const onClose = vi.fn();
    render(<Drawer title="Details" description="Description" ariaLabel="Details panel" onClose={onClose}>Content</Drawer>);

    const dialog = screen.getByRole("dialog", { name: "Details" });
    expect(dialog).toHaveAttribute("aria-label", "Details panel");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("keeps custom header content while retaining the shared close action", () => {
    render(<Drawer header={<h2>Custom header</h2>} ariaLabel="Custom panel" onClose={vi.fn()}>Content</Drawer>);

    expect(screen.getByRole("heading", { name: "Custom header" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });
});
