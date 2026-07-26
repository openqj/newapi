import { describe, expect, it } from "vitest";
import { errorMessage, toAppError } from "./errors";

describe("toAppError", () => {
  it("keeps a useful Error message", () => {
    expect(toAppError(new Error("network unavailable")).message).toBe("network unavailable");
  });

  it("uses the caller fallback for unknown failures", () => {
    expect(errorMessage({ status: 500 }, "Try again.")).toBe("Try again.");
  });
});
