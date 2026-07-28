import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";

describe("DataTable", () => {
  afterEach(cleanup);

  it("renders the standard slots around the desktop and mobile representations", () => {
    render(<DataTable ariaLabel="Keys" header={<span>3 keys</span>} desktop={<table><tbody><tr><td>Desktop key</td></tr></tbody></table>} mobile={<div>Mobile key</div>} footer={<button type="button">Next page</button>} />);

    expect(screen.getByLabelText("Keys")).toHaveClass("data-table");
    expect(screen.getByText("3 keys")).toBeVisible();
    expect(screen.getByText("Desktop key")).toBeVisible();
    expect(screen.getByText("Mobile key")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next page" })).toBeVisible();
  });

  it("uses the common empty slot without rendering stale responsive content", () => {
    render(<DataTable isEmpty empty={<p>No keys</p>} desktop={<p>Desktop key</p>} mobile={<p>Mobile key</p>} />);

    expect(screen.getByText("No keys")).toBeVisible();
    expect(screen.queryByText("Desktop key")).not.toBeInTheDocument();
    expect(screen.queryByText("Mobile key")).not.toBeInTheDocument();
  });
});
