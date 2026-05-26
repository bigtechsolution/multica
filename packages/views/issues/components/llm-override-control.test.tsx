import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const { setIssueMetadataMock, deleteIssueMetadataMock, rerunIssueMock } = vi.hoisted(() => ({
  setIssueMetadataMock: vi.fn(),
  deleteIssueMetadataMock: vi.fn(),
  rerunIssueMock: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    setIssueMetadata: setIssueMetadataMock,
    deleteIssueMetadata: deleteIssueMetadataMock,
    rerunIssue: rerunIssueMock,
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

import { LlmOverrideControl } from "./llm-override-control";

function renderWithQuery(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function mkIssue(metadata: Record<string, string | number | boolean> = {}) {
  return {
    id: "iss-1",
    workspace_id: "ws-1",
    metadata,
    // every other Issue field is unused by the control — cast for brevity.
  } as any;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("LlmOverrideControl", () => {
  it("renders three segments with Default active when no override is set", () => {
    renderWithQuery(<LlmOverrideControl issue={mkIssue()} />);
    const defaultBtn = screen.getByRole("radio", { name: "Default" });
    const local = screen.getByRole("radio", { name: "Force Local" });
    const cloud = screen.getByRole("radio", { name: "Force Cloud" });
    expect(defaultBtn).toHaveAttribute("aria-checked", "true");
    expect(local).toHaveAttribute("aria-checked", "false");
    expect(cloud).toHaveAttribute("aria-checked", "false");
  });

  it("reflects an existing override from issue.metadata.llm_override", () => {
    renderWithQuery(<LlmOverrideControl issue={mkIssue({ llm_override: "cloud" })} />);
    expect(screen.getByRole("radio", { name: "Force Cloud" })).toHaveAttribute("aria-checked", "true");
  });

  it("calls api.setIssueMetadata when picking Force Local", async () => {
    setIssueMetadataMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithQuery(<LlmOverrideControl issue={mkIssue()} />);

    await user.click(screen.getByRole("radio", { name: "Force Local" }));

    await waitFor(() => {
      expect(setIssueMetadataMock).toHaveBeenCalledWith("iss-1", "llm_override", "local");
    });
  });

  it("calls api.deleteIssueMetadata when picking Default from an existing override", async () => {
    deleteIssueMetadataMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithQuery(<LlmOverrideControl issue={mkIssue({ llm_override: "local" })} />);

    await user.click(screen.getByRole("radio", { name: "Default" }));

    await waitFor(() => {
      expect(deleteIssueMetadataMock).toHaveBeenCalledWith("iss-1", "llm_override");
    });
  });

  it("Rerun button calls api.rerunIssue with current override (cloud)", async () => {
    rerunIssueMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithQuery(<LlmOverrideControl issue={mkIssue({ llm_override: "cloud" })} />);

    await user.click(screen.getByRole("button", { name: /Re-run issue with the selected LLM/i }));

    await waitFor(() => {
      expect(rerunIssueMock).toHaveBeenCalledWith("iss-1", { llmOverride: "cloud" });
    });
  });

  it("Rerun maps Default segment to llm_override='clear'", async () => {
    rerunIssueMock.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithQuery(<LlmOverrideControl issue={mkIssue()} />);

    await user.click(screen.getByRole("button", { name: /Re-run issue with the selected LLM/i }));

    await waitFor(() => {
      expect(rerunIssueMock).toHaveBeenCalledWith("iss-1", { llmOverride: "clear" });
    });
  });

  it("optimistically highlights the picked segment before the mutation resolves", async () => {
    // never-resolving promise → mutation stays pending; we expect the local
    // mirror state to still flip the visual immediately.
    setIssueMetadataMock.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderWithQuery(<LlmOverrideControl issue={mkIssue()} />);

    const local = screen.getByRole("radio", { name: "Force Local" });
    await user.click(local);
    await waitFor(() => expect(local).toHaveAttribute("aria-checked", "true"));
  });
});
