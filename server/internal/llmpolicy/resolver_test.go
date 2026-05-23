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
	alt      map[string]db.AgentRuntime // keyed by provider class (external/local) → runtime to return
	altErr   error
}

func (s *stubQ) GetAgentRuntime(_ context.Context, id pgtype.UUID) (db.AgentRuntime, error) {
	if rt, ok := s.runtimes[uuidStr(id)]; ok {
		return rt, nil
	}
	return db.AgentRuntime{}, pgx.ErrNoRows
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

	t.Run("L2 local_only respects MCP", func(t *testing.T) {
		q := mkQ(claudeRT)
		ws := db.Workspace{ID: mkUUID(0x99), Settings: settingsJSON(t, map[string]any{"llm_policy": "local_only"})}
		agent := mkAgent(claudeRT, []byte(`{"mcpServers":{"github":{}}}`))
		d, err := New(nil).withQ(q).Resolve(context.Background(), ws, agent, nil)
		mustNoErr(t, err)
		mustEq(t, d.Layer, LayerL2)
		mustEq(t, d.Reason, ReasonMCPRequiredSkipped)
		mustEq(t, d.Provider, "claude")
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
