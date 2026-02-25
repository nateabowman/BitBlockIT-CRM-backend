-- Phase D: Pipelines & Deals
-- requiredFieldKeys: JSON array of field keys required before moving into this stage (e.g. nextStep, amount)
ALTER TABLE "pipeline_stages" ADD COLUMN IF NOT EXISTS "required_field_keys" JSONB;
