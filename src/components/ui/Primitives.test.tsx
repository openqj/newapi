import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState, FormField, PageHeader, StatusBadge, TextField } from "./Primitives";

describe("shared UI primitives", () => {
  it("renders a labelled invalid form field", () => {
    render(<FormField label="API key" required error="Required"><TextField value="" onChange={() => undefined} error /></FormField>);
    expect(screen.getByText("API key")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("renders consistent page feedback", () => {
    render(<><PageHeader title="Keys" description="Manage access keys" /><StatusBadge status="online">Online</StatusBadge><EmptyState title="No keys" /></>);
    expect(screen.getByRole("heading", { name: "Keys" })).toBeInTheDocument();
    expect(screen.getByText("Online")).toHaveClass("online");
    expect(screen.getByText("No keys")).toBeInTheDocument();
  });
});
