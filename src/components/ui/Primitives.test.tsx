import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { EmptyState, FormField, PageHeader, StatusBadge, TextareaField, TextField } from "./Primitives";

describe("shared UI primitives", () => {
  it("renders a labelled invalid form field", () => {
    render(<FormField label="API key" required error="Required"><TextField value="" onChange={() => undefined} error /></FormField>);
    expect(screen.getByText("API key")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("forwards shared field refs and classes", () => {
    const inputRef = createRef<HTMLInputElement>();
    const textareaRef = createRef<HTMLTextAreaElement>();

    render(<><TextField ref={inputRef} className="custom-input" aria-label="Name" /><TextareaField ref={textareaRef} className="custom-textarea" aria-label="Notes" error /></>);

    expect(inputRef.current).toHaveClass("input", "custom-input");
    expect(textareaRef.current).toHaveClass("input", "custom-textarea");
    expect(textareaRef.current).toHaveAttribute("aria-invalid", "true");
  });

  it("renders consistent page feedback", () => {
    render(<><PageHeader title="Keys" description="Manage access keys" /><StatusBadge status="online">Online</StatusBadge><EmptyState title="No keys" /></>);
    expect(screen.getByRole("heading", { name: "Keys" })).toBeInTheDocument();
    expect(screen.getByText("Online")).toHaveClass("online");
    expect(screen.getByText("No keys")).toBeInTheDocument();
  });
});
