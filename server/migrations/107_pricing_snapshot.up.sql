-- AWS pricing snapshots — a cache of public AWS Price List data captured
-- at a point in time. Used by the aws-spec-to-cost and aws-spec-to-bom
-- skills (referenced via architecture_estimate.pricing_snapshot_id) so
-- that an estimate's price can be reproduced months later regardless of
-- subsequent AWS price changes.
--
-- Snapshots are GLOBAL (no workspace_id) because AWS public prices are
-- the same for every workspace and we don't want N workspaces refetching
-- the same offer files. Per-workspace pricing overrides (EDP discounts,
-- private pricing) belong in workspace.settings, not here.

CREATE TABLE pricing_snapshot (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    region        TEXT        NOT NULL,
    source        TEXT        NOT NULL,
    captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- {service_code: {sku: {unit, currency, price_per_unit, ...}}}
    -- Also holds RI rows under a parallel key when the refresh job was
    -- run with --ri (database services only).
    services      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- Offer-file etag, version, byte count — for cache-validation on
    -- the next refresh without parsing the full payload.
    raw_meta      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pricing_snapshot_services_is_object
        CHECK (jsonb_typeof(services) = 'object'),
    CONSTRAINT pricing_snapshot_raw_meta_is_object
        CHECK (jsonb_typeof(raw_meta) = 'object'),
    -- A given (region, source) pair is captured at one instant — re-running
    -- the refresh in the same second is a no-op rather than a duplicate row.
    UNIQUE (region, source, captured_at)
);

-- "Latest snapshot for region X" is the dominant read pattern (cost runs
-- pick the most recent matching snapshot); order DESC so the planner can
-- LIMIT 1 off the index.
CREATE INDEX idx_pricing_snapshot_region_captured
    ON pricing_snapshot(region, captured_at DESC);
