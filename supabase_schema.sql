-- ============================================================
-- Supabase Schema — Interrogation Risk Tracker
-- Esegui questo script nel SQL Editor di Supabase
-- ============================================================

-- Students
CREATE TABLE IF NOT EXISTS students (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  image TEXT
);

-- Teachers
CREATE TABLE IF NOT EXISTS teachers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

-- Subjects
CREATE TABLE IF NOT EXISTS subjects (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  teacher_id BIGINT REFERENCES teachers(id) ON DELETE SET NULL
);

-- Schedule
CREATE TABLE IF NOT EXISTS schedule (
  id BIGSERIAL PRIMARY KEY,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  hours INT NOT NULL DEFAULT 1 CHECK (hours > 0)
);

-- Interrogations
CREATE TABLE IF NOT EXISTS interrogations (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  grade NUMERIC(4,1)
);

-- Absences
CREATE TABLE IF NOT EXISTS absences (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id BIGINT REFERENCES subjects(id) ON DELETE CASCADE,
  date DATE NOT NULL
);

-- Volunteers
CREATE TABLE IF NOT EXISTS volunteers (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  date DATE NOT NULL
);

-- Vacations
CREATE TABLE IF NOT EXISTS vacations (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  note TEXT
);

-- Config (single row, id always = 1)
CREATE TABLE IF NOT EXISTS config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  school_days INT NOT NULL DEFAULT 5,
  cycle_threshold INT NOT NULL DEFAULT 80,
  cycle_return INT NOT NULL DEFAULT 2
);
INSERT INTO config (id, school_days, cycle_threshold, cycle_return)
  VALUES (1, 5, 80, 2)
  ON CONFLICT (id) DO NOTHING;

-- Subject average interrogations per day
CREATE TABLE IF NOT EXISTS subject_avg (
  subject_id BIGINT PRIMARY KEY REFERENCES subjects(id) ON DELETE CASCADE,
  avg_per_day NUMERIC NOT NULL DEFAULT 1
);

-- ============================================================
-- Row Level Security: enable and allow all for the anon key
-- ============================================================

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE interrogations ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacations ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_avg ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all" ON students FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON teachers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON subjects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON schedule FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON interrogations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON absences FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON volunteers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON vacations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON subject_avg FOR ALL USING (true) WITH CHECK (true);
