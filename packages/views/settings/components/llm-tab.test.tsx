import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSettings from "../../locales/en/settings.json";

const mockUpdateWorkspace = vi.hoisted(() => vi.fn());
const workspaceRef = vi.hoisted(() => ({
  current: {
    id: "workspace-1",
    name: "Test Workspace",
    slug: "test-workspace",
    description: "",
    context: "",
    issue_prefix: "TES",
    repos: [] as { url: string }[],
    settings: {} as Record<string, unknown>,
  },
}));
const membersRef = vi.hoisted(() => ({
  current: [
    { user_id: "user-1", role: "owner" as "owner" | "admin" | "member" },
  ],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: membersRef.current, isFetched: true }),
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    getQueryData: vi.fn(() => []),
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => workspaceRef.current,
}));

vi.mock("@multica/core/workspace/queries", () => ({
  memberListOptions: () => ({ queryKey: ["members"], queryFn: vi.fn() }),
  workspaceKeys: { list: () => ["workspaces"] },
}));

vi.mock("@multica/core/api", () => ({
  api: { updateWorkspace: mockUpdateWorkspace },
}));

vi.mock("@multica/core/auth", () => {
  const useAuthStore = Object.assign(
    (sel?: (s: { user: { id: string } }) => unknown) =>
      sel ? sel({ user: { id: "user-1" } }) : { user: { id: "user-1" } },
    { getState: () => ({ user: { id: "user-1" } }) },
  );
  return { useAuthStore };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { LlmTab } from "./llm-tab";

const TEST_RESOURCES = {
  en: { common: enCommon, settings: enSettings },
};

function wrap(children: ReactNode) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  workspaceRef.current = {
    id: "workspace-1",
    name: "Test Workspace",
    slug: "test-workspace",
    description: "",
    context: "",
    issue_prefix: "TES",
    repos: [],
    settings: {},
  };
  membersRef.current = [{ user_id: "user-1", role: "owner" }];
});

describe("LlmTab", () => {
  it("renders the three policy options with hybrid selected by default when settings empty", () => {
    render(wrap(<LlmTab />));
    const hybrid = screen.getByRole("radio", { name: /Hybrid \(default\)/ });
    expect(hybrid).toBeChecked();
    expect(screen.getByRole("radio", { name: /Local only/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Cloud first/ })).not.toBeChecked();
  });

  it("reflects existing settings on mount", () => {
    workspaceRef.current.settings = {
      llm_policy: "local_only",
      redact_before_external: false,
      external_provider: "claude",
      external_monthly_budget_usd: 500,
    };
    render(wrap(<LlmTab />));
    expect(screen.getByRole("radio", { name: /Local only/ })).toBeChecked();
    expect(screen.getByLabelText(/Preferred external provider/)).toHaveValue("claude");
    expect(screen.getByLabelText(/External monthly budget/)).toHaveValue(500);
  });

  it("hides the save button and disables inputs for non-owners", () => {
    membersRef.current = [{ user_id: "user-1", role: "member" }];
    render(wrap(<LlmTab />));
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
    expect(screen.getByLabelText(/Preferred external provider/)).toBeDisabled();
    expect(screen.getByText(/Only workspace owners can change these settings/)).toBeTruthy();
  });

  it("disables Save when nothing has changed", () => {
    render(wrap(<LlmTab />));
    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeDisabled();
  });

  it("calls updateWorkspace with merged settings preserving unknown keys", async () => {
    workspaceRef.current.settings = {
      tfstate_bucket: "acme-tfstate",
      llm_policy: "hybrid",
    };
    mockUpdateWorkspace.mockResolvedValue({
      ...workspaceRef.current,
      settings: {
        ...workspaceRef.current.settings,
        llm_policy: "local_only",
        redact_before_external: true,
      },
    });

    const user = userEvent.setup();
    render(wrap(<LlmTab />));

    await user.click(screen.getByRole("radio", { name: /Local only/ }));
    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => {
      expect(mockUpdateWorkspace).toHaveBeenCalledTimes(1);
    });
    const [, body] = mockUpdateWorkspace.mock.calls[0]!;
    expect(body.settings).toMatchObject({
      tfstate_bucket: "acme-tfstate", // preserved unknown key
      llm_policy: "local_only",
      redact_before_external: true,
    });
  });

  it("rejects a negative budget and blocks Save", async () => {
    const user = userEvent.setup();
    render(wrap(<LlmTab />));

    const budget = screen.getByLabelText(/External monthly budget/);
    await user.type(budget, "-50");

    expect(screen.getByText(/non-negative number/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
  });
});
