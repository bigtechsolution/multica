#!/usr/bin/env bash
# Idempotently import skill bundles from github-copilot-agent-skills into the
# current multica workspace.
#
# Usage: scripts/seed-skills.sh [path/to/.github/skills]

set -euo pipefail

SKILLS_DIR="${1:-/home/dony/WebstormProjects/github-copilot-agent-skills/.github/skills}"
export PATH="$HOME/.local/bin:$PATH"

SKILLS_TO_IMPORT=(
  aws-spec-to-drawio
  aws-spec-to-bom
  aws-spec-to-cost
  aws-spec-to-terraform
  aws-pricing-snapshot-refresh
  aws-drawio-xml-architect
  aws-drawio-to-spec
  c4-model-drawio-architect
  drawio-mcp-diagramming
  terraform-provider-upgrade
  architecture-design
  waf-assessment
  cost-optimization
)

# Cache the workspace skill list once for existence checks
EXISTING_JSON=$(multica skill list --output json 2>/dev/null || echo "[]")

for skill in "${SKILLS_TO_IMPORT[@]}"; do
  dir="$SKILLS_DIR/$skill"
  if [[ ! -d "$dir" ]]; then
    echo "SKIP: $skill (directory not found)"
    continue
  fi
  skill_md="$dir/SKILL.md"
  if [[ ! -f "$skill_md" ]]; then
    echo "SKIP: $skill (no SKILL.md)"
    continue
  fi

  desc=$(awk 'BEGIN{flag=0} /^---$/{flag=!flag; next} flag && /^description:/{sub(/^description: */, ""); print; exit}' "$skill_md")
  desc="${desc:-Imported from github-copilot-agent-skills}"

  content=$(cat "$skill_md")

  existing_id=$(echo "$EXISTING_JSON" | jq -r --arg n "$skill" '.[] | select(.name==$n) | .id' | head -1)

  if [[ -n "$existing_id" && "$existing_id" != "null" ]]; then
    echo "==> $skill exists ($existing_id) — refreshing content + files"
    skill_id="$existing_id"
    multica skill update "$skill_id" --content "$content" --description "$desc" >/dev/null 2>&1 || true
  else
    echo "==> creating $skill"
    skill_id=$(multica skill create \
      --name "$skill" \
      --description "$desc" \
      --content "$content" \
      --output json | jq -r .id)
    echo "    created: $skill_id"
  fi

  added=0; skipped=0; failed=0
  while IFS= read -r f; do
    rel="${f#"$dir"/}"
    mime=$(file -b --mime "$f" 2>/dev/null || echo "")
    case "$mime" in
      text/*|application/json*|application/xml*|application/javascript*|inode/x-empty*|*charset=utf-8*|*charset=us-ascii*)
        if multica skill files upsert "$skill_id" \
             --path "$rel" \
             --content "$(cat "$f")" >/dev/null 2>&1; then
          added=$((added+1))
        else
          echo "    WARN: failed to upsert $rel"
          failed=$((failed+1))
        fi
        ;;
      *)
        skipped=$((skipped+1))
        ;;
    esac
  done < <(find "$dir" -type f -not -name "SKILL.md" -not -path "*/__pycache__/*")

  echo "    files: +$added  binary-skipped:$skipped  failed:$failed"
done

echo
echo "Final skill list:"
multica skill list 2>&1
