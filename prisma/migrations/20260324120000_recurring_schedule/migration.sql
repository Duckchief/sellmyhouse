-- Create SlotSource enum
CREATE TYPE "SlotSource" AS ENUM ('manual', 'recurring');

-- Add source column to viewing_slots with default manual
ALTER TABLE "viewing_slots" ADD COLUMN "source" "SlotSource" NOT NULL DEFAULT 'manual';

-- Deduplication: keep lowest ctid per (property_id, date, start_time, end_time)
DELETE FROM viewing_slots
WHERE id NOT IN (
  SELECT DISTINCT ON (property_id, date, start_time, end_time) id
  FROM viewing_slots
  ORDER BY property_id, date, start_time, end_time, ctid
);

-- Add unique constraint (Prisma auto-names this index)
ALTER TABLE "viewing_slots"
  ADD CONSTRAINT "viewing_slots_property_id_date_start_time_end_time_key"
  UNIQUE ("property_id", "date", "start_time", "end_time");

-- Create recurring_schedules table
CREATE TABLE "recurring_schedules" (
  "id" TEXT NOT NULL,
  "property_id" TEXT NOT NULL,
  "days" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recurring_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_schedules_property_id_key" ON "recurring_schedules"("property_id");

ALTER TABLE "recurring_schedules"
  ADD CONSTRAINT "recurring_schedules_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Index for querying slots by source per property
CREATE INDEX "viewing_slots_property_id_source_idx" ON "viewing_slots"("property_id", "source");
