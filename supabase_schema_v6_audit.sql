-- Update login_attempts to store device / IP information
ALTER TABLE public.login_attempts ADD COLUMN IF NOT EXISTS device_info text;
