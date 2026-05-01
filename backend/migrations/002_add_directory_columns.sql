-- Run this in the Supabase SQL Editor to add directory-sourced columns

ALTER TABLE lead_jobs ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE lead_jobs ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE lead_jobs ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE lead_jobs ADD COLUMN IF NOT EXISTS niche TEXT;
ALTER TABLE lead_jobs ADD COLUMN IF NOT EXISTS location TEXT;