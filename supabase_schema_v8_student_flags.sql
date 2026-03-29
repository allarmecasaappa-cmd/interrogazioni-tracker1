-- ============================================================
-- Migration v8: Student Flags (DSA, PFP, No Religion)
--              + Subject Religion Flag
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Add student flags
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS is_dsa       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_pfp       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS no_religion  BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Add subject religion marker
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS is_religion  BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Comments for documentation
COMMENT ON COLUMN students.is_dsa      IS 'DSA student: never eligible for random interrogation, can only be called as volunteer';
COMMENT ON COLUMN students.is_pfp      IS 'PFP student: never eligible for random interrogation, can only be called as volunteer';
COMMENT ON COLUMN students.no_religion IS 'Student does not attend religion class: excluded from religion subject risk calculations';
COMMENT ON COLUMN subjects.is_religion IS 'This subject is Religion (IRC): students with no_religion=true are excluded from its risk calculation';
