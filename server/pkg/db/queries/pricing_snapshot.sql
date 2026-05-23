-- name: CreatePricingSnapshot :one
INSERT INTO pricing_snapshot (
    region,
    source,
    captured_at,
    services,
    raw_meta
)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetPricingSnapshot :one
SELECT * FROM pricing_snapshot
WHERE id = $1;

-- name: GetLatestPricingSnapshot :one
-- Most recent snapshot for (region, source). Cost runs call this to pick
-- the snapshot to anchor a new estimate to.
SELECT * FROM pricing_snapshot
WHERE region = $1 AND source = $2
ORDER BY captured_at DESC
LIMIT 1;

-- name: ListPricingSnapshotsForRegion :many
-- Audit / debug: every snapshot for a region, newest first, capped.
SELECT * FROM pricing_snapshot
WHERE region = $1
ORDER BY captured_at DESC
LIMIT $2;
