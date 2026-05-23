#!/usr/bin/env bash
# Sets the routing_pair_id metadata on a primary agent so the llmpolicy
# resolver can swap to the paired agent when an L2/L3 policy wants a
# runtime-class swap but agent.mcp_config blocks the direct same-agent
# swap (OpenCode lacks --mcp-config). See:
#   - server/internal/llmpolicy/resolver.go  swapViaPair
#   - server/migrations/113_agent_metadata.up.sql
#
# The pair must:
#   - live in the same workspace
#   - have empty mcp_config
#   - run on a runtime whose provider classifies into the opposite class
#     (external ↔ local) per server/internal/llmpolicy/classify.go.
#
# Pairing is unidirectional by default: A → B means "when A is locked
# by MCP, swap to B". For symmetric pairing (cloud_first policy on a
# local-default MCP agent), pass --symmetric to also write B → A.
#
# Usage:
#   scripts/pair-agents.sh <primary-name> <pair-name>
#   scripts/pair-agents.sh aws-spec-author aws-spec-author-local --symmetric
#
# Idempotent: re-running with the same names is a no-op.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <primary-name> <pair-name> [--symmetric]" >&2
  exit 1
fi

PRIMARY="$1"
PAIR="$2"
SYMMETRIC=0
if [[ "${3:-}" == "--symmetric" ]]; then
  SYMMETRIC=1
fi

PSQL="docker exec -i multica-postgres-1 psql -U multica -d multica"

# Resolve both agent UUIDs in one round trip; aborts loudly if either
# is missing so we never silently set metadata.routing_pair_id to NULL.
RAW=$($PSQL -tAF'|' -c "
  SELECT
    COALESCE((SELECT id::text FROM agent WHERE name = '$PRIMARY' AND archived_at IS NULL LIMIT 1), ''),
    COALESCE((SELECT id::text FROM agent WHERE name = '$PAIR'    AND archived_at IS NULL LIMIT 1), '');
")
PRIMARY_ID=$(echo "$RAW" | awk -F'|' '{print $1}' | tr -d '[:space:]')
PAIR_ID=$(echo "$RAW" | awk -F'|' '{print $2}' | tr -d '[:space:]')

if [[ -z "$PRIMARY_ID" ]]; then
  echo "ERROR: primary agent '$PRIMARY' not found (or archived)" >&2
  exit 1
fi
if [[ -z "$PAIR_ID" ]]; then
  echo "ERROR: pair agent '$PAIR' not found (or archived)" >&2
  exit 1
fi

echo "Pairing: $PRIMARY ($PRIMARY_ID) → $PAIR ($PAIR_ID)"
$PSQL -c "
  UPDATE agent
  SET metadata = metadata || jsonb_build_object('routing_pair_id', '$PAIR_ID')
  WHERE id = '$PRIMARY_ID';
"

if [[ $SYMMETRIC -eq 1 ]]; then
  echo "Pairing (symmetric): $PAIR ($PAIR_ID) → $PRIMARY ($PRIMARY_ID)"
  $PSQL -c "
    UPDATE agent
    SET metadata = metadata || jsonb_build_object('routing_pair_id', '$PRIMARY_ID')
    WHERE id = '$PAIR_ID';
  "
fi

echo "Done. Verify with:"
echo "  multica agent list --output json | jq '.[] | select(.name | IN(\"$PRIMARY\", \"$PAIR\"))'"
