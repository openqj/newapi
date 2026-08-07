import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

describe("Switch", () => {
  afterEach(() => cleanup());

  it("exposes switch semantics and reports the next value", () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Remote sync" checked={false} onCheckedChange={onCheckedChange} />);

    const control = screen.getByRole("switch", { name: "Remote sync" });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveAttribute("data-state", "unchecked");

    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("does not report changes while disabled", () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Remote sync" checked onCheckedChange={onCheckedChange} disabled />);

    fireEvent.click(screen.getByRole("switch", { name: "Remote sync" }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
