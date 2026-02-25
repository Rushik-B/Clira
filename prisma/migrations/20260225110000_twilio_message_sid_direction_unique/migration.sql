-- Remove duplicate Twilio rows before adding uniqueness.
-- Keep the earliest record per (twilioSid, direction) pair.
WITH ranked_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "twilioSid", "direction"
      ORDER BY "createdAt" ASC, id ASC
    ) AS duplicate_rank
  FROM "TwilioMessage"
  WHERE "twilioSid" IS NOT NULL
)
DELETE FROM "TwilioMessage"
WHERE id IN (
  SELECT id
  FROM ranked_duplicates
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "TwilioMessage_twilioSid_direction_key"
ON "TwilioMessage"("twilioSid", "direction");
