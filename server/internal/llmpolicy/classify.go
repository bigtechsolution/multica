package llmpolicy

// ProviderClass categorises an agent_runtime.provider string into the two
// buckets the layer-2 workspace policy cares about: external (cloud-LLM
// backed) vs local (on-machine LLM backed in this fork's deployment).
type ProviderClass string

const (
	ClassExternal ProviderClass = "external"
	ClassLocal    ProviderClass = "local"
	ClassUnknown  ProviderClass = "unknown"
)

// externalProviders is the closed set of provider strings the fork treats as
// "outbound to a third-party LLM API" for the purpose of routing + redaction.
// All entries match the agent backends shipped in server/pkg/agent/.
var externalProviders = map[string]struct{}{
	"claude":   {},
	"codex":    {},
	"openclaw": {},
	"copilot":  {},
	"hermes":   {},
	"gemini":   {},
	"pi":       {},
	"cursor":   {},
	"kimi":     {},
	"kiro":     {},
}

// localProviders is the closed set of provider strings the fork treats as
// "stays on the user's machine" — in this deployment OpenCode is configured
// to talk to a local vLLM endpoint (Qwen3-Coder), so its outbound API call
// never leaves the LAN. If a future fork re-points OpenCode at OpenAI this
// classification must change.
var localProviders = map[string]struct{}{
	"opencode": {},
}

// Classify returns the ProviderClass for an agent_runtime.provider string.
// Unknown providers fall into ClassUnknown — the resolver treats those as
// non-swappable (Layer 1 wins) so a new backend never gets surprise-routed.
func Classify(provider string) ProviderClass {
	if _, ok := externalProviders[provider]; ok {
		return ClassExternal
	}
	if _, ok := localProviders[provider]; ok {
		return ClassLocal
	}
	return ClassUnknown
}

// providersInClass returns the provider strings that belong to the given
// class. Used when looking up an alternate runtime in the workspace.
func providersInClass(class ProviderClass) []string {
	switch class {
	case ClassExternal:
		out := make([]string, 0, len(externalProviders))
		for p := range externalProviders {
			out = append(out, p)
		}
		return out
	case ClassLocal:
		out := make([]string, 0, len(localProviders))
		for p := range localProviders {
			out = append(out, p)
		}
		return out
	}
	return nil
}
