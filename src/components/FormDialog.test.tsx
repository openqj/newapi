import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FormDialog } from "./FormDialog";

describe("FormDialog", () => {
  it("focuses its close control and closes on Escape", async () => {
    const onClose = vi.fn();
    render(<FormDialog title="Edit key" ariaLabel="Edit key" onClose={onClose}><input aria-label="Name" /></FormDialog>);

    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
