// Package llmpolicy is the single chokepoint that decides which runtime an
// agent task actually runs on, given:
//
//   - Layer 1 — the agent's structural default (agent.runtime_id, set at seed)
//   - Layer 2 — the workspace policy (workspace.settings.llm_policy)
//   - Layer 3 — a per-issue override (issue.metadata.llm_override)
//
// L3 beats L2 beats L1. A "swap" replaces the runtime, never the agent —
// same skills, same mcp_config, same identity — so observability stays
// coherent. An agent whose mcp_config is non-empty is exempt from L2 swap
// (the OpenCode CLI does not honour --mcp-config), but L3 still wins for
// that case if the user explicitly opts in.
//
// Output is a Decision struct that the dispatch sites stash into
// agent_task_queue.routing_decision so the cost dashboard and the
// observability layer can read it back without re-running the resolver.
package llmpolicy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// runtimeLookup is the subset of db.Queries the resolver needs. Declared as
// an interface so tests can stub it without touching the DB.
type runtimeLookup interface {
	GetAgentRuntime(ctx context.Context, id pgtype.UUID) (db.AgentRuntime, error)
	FindOnlineRuntimeByProvider(ctx context.Context, arg db.FindOnlineRuntimeByProviderParams) (db.AgentRuntime, error)
	GetAgent(ctx context.Context, id pgtype.UUID) (db.Agent, error)
}

// Resolver turns (workspace, agent, issue) into a Decision.
type Resolver struct {
	Q runtimeLookup
}

// New constructs a Resolver bound to a db.Queries instance.
func New(q *db.Queries) *Resolver { return &Resolver{Q: q} }

// workspaceSettings is the subset of workspace.settings JSONB the resolver
// reads. Unknown keys are ignored — the column is freeform JSONB and other
// subsystems own their own keys.
type workspaceSettings struct {
	LLMPolicy            PolicyMode `json:"llm_policy"`
	RedactBeforeExternal *bool      `json:"redact_before_external,omitempty"`
}

// issueMeta is the subset of issue.metadata the resolver reads.
type issueMeta struct {
	LLMOverride IssueOverride `json:"llm_override,omitempty"`
}

// agentMeta is the subset of agent.metadata the resolver reads.
type agentMeta struct {
	// RoutingPairID, when set, names an alternate agent the resolver
	// will swap to when an L2/L3 policy wants to change runtime class
	// but agent.mcp_config blocks the direct same-agent swap. The
	// paired agent must ship with empty mcp_config and a runtime in
	// the target class — see scripts/seed-agent-pairs.sh.
	RoutingPairID string `json:"routing_pair_id,omitempty"`
}

// Resolve picks the runtime + records the reason. issueMetadataRaw may be
// nil for non-issue dispatch paths (chat, quick-create); in that case L3
// is skipped and only L1/L2 apply.
func (r *Resolver) Resolve(
	ctx context.Context,
	ws db.Workspace,
	agent db.Agent,
	issueMetadataRaw []byte,
) (Decision, error) {
	settings := parseSettings(ws.Settings)
	policy := normalizePolicy(settings.LLMPolicy)

	base, err := r.Q.GetAgentRuntime(ctx, agent.RuntimeID)
	if err != nil {
		return Decision{}, fmt.Errorf("llmpolicy: load agent runtime: %w", err)
	}
	baseClass := Classify(base.Provider)
	redactExternal := baseClass == ClassExternal && derefBoolDefault(settings.RedactBeforeExternal, true)

	out := Decision{
		AgentID:        agent.ID,
		RuntimeID:      base.ID,
		Provider:       base.Provider,
		Layer:          LayerL1,
		Reason:         ReasonDefault,
		Policy:         policy,
		RedactExternal: redactExternal,
	}
	if baseClass == ClassUnknown {
		out.Reason = ReasonUnknownProvider
	}

	// Layer 3 — per-issue override beats everything.
	if override, ok := readIssueOverride(issueMetadataRaw); ok {
		out.Layer = LayerL3
		out.Override = override
		targetClass := classForOverride(override)
		// If override aligns with current class, no swap needed (still L3 — the
		// user explicitly pinned this issue).
		if targetClass == baseClass {
			out.Reason = ReasonL3Override
			out.RedactExternal = baseClass == ClassExternal && derefBoolDefault(settings.RedactBeforeExternal, true)
			return out, nil
		}
		return r.swap(ctx, ws.ID, agent, out, targetClass, settings)
	}

	// Layer 2 — workspace policy may swap.
	targetClass, swap := classForPolicy(policy, baseClass)
	if !swap {
		return out, nil
	}
	out.Layer = LayerL2
	return r.swap(ctx, ws.ID, agent, out, targetClass, settings)
}

// swap attempts to find an online runtime of targetClass in the same
// workspace and rewrite the Decision to point at it. If the agent has a
// non-empty mcp_config a direct same-agent runtime swap is forbidden
// (OpenCode lacks --mcp-config) — the resolver instead tries to follow
// agent.metadata.routing_pair_id to a paired alternate agent. If no
// pair is configured (or the pair is archived / missing), the swap is
// recorded as skipped and L1 stands. Either way, Layer is preserved
// (L2 or L3) so the caller sees the policy intent, and Reason explains
// the outcome.
func (r *Resolver) swap(
	ctx context.Context,
	wsID pgtype.UUID,
	agent db.Agent,
	out Decision,
	targetClass ProviderClass,
	settings workspaceSettings,
) (Decision, error) {
	if hasMCPConfig(agent.McpConfig) {
		return r.swapViaPair(ctx, wsID, agent, out, targetClass, settings)
	}
	alt, err := r.Q.FindOnlineRuntimeByProvider(ctx, db.FindOnlineRuntimeByProviderParams{
		WorkspaceID: wsID,
		Providers:   providersInClass(targetClass),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			out.Reason = ReasonNoAlternateRuntime
			return out, nil
		}
		return Decision{}, fmt.Errorf("llmpolicy: lookup alternate runtime: %w", err)
	}
	out.RuntimeID = alt.ID
	out.Provider = alt.Provider
	out.Reason = ReasonSwappedByPolicy
	out.RedactExternal = Classify(alt.Provider) == ClassExternal && derefBoolDefault(settings.RedactBeforeExternal, true)
	// Class changed — agent.Model belongs to the original provider's CLI
	// and is meaningless (often fatal) to the new one. Force runtime
	// default by emitting an explicit empty-string override; the daemon
	// recognises the empty string as "skip --model on the CLI invocation".
	empty := ""
	out.Model = &empty
	return out, nil
}

// swapViaPair is the MCP-required fallback for swap(). Reads
// agent.metadata.routing_pair_id; if set, resolves the paired agent
// and re-runs the runtime selection against the pair's own runtime.
// The pair's class must match the target class for the swap to count.
func (r *Resolver) swapViaPair(
	ctx context.Context,
	wsID pgtype.UUID,
	original db.Agent,
	out Decision,
	targetClass ProviderClass,
	settings workspaceSettings,
) (Decision, error) {
	meta := parseAgentMeta(original.Metadata)
	if meta.RoutingPairID == "" {
		out.Reason = ReasonMCPRequiredSkipped
		return out, nil
	}
	pairUUID, ok := parsePairUUID(meta.RoutingPairID)
	if !ok {
		out.Reason = ReasonPairMissing
		return out, nil
	}
	paired, err := r.Q.GetAgent(ctx, pairUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			out.Reason = ReasonPairMissing
			return out, nil
		}
		return Decision{}, fmt.Errorf("llmpolicy: load paired agent: %w", err)
	}
	if paired.ArchivedAt.Valid || !uuidEqual(paired.WorkspaceID, wsID) {
		out.Reason = ReasonPairMissing
		return out, nil
	}
	pairedRuntime, err := r.Q.GetAgentRuntime(ctx, paired.RuntimeID)
	if err != nil {
		return Decision{}, fmt.Errorf("llmpolicy: load paired runtime: %w", err)
	}
	if Classify(pairedRuntime.Provider) != targetClass {
		// Pair runtime doesn't match the policy direction — treat as
		// "no alternate" rather than misleadingly claiming success.
		out.Reason = ReasonNoAlternateRuntime
		return out, nil
	}
	out.AgentID = paired.ID
	out.RuntimeID = pairedRuntime.ID
	out.Provider = pairedRuntime.Provider
	out.Reason = ReasonSwappedViaPair
	out.RedactExternal = Classify(pairedRuntime.Provider) == ClassExternal && derefBoolDefault(settings.RedactBeforeExternal, true)
	// Pair has its own (correct) model for its native runtime — copy
	// it over so the daemon uses the pair's CLI default model bindings
	// instead of inheriting the MCP-locked original's wrong model.
	if paired.Model.Valid {
		pm := paired.Model.String
		out.Model = &pm
	} else {
		empty := ""
		out.Model = &empty
	}
	return out, nil
}

func parseAgentMeta(raw []byte) agentMeta {
	var m agentMeta
	if len(raw) == 0 {
		return m
	}
	_ = json.Unmarshal(raw, &m)
	return m
}

func parsePairUUID(s string) (pgtype.UUID, bool) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, false
	}
	return u, u.Valid
}

func uuidEqual(a, b pgtype.UUID) bool {
	if a.Valid != b.Valid {
		return false
	}
	return a.Bytes == b.Bytes
}

// classForPolicy returns the target class to swap to + whether a swap is
// needed at all, given the workspace policy and the current class.
func classForPolicy(policy PolicyMode, current ProviderClass) (ProviderClass, bool) {
	switch policy {
	case PolicyLocalOnly:
		if current == ClassExternal {
			return ClassLocal, true
		}
	case PolicyCloudFirst:
		if current == ClassLocal {
			return ClassExternal, true
		}
	}
	return current, false
}

func classForOverride(o IssueOverride) ProviderClass {
	switch o {
	case OverrideLocal:
		return ClassLocal
	case OverrideCloud:
		return ClassExternal
	}
	return ClassUnknown
}

// hasMCPConfig returns true when the agent's mcp_config JSONB column carries
// a non-trivial value. Both NULL and `{}` / `null` count as empty.
func hasMCPConfig(raw []byte) bool {
	if len(raw) == 0 {
		return false
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		// If the column holds an array or scalar we conservatively treat that
		// as "configured" — better to skip swap than to silently drop MCP.
		return true
	}
	// Treat an object with at least one server entry as configured. Other
	// top-level keys (no `mcpServers`) still count — anything non-trivial
	// blocks the swap.
	if len(m) == 0 {
		return false
	}
	return true
}

func parseSettings(raw []byte) workspaceSettings {
	var s workspaceSettings
	if len(raw) == 0 {
		return s
	}
	_ = json.Unmarshal(raw, &s)
	return s
}

func normalizePolicy(p PolicyMode) PolicyMode {
	switch p {
	case PolicyLocalOnly, PolicyCloudFirst, PolicyHybrid:
		return p
	}
	return PolicyHybrid
}

func readIssueOverride(raw []byte) (IssueOverride, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var m issueMeta
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", false
	}
	switch m.LLMOverride {
	case OverrideLocal, OverrideCloud:
		return m.LLMOverride, true
	}
	return "", false
}

func derefBoolDefault(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}
