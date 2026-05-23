ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_password_hash_bcrypt_shape;
ALTER TABLE "user" DROP COLUMN IF EXISTS password_updated_at;
ALTER TABLE "user" DROP COLUMN IF EXISTS password_hash;
