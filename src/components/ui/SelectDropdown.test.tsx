import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectDropdown } from "./SelectDropdown";

const options = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
  { value: "gamma", label: "Gamma" },
];

describe("SelectDropdown", () => {
  afterEach(cleanup);

  it("selects an option and shows the selected indicator", () => {
    const onChange = vi.fn();
    render(<SelectDropdown value="alpha" options={options} onChange={onChange} ariaLabel="Filter" />);

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByRole("option", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Alpha" }).querySelector(".ui-select-dropdown-check")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("beta");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports keyboard navigation and search", () => {
    const onChange = vi.fn();
    render(<SelectDropdown value="alpha" options={options} onChange={onChange} ariaLabel="Filter" searchable />);
    const trigger = screen.getByRole("button", { name: "Filter" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("beta");

    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "gam" } });
    expect(screen.getByRole("option", { name: "Gamma" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Alpha" })).not.toBeInTheDocument();
  });

  it("closes when the pointer moves outside the trigger and menu", () => {
    render(<><SelectDropdown value="alpha" options={options} onChange={vi.fn()} ariaLabel="Filter" /><button type="button">Outside</button></>);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
