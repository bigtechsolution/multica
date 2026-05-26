-- Phase A item 4: workspace-scoped issue templates.
--
-- A template is a fixed bundle of fields the user picks from when creating
-- a new issue ("Bug report", "RFC", "Architecture decision record",
-- "Infrastructure review", ...). The template fields prefill the create
-- form; the user can still edit anything after picking.
--
-- Scope: workspace, not project. Templates live above projects so the
-- same "Bug report" template works for any project. A future "default
-- project_id" column on the template could pin a template to a project
-- if/when needed — out of scope for v1.
--
-- Why a dedicated table (not just issue.is_template = bool):
--   - Template rows have no number/status/assignee_id-as-foreign-key
--     pressure — they don't need to participate in the issue counter,
--     activity stream, or assignment validation.
--   - Listing templates ("show me my workspace's templates") is then a
--     single index hit instead of a filter on the much larger issue table.

CREATE TABLE issue_template (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id         UUID         NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    -- Human-facing name, shown in the create-issue dialog picker. Unique
    -- per workspace so users can't end up with two indistinguishable
    -- "Bug report" entries in the dropdown.
    name                 TEXT         NOT NULL,
    -- Prefill fields. Title / description map straight onto issue create
    -- form. Priority + assignee are optional — empty means "no prefill",
    -- user picks at create time.
    title                TEXT         NOT NULL DEFAULT '',
    description          TEXT         NOT NULL DEFAULT '',
    priority             TEXT,
    assignee_type        TEXT,
    assignee_id          UUID,
    -- Free-form JSONB for forward-compat (labels, custom metadata,
    -- start/due_date offsets, etc.) without another migration.
    extra                JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- Authorship + audit
    created_by           UUID         NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT issue_template_name_per_workspace UNIQUE (workspace_id, name),
    CONSTRAINT issue_template_assignee_paired
        CHECK ((assignee_type IS NULL) = (assignee_id IS NULL))
);

-- "List templates for this workspace" — the hot path. Newest first so the
-- recently-added template surfaces at the top of the picker.
CREATE INDEX idx_issue_template_workspace_created
    ON issue_template(workspace_id, created_at DESC);
