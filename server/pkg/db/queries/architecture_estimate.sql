-- name: CreateArchitectureEstimate :one
INSERT INTO architecture_estimate (
    workspace_id,
    issue_id,
    spec_hash,
    spec_path,
    pricing_snapshot_id,
    region,
    monthly_usd,
    yearly_usd,
    breakdown,
    cost_md
)
VALUES (
    $1,
    sqlc.narg(issue_id)::uuid,
    $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: GetArchitectureEstimate :one
SELECT * FROM architecture_estimate
WHERE id = $1 AND workspace_id = $2;

-- name: ListArchitectureEstimatesForWorkspace :many
-- Cost trend view (Stage J): every estimate in the workspace, newest first.
-- $2/$3 are limit/offset for the paginated grid.
SELECT * FROM architecture_estimate
WHERE workspace_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountArchitectureEstimatesForWorkspace :one
-- Total count for the cost trend view header / X-Total-Count pagination.
SELECT count(*) FROM architecture_estimate
WHERE workspace_id = $1;

-- name: ListArchitectureEstimatesForIssue :many
-- Issue detail view: cost history attached to a spec-change issue,
-- newest first.
SELECT * FROM architecture_estimate
WHERE issue_id = $1 AND workspace_id = $2
ORDER BY created_at DESC
LIMIT $3;

-- name: GetLatestArchitectureEstimateBySpecHash :one
-- Dedup probe: "do we already have an estimate for this exact spec content
-- in this workspace against the same snapshot?" Used by the spec-changed
-- handler to skip recomputation when nothing relevant has changed.
SELECT * FROM architecture_estimate
WHERE workspace_id = $1
  AND spec_hash = $2
  AND pricing_snapshot_id = $3
ORDER BY created_at DESC
LIMIT 1;
