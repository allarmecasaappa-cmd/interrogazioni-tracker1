-- Migration to add local administrator (Capoclasse) capabilities
-- Adding is_class_admin flag to students table

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS is_class_admin boolean DEFAULT false;

-- Example of how to promote a student to Capoclasse (Manually for now via DB)
-- UPDATE public.students SET is_class_admin = true WHERE last_name = 'Rossi' AND first_name = 'Mario';
