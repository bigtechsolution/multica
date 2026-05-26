import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { listTemplatesMock } = vi.hoisted(() => ({
  listTemplatesMock: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({
  api: { listIssueTemplates: listTemplatesMock },
}));

import { TemplatePicker } from "./template-picker";

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

const sample = (id: string, name: string, title = "", priority: string | null = null) => ({
  id,
  workspace_id: "ws-1",
  name,
  title,
  description: "",
  priority,
  assignee_type: null,
  assignee_id: null,
  extra: {},
  created_by: "u-1",
  created_at: "2026-05-26T00:00:00Z",
  updated_at: "2026-05-26T00:00:00Z",
});

describe("TemplatePicker", () => {
  it("renders nothing when there are no templates", async () => {
    listTemplatesMock.mockResolvedValueOnce({ templates: [] });
    const { container } = renderWithQuery(<TemplatePicker onPick={() => undefined} />);
    await waitFor(() => expect(listTemplatesMock).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("renders the trigger when templates exist and lists them on open", async () => {
    listTemplatesMock.mockResolvedValueOnce({
      templates: [sample("t1", "Bug report", "Bug: "), sample("t2", "ADR", "ADR-XXX: ")],
    });
    const user = userEvent.setup();
    renderWithQuery(<TemplatePicker onPick={() => undefined} />);
    const trigger = await screen.findByLabelText("Use issue template");
    await user.click(trigger);
    expect(await screen.findByText("Bug report")).toBeTruthy();
    expect(screen.getByText("ADR")).toBeTruthy();
  });

  it("invokes onPick with the chosen template", async () => {
    const tpl = sample("t1", "Bug report", "Bug: ", "high");
    listTemplatesMock.mockResolvedValueOnce({ templates: [tpl] });
    const onPick = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<TemplatePicker onPick={onPick} />);
    await user.click(await screen.findByLabelText("Use issue template"));
    await user.click(await screen.findByText("Bug report"));
    expect(onPick).toHaveBeenCalledWith(tpl);
  });
});
