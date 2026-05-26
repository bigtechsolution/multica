-- Stage I follow-up: record the routing decision that produced each
-- architecture estimate so the cost dashboard can surface "which LLM
-- layer ran this?" without a fragile join back to agent_task_queue.
--
-- Writer (the cost-analyst agent's estimate-emission code, lands in
-- Stage G) snapshots the current task's routing_decision into this
-- column at INSERT. Defaults to '{}' so pre-Stage-G demo rows stay
-- valid and the dashboard shows "—" for them.

ALTER TABLE architecture_estimate
    ADD COLUMN routing_decision JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN architecture_estimate.routing_decision IS
    'Snapshot of agent_task_queue.routing_decision from the task that produced this estimate. Shape matches server/internal/llmpolicy.Decision.';
