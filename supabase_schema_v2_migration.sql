-- ============================================================
-- Supabase Schema Update — Multi-Class Support
-- Run this script in the Supabase SQL Editor to upgrade
-- an existing database to support multiple classes.
-- ============================================================

-- 1. Add class_id to all tables with a default value of 'Classe-1'
-- This ensures existing data is preserved and assigned to a default class.
ALTER TABLE students ADD COLUMN class_id TEXT NOT NULL DEFAULT 'Classe-1';
ALTER TABLE teachers ADD COLUMN class_id TEXT NOT NULL DEFAULT 'Classe-1';
ALTER TABLE subjects ADD COLUMN class_id TEXT NOT NULL DEFAULT 'Classe-1';
ALTER TABLE schedule ADD COLUMN class_id TEXT NOT NULL DEFAULT 'Classe-1';
ALTER TABLE interrogations ADD COLUMN class_id TEXT NOT NULL DEFAULT 'Classe-1';
ALTER TABLE absences ADD COLUMN class_id TEXT NOT NULL DEFAULT 'Classe-1';
ALTER TABLE volunteers ADD COLUMN class_id TEXT NOT NULL DEFAULT 'Classe-1';
ALTER TABLE vacations ADD COLUMN class_id TEXT NOT NULL DEFAULT 'Classe-1';
-- NOTE: 'config' table is intentionally left without class_id, as these 
-- represent app-wide settings like 'school_days'.
ALTER TABLE subject_avg ADD COLUMN class_id TEXT NOT NULL DEFAULT 'Classe-1';

-- 2. Update the 'vacations' table unique constraint
-- Previously, date was UNIQUE. Now it should be UNIQUE per class.
ALTER TABLE vacations DROP CONSTRAINT IF EXISTS vacations_date_key;
ALTER TABLE vacations ADD CONSTRAINT vacations_date_class_key UNIQUE (date, class_id);

-- 3. Update the 'subject_avg' table primary key
-- Previously subject_id was the PK. Now we append class_id to allow
-- per-class subject averages.
ALTER TABLE subject_avg DROP CONSTRAINT IF EXISTS subject_avg_pkey;
ALTER TABLE subject_avg ADD PRIMARY KEY (subject_id, class_id);

-- ============================================================
-- IMPORTANT:
-- If you are starting fresh, run `supabase_schema.sql` FIRST,
-- then run this script `supabase_schema_v2_migration.sql`.
-- ============================================================
