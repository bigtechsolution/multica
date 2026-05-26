"use client";

import { useCallback, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useUpdateIssue } from "@multica/core/issues/mutations";
import type { Issue, UpdateIssueRequest } from "@multica/core/types";
import { toast } from "sonner";
import { cn } from "@multica/ui/lib/utils";
import { AppLink } from "../../navigation";
import { useWorkspacePaths } from "@multica/core/paths";
import { useT } from "../../i18n";
import { StatusPicker, StatusIcon, AssigneePicker } from ".";
import { ActorAvatar } from "../../common/actor-avatar";

/**
 * A node in the issue hierarchy tree (Phase A item 1).
 *
 * Each node renders one issue row at its depth-indented position plus a
 * disclosure chevron when it has children. Children are passed in
 * pre-grouped by the caller (see assembleIssueTree below) so this
 * component stays a pure renderer — no fetching, no recursion control
 * beyond expand state.
 *
 * The visual shape mirrors SubIssueRow in issue-detail.tsx (status icon
 * + identifier + title + assignee) so users moving between the flat
 * legacy view and the tree view see consistent rows.
 *
 * Depth → indent: 12px per level + 8px base, matching skills/file-tree.tsx
 * so trees across the app align visually if displayed side-by-side.
 */
export interface IssueTreeNodeData {
  issue: Issue;
  depth: number;
  children: IssueTreeNodeData[];
}

interface IssueTreeNodeProps {
  node: IssueTreeNodeData;
  defaultExpanded?: boolean;
}

const INDENT_PER_DEPTH = 12;
const BASE_INDENT = 8;

export function IssueTreeNode({ node, defaultExpanded = true }: IssueTreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { t } = useT("issues");
  const paths = useWorkspacePaths();
  const updateIssue = useUpdateIssue();
  const hasChildren = node.children.length > 0;
  const isDone = node.issue.status === "done" || node.issue.status === "cancelled";

  const handleUpdate = useCallback(
    (updates: Partial<UpdateIssueRequest>) => {
      updateIssue.mutate(
        { id: node.issue.id, ...updates },
        {
          onError: (err) =>
            toast.error(
              err instanceof Error && err.message
                ? err.message
                : t(($) => $.detail.update_failed),
            ),
        },
      );
    },
    [node.issue.id, updateIssue, t],
  );

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center gap-2 px-2 py-1.5 hover:bg-accent/50 transition-colors group/row"
        style={{ paddingLeft: `${node.depth * INDENT_PER_DEPTH + BASE_INDENT}px` }}
      >
        {/* Disclosure chevron — invisible spacer for leaves so columns
            stay aligned across the tree. */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
            aria-expanded={expanded}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-accent/70"
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 stroke-[2.5] text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <StatusPicker
          status={node.issue.status}
          onUpdate={handleUpdate}
          align="start"
          trigger={
            <StatusIcon
              status={node.issue.status}
              className="h-[15px] w-[15px] shrink-0"
            />
          }
        />
        <AppLink
          href={paths.issueDetail(node.issue.id)}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <span className="text-[11px] text-muted-foreground tabular-nums font-medium shrink-0">
            {node.issue.identifier}
          </span>
          <span
            className={cn(
              "text-sm truncate flex-1",
              isDone ? "text-muted-foreground line-through" : "group-hover/row:text-foreground",
            )}
          >
            {node.issue.title}
          </span>
          {hasChildren && (
            <span className="text-[10px] text-muted-foreground/70 tabular-nums shrink-0 px-1">
              {countDoneRecursive(node)}/{countTotalRecursive(node)}
            </span>
          )}
        </AppLink>
        <AssigneePicker
          assigneeType={node.issue.assignee_type}
          assigneeId={node.issue.assignee_id}
          onUpdate={handleUpdate}
          align="end"
          trigger={
            node.issue.assignee_type && node.issue.assignee_id ? (
              <ActorAvatar
                actorType={node.issue.assignee_type}
                actorId={node.issue.assignee_id}
                size={20}
                className="shrink-0"
              />
            ) : (
              <span className="h-5 w-5 shrink-0 rounded-full border border-dashed border-border" />
            )
          }
        />
      </div>
      {expanded && hasChildren && (
        <div className="flex flex-col">
          {node.children.map((child) => (
            <IssueTreeNode
              key={child.issue.id}
              node={child}
              defaultExpanded={defaultExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function countTotalRecursive(node: IssueTreeNodeData): number {
  return 1 + node.children.reduce((sum, c) => sum + countTotalRecursive(c), 0);
}

function countDoneRecursive(node: IssueTreeNodeData): number {
  const self =
    node.issue.status === "done" || node.issue.status === "cancelled" ? 1 : 0;
  return self + node.children.reduce((sum, c) => sum + countDoneRecursive(c), 0);
}

/**
 * Build a depth-grouped tree from the descendants endpoint's parallel
 * arrays. Stable on ill-formed input: orphans (depth > root and no parent
 * in the flat list) attach to the nearest preceding row at depth-1, which
 * happens to match the SQL CTE's natural ordering.
 */
export function assembleIssueTree(
  rootIssue: Issue,
  descendants: Issue[],
  depths: number[],
): IssueTreeNodeData {
  const root: IssueTreeNodeData = { issue: rootIssue, depth: 0, children: [] };
  // Stack of last-seen node at each depth so we can attach the next row
  // as a child of the matching parent without doing a parent_id lookup.
  // The CTE already orders rows so a depth-N row's parent is the most
  // recently visited node at depth N-1.
  const stack: IssueTreeNodeData[] = [root];

  for (let i = 0; i < descendants.length; i++) {
    const issue = descendants[i];
    const depth = depths[i] ?? stack.length; // fail-safe
    if (!issue) continue;
    // Trim stack so its top is the parent (depth - 1).
    while (stack.length > depth) stack.pop();
    const parent = stack[stack.length - 1] ?? root;
    const node: IssueTreeNodeData = { issue, depth, children: [] };
    parent.children.push(node);
    stack.push(node);
  }

  return root;
}
