-- ============================================================
-- Migration to move config parameters to classes table
-- ============================================================

-- Add config columns to the classes table with default values
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS school_days INT NOT NULL DEFAULT 5;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS cycle_threshold INT NOT NULL DEFAULT 80;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS cycle_return INT NOT NULL DEFAULT 2;

-- If you want, you can migrate data from the global config table to all existing classes
UPDATE public.classes
SET 
    school_days = (SELECT school_days FROM public.config WHERE id = 1 LIMIT 1),
    cycle_threshold = (SELECT cycle_threshold FROM public.config WHERE id = 1 LIMIT 1),
    cycle_return = (SELECT cycle_return FROM public.config WHERE id = 1 LIMIT 1)
WHERE EXISTS (SELECT 1 FROM public.config WHERE id = 1);

-- We leave the old 'config' table intact for now to prevent breaking any old code, 
-- but it will no longer be used.
