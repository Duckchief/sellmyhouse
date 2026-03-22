ALTER TABLE "public"."properties"
  ADD COLUMN "level" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "unit_number" TEXT NOT NULL DEFAULT '';

ALTER TABLE "public"."properties"
  DROP COLUMN "storey_range",
  DROP COLUMN "flat_model";

ALTER TABLE "public"."properties"
  ALTER COLUMN "level" DROP DEFAULT,
  ALTER COLUMN "unit_number" DROP DEFAULT;
