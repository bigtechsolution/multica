package auth

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

// HashPassword turns a plaintext password into a bcrypt hash. cost=12 is a
// deliberate trade between CPU cost on login (sub-300ms on the Spark CPU)
// and resistance to offline GPU attack. Increase here (not per-caller) if
// hardware budget allows.
const PasswordHashCost = 12

// PasswordMaxLen is bcrypt's hard limit. bcrypt silently truncates inputs
// past 72 bytes, which is the footgun: a user picks a 90-character
// passphrase, then later logs in with the same first 72 bytes plus
// anything-or-nothing trailing and it passes. Capping at 72 bytes is the
// only reject-at-the-boundary defence that doesn't add another hashing
// layer.
//
// Note this is BYTES, not characters. UTF-8 makes the difference matter:
// Korean / CJK glyphs are 3 bytes each, so 72 bytes ≈ 24 Korean chars.
// UI should surface "최대 72 바이트(한글 약 24자)" rather than a char count.
const PasswordMaxLen = 72

// PasswordMinLen is intentionally lenient. The real protection is the
// hash cost and rate-limited login, not arbitrary minimum length. UI may
// enforce stricter rules on top.
const PasswordMinLen = 8

// ErrPasswordTooShort / ErrPasswordTooLong are returned by HashPassword so
// the handler can convert them to 400-with-message rather than a generic 500.
var (
	ErrPasswordTooShort = errors.New("password must be at least 8 characters")
	ErrPasswordTooLong  = errors.New("password must be at most 72 bytes (around 24 Korean characters)")
)

// HashPassword validates length then bcrypts. Returns the standard 60-byte
// bcrypt string ready to store in user.password_hash.
func HashPassword(plaintext string) (string, error) {
	if len(plaintext) < PasswordMinLen {
		return "", ErrPasswordTooShort
	}
	if len(plaintext) > PasswordMaxLen {
		return "", ErrPasswordTooLong
	}
	out, err := bcrypt.GenerateFromPassword([]byte(plaintext), PasswordHashCost)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// VerifyPassword returns true iff plaintext matches the stored bcrypt hash.
// Returns false on any error (including malformed hash) — never expose the
// underlying bcrypt error to callers, that would help an attacker
// distinguish "no such user" from "wrong password" via timing or message.
func VerifyPassword(hash, plaintext string) bool {
	if hash == "" || plaintext == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plaintext)) == nil
}
