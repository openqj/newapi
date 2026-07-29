import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOutsideDismiss } from "./useOutsideDismiss";

function TestMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(menuRef, open, () => setOpen(false));
  return <><button onClick={() => setOpen(true)}>打开</button>{open && <div ref={menuRef}>菜单内容</div>}<button>外部</button></>;
}

describe("useOutsideDismiss", () => {
  it("keeps menu interactions open and dismisses it on outside pointer or Escape", () => {
    render(<TestMenu />);

    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    fireEvent.pointerDown(screen.getByText("菜单内容"));
    expect(screen.getByText("菜单内容")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "外部" }));
    expect(screen.queryByText("菜单内容")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("菜单内容")).not.toBeInTheDocument();
  });
});
