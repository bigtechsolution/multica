-- name: ListIssueTemplates :many
-- Workspace-scoped, newest first (matches the picker's expected order).
SELECT * FROM issue_template
WHERE workspace_id = $1
ORDER BY created_at DESC;

-- name: GetIssueTemplate :one
SELECT * FROM issue_template
WHERE id = $1 AND workspace_id = $2;

-- name: CreateIssueTemplate :one
INSERT INTO issue_template (
    workspace_id, name, title, description, priority,
    assignee_type, assignee_id, extra, created_by
) VALUES (
    $1, $2, $3, $4, sqlc.narg('priority'),
    sqlc.narg('assignee_type'), sqlc.narg('assignee_id'),
    COALESCE(sqlc.narg('extra')::jsonb, '{}'::jsonb), $5
)
RETURNING *;

-- name: DeleteIssueTemplate :exec
DELETE FROM issue_template
WHERE id = $1 AND workspace_id = $2;
