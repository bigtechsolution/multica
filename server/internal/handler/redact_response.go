package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/middleware"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/redact"
)

// redactionRequired returns true when this request originates from a CLI
// subprocess attached to an agent task whose routing decision flagged
// redact_external. The decision is attached by middleware.TaskContextMiddleware
// based on the X-Task-ID header the CLI propagates from MULTICA_TASK_ID.
func redactionRequired(r *http.Request) bool {
	tc := middleware.TaskContextFromRequest(r)
	return tc != nil && tc.Decision != nil && tc.Decision.RedactExternal
}

// promptContextForWorkspace builds a redact.PromptContext for the given
// workspace, pulling Name and any repo path/url strings out of Repos JSONB.
// Failures degrade silently to an empty context — partial redaction is
// strictly better than refusing the response.
func (h *Handler) promptContextForWorkspace(ctx context.Context, wsID pgtype.UUID) redact.PromptContext {
	ws, err := h.Queries.GetWorkspace(ctx, wsID)
	if err != nil {
		slog.Debug("redact: workspace load failed", "error", err)
		return redact.PromptContext{}
	}
	return redact.PromptContext{
		WorkspaceName: ws.Name,
		RepoPaths:     extractRepoPaths(ws.Repos),
	}
}

// extractRepoPaths flattens the workspace.repos JSONB into a list of path
// strings (typical shapes: {"path":"infra"}, {"url":"https://github.com/x/y"},
// {"name":"x/y"}). Unknown shapes are ignored.
func extractRepoPaths(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var items []map[string]any
	if err := json.Unmarshal(raw, &items); err != nil {
		// Tolerate non-array shapes — partial info is better than dropping
		// the whole list.
		return nil
	}
	out := make([]string, 0, len(items)*3)
	keys := []string{"path", "url", "name", "remote", "full_name"}
	for _, item := range items {
		for _, k := range keys {
			if v, ok := item[k].(string); ok && v != "" {
				out = append(out, v)
			}
		}
	}
	return out
}

// applyIssuePromptRedaction overwrites Title and Description on the response
// when the caller is an external-LLM task. Call after building the response
// but before writeJSON.
func applyIssuePromptRedaction(r *http.Request, resp *IssueResponse, pc redact.PromptContext) {
	if !redactionRequired(r) {
		return
	}
	resp.Title = redact.Prompt(resp.Title, pc)
	if resp.Description != nil {
		s := redact.Prompt(*resp.Description, pc)
		resp.Description = &s
	}
}

// applyCommentPromptRedaction is the comment analogue. Mutates Content in place.
func applyCommentPromptRedaction(r *http.Request, comments []CommentResponse, pc redact.PromptContext) []CommentResponse {
	if !redactionRequired(r) || len(comments) == 0 {
		return comments
	}
	for i := range comments {
		comments[i].Content = redact.Prompt(comments[i].Content, pc)
	}
	return comments
}

// shouldRedactForTask exposes redactionRequired for tests that need to assert
// the gate logic without exercising a full HTTP request stack.
var shouldRedactForTask = redactionRequired

// Ensure db is referenced even when only the helper signatures land — keeps
// the import-pruner happy if a future refactor strips the workspace load.
var _ = db.Workspace{}
