-- Per-spec cost estimate produced by the aws-spec-to-cost / aws-spec-to-bom
-- skills. Every estimate is anchored to a pricing_snapshot so the number is
-- reproducible — a later price refresh creates a NEW estimate row, the old
-- one stays valid against its own snapshot. This powers the cost trend
-- view (Stage J) and the "delta on spec edit" PR comment.
--
-- The link to issue is optional: in the spec-changed pipeline (Stage G) we
-- create a dedicated cost-analyst issue and write the estimate against it;
-- ad-hoc estimates (CLI dry-runs, manual `multica estimate` invocations)
-- may have no owning issue.

CREATE TABLE architecture_estimate (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id         UUID         NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    issue_id             UUID         REFERENCES issue(id) ON DELETE SET NULL,
    -- sha256 of the normalized architecture.yaml that produced this estimate.
    -- Lets us short-circuit recomputation when the same spec is re-evaluated
    -- against the same snapshot.
    spec_hash            TEXT         NOT NULL,
    -- Repo-relative path of the spec file (e.g. 'infra/architecture.yaml').
    -- Stored for traceability in the trend view; not used as a key.
    spec_path            TEXT         NOT NULL,
    -- RESTRICT (not CASCADE / SET NULL): dropping a snapshot must be a
    -- deliberate act because every estimate above is anchored to it.
    pricing_snapshot_id  UUID         NOT NULL REFERENCES pricing_snapshot(id) ON DELETE RESTRICT,
    region               TEXT         NOT NULL,
    -- NUMERIC(14,2): max ~999B USD/month — well beyond any plausible AWS bill.
    monthly_usd          NUMERIC(14,2) NOT NULL,
    yearly_usd           NUMERIC(14,2) NOT NULL,
    -- Per-resource line items: [{section, resource, qty, monthly_usd, ...}].
    -- Always an array to match the renderer's expectation.
    breakdown            JSONB        NOT NULL DEFAULT '[]'::jsonb,
    -- Full markdown report (the aws-spec-to-cost output). Stored inline
    -- because it's small (~5-30 KB per estimate) and the trend view wants
    -- to re-render historical reports without re-running the skill.
    cost_md              TEXT         NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT architecture_estimate_breakdown_is_array
        CHECK (jsonb_typeof(breakdown) = 'array'),
    CONSTRAINT architecture_estimate_monthly_non_negative
        CHECK (monthly_usd >= 0),
    CONSTRAINT architecture_estimate_yearly_non_negative
        CHECK (yearly_usd >= 0)
);

-- Trend view: "all estimates in this workspace, newest first".
CREATE INDEX idx_architecture_estimate_workspace_created
    ON architecture_estimate(workspace_id, created_at DESC);

-- "Estimates for this issue" — used by the issue detail page to show the
-- cost history attached to a spec-change PR. Partial because most rows
-- have no issue (CLI runs).
CREATE INDEX idx_architecture_estimate_issue_created
    ON architecture_estimate(issue_id, created_at DESC) WHERE issue_id IS NOT NULL;

-- Dedup-on-write probe: "do we already have an estimate for this exact
-- spec in this workspace?" Scoped by workspace_id so two workspaces with
-- the same architecture.yaml don't share estimates (IP isolation per the
-- project's single-workspace-per-client rule).
CREATE INDEX idx_architecture_estimate_workspace_spec_hash
    ON architecture_estimate(workspace_id, spec_hash);
