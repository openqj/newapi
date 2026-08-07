import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, IconButton } from "./Button";
import { List, ListItem } from "./List";

describe("shared UI controls", () => {
  it("uses the shared button variant and defaults to a non-submit button", () => {
    render(<Button variant="primary">Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveClass("ui-button", "button-primary");
    expect(button).toHaveAttribute("type", "button");
  });

  it("provides an accessible shared icon button", () => {
    render(<IconButton label="Close" icon={<span aria-hidden="true">x</span>} />);

    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("icon-button", "ui-button-icon-only");
  });

  it("preserves semantic list elements through the shared list components", () => {
    render(<List as="ol"><ListItem as="li">First item</ListItem></List>);

    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getByRole("listitem").tagName).toBe("LI");
  });
});
