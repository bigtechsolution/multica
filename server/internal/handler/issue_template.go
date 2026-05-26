package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// IssueTemplateResponse is the wire shape for /api/issue-templates.
type IssueTemplateResponse struct {
	ID            string          `json:"id"`
	WorkspaceID   string          `json:"workspace_id"`
	Name          string          `json:"name"`
	Title         string          `json:"title"`
	Description   string          `json:"description"`
	Priority      *string         `json:"priority"`
	AssigneeType  *string         `json:"assignee_type"`
	AssigneeID    *string         `json:"assignee_id"`
	Extra         json.RawMessage `json:"extra"`
	CreatedBy     string          `json:"created_by"`
	CreatedAt     string          `json:"created_at"`
	UpdatedAt     string          `json:"updated_at"`
}

func issueTemplateToResponse(t db.IssueTemplate) IssueTemplateResponse {
	resp := IssueTemplateResponse{
		ID:          uuidToString(t.ID),
		WorkspaceID: uuidToString(t.WorkspaceID),
		Name:        t.Name,
		Title:       t.Title,
		Description: t.Description,
		Priority:    textToPtr(t.Priority),
		AssigneeID:  uuidToPtr(t.AssigneeID),
		Extra:       json.RawMessage(t.Extra),
		CreatedBy:   uuidToString(t.CreatedBy),
		CreatedAt:   timestampToString(t.CreatedAt),
		UpdatedAt:   timestampToString(t.UpdatedAt),
	}
	resp.AssigneeType = textToPtr(t.AssigneeType)
	return resp
}

// ListIssueTemplates — GET /api/issue-templates (workspace-scoped).
func (h *Handler) ListIssueTemplates(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace_id")
	if !ok {
		return
	}
	rows, err := h.Queries.ListIssueTemplates(r.Context(), wsUUID)
	if err != nil {
		slog.Error("ListIssueTemplates failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list issue templates")
		return
	}
	resp := make([]IssueTemplateResponse, len(rows))
	for i, t := range rows {
		resp[i] = issueTemplateToResponse(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": resp})
}

// CreateIssueTemplateRequest is the body shape for POST /api/issue-templates.
type CreateIssueTemplateRequest struct {
	Name         string          `json:"name"`
	Title        string          `json:"title"`
	Description  string          `json:"description"`
	Priority     string          `json:"priority"`
	AssigneeType string          `json:"assignee_type"`
	AssigneeID   string          `json:"assignee_id"`
	Extra        json.RawMessage `json:"extra"`
}

func (h *Handler) CreateIssueTemplate(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace_id")
	if !ok {
		return
	}

	var req CreateIssueTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	params := db.CreateIssueTemplateParams{
		WorkspaceID: wsUUID,
		Name:        name,
		Title:       req.Title,
		Description: req.Description,
		CreatedBy:   parseUUID(userID),
	}
	if req.Priority != "" {
		params.Priority = pgtype.Text{String: req.Priority, Valid: true}
	}
	if req.AssigneeType != "" && req.AssigneeID != "" {
		// Pair invariant matched by the CHECK constraint on the table.
		assigneeUUID, ok := parseUUIDOrBadRequest(w, req.AssigneeID, "assignee_id")
		if !ok {
			return
		}
		params.AssigneeType = pgtype.Text{String: req.AssigneeType, Valid: true}
		params.AssigneeID = assigneeUUID
	}
	if len(req.Extra) > 0 {
		params.Extra = []byte(req.Extra)
	}

	created, err := h.Queries.CreateIssueTemplate(r.Context(), params)
	if err != nil {
		if strings.Contains(err.Error(), "issue_template_name_per_workspace") {
			writeError(w, http.StatusConflict, "a template with this name already exists in the workspace")
			return
		}
		slog.Error("CreateIssueTemplate failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create issue template")
		return
	}
	writeJSON(w, http.StatusCreated, issueTemplateToResponse(created))
}

// DeleteIssueTemplate — DELETE /api/issue-templates/:id.
func (h *Handler) DeleteIssueTemplate(w http.ResponseWriter, r *http.Request) {
	wsID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace_id")
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	tplUUID, ok := parseUUIDOrBadRequest(w, id, "template id")
	if !ok {
		return
	}
	// Verify it exists in this workspace BEFORE delete — otherwise a
	// cross-workspace delete races silently to a 204.
	if _, err := h.Queries.GetIssueTemplate(r.Context(), db.GetIssueTemplateParams{
		ID:          tplUUID,
		WorkspaceID: wsUUID,
	}); err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "issue template not found")
			return
		}
		slog.Error("GetIssueTemplate failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load issue template")
		return
	}
	if err := h.Queries.DeleteIssueTemplate(r.Context(), db.DeleteIssueTemplateParams{
		ID:          tplUUID,
		WorkspaceID: wsUUID,
	}); err != nil {
		slog.Error("DeleteIssueTemplate failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete issue template")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// keep errors import used
var _ = errors.New
