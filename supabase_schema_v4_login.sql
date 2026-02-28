-- Update students table to add password and split names
-- We use TEXT for password (4 characters)
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS password text DEFAULT '1234';
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS last_name text;

-- Migration logic: split current 'name' into first_name and last_name (approximate)
UPDATE public.students 
SET 
  last_name = split_part(name, ' ', 1),
  first_name = substr(name, length(split_part(name, ' ', 1)) + 2)
WHERE first_name IS NULL;

-- Create admins table
CREATE TABLE IF NOT EXISTS public.admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username text UNIQUE NOT NULL,
    password text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insert the admin user
INSERT INTO public.admins (username, password) 
VALUES ('AdMiN', 'nimda') 
ON CONFLICT (username) DO NOTHING;

-- Create table for login attempts (to implement the 5-try block)
CREATE TABLE IF NOT EXISTS public.login_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username text NOT NULL,
    attempted_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    success boolean DEFAULT false
);

-- Enable RLS
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Policies for admins (Public read for login check, but better to keep it restricted)
-- For this simple implementation, we allow public select on admins for the login logic
CREATE POLICY "Allow public select on admins" ON public.admins FOR SELECT USING (true);
CREATE POLICY "Allow public select on login_attempts" ON public.login_attempts FOR SELECT USING (true);
CREATE POLICY "Allow public insert on login_attempts" ON public.login_attempts FOR INSERT WITH CHECK (true);
