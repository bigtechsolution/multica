-- Optional bcrypt password credential on the user row, enabling the
-- traditional email + password sign-in path in addition to (or instead
-- of) the existing verification-code flow.
--
-- Nullable on purpose: existing users (created via /auth/send-code +
-- /auth/verify-code or Google OAuth) have no password set. A NULL
-- password_hash means "this user cannot log in with a password" — the
-- login handler must refuse such accounts, not treat NULL as "any
-- password accepted".
--
-- password_updated_at is recorded so future security work (rotation
-- prompts, "password changed N days ago" UX, forced-rotation policies)
-- has a timestamp to read without trawling the activity log.

ALTER TABLE "user"
    ADD COLUMN password_hash       TEXT,
    ADD COLUMN password_updated_at TIMESTAMPTZ;

-- Defensive length cap: bcrypt outputs are always 60 bytes. Anything
-- longer is either a bug, a wrong algorithm, or someone smuggling data
-- through the column. CHECK is cheap; the column is rarely written.
--
-- IF YOU EVER MIGRATE TO argon2 / scrypt: drop this CHECK first in the
-- same migration that writes the new hashes. Argon2 / scrypt outputs are
-- variable length and this constraint will reject every new row.
ALTER TABLE "user"
    ADD CONSTRAINT user_password_hash_bcrypt_shape
        CHECK (password_hash IS NULL OR length(password_hash) = 60);
