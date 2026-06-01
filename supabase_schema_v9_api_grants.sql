-- ============================================================
-- Migration v9: Explicit API Grants for Supabase Data API
-- Run this in Supabase Dashboard → SQL Editor to ensure
-- all tables are accessible under the new Supabase rules.
-- ============================================================

-- 1. Grant permissions on all existing tables in the public schema to API roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.classes TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teachers TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subjects TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interrogations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.absences TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.volunteers TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vacations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.config TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subject_avg TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admins TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_attempts TO anon, authenticated, service_role;

-- 2. Grant permissions on sequences (required for auto-incrementing/serial IDs during inserts)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 3. Future-proofing: automatically grant access to any tables created in the future within the public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
