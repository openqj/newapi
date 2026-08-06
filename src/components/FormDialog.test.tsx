import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormDialog } from "./FormDialog";

describe("FormDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("focuses its close control and closes on Escape", async () => {
    const onClose = vi.fn();
    render(<FormDialog title="Edit key" ariaLabel="Edit key" onClose={onClose}><input aria-label="Name" /></FormDialog>);

    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("can omit the header for full-window forms", () => {
    render(<FormDialog title="Hidden title" ariaLabel="Full-window form" hideHeader onClose={vi.fn()}><input aria-label="Name" /></FormDialog>);

    expect(screen.getByRole("dialog", { name: "Full-window form" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hidden title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
  });
});
