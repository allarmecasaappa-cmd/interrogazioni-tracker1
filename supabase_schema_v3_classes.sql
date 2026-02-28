-- Create the classes table
CREATE TABLE public.classes (
    id text PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insert the default class (this will throw an error if already exists, but we ignore it)
INSERT INTO public.classes (id) VALUES ('Classe-1') ON CONFLICT (id) DO NOTHING;

-- Since the tables already have a class_id referencing text, we don't need to change their type.
-- But we can add a foreign key constraint to ensure data integrity if wanted.
-- For simplicity and backward compatibility during migration, we'll keep it as text without a strict FK for now, 
-- or we can add it. Let's add the FK for safety.

ALTER TABLE public.students 
  ADD CONSTRAINT fk_students_class FOREIGN KEY (class_id) REFERENCES public.classes (id) ON DELETE CASCADE;

ALTER TABLE public.subjects 
  ADD CONSTRAINT fk_subjects_class FOREIGN KEY (class_id) REFERENCES public.classes (id) ON DELETE CASCADE;

ALTER TABLE public.teachers 
  ADD CONSTRAINT fk_teachers_class FOREIGN KEY (class_id) REFERENCES public.classes (id) ON DELETE CASCADE;

ALTER TABLE public.schedule 
  ADD CONSTRAINT fk_schedule_class FOREIGN KEY (class_id) REFERENCES public.classes (id) ON DELETE CASCADE;

ALTER TABLE public.interrogations 
  ADD CONSTRAINT fk_interrogations_class FOREIGN KEY (class_id) REFERENCES public.classes (id) ON DELETE CASCADE;

ALTER TABLE public.absences 
  ADD CONSTRAINT fk_absences_class FOREIGN KEY (class_id) REFERENCES public.classes (id) ON DELETE CASCADE;

ALTER TABLE public.volunteers 
  ADD CONSTRAINT fk_volunteers_class FOREIGN KEY (class_id) REFERENCES public.classes (id) ON DELETE CASCADE;

ALTER TABLE public.vacations 
  ADD CONSTRAINT fk_vacations_class FOREIGN KEY (class_id) REFERENCES public.classes (id) ON DELETE CASCADE;

ALTER TABLE public.subject_avg 
  ADD CONSTRAINT fk_subject_avg_class FOREIGN KEY (class_id) REFERENCES public.classes (id) ON DELETE CASCADE;

-- Enable RLS for classes
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for reading and writing classes
CREATE POLICY "Allow anonymous select on classes" 
  ON public.classes FOR SELECT USING (true);

CREATE POLICY "Allow anonymous insert on classes" 
  ON public.classes FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous delete on classes" 
  ON public.classes FOR DELETE USING (true);
