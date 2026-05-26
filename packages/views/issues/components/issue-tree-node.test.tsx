import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@multica/core/api", () => ({ api: {} }));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({ issueDetail: (id: string) => `/ws/issue/${id}` }),
}));
vi.mock("../../navigation", () => ({
  AppLink: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => <div data-testid="actor-avatar" />,
}));
vi.mock(".", () => ({
  StatusIcon: ({ status }: { status: string }) => <span data-testid="status-icon">{status}</span>,
  StatusPicker: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
  AssigneePicker: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@multica/core/issues/mutations", () => ({
  useUpdateIssue: () => ({ mutate: vi.fn() }),
}));

import { IssueTreeNode, assembleIssueTree, type IssueTreeNodeData } from "./issue-tree-node";

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mkIssue(id: string, title: string, status = "todo") {
  return {
    id,
    workspace_id: "ws-1",
    title,
    description: null,
    status,
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "user",
    creator_id: "u-1",
    parent_issue_id: null,
    project_id: null,
    position: 0,
    start_date: null,
    due_date: null,
    created_at: "2026-05-26T00:00:00Z",
    updated_at: "2026-05-26T00:00:00Z",
    number: 1,
    identifier: "MUL-1",
    metadata: {},
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("IssueTreeNode", () => {
  it("renders a leaf without a disclosure chevron", () => {
    const node: IssueTreeNodeData = { issue: mkIssue("1", "Leaf"), depth: 0, children: [] };
    render(wrap(<IssueTreeNode node={node} />));
    expect(screen.getByText("Leaf")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Expand|Collapse/ })).toBeNull();
  });

  it("renders disclosure chevron when children exist and expands by default", () => {
    const node: IssueTreeNodeData = {
      issue: mkIssue("1", "Root"),
      depth: 0,
      children: [{ issue: mkIssue("2", "Child"), depth: 1, children: [] }],
    };
    render(wrap(<IssueTreeNode node={node} />));
    expect(screen.getByText("Child")).toBeTruthy();
    const btn = screen.getByRole("button", { name: /Collapse/ });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses children on chevron click", async () => {
    const user = userEvent.setup();
    const node: IssueTreeNodeData = {
      issue: mkIssue("1", "Root"),
      depth: 0,
      children: [{ issue: mkIssue("2", "Child"), depth: 1, children: [] }],
    };
    render(wrap(<IssueTreeNode node={node} />));
    expect(screen.getByText("Child")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Collapse/ }));
    expect(screen.queryByText("Child")).toBeNull();
  });

  it("shows done/total counter when node has children", () => {
    const node: IssueTreeNodeData = {
      issue: mkIssue("1", "Root"),
      depth: 0,
      children: [
        { issue: mkIssue("2", "Done child", "done"), depth: 1, children: [] },
        { issue: mkIssue("3", "Open child", "todo"), depth: 1, children: [] },
      ],
    };
    render(wrap(<IssueTreeNode node={node} />));
    // Counter is "done/total" — root + 2 children = 3 total; 1 done.
    expect(screen.getByText("1/3")).toBeTruthy();
  });
});

describe("assembleIssueTree", () => {
  it("builds a single-level tree from descendants", () => {
    const root = mkIssue("root", "Root");
    const tree = assembleIssueTree(root, [mkIssue("c1", "Child 1"), mkIssue("c2", "Child 2")], [1, 1]);
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]!.issue.title).toBe("Child 1");
  });

  it("nests grandchildren under the right parent based on depth", () => {
    const root = mkIssue("root", "Root");
    const tree = assembleIssueTree(
      root,
      [mkIssue("c1", "Child 1"), mkIssue("gc1", "Grandchild"), mkIssue("c2", "Child 2")],
      [1, 2, 1],
    );
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]!.issue.title).toBe("Child 1");
    expect(tree.children[0]!.children).toHaveLength(1);
    expect(tree.children[0]!.children[0]!.issue.title).toBe("Grandchild");
    expect(tree.children[1]!.issue.title).toBe("Child 2");
    expect(tree.children[1]!.children).toHaveLength(0);
  });

  it("returns root only when descendants is empty", () => {
    const root = mkIssue("root", "Root");
    const tree = assembleIssueTree(root, [], []);
    expect(tree.children).toHaveLength(0);
  });
});
