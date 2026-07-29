import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationProvider, ToastProvider, useConfirm, useToast } from "./Feedback";

function ConfirmationProbe({ onResult }: { onResult: (value: boolean) => void }) {
  const confirm = useConfirm();
  return <button type="button" onClick={() => void confirm({ description: "This action cannot be undone" }).then(onResult)}>Delete</button>;
}

function ToastProbe() {
  const { notify } = useToast();
  return <button type="button" onClick={() => notify("Save failed", "error")}>Save</button>;
}

function InitialFocusProbe() {
  const confirm = useConfirm();
  useEffect(() => { void confirm({ title: "Confirm action", description: "Continue?" }); }, [confirm]);
  return null;
}

describe("shared feedback", () => {
  it("cancels confirmation with Escape and resolves false", async () => {
    const onResult = vi.fn();
    render(<ConfirmationProvider><ConfirmationProbe onResult={onResult} /></ConfirmationProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("moves focus to the dialog close action", () => {
    render(<ConfirmationProvider><InitialFocusProbe /></ConfirmationProvider>);

    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  });

  it("renders a dismissible error toast", async () => {
    render(<ToastProvider><ToastProbe /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Save failed")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));

    expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
  });

  it("shows an active error toast only once", () => {
    const { container } = render(<ToastProvider><ToastProbe /></ToastProvider>);

    const button = within(container).getByRole("button", { name: "Save" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.getAllByText("Save failed")).toHaveLength(1);
  });
});
