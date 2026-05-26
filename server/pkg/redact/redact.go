// Package redact provides functions for detecting and masking secrets
// in agent output before it reaches the database or WebSocket broadcast.
package redact

import (
	"os"
	"os/user"
	"regexp"
	"strings"
)

// secretPattern pairs a compiled regex with its replacement text.
type secretPattern struct {
	re          *regexp.Regexp
	replacement string
}

// Patterns are checked in order; first match wins per position.
var patterns = []secretPattern{
	// AWS access key IDs (always start with AKIA)
	{regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`), "[REDACTED AWS KEY]"},

	// AWS secret access keys (40 char base64-ish, preceded by a common separator)
	{regexp.MustCompile(`(?i)(?:aws_secret_access_key|secret_?access_?key)\s*[=:]\s*[A-Za-z0-9/+=]{40}`), "[REDACTED AWS SECRET]"},

	// PEM private keys (multi-line)
	{regexp.MustCompile(`(?s)-----BEGIN[A-Z\s]*PRIVATE KEY-----.*?-----END[A-Z\s]*PRIVATE KEY-----`), "[REDACTED PRIVATE KEY]"},

	// GitHub tokens (classic PAT, fine-grained, OAuth, etc.)
	{regexp.MustCompile(`\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b`), "[REDACTED GITHUB TOKEN]"},

	// OpenAI / Anthropic API keys
	{regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{20,}\b`), "[REDACTED API KEY]"},

	// Slack tokens
	{regexp.MustCompile(`\bxox[bporas]-[A-Za-z0-9\-]{10,}\b`), "[REDACTED SLACK TOKEN]"},

	// GitLab personal access tokens
	{regexp.MustCompile(`\bglpat-[A-Za-z0-9_-]{20,}\b`), "[REDACTED GITLAB TOKEN]"},

	// JWT tokens (three base64url segments)
	{regexp.MustCompile(`\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b`), "[REDACTED JWT]"},

	// Generic "Bearer <token>" in output
	{regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b`), "Bearer [REDACTED]"},

	// Connection strings with embedded passwords
	{regexp.MustCompile(`(?i)(?:postgres|mysql|mongodb|redis|amqp)(?:ql)?://[^:\s]+:[^@\s]+@`), "[REDACTED CONNECTION STRING]@"},

	// Generic key=value patterns for common secret env var names
	{regexp.MustCompile(`(?i)(?:API_KEY|API_SECRET|SECRET_KEY|SECRET|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY|DATABASE_URL|DB_PASSWORD|DB_URL|REDIS_URL|PASSWORD|TOKEN)\s*[=:]\s*\S+`), "[REDACTED CREDENTIAL]"},
}

// InputMap returns a copy of m with all string values passed through Text.
// Non-string values are preserved as-is.
func InputMap(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		if s, ok := v.(string); ok {
			out[k] = Text(s)
		} else {
			out[k] = v
		}
	}
	return out
}

// homeDir is resolved once at init for path redaction.
var homeDir string
var username string

func init() {
	homeDir, _ = os.UserHomeDir()
	if u, err := user.Current(); err == nil {
		username = u.Username
	}
}

// Text scans the input string for known secret patterns and replaces
// matches with safe placeholders. It also masks the local user's home
// directory path to prevent leaking the username.
func Text(s string) string {
	for _, p := range patterns {
		s = p.re.ReplaceAllString(s, p.replacement)
	}

	// Redact home directory paths (e.g. /Users/john/ → /Users/****/).
	if homeDir != "" && username != "" {
		masked := strings.Replace(homeDir, username, "****", 1)
		s = strings.ReplaceAll(s, homeDir, masked)
	}

	return s
}

// PromptContext carries the workspace-scoped knobs that Prompt uses to
// mask things only the resolver knows about (the client name, the repo
// paths it owns). Empty strings/slices are no-ops.
type PromptContext struct {
	WorkspaceName string
	RepoPaths     []string
}

// awsAccountIDRegex matches a 12-digit AWS account ID near a contextual
// keyword. Narrow on purpose — bare 12-digit numbers in code (timestamps,
// IDs, ports) would false-positive otherwise.
var awsAccountIDRegex = regexp.MustCompile(`(?i)\baccount[\s_\-]*(?:id|number|num|#)?\s*[:=]?\s*(\d{12})\b`)

// ipv4Regex matches non-loopback IPv4 addresses. Loopback (127.x.x.x) is
// preserved to avoid masking local-only debugging breadcrumbs the LLM
// might find genuinely useful.
var ipv4Regex = regexp.MustCompile(`\b(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}\b`)

// Prompt layers Text() with workspace-scoped masks. Use this on any string
// that is about to cross into an external LLM via the daemon's CLI tool-call
// path (issue title/description, comment body). For credentials-only
// redaction on already-stored agent output, prefer Text().
func Prompt(s string, ctx PromptContext) string {
	// Workspace-scoped masks first — replacement makes downstream regex
	// matching cleaner (less raw text to inspect).
	if ctx.WorkspaceName != "" {
		s = strings.ReplaceAll(s, ctx.WorkspaceName, "[REDACTED WORKSPACE]")
	}
	for _, p := range ctx.RepoPaths {
		if p == "" {
			continue
		}
		s = strings.ReplaceAll(s, p, "[REDACTED REPO]")
	}

	// AWS account IDs near contextual keywords. Replace just the 12-digit
	// group so the surrounding "account:" cue stays readable.
	s = awsAccountIDRegex.ReplaceAllStringFunc(s, func(match string) string {
		groups := awsAccountIDRegex.FindStringSubmatch(match)
		if len(groups) < 2 {
			return match
		}
		return strings.Replace(match, groups[1], "[REDACTED ACCOUNT]", 1)
	})

	// Non-loopback IPv4. Conservative: drop only if the address is not 127.*.
	s = ipv4Regex.ReplaceAllStringFunc(s, func(ip string) string {
		if strings.HasPrefix(ip, "127.") {
			return ip
		}
		return "[REDACTED IP]"
	})

	// Finally the credential/path patterns.
	return Text(s)
}
