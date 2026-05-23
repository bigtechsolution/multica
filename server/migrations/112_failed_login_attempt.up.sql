-- Per-email lockout for /auth/login. The existing per-IP rate limit
-- (authVerifyRL: 20/min) does not protect against an attacker rotating
-- through IPv6 prefixes / Tor / a botnet against a single email. This
-- table backs a soft hard-lockout: 5 failures in any rolling 15-min
-- window → next request returns 429 without doing a bcrypt verify.
--
-- Trade-off: an attacker who knows a user's email can DoS that account
-- by submitting 5 wrong passwords. For the selfhost-with-1-user case
-- this is acceptable; a SaaS deployment should layer a CAPTCHA on the
-- 429 path before opening signups to the world. Captured as deferred
-- follow-up in project_password_auth memory.
--
-- Rows are NOT deduplicated by IP / user-agent / browser — every failure
-- adds a row. A successful login clears all rows for the email (clean
-- slate). The (email, attempted_at) index serves the count probe; rows
-- older than the window are pruned by a periodic sweeper (added when
-- attempts start accumulating; for now Postgres autovacuum is enough).

CREATE TABLE failed_login_attempt (
    id           BIGSERIAL PRIMARY KEY,
    -- Stored lowercase to match the lookup path in handler/auth_password.go
    -- (Login normalises req.Email with ToLower(TrimSpace(...))).
    email        TEXT        NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason       TEXT        NOT NULL,
    CONSTRAINT failed_login_attempt_reason_known
        CHECK (reason IN ('unknown_email', 'null_hash', 'bad_password'))
);

-- "How many failures for this email in the lockout window?" — count
-- probe runs on every Login request, indexed for the hot path.
CREATE INDEX idx_failed_login_attempt_email_time
    ON failed_login_attempt(email, attempted_at DESC);
