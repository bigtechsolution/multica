-- Stage I (3-layer LLM routing): record the resolver decision on every
-- queued task so the dispatch reason and redaction flag survive into
-- task history and the cost dashboard.
--
-- Shape (set by server/internal/llmpolicy.Decision.MarshalJSON):
--   {
--     "layer":            "L1" | "L2" | "L3",
--     "reason":           "default" | "swapped_by_policy"
--                           | "mcp_required_skipped" | "no_alternate_runtime"
--                           | "l3_override",
--     "policy":           "hybrid" | "local_only" | "cloud_first",   -- resolved at enqueue
--     "override":         "local" | "cloud" | null,                  -- issue.metadata.llm_override
--     "provider":         "claude" | "opencode" | ...,                -- resolved runtime provider
--     "redact_external":  true | false
--   }
--
-- Default '{}' so existing rows are valid; new inserts always populate it.

ALTER TABLE agent_task_queue
    ADD COLUMN routing_decision JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN agent_task_queue.routing_decision IS
    'LLM routing decision recorded at enqueue. See server/internal/llmpolicy.';
