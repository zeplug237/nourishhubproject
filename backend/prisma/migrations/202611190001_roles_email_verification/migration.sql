-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'ACCOUNTANT';
ALTER TYPE "UserRole" ADD VALUE 'AUDIT_TEAM_LEAD';
ALTER TYPE "UserRole" ADD VALUE 'INVENTORY_OFFICER';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verification_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verification_code_hash" VARCHAR(64),
ADD COLUMN     "verification_expires_at" TIMESTAMP(0);

-- Preserve access for accounts that were already active before email verification existed.
UPDATE "users" SET "email_verified" = true WHERE "is_active" = true;

