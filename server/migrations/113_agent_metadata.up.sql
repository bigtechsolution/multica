-- Add a freeform metadata JSONB column to agent for orthogonal-to-runtime
-- annotations the resolver / dispatcher needs.
--
-- First consumer (Stage I follow-up): metadata.routing_pair_id holds the
-- UUID of an alternate agent the resolver should swap to when an L2/L3
-- policy wants a runtime swap but agent.mcp_config blocks it (OpenCode
-- has no --mcp-config). The paired agent ships with empty mcp_config so
-- it can run on the alternate runtime class — see
-- scripts/seed-agent-pairs.sh.
--
-- Other future keys (kept out of column-name proliferation): owner-side
-- labels, custom routing weights, A/B run tags. Unknown keys are
-- preserved on write and ignored on read — same contract as
-- workspace.settings and issue.metadata.

ALTER TABLE agent
    ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN agent.metadata IS
    'Per-agent KV metadata. Recognised keys: routing_pair_id (alternate agent for MCP-locked policy swap, server/internal/llmpolicy).';

-- "Find every agent whose routing_pair_id points at this UUID" — used
-- when archiving an agent to detect orphaned pairs. GIN index on the
-- JSONB column with jsonb_path_ops for fast `@>` containment lookups.
CREATE INDEX idx_agent_metadata ON agent USING gin (metadata jsonb_path_ops);
