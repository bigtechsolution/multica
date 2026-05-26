"use client";

import { useMemo } from "react";
import type { Issue } from "@multica/core/types";
import { IssueTreeNode, type IssueTreeNodeData } from "./issue-tree-node";

/**
 * Project-scope tree view. Renders the supplied issue list as a hierarchy
 * grouped by parent_issue_id. Issues whose parent is outside the supplied
 * set (or null) become roots — so an issue with a parent in a different
 * project (or no parent at all) shows at the top level. This keeps the
 * tree complete for the project even when some parents are cross-cutting.
 *
 * Pure client-side assembly — no fetch. Operates on whatever filtered set
 * the caller passes (post-status / priority / assignee filters), so a
 * tree of "Done issues only" or "High-priority issues only" works without
 * code changes.
 */
export function TreeView({ issues }: { issues: Issue[] }) {
  const roots = useMemo(() => buildProjectTree(issues), [issues]);
  if (roots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-sm text-muted-foreground">
        No issues to display.
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4">
        <div className="overflow-hidden rounded-lg border bg-card/30">
          {roots.map((root) => (
            <IssueTreeNode key={root.issue.id} node={root} defaultExpanded />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Group issues by parent_issue_id. Root = parent absent OR pointing
 * outside the supplied set. Children attach to their parent's node.
 *
 * Order: parents in original input order; children sorted by position
 * then created_at to match the SQL CTE used by the issue-detail tree.
 */
function buildProjectTree(issues: Issue[]): IssueTreeNodeData[] {
  const byId = new Map<string, Issue>();
  for (const issue of issues) byId.set(issue.id, issue);

  const nodeById = new Map<string, IssueTreeNodeData>();
  for (const issue of issues) {
    nodeById.set(issue.id, { issue, depth: 0, children: [] });
  }

  const roots: IssueTreeNodeData[] = [];
  for (const issue of issues) {
    const node = nodeById.get(issue.id)!;
    const parentId = issue.parent_issue_id;
    if (parentId && byId.has(parentId)) {
      const parent = nodeById.get(parentId)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Apply depth to each node post-attachment so nested children render
  // with their visual indent. BFS keeps each node's depth one greater
  // than its parent.
  const queue: IssueTreeNodeData[] = roots.map((r) => {
    r.depth = 0;
    return r;
  });
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const child of node.children) {
      child.depth = node.depth + 1;
      queue.push(child);
    }
    // Stable child ordering: position then created_at.
    node.children.sort((a, b) => {
      const pa = a.issue.position ?? 0;
      const pb = b.issue.position ?? 0;
      if (pa !== pb) return pa - pb;
      return a.issue.created_at.localeCompare(b.issue.created_at);
    });
  }

  return roots;
}
