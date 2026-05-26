package redact

import (
	"strings"
	"testing"
)

func TestRedactAWSAccessKey(t *testing.T) {
	t.Parallel()
	input := "Found key AKIAIOSFODNN7EXAMPLE in config"
	got := Text(input)
	if strings.Contains(got, "AKIAIOSFODNN7EXAMPLE") {
		t.Fatalf("AWS key not redacted: %s", got)
	}
	if !strings.Contains(got, "[REDACTED AWS KEY]") {
		t.Fatalf("expected [REDACTED AWS KEY] placeholder, got: %s", got)
	}
}

func TestRedactAWSSecretKey(t *testing.T) {
	t.Parallel()
	input := "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
	got := Text(input)
	if strings.Contains(got, "wJalrXUtnFEMI") {
		t.Fatalf("AWS secret not redacted: %s", got)
	}
}

func TestRedactPrivateKey(t *testing.T) {
	t.Parallel()
	input := "Here is the key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\nDone."
	got := Text(input)
	if strings.Contains(got, "MIIEow") {
		t.Fatalf("private key content not redacted: %s", got)
	}
	if !strings.Contains(got, "[REDACTED PRIVATE KEY]") {
		t.Fatalf("expected [REDACTED PRIVATE KEY] placeholder, got: %s", got)
	}
}

func TestRedactGitHubToken(t *testing.T) {
	t.Parallel()
	input := "export GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn"
	got := Text(input)
	if strings.Contains(got, "ghp_") {
		t.Fatalf("GitHub token not redacted: %s", got)
	}
}

func TestRedactOpenAIKey(t *testing.T) {
	t.Parallel()
	input := "OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345"
	got := Text(input)
	if strings.Contains(got, "sk-proj-abc123") {
		t.Fatalf("OpenAI key not redacted: %s", got)
	}
}

func TestRedactSlackToken(t *testing.T) {
	t.Parallel()
	input := "token: xoxb-123456789012-1234567890123-AbCdEfGhIjKl"
	got := Text(input)
	if strings.Contains(got, "xoxb-") {
		t.Fatalf("Slack token not redacted: %s", got)
	}
}

func TestRedactBearerToken(t *testing.T) {
	t.Parallel()
	input := "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123"
	got := Text(input)
	if strings.Contains(got, "eyJhbGci") {
		t.Fatalf("Bearer token not redacted: %s", got)
	}
}

func TestRedactGenericCredentials(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		input string
	}{
		{"API_KEY", "API_KEY=mysupersecretkey123"},
		{"DATABASE_URL", "DATABASE_URL=postgres://user:pass@host/db"},
		{"DB_PASSWORD", "DB_PASSWORD: hunter2"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Text(tc.input)
			if !strings.Contains(got, "[REDACTED CREDENTIAL]") {
				t.Fatalf("expected credential redaction for %s, got: %s", tc.name, got)
			}
		})
	}
}

func TestRedactHomeDirectory(t *testing.T) {
	t.Parallel()
	if homeDir == "" || username == "" {
		t.Skip("cannot determine home dir or username")
	}
	input := "Reading file at " + homeDir + "/Documents/secret.txt"
	got := Text(input)
	if strings.Contains(got, username) {
		t.Fatalf("home directory username not redacted: %s", got)
	}
	if !strings.Contains(got, "****") {
		t.Fatalf("expected **** in path, got: %s", got)
	}
}

func TestNoFalsePositivesOnNormalText(t *testing.T) {
	t.Parallel()
	inputs := []string{
		"This is a normal commit message about fixing a bug",
		"The function returns skip-navigation as the class name",
		"Created PR #42 for the authentication feature",
		"Running tests in /tmp/test-workspace/project",
		"The API endpoint /api/issues/123 was updated",
	}
	for _, input := range inputs {
		got := Text(input)
		if got != input {
			t.Fatalf("false positive redaction:\n  input:  %s\n  output: %s", input, got)
		}
	}
}

func TestRedactGitLabToken(t *testing.T) {
	t.Parallel()
	input := "GITLAB_TOKEN=glpat-AbCdEfGhIjKlMnOpQrStUvWx"
	got := Text(input)
	if strings.Contains(got, "glpat-") {
		t.Fatalf("GitLab token not redacted: %s", got)
	}
}

func TestPromptMasksWorkspaceName(t *testing.T) {
	t.Parallel()
	got := Prompt("KGC ISP migration plan for KGC ISP team", PromptContext{WorkspaceName: "KGC ISP"})
	if strings.Contains(got, "KGC ISP") {
		t.Fatalf("workspace name not redacted: %s", got)
	}
	if !strings.Contains(got, "[REDACTED WORKSPACE]") {
		t.Fatalf("missing placeholder: %s", got)
	}
}

func TestPromptMasksRepoPaths(t *testing.T) {
	t.Parallel()
	got := Prompt("Open PR on github.com/acme/infra and github.com/acme/api",
		PromptContext{RepoPaths: []string{"github.com/acme/infra", "github.com/acme/api"}})
	if strings.Contains(got, "github.com/acme/") {
		t.Fatalf("repo paths not redacted: %s", got)
	}
}

func TestPromptMasksAWSAccountID(t *testing.T) {
	t.Parallel()
	cases := []string{
		"account: 123456789012",
		"AWS account id 123456789012 is the production tenant",
		"account_id=123456789012",
	}
	for _, in := range cases {
		got := Prompt(in, PromptContext{})
		if strings.Contains(got, "123456789012") {
			t.Fatalf("account id not redacted: %s -> %s", in, got)
		}
		if !strings.Contains(got, "[REDACTED ACCOUNT]") {
			t.Fatalf("missing placeholder for %q: %s", in, got)
		}
	}
}

func TestPromptDoesNotMaskRandom12DigitNumbers(t *testing.T) {
	t.Parallel()
	// No "account" keyword — should NOT match (avoid false positives on
	// timestamps, big IDs, port concatenations).
	got := Prompt("processed 123456789012 messages in 2.3s", PromptContext{})
	if !strings.Contains(got, "123456789012") {
		t.Fatalf("false positive: bare 12-digit number should not be masked: %s", got)
	}
}

func TestPromptMasksNonLoopbackIPv4(t *testing.T) {
	t.Parallel()
	got := Prompt("connect to 10.0.1.5 via tunnel, debug on 127.0.0.1:8080", PromptContext{})
	if strings.Contains(got, "10.0.1.5") {
		t.Fatalf("non-loopback IP not redacted: %s", got)
	}
	if !strings.Contains(got, "127.0.0.1") {
		t.Fatalf("loopback IP should be preserved: %s", got)
	}
}

func TestPromptStillRunsTextPatterns(t *testing.T) {
	t.Parallel()
	got := Prompt("ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AB", PromptContext{})
	if strings.Contains(got, "ghp_") {
		t.Fatalf("Prompt should still apply Text() patterns: %s", got)
	}
}

func TestRedactJWT(t *testing.T) {
	t.Parallel()
	input := "token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
	got := Text(input)
	if strings.Contains(got, "eyJhbGci") {
		t.Fatalf("JWT not redacted: %s", got)
	}
}

func TestRedactConnectionString(t *testing.T) {
	t.Parallel()
	input := "connecting to postgres://admin:s3cret@db.example.com:5432/mydb"
	got := Text(input)
	if strings.Contains(got, "s3cret") {
		t.Fatalf("connection string password not redacted: %s", got)
	}
}

func TestRedactPasswordEnvVar(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		input string
	}{
		{"PASSWORD", "PASSWORD=hunter2"},
		{"SECRET", "SECRET=mysecretvalue"},
		{"TOKEN", "TOKEN=abc123xyz"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Text(tc.input)
			if !strings.Contains(got, "[REDACTED CREDENTIAL]") {
				t.Fatalf("expected credential redaction for %s, got: %s", tc.name, got)
			}
		})
	}
}

func TestInputMap(t *testing.T) {
	t.Parallel()
	m := map[string]any{
		"command":   "echo sk-proj-abc123def456ghi789jkl012mno345",
		"file_path": "/tmp/test.txt",
		"count":     42,
	}
	got := InputMap(m)
	if s, ok := got["command"].(string); ok {
		if strings.Contains(s, "sk-proj") {
			t.Fatalf("API key in input map not redacted: %s", s)
		}
	}
	// Non-string values preserved
	if got["count"] != 42 {
		t.Fatalf("non-string value altered: %v", got["count"])
	}
	// Clean strings unchanged
	if got["file_path"] != "/tmp/test.txt" {
		t.Fatalf("clean string altered: %v", got["file_path"])
	}
}

func TestInputMapNil(t *testing.T) {
	t.Parallel()
	if got := InputMap(nil); got != nil {
		t.Fatalf("expected nil, got: %v", got)
	}
}

func TestRedactMultipleSecrets(t *testing.T) {
	t.Parallel()
	input := "Keys: AKIAIOSFODNN7EXAMPLE and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn"
	got := Text(input)
	if strings.Contains(got, "AKIAIOSFODNN7EXAMPLE") {
		t.Fatal("AWS key not redacted in multi-secret text")
	}
	if strings.Contains(got, "ghp_") {
		t.Fatal("GitHub token not redacted in multi-secret text")
	}
}
