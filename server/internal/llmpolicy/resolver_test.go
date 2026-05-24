package llmpolicy

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// stubQ implements runtimeLookup with in-memory tables.
type stubQ struct {
	runtimes map[string]db.AgentRuntime // keyed by uuid string
	agents   map[string]db.Agent        // for GetAgent (pair lookups)
	alt      map[string]db.AgentRuntime // keyed by provider class (external/local) → runtime to return
	altErr   error
}

func (s *stubQ) GetAgentRuntime(_ context.Context, id pgtype.UUID) (db.AgentRuntime, error) {
	if rt, ok := s.runtimes[uuidStr(id)]; ok {
		return rt, nil
	}
	return db.AgentRuntime{}, pgx.ErrNoRows
}

func (s *stubQ) GetAgent(_ context.Context, id pgtype.UUID) (db.Agent, error) {
	if a, ok := s.agents[uuidStr(id)]; ok {
		return a, nil
	}
	return db.Agent{}, pgx.ErrNoRows
}

func (s *stubQ) FindOnlineRuntimeByProvider(_ context.Context, arg db.FindOnlineRuntimeByProviderParams) (db.AgentRuntime, error) {
	if s.altErr != nil {
		return db.AgentRuntime{}, s.altErr
	}
	// Pick any runtime whose provider matches one of the requested providers.
	wanted := map[string]struct{}{}
	for _, p := range arg.Providers {
		wanted[p] = struct{}{}
	}
	for _, rt := range s.alt {
		if _, ok := wanted[rt.Provider]; ok {
			return rt, nil
		}
	}
	return db.AgentRuntime{}, pgx.ErrNoRows
}

func uuidStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return string(u.Bytes[:])
}

func mkUUID(tag byte) pgtype.UUID {
	var u pgtype.UUID
	u.Valid = true
	for i := range u.Bytes {
		u.Bytes[i] = tag
	}
	return u
}

func mkRuntime(id pgtype.UUID, provider string) db.AgentRuntime {
	return db.AgentRuntime{ID: id, Provider: provider, Status: "online"}
}

func settingsJSON(t *testing.T, s map[string]any) []byte {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal settings: %v", err)
	}
	return b
}

func TestResolver(t *testing.T) {
	claudeRT := mkRuntime(mkUUID(0x11), "claude")
	opencodeRT := mkRuntime(mkUUID(0x22), "opencode")

	mkQ := func(base db.AgentRuntime) *stubQ {
		return &stubQ{
			runtimes: map[string]db.AgentRuntime{uuidStr(base.ID): base},
			alt: map[string]db.AgentRuntime{
				"external": claudeRT,
				"local":    opencodeRT,
			},
		}
	}
	ws := db.Workspace{ID: mkUUID(0x99)}
	mkAgent := func(rt db.AgentRuntime, mcp []byte) db.Agent {
		return db.Agent{ID: mkUUID(0x77), RuntimeID: rt.ID, McpConfig: mcp}
	}

	t.Run("L1 default on claude", func(t *testing.T) {
		q := mkQ(claudeRT)
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(claudeRT, nil), nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL1)
		mustEq(t, d.Reason, ReasonDefault)
		mustEq(t, d.Provider, "claude")
		if !d.RedactExternal {
			t.Fatal("claude default should redact when no setting (default true)")
		}
	})

	t.Run("L1 default on opencode", func(t *testing.T) {
		q := mkQ(opencodeRT)
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(opencodeRT, nil), nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL1)
		mustEq(t, d.Provider, "opencode")
		if d.RedactExternal {
			t.Fatal("opencode default should not redact")
		}
	})

	t.Run("L2 local_only swaps claude → opencode", func(t *testing.T) {
		q := mkQ(claudeRT)
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "local_only"})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(claudeRT, nil), nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL2)
		mustEq(t, d.Reason, ReasonSwappedByPolicy)
		mustEq(t, d.Provider, "opencode")
		if d.RedactExternal {
			t.Fatal("post-swap to opencode should not redact")
		}
	})

	t.Run("L2 local_only respects MCP (no pair configured)", func(t *testing.T) {
		q := mkQ(claudeRT)
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "local_only"})}
		agent := mkAgent(claudeRT, []byte(`{"mcpServers":{"github":{}}}`))
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, agent, nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL2)
		mustEq(t, d.Reason, ReasonMCPRequiredSkipped)
		mustEq(t, d.Provider, "claude")
	})

	t.Run("L2 local_only follows routing_pair_id when MCP blocks", func(t *testing.T) {
		// Original MCP agent on claude. Pair has empty mcp_config on opencode.
		pairID := mkUUID(0x55)
		pair := db.Agent{ID: pairID, WorkspaceID: mkUUID(0x99), RuntimeID: opencodeRT.ID, McpConfig: nil}
		meta := []byte(`{"routing_pair_id":"` + uuidString(pairID) + `"}`)
		agent := db.Agent{ID: mkUUID(0x77), WorkspaceID: mkUUID(0x99), RuntimeID: claudeRT.ID, McpConfig: []byte(`{"mcpServers":{"github":{}}}`), Metadata: meta}
		q := &stubQ{
			runtimes: map[string]db.AgentRuntime{uuidStr(claudeRT.ID): claudeRT, uuidStr(opencodeRT.ID): opencodeRT},
			agents:   map[string]db.Agent{uuidStr(pairID): pair},
		}
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "local_only"})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, agent, nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL2)
		mustEq(t, d.Reason, ReasonSwappedViaPair)
		mustEq(t, d.Provider, "opencode")
		if d.AgentID != pairID {
			t.Fatalf("expected AgentID to swap to pair %v, got %v", pairID, d.AgentID)
		}
	})

	t.Run("pair_missing when routing_pair_id points at archived agent", func(t *testing.T) {
		pairID := mkUUID(0x55)
		archivedPair := db.Agent{ID: pairID, WorkspaceID: mkUUID(0x99), RuntimeID: opencodeRT.ID, ArchivedAt: pgtype.Timestamptz{Valid: true}}
		meta := []byte(`{"routing_pair_id":"` + uuidString(pairID) + `"}`)
		agent := db.Agent{ID: mkUUID(0x77), WorkspaceID: mkUUID(0x99), RuntimeID: claudeRT.ID, McpConfig: []byte(`{"mcpServers":{}}`), Metadata: meta}
		// hasMCPConfig only blocks if the map is non-empty — force non-empty.
		agent.McpConfig = []byte(`{"mcpServers":{"x":{}}}`)
		q := &stubQ{
			runtimes: map[string]db.AgentRuntime{uuidStr(claudeRT.ID): claudeRT, uuidStr(opencodeRT.ID): opencodeRT},
			agents:   map[string]db.Agent{uuidStr(pairID): archivedPair},
		}
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "local_only"})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, agent, nil)
		mustNoErr(t, err)
		mustEq(t, d.Reason, ReasonPairMissing)
	})

	t.Run("pair mismatch class falls back to no_alternate", func(t *testing.T) {
		// Original on claude (external), wants local. Pair is ALSO on
		// claude (external) — useless for this policy direction.
		pairID := mkUUID(0x55)
		anotherClaudeRT := mkRuntime(mkUUID(0x44), "claude")
		pair := db.Agent{ID: pairID, WorkspaceID: mkUUID(0x99), RuntimeID: anotherClaudeRT.ID}
		meta := []byte(`{"routing_pair_id":"` + uuidString(pairID) + `"}`)
		agent := db.Agent{ID: mkUUID(0x77), WorkspaceID: mkUUID(0x99), RuntimeID: claudeRT.ID, McpConfig: []byte(`{"mcpServers":{"x":{}}}`), Metadata: meta}
		q := &stubQ{
			runtimes: map[string]db.AgentRuntime{uuidStr(claudeRT.ID): claudeRT, uuidStr(anotherClaudeRT.ID): anotherClaudeRT},
			agents:   map[string]db.Agent{uuidStr(pairID): pair},
		}
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "local_only"})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, agent, nil)
		mustNoErr(t, err)
		mustEq(t, d.Reason, ReasonNoAlternateRuntime)
	})

	t.Run("L2 local_only no alternate runtime", func(t *testing.T) {
		q := mkQ(claudeRT)
		q.altErr = pgx.ErrNoRows
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "local_only"})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(claudeRT, nil), nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL2)
		mustEq(t, d.Reason, ReasonNoAlternateRuntime)
		mustEq(t, d.Provider, "claude")
	})

	t.Run("L2 cloud_first swaps opencode → claude", func(t *testing.T) {
		q := mkQ(opencodeRT)
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "cloud_first"})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(opencodeRT, nil), nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL2)
		mustEq(t, d.Reason, ReasonSwappedByPolicy)
		mustEq(t, d.Provider, "claude")
		if !d.RedactExternal {
			t.Fatal("after cloud_first swap to claude, redact should be on")
		}
	})

	t.Run("L2 hybrid is no-op", func(t *testing.T) {
		q := mkQ(claudeRT)
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "hybrid"})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(claudeRT, nil), nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL1)
	})

	t.Run("L3 override forces local", func(t *testing.T) {
		q := mkQ(claudeRT)
		meta := []byte(`{"llm_override":"local"}`)
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(claudeRT, nil), meta)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL3)
		mustEq(t, d.Override, OverrideLocal)
		mustEq(t, d.Reason, ReasonSwappedByPolicy)
		mustEq(t, d.Provider, "opencode")
	})

	t.Run("L3 override forces cloud", func(t *testing.T) {
		q := mkQ(opencodeRT)
		meta := []byte(`{"llm_override":"cloud"}`)
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(opencodeRT, nil), meta)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL3)
		mustEq(t, d.Reason, ReasonSwappedByPolicy)
		mustEq(t, d.Provider, "claude")
	})

	t.Run("L3 override matches current class, no swap", func(t *testing.T) {
		q := mkQ(claudeRT)
		meta := []byte(`{"llm_override":"cloud"}`)
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(claudeRT, nil), meta)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL3)
		mustEq(t, d.Reason, ReasonL3Override)
		mustEq(t, d.Provider, "claude")
	})

	t.Run("L3 beats L2", func(t *testing.T) {
		q := mkQ(claudeRT)
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "local_only"})}
		meta := []byte(`{"llm_override":"cloud"}`)
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(claudeRT, nil), meta)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL3)
		mustEq(t, d.Provider, "claude") // L3 cloud wins, no swap
	})

	t.Run("redact_before_external=false disables redaction", func(t *testing.T) {
		q := mkQ(claudeRT)
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"redact_before_external": false})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(claudeRT, nil), nil)
		mustNoErr(t, err)
		if d.RedactExternal {
			t.Fatal("explicit false should disable redaction even on external")
		}
	})

	t.Run("unknown provider does not swap", func(t *testing.T) {
		mystery := mkRuntime(mkUUID(0x33), "mystery-llm")
		q := &stubQ{runtimes: map[string]db.AgentRuntime{uuidStr(mystery.ID): mystery}}
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "local_only"})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(mystery, nil), nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL1)
		mustEq(t, d.Reason, ReasonUnknownProvider)
	})

	t.Run("nil issue metadata still resolves", func(t *testing.T) {
		q := mkQ(claudeRT)
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(claudeRT, nil), nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL1)
	})

	t.Run("missing runtime row bubbles error", func(t *testing.T) {
		q := &stubQ{runtimes: map[string]db.AgentRuntime{}}
		_, err := New(nil).withQ(q).Resolve(context.Background(), ws, mkAgent(claudeRT, nil), nil)
		if err == nil || !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("want ErrNoRows wrapped, got %v", err)
		}
	})

	t.Run("decision marshal roundtrip", func(t *testing.T) {
		d := Decision{Layer: LayerL2, Reason: ReasonSwappedByPolicy, Policy: PolicyLocalOnly, Provider: "opencode", RedactExternal: false}
		var got Decision
		if err := json.Unmarshal(d.Marshal(), &got); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		mustEq(t, got.Layer, LayerL2)
		mustEq(t, got.Provider, "opencode")
	})

	t.Run("L2 swap clears Model so daemon falls back to runtime default", func(t *testing.T) {
		// @diagrammer setup: opencode runtime + Qwen model. Policy
		// cloud_first → swap to claude. Old behaviour passed the Qwen
		// model name to Claude CLI → 400 in the wild (MUL-10 smoke).
		q := mkQ(opencodeRT)
		agent := db.Agent{
			ID: mkUUID(0x77), WorkspaceID: mkUUID(0x99),
			RuntimeID: opencodeRT.ID,
			Model:     pgtype.Text{String: "vllm-local/qwen3.6-coder", Valid: true},
		}
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "cloud_first"})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, agent, nil)
		mustNoErr(t, err)
		mustEq(t, d.Reason, ReasonSwappedByPolicy)
		mustEq(t, d.Provider, "claude")
		if d.Model == nil {
			t.Fatal("Model should be non-nil on class swap (explicit override)")
		}
		if *d.Model != "" {
			t.Fatalf("Model should be empty string for runtime-default, got %q", *d.Model)
		}
	})

	t.Run("L1 default leaves Model nil (passthrough)", func(t *testing.T) {
		q := mkQ(opencodeRT)
		agent := db.Agent{
			ID: mkUUID(0x77), WorkspaceID: mkUUID(0x99),
			RuntimeID: opencodeRT.ID,
			Model:     pgtype.Text{String: "vllm-local/qwen3.6-coder", Valid: true},
		}
		d, err := New(nil).withQ(q).Resolve(context.Background(), db.Workspace{ID: mkUUID(0x99)}, agent, nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL1)
		if d.Model != nil {
			t.Fatalf("L1 no-op should leave Model nil, got %v", *d.Model)
		}
	})

	t.Run("Pair-swap copies paired agent Model", func(t *testing.T) {
		pairID := mkUUID(0x55)
		pair := db.Agent{
			ID: pairID, WorkspaceID: mkUUID(0x99), RuntimeID: opencodeRT.ID,
			Model: pgtype.Text{String: "vllm-local/qwen3.6-coder", Valid: true},
		}
		meta := []byte(`{"routing_pair_id":"` + uuidString(pairID) + `"}`)
		agent := db.Agent{
			ID: mkUUID(0x77), WorkspaceID: mkUUID(0x99), RuntimeID: claudeRT.ID,
			McpConfig: []byte(`{"mcpServers":{"github":{}}}`),
			Metadata:  meta,
			Model:     pgtype.Text{String: "claude-sonnet-4-5", Valid: true},
		}
		q := &stubQ{
			runtimes: map[string]db.AgentRuntime{uuidStr(claudeRT.ID): claudeRT, uuidStr(opencodeRT.ID): opencodeRT},
			agents:   map[string]db.Agent{uuidStr(pairID): pair},
		}
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "local_only"})}
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, agent, nil)
		mustNoErr(t, err)
		mustEq(t, d.Reason, ReasonSwappedViaPair)
		if d.Model == nil || *d.Model != "vllm-local/qwen3.6-coder" {
			t.Fatalf("Pair-swap should carry paired Model, got %v", d.Model)
		}
	})
}

func TestHasMCPConfig(t *testing.T) {
	cases := []struct {
		name string
		raw  []byte
		want bool
	}{
		{"nil", nil, false},
		{"empty bytes", []byte{}, false},
		{"empty object", []byte(`{}`), false},
		{"null literal", []byte(`null`), false},
		{"with server", []byte(`{"mcpServers":{"github":{}}}`), true},
		{"array form", []byte(`[{"name":"github"}]`), true},
		{"malformed", []byte(`not json`), true}, // conservative — assume configured
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := hasMCPConfig(c.raw)
			if got != c.want {
				t.Fatalf("hasMCPConfig(%q) = %v, want %v", c.raw, got, c.want)
			}
		})
	}
}

// withQ is a test-only override so the same Resolver type can be exercised
// against the in-memory stub. The production constructor wires a real
// *db.Queries; this lets tests bypass the DB without exporting Q.
func (r *Resolver) withQ(q runtimeLookup) *Resolver { r.Q = q; return r }

func mustNoErr(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func mustEq[T comparable](t *testing.T, got, want T) {
	t.Helper()
	if got != want {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// uuidString returns the canonical 8-4-4-4-12 hex form pgtype.UUID.Scan
// expects. Used in tests to embed a UUID inside a JSON payload that the
// resolver will parse back into a pgtype.UUID.
func uuidString(u pgtype.UUID) string {
	b := u.Bytes
	hex := func(x byte) string {
		const h = "0123456789abcdef"
		return string([]byte{h[x>>4], h[x&0x0f]})
	}
	s := ""
	for i := 0; i < 16; i++ {
		s += hex(b[i])
		if i == 3 || i == 5 || i == 7 || i == 9 {
			s += "-"
		}
	}
	return s
}
