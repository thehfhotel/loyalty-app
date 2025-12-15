-- CreateTable: reserved_membership_ids
-- Stores membership IDs from deleted users to prevent reuse
CREATE TABLE IF NOT EXISTS "public"."reserved_membership_ids" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "membership_id" VARCHAR(8) NOT NULL,
    "original_user_id" UUID,
    "reserved_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(50) DEFAULT 'user_deleted',

    CONSTRAINT "reserved_membership_ids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique membership_id
CREATE UNIQUE INDEX IF NOT EXISTS "reserved_membership_ids_membership_id_key"
ON "public"."reserved_membership_ids"("membership_id");

-- CreateIndex: for lookups
CREATE INDEX IF NOT EXISTS "idx_reserved_membership_ids_membership_id"
ON "public"."reserved_membership_ids"("membership_id");
