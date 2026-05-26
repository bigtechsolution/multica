/**
 * Issue template — workspace-scoped fixed bundle of fields the user picks
 * from when creating a new issue. The template prefills title /
 * description / priority / assignee on the create form; the user can edit
 * anything after picking.
 *
 * Scope: workspace (not project) — same template applies to any project.
 */
export interface IssueTemplate {
  id: string;
  workspace_id: string;
  name: string;
  title: string;
  description: string;
  priority: string | null;
  assignee_type: string | null;
  assignee_id: string | null;
  extra: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}
