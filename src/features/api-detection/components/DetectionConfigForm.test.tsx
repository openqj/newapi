import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetectionConfigForm } from "./DetectionConfigForm";

const defaults = {
  keyRows: [], savedKeyId: "", endpoint: "", apiKey: "", showKey: false,
  selectedSavedKey: undefined, availableModels: ["gpt-5.5"], selectedModels: ["gpt-5.5"],
  discoveryFromCache: false, discoveryRunning: false, running: false,
  onSubmit: vi.fn(), onSavedKeyChange: vi.fn(), onEndpointChange: vi.fn(), onApiKeyChange: vi.fn(),
  onShowKeyChange: vi.fn(), onRefreshModels: vi.fn(), onToggleModel: vi.fn(),
};

describe("DetectionConfigForm", () => {
  it("forwards temporary credential input and model selection", () => {
    render(<DetectionConfigForm {...defaults} />);

    fireEvent.change(screen.getByPlaceholderText("https://api.anthropic.com"), { target: { value: "https://example.test" } });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("listitem"));

    expect(defaults.onEndpointChange).toHaveBeenCalledWith("https://example.test");
    expect(defaults.onApiKeyChange).toHaveBeenCalledWith("sk-test");
    expect(defaults.onToggleModel).toHaveBeenCalledWith("gpt-5.5");
  });
});
