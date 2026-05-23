#!/usr/bin/env bash
# Sets a user's password by bcrypt-hashing it and UPDATEing the user row.
# One-off / admin tool — until a /auth/set-password handler exists, this
# is how existing accounts (originally created via the verify-code path,
# password_hash NULL) opt in to password-based login.
#
# Usage: scripts/set-user-password.sh <email> <password>
#   $ scripts/set-user-password.sh hidon84@gmail.com 'my-new-password'
#
# Requirements: docker compose running the multica-postgres-1 container,
# and python3 with the `bcrypt` package (auto-installs via pip if missing).

set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <email> <password>" >&2
    exit 1
fi

EMAIL="$1"
PASSWORD="$2"

# Server caps password at 72 bytes (bcrypt's hard limit). Mirror that here
# so a too-long password fails locally with a clear message instead of
# producing a hash whose effective input differs from what the user typed.
PASSWORD_BYTES=$(printf %s "$PASSWORD" | wc -c)
if (( PASSWORD_BYTES > 72 )); then
    echo "Error: password is $PASSWORD_BYTES bytes; bcrypt max is 72 (about 24 Korean chars)" >&2
    exit 2
fi
if (( ${#PASSWORD} < 8 )); then
    echo "Error: password must be at least 8 characters" >&2
    exit 2
fi

# Lazy-install bcrypt if missing. Quiet failure on the install line is
# fine — the import below will surface a clear error if it's still absent.
python3 -c 'import bcrypt' 2>/dev/null || pip3 install --quiet bcrypt

HASH=$(PWPW="$PASSWORD" python3 -c '
import bcrypt, os, sys
pw = os.environ["PWPW"].encode("utf-8")
print(bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode("ascii"))
')

# UPDATE via psql. Use -v ON_ERROR_STOP=1 so a non-existent user or any
# constraint violation propagates as a non-zero exit code.
docker exec -i multica-postgres-1 psql -U multica -d multica -v ON_ERROR_STOP=1 \
    -v email="$EMAIL" -v hash="$HASH" <<'SQL'
UPDATE "user"
SET password_hash = :'hash',
    password_updated_at = now(),
    updated_at = now()
WHERE email = :'email'
RETURNING id, email, length(password_hash) AS hash_len, password_updated_at;
SQL

echo "✓ password set for $EMAIL"
