DROP INDEX IF EXISTS idx_agent_metadata;
ALTER TABLE agent DROP COLUMN IF EXISTS metadata;
