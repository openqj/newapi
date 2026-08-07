import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pagination } from "./Pagination";

describe("Pagination", () => {
  afterEach(() => cleanup());

  it("renders accessible navigation and reports page changes", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} pageCount={3} onPageChange={onPageChange} ariaLabel="记录分页" />);

    expect(screen.getByRole("navigation", { name: "记录分页" })).toBeInTheDocument();
    expect(screen.getByText("第 2 / 3 页")).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
  });

  it("disables the boundary controls and hides for a single page", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pageCount={2} onPageChange={onPageChange} />);
    const navigation = screen.getByRole("navigation");

    expect(within(navigation).getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(within(navigation).getByRole("button", { name: "下一页" })).not.toBeDisabled();

    rerender(<Pagination page={1} pageCount={1} onPageChange={onPageChange} />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
