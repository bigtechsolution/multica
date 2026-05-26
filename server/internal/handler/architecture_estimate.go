package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// Workspace-scoped list of architecture cost estimates, newest first.
// Powers the Cost Trend dashboard (Stage J). Workspace membership is
// enforced by the RequireWorkspaceMember middleware at the route group;
// no per-role gating here yet — when an external-member role lands
// (separate stage), guard against it at this entry point.

const (
	defaultEstimatesLimit = 100
	maxEstimatesLimit     = 500
)

func (h *Handler) ListEstimates(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}

	limit := defaultEstimatesLimit
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}
	if limit > maxEstimatesLimit {
		limit = maxEstimatesLimit
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	estimates, err := h.Queries.ListArchitectureEstimatesForWorkspace(ctx, db.ListArchitectureEstimatesForWorkspaceParams{
		WorkspaceID: wsUUID,
		Limit:       int32(limit),
		Offset:      int32(offset),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list estimates")
		return
	}

	total, err := h.Queries.CountArchitectureEstimatesForWorkspace(ctx, wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to count estimates")
		return
	}

	resp := make([]map[string]any, len(estimates))
	for i, e := range estimates {
		resp[i] = serializeEstimate(e)
	}

	w.Header().Set("X-Total-Count", strconv.FormatInt(total, 10))
	writeJSON(w, http.StatusOK, map[string]any{
		"estimates": resp,
		"total":     total,
	})
}

// serializeEstimate produces a stable JSON shape for the frontend. The
// full cost_md is intentionally omitted — it can be ~30 KB per row and
// the trend page only renders summaries. A dedicated detail endpoint
// will surface cost_md later.
func serializeEstimate(e db.ArchitectureEstimate) map[string]any {
	out := map[string]any{
		"id":                  uuidToString(e.ID),
		"workspace_id":        uuidToString(e.WorkspaceID),
		"spec_hash":           e.SpecHash,
		"spec_path":           e.SpecPath,
		"pricing_snapshot_id": uuidToString(e.PricingSnapshotID),
		"region":              e.Region,
		"monthly_usd":         numericToFloat(e.MonthlyUsd),
		"yearly_usd":          numericToFloat(e.YearlyUsd),
		"breakdown":           json.RawMessage(e.Breakdown),
		"created_at":          e.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if e.IssueID.Valid {
		out["issue_id"] = uuidToString(e.IssueID)
	} else {
		out["issue_id"] = nil
	}
	// routing_decision is non-NULL (DEFAULT '{}') so always emit; the
	// frontend treats an empty object as "no decision recorded" and
	// shows a dash. Passes raw to avoid double-decoding.
	out["routing_decision"] = json.RawMessage(e.RoutingDecision)
	return out
}

// numericToFloat extracts a float64 from pgtype.Numeric. Used only for
// JSON-rendering the estimate's USD totals: we accept the precision loss
// because the trend chart and the table show 2-decimal currency, and
// JS numbers are float64 anyway. Internal math must keep using the raw
// pgtype.Numeric / database NUMERIC(14,2) — never round-trip through here.
func numericToFloat(n pgtype.Numeric) float64 {
	if !n.Valid {
		return 0
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return 0
	}
	return f.Float64
}
