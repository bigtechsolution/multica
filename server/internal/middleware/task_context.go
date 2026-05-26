package middleware

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/multica-ai/multica/server/internal/llmpolicy"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// TaskContextHeader is the request header the multica CLI sets when it is
// running inside a daemon-spawned subprocess for a specific task. We reuse
// the pre-existing X-Task-ID header that the agent-identity path already
// stamps (see server/internal/cli/client.go), so no env var or header
// plumbing changes are required to enable LLM-policy-aware redaction —
// any CLI subprocess that the daemon has set MULTICA_TASK_ID on will
// already be sending this header.
//
// Server handlers downstream (issue / comment reads) look up the decision
// via TaskContextFromRequest and apply redact.Prompt to outgoing payloads
// when decision.RedactExternal is true.
const TaskContextHeader = "X-Task-ID"

type taskContextKey struct{}

// TaskContext is the cached payload the middleware stashes on the request.
// Decision may be nil when the header was absent OR the lookup failed —
// downstream code treats nil as "no redaction required" (fail-open is wrong
// here? — see comment in redact handlers).
type TaskContext struct {
	TaskID   string
	Decision *llmpolicy.Decision
}

// TaskContextFromRequest returns the (possibly nil) TaskContext attached to
// the request. Callers check `tc != nil && tc.Decision != nil` before
// reading Decision.
func TaskContextFromRequest(r *http.Request) *TaskContext {
	if v, ok := r.Context().Value(taskContextKey{}).(*TaskContext); ok {
		return v
	}
	return nil
}

// TaskContextMiddleware reads X-Multica-Task-Context, looks up the task's
// routing_decision JSONB column, and stashes a parsed Decision on the
// request. Missing or malformed values are logged at Debug and the request
// continues without context — handlers should treat that as "no redaction"
// (the request likely originates from the browser UI, not a CLI subprocess).
//
// The DB lookup is one indexed point read; if it becomes hot, cache it.
func TaskContextMiddleware(queries *db.Queries) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get(TaskContextHeader)
			if header == "" {
				next.ServeHTTP(w, r)
				return
			}

			taskUUID, err := util.ParseUUID(header)
			if err != nil {
				slog.Debug("task_context: invalid UUID header", "value", header)
				next.ServeHTTP(w, r)
				return
			}
			task, taskErr := queries.GetAgentTask(r.Context(), taskUUID)
			if taskErr != nil {
				slog.Debug("task_context: task not found", "task_id", header, "error", taskErr)
				next.ServeHTTP(w, r)
				return
			}
			tc := &TaskContext{TaskID: header}
			if len(task.RoutingDecision) > 0 && string(task.RoutingDecision) != "{}" {
				var d llmpolicy.Decision
				if jsonErr := json.Unmarshal(task.RoutingDecision, &d); jsonErr == nil {
					tc.Decision = &d
				} else {
					slog.Debug("task_context: malformed routing_decision", "task_id", header, "error", jsonErr)
				}
			}
			ctx := context.WithValue(r.Context(), taskContextKey{}, tc)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
