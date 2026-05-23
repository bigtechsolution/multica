package llmpolicy

import (
	"encoding/json"

	"github.com/jackc/pgx/v5/pgtype"
)

// Layer identifies which routing layer decided this dispatch.
type Layer string

const (
	LayerL1 Layer = "L1" // agent default — no policy override
	LayerL2 Layer = "L2" // workspace policy swapped (or attempted to swap)
	LayerL3 Layer = "L3" // per-issue metadata override
)

// Reason captures *why* the resolver landed where it did. Stored on the queue
// row so the cost dashboard / future audit can explain "this task ran on
// claude even though policy=local_only" without re-running the resolver.
type Reason string

const (
	ReasonDefault            Reason = "default"               // L1 no-op
	ReasonSwappedByPolicy    Reason = "swapped_by_policy"     // L2/L3 successfully swapped runtime
	ReasonMCPRequiredSkipped Reason = "mcp_required_skipped"  // agent.mcp_config non-empty, swap forbidden
	ReasonNoAlternateRuntime Reason = "no_alternate_runtime"  // no online runtime in target class
	ReasonUnknownProvider    Reason = "unknown_provider"      // L1 provider not in classification table
	ReasonL3Override         Reason = "l3_override"           // L3 issue override applied as-is (no class change)
)

// PolicyMode mirrors workspace.settings.llm_policy.
type PolicyMode string

const (
	PolicyHybrid    PolicyMode = "hybrid"     // default — L1 wins
	PolicyLocalOnly PolicyMode = "local_only" // rewrite external → local
	PolicyCloudFirst PolicyMode = "cloud_first" // rewrite local → external
)

// IssueOverride mirrors issue.metadata.llm_override.
type IssueOverride string

const (
	OverrideLocal IssueOverride = "local"
	OverrideCloud IssueOverride = "cloud"
)

// Decision is what the resolver returns AND what gets serialised into
// agent_task_queue.routing_decision JSONB. The dispatch callers use
// .AgentID / .RuntimeID to build the queue row, then call .Marshal() for
// the JSONB column.
type Decision struct {
	// AgentID is the agent that will execute the task. Always equal to the
	// caller-supplied agent — this resolver never swaps the agent, only the
	// runtime it runs on. Surfaced here so the queue insert call site has a
	// single source of truth.
	AgentID pgtype.UUID `json:"-"`

	// RuntimeID is the runtime the task will run on. May differ from
	// agent.RuntimeID when Layer != L1.
	RuntimeID pgtype.UUID `json:"-"`

	// Provider is the resolved runtime.provider — useful for downstream
	// classification (e.g. redact_external) without another DB lookup.
	Provider string `json:"provider"`

	// Layer / Reason / Policy / Override are observability-only fields.
	Layer    Layer         `json:"layer"`
	Reason   Reason        `json:"reason"`
	Policy   PolicyMode    `json:"policy"`
	Override IssueOverride `json:"override,omitempty"`

	// RedactExternal is true when the resolved provider is external AND the
	// workspace policy enabled redaction. Daemon / server-side handlers use
	// this to gate the redact.Prompt pass on issue/comment responses.
	RedactExternal bool `json:"redact_external"`
}

// Marshal returns the JSONB bytes to stash in agent_task_queue.routing_decision.
// Never fails — Decision is a flat struct of primitive types.
func (d Decision) Marshal() []byte {
	b, _ := json.Marshal(d)
	return b
}
