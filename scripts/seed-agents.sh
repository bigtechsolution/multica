#!/usr/bin/env bash
# Idempotently create the 8 architect agents and attach DB-stored skills.
#
# Layer-1 LLM defaults (locked 2026-05-24 after Qwen quality/context
# limitations made the original hybrid split untenable for this fork):
#   ALL 8 agents → Claude (Opus 4.7).
#   OpenCode/Qwen runtime stays registered as a fallback but no agent
#   defaults to it. Per-issue Force Local (L3) still works for users
#   who want to drop to Qwen on small tasks — see [[stage-i-llm-routing]].
#
# Why the flip:
#   - Quality gap material: Claude added AWS best-practice annotations
#     (Vault Lock, EventBridge) and parsed meta.name correctly; Qwen
#     produced same content but missed metadata + couldn't add domain
#     reasoning. Captured in MUL-10 smoke A/B.
#   - Qwen3.6-Coder context window (132K) overflowed when @diagrammer
#     loaded full aws-spec-to-drawio skill bundle (examples/, references/,
#     *.py) — task_id 57985959 failed with 132,001/132,000 tokens.
#     Claude (200K) handles it fine.
#
# Requires: skills already seeded via seed-skills.sh, daemon running so
# runtimes are registered (multica runtime list shows online).
#
# Usage: scripts/seed-agents.sh

set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

# Resolve runtime IDs by provider (Layer-1 defaults)
RT_CLAUDE=$(multica runtime list --output json | jq -r '.[] | select(.provider=="claude") | .id' | head -1)
RT_OPENCODE=$(multica runtime list --output json | jq -r '.[] | select(.provider=="opencode") | .id' | head -1)

if [[ -z "$RT_CLAUDE" || -z "$RT_OPENCODE" ]]; then
  echo "ERROR: missing runtime — claude=$RT_CLAUDE opencode=$RT_OPENCODE"
  echo "Run 'multica daemon start' and verify 'multica runtime list'."
  exit 1
fi

echo "Runtimes:"
echo "  claude:   $RT_CLAUDE"
echo "  opencode: $RT_OPENCODE"
echo

MDL_CLAUDE="claude-sonnet-4-5"
MDL_QWEN="vllm-local/qwen3.6-coder"

# Cache existing agents + skills
AGENTS_JSON=$(multica agent list --output json)
SKILLS_JSON=$(multica skill list --output json)

# sid: get skill id by name (empty if missing)
sid() { echo "$SKILLS_JSON" | jq -r --arg n "$1" '.[] | select(.name==$n) | .id' | head -1; }

# sids: comma-joined skill IDs for given names; warns on missing
sids() {
  local out=""
  for n in "$@"; do
    local i; i=$(sid "$n")
    if [[ -n "$i" && "$i" != "null" ]]; then
      [[ -n "$out" ]] && out+=","
      out+="$i"
    else
      echo "  WARN: skill '$n' not found in DB" >&2
    fi
  done
  echo "$out"
}

# upsert_agent <name> <runtime> <model> <description> <instructions> <skill-names...>
upsert_agent() {
  local name="$1" rt="$2" model="$3" desc="$4" instr="$5"; shift 5

  local existing
  existing=$(echo "$AGENTS_JSON" | jq -r --arg n "$name" '.[] | select(.name==$n) | .id' | head -1)

  local id
  if [[ -n "$existing" && "$existing" != "null" ]]; then
    echo "==> $name exists ($existing) — updating"
    id="$existing"
    multica agent update "$id" \
      --runtime-id "$rt" \
      --model "$model" \
      --description "$desc" \
      --instructions "$instr" \
      --visibility workspace >/dev/null 2>&1 || echo "  WARN: update failed"
  else
    echo "==> creating $name"
    id=$(multica agent create \
      --name "$name" \
      --runtime-id "$rt" \
      --model "$model" \
      --description "$desc" \
      --instructions "$instr" \
      --visibility workspace \
      --output json | jq -r .id)
    echo "    created: $id"
  fi

  local skill_ids; skill_ids=$(sids "$@")
  if [[ -n "$skill_ids" ]]; then
    multica agent skills set "$id" --skill-ids "$skill_ids" >/dev/null
    local count=$(echo "$skill_ids" | tr ',' '\n' | wc -l)
    echo "    skills: $count attached"
  fi
}

# ===== 8 architect agents (Layer-1 defaults) =====

upsert_agent "aws-spec-author" "$RT_CLAUDE" "$MDL_CLAUDE" \
  "Drafts the initial architecture.yaml from NL requirements / interview notes" \
  "You are a senior AWS solutions architect. Given user requirements (functional + NFR + RTO/RPO + traffic + compliance + budget), produce a complete architecture.yaml spec consumable by aws-spec-to-drawio/-bom/-cost/-terraform. Use the architecture-design skill as reasoning scaffold. Ask for missing essentials via comments before guessing." \
  architecture-design

upsert_agent "aws-as-is-importer" "$RT_CLAUDE" "$MDL_CLAUDE" \
  "Reverse-engineers existing .drawio diagrams into architecture.yaml" \
  "When an issue attaches a hand-drawn .drawio file, use aws-drawio-to-spec to extract the structured architecture.yaml. Flag any elements you cannot identify in a comment, do not guess service types." \
  aws-drawio-to-spec

upsert_agent "aws-architect" "$RT_CLAUDE" "$MDL_CLAUDE" \
  "Edits architecture.yaml on user request (sizing, AZ, services); regenerates artifacts" \
  "You modify architecture.yaml based on user requests like 'make RDS multi-AZ' or 're-architect for 10x scale'. Always validate with the drawio generator dry-run after edits. Commit changes to a PR branch — never directly to main. After spec changes, downstream agents (cost-analyst, iac-engineer, diagrammer) pick up automatically." \
  aws-spec-to-drawio aws-drawio-xml-architect c4-model-drawio-architect architecture-design

upsert_agent "cost-analyst" "$RT_CLAUDE" "$MDL_CLAUDE" \
  "Computes monthly AWS cost from spec; posts delta vs previous estimate" \
  "When given an updated architecture.yaml, run aws-spec-to-cost to produce a cost.md report. Compute delta vs the previous estimate for this spec path. Post the delta + headline number in an issue comment. Refresh local pricing snapshot via aws-pricing-snapshot-refresh when older than 30 days." \
  aws-spec-to-cost aws-pricing-snapshot-refresh cost-optimization

upsert_agent "iac-engineer" "$RT_CLAUDE" "$MDL_CLAUDE" \
  "Compiles spec into layered Terraform; opens PR with plan dry-run in description" \
  "Run aws-spec-to-terraform on the workspace spec to produce layered TF (10-vpc / 20-subnets / 30-security / 40-data / 50-compute / 60-edge). Backend = S3 + DynamoDB per workspace.settings. Validate via terraform validate + plan dry-run; include the plan summary in PR body. NEVER apply — apply happens only after human PR merge by CI." \
  aws-spec-to-terraform aws-spec-to-bom terraform-provider-upgrade

upsert_agent "diagrammer" "$RT_CLAUDE" "$MDL_CLAUDE" \
  "Produces .drawio files (AWS reference style + C4) from spec" \
  "Generate diagrams from the current architecture.yaml. Default to deterministic offline output via aws-drawio-xml-architect. Use Drawio MCP for interactive editing if requested. Always emit (1) AWS reference style L3 deployment and (2) C4 L1 Context + L2 Container. Attach all three to the issue." \
  drawio-mcp-diagramming aws-drawio-xml-architect c4-model-drawio-architect

upsert_agent "waf-reviewer" "$RT_CLAUDE" "$MDL_CLAUDE" \
  "Scores architecture against AWS WAF five pillars; returns prioritized improvements" \
  "Read the current architecture.yaml + latest cost estimate. Produce a WAF assessment for the five pillars (Reliability, Security, Cost, Operational Excellence, Performance). Score each 0-100 with rationale. Return a comment with top 5 prioritized improvements ranked by (impact × feasibility / effort)." \
  waf-assessment

upsert_agent "reporter" "$RT_CLAUDE" "$MDL_CLAUDE" \
  "Produces Korean client deliverables (exec summary, PPT outline)" \
  "When an issue is marked done, produce: (1) a 200-400 word Korean executive summary covering 핵심 결정 / 비용 / 위험 / 다음 단계, and (2) a PPT outline as sectioned bullet lists ready for python-pptx rendering. Formal client-facing tone. Attach as a comment."

echo
echo "Final agent list:"
multica agent list
