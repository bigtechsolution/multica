package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/analytics"
	"github.com/multica-ai/multica/server/internal/auth"
	"github.com/multica-ai/multica/server/internal/logger"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// Email + password sign-up / sign-in path. Lives alongside the existing
// verification-code and Google OAuth flows in handler/auth.go — same JWT
// issuance, same cookie set, same LoginResponse shape, same signup
// gating (h.checkSignupAllowed). The only differences are: (1) password
// is the credential instead of a freshly-mailed code, and (2) we never
// auto-create a user on the login path — unknown email and wrong
// password both collapse to the same 401 message to defeat enumeration.

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Register handles POST /auth/register — creates a new user with a bcrypt
// password hash and immediately issues a session JWT.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if _, err := mail.ParseAddress(email); err != nil {
		writeError(w, http.StatusBadRequest, "invalid email address")
		return
	}
	if req.Password == "" {
		writeError(w, http.StatusBadRequest, "password is required")
		return
	}

	// Reject duplicates BEFORE hashing — bcrypt cost=12 is ~250ms on the
	// Spark; doing it on a guaranteed-409 path wastes CPU and gives an
	// attacker a free oracle for "this email is registered" via timing.
	if _, err := h.Queries.GetUserByEmail(r.Context(), email); err == nil {
		writeError(w, http.StatusConflict, "an account with this email already exists")
		return
	} else if !isNotFound(err) {
		writeError(w, http.StatusInternalServerError, "failed to lookup user")
		return
	}

	// Same signup gate as verify-code / google paths — allowlist, domain
	// rules, AllowSignup flag.
	if err := h.checkSignupAllowed(email, true); err != nil {
		var signupErr SignupError
		if errors.As(err, &signupErr) {
			writeError(w, http.StatusForbidden, signupErr.Error())
			return
		}
		writeError(w, http.StatusForbidden, "user registration is disabled")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrPasswordTooShort), errors.Is(err, auth.ErrPasswordTooLong):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			slog.Error("password hashing failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to hash password")
		}
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		// Match findOrCreateUser's fallback so the user row looks
		// consistent regardless of which signup path created it.
		name = email
		if at := strings.Index(email, "@"); at > 0 {
			name = email[:at]
		}
	}

	user, err := h.Queries.CreateUserWithPassword(r.Context(), db.CreateUserWithPasswordParams{
		Name:         name,
		Email:        email,
		PasswordHash: pgtype.Text{String: hash, Valid: true},
	})
	if err != nil {
		// Race: another concurrent register call won the unique email
		// constraint. Translate to the same 409 as the pre-check above.
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "an account with this email already exists")
			return
		}
		slog.Error("CreateUserWithPassword failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create user")
		return
	}

	h.Analytics.Capture(analytics.Signup(uuidToString(user.ID), user.Email, signupSourceFromRequest(r)))
	slog.Info("user registered (password)", append(logger.RequestAttrs(r), "user_id", uuidToString(user.ID), "email", user.Email)...)

	h.completePasswordLogin(w, r, user)
}

// loginLockoutWindow / loginLockoutThreshold define the per-email soft
// lockout. The existing per-IP authVerifyRL middleware does not protect
// against an attacker rotating through addresses — IPv6 prefix rotation,
// Tor, or a botnet — against a single email. After 5 failures in any
// rolling 15-min window /auth/login returns 429 for that email without
// running bcrypt, regardless of whether the email exists. A successful
// login clears the counter.
const (
	loginLockoutWindow    = 15 * time.Minute
	loginLockoutThreshold = 5
)

// Login handles POST /auth/login — email + password verification → JWT.
// Returns 401 with a generic "invalid credentials" for both unknown email
// AND wrong password, so the response cannot be used to enumerate which
// addresses have accounts. Users created via the verification-code or
// Google paths (password_hash NULL) cannot log in here and fall into the
// same generic 401 — they must set a password first.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	// Single message for both empty-email and empty-password: an attacker
	// scraping field-level validation can't tell whether the address was
	// the missing field. Register's split messages are fine because
	// register is a known-noisy surface; login is the brute-force target.
	if email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	// Per-email lockout. Run BEFORE the user lookup + bcrypt verify so
	// a locked account costs us nothing. Apply to every email submitted
	// (existing or not) to preserve enumeration defence — otherwise the
	// presence of a 429 vs 401 would itself leak account existence.
	since := time.Now().Add(-loginLockoutWindow)
	failed, err := h.Queries.CountRecentFailedLogins(r.Context(), db.CountRecentFailedLoginsParams{
		Email:       email,
		AttemptedAt: pgtype.Timestamptz{Time: since, Valid: true},
	})
	if err != nil {
		slog.Error("CountRecentFailedLogins failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to verify login state")
		return
	}
	if failed >= loginLockoutThreshold {
		slog.Warn("password login rate-limited", append(logger.RequestAttrs(r), "email", email, "reason", "rate_limited", "attempts", failed)...)
		w.Header().Set("Retry-After", strconv.Itoa(int(loginLockoutWindow.Seconds())))
		writeError(w, http.StatusTooManyRequests, "too many failed attempts; try again later")
		return
	}

	user, err := h.Queries.GetUserByEmail(r.Context(), email)
	if err != nil {
		if isNotFound(err) {
			// Run a dummy bcrypt verify to keep the response time the
			// same for "no such user" and "wrong password" — cheap
			// enumeration defence.
			_ = auth.VerifyPassword("$2a$12$invalid.hash.placeholder.value.value.value.value.value.value", req.Password)
			h.recordLoginFailure(r.Context(), email, "unknown_email")
			slog.Warn("password login failed", append(logger.RequestAttrs(r), "email", email, "reason", "unknown_email")...)
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		slog.Error("GetUserByEmail failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to lookup user")
		return
	}

	switch {
	case !user.PasswordHash.Valid:
		// User exists but was created via verify-code / google — has no
		// password set yet. Same 401 to the client, but the log
		// distinguishes the case so future "set up your password" UX
		// prompts can be triggered off the audit log if needed.
		h.recordLoginFailure(r.Context(), email, "null_hash")
		slog.Warn("password login failed", append(logger.RequestAttrs(r), "user_id", uuidToString(user.ID), "email", email, "reason", "null_hash")...)
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	case !auth.VerifyPassword(user.PasswordHash.String, req.Password):
		h.recordLoginFailure(r.Context(), email, "bad_password")
		slog.Warn("password login failed", append(logger.RequestAttrs(r), "user_id", uuidToString(user.ID), "email", email, "reason", "bad_password")...)
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// Successful login — clear the counter so the next failure starts
	// a fresh window. Errors here are non-fatal (the login itself
	// succeeded); log and continue.
	if err := h.Queries.ClearFailedLoginAttempts(r.Context(), email); err != nil {
		slog.Warn("ClearFailedLoginAttempts failed", "error", err, "email", email)
	}
	h.completePasswordLogin(w, r, user)
}

// recordLoginFailure inserts a failed_login_attempt row. Failures here
// are non-fatal — we'd rather the user see the regular 401 than a 500
// telling them the audit log is down — but they ARE logged so a wedged
// table surfaces in ops.
func (h *Handler) recordLoginFailure(ctx context.Context, email, reason string) {
	if err := h.Queries.RecordFailedLoginAttempt(ctx, db.RecordFailedLoginAttemptParams{
		Email:  email,
		Reason: reason,
	}); err != nil {
		slog.Warn("RecordFailedLoginAttempt failed", "error", err, "email", email, "reason", reason)
	}
}

// completePasswordLogin produces the JWT, sets cookies, and writes the
// LoginResponse. Shared by Register (first session) and Login (returning
// session) so the post-credential side of the flow is identical to the
// verification-code path — same TTL, same cookie names, same CF cookies.
func (h *Handler) completePasswordLogin(w http.ResponseWriter, r *http.Request, user db.User) {
	tokenString, err := h.issueJWT(user)
	if err != nil {
		slog.Warn("password login failed", append(logger.RequestAttrs(r), "error", err, "user_id", uuidToString(user.ID))...)
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	if err := auth.SetAuthCookies(w, tokenString); err != nil {
		slog.Warn("failed to set auth cookies", "error", err)
	}

	if h.CFSigner != nil {
		for _, cookie := range h.CFSigner.SignedCookies(time.Now().Add(auth.AuthTokenTTL())) {
			http.SetCookie(w, cookie)
		}
	}

	slog.Info("user logged in (password)", append(logger.RequestAttrs(r), "user_id", uuidToString(user.ID), "email", user.Email)...)
	writeJSON(w, http.StatusOK, LoginResponse{
		Token: tokenString,
		User:  userToResponse(user),
	})
}
