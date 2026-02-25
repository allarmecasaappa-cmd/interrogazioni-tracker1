// ============================================================
// simulation.js — Random data generator for testing
// ============================================================
const Simulation = (() => {

    const FIRST_NAMES = [
        'Marco', 'Luca', 'Alessandro', 'Francesco', 'Lorenzo',
        'Matteo', 'Andrea', 'Davide', 'Gabriele', 'Riccardo',
        'Sofia', 'Giulia', 'Aurora', 'Alice', 'Ginevra',
        'Emma', 'Chiara', 'Elena', 'Martina', 'Beatrice',
        'Federico', 'Tommaso', 'Simone', 'Pietro', 'Leonardo',
        'Sara', 'Anna', 'Valentina', 'Francesca', 'Camilla'
    ];

    const LAST_NAMES = [
        'Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi',
        'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco',
        'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini',
        'Costa', 'Giordano', 'Mazza', 'Pellegrini', 'Barbieri'
    ];

    const SUBJECT_NAMES = [
        'Matematica', 'Italiano', 'Storia', 'Filosofia', 'Fisica',
        'Scienze', 'Inglese', 'Latino', 'Arte', 'Educazione Fisica',
        'Informatica', 'Chimica', 'Geografia', 'Diritto', 'Economia'
    ];

    const TEACHER_FIRST = [
        'Giuseppe', 'Maria', 'Antonio', 'Rosa', 'Giovanni',
        'Paola', 'Luigi', 'Carla', 'Vincenzo', 'Lucia',
        'Carlo', 'Francesca', 'Angelo', 'Teresa', 'Salvatore'
    ];

    function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function pick(arr) {
        return arr[randInt(0, arr.length - 1)];
    }

    function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = randInt(0, i);
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function generateStudents(count = 25) {
        const names = new Set();
        const students = [];
        while (students.length < count) {
            const name = pick(FIRST_NAMES) + ' ' + pick(LAST_NAMES);
            if (names.has(name)) continue;
            names.add(name);
            students.push(DB.addStudent({ name, image: null }));
        }
        return students;
    }

    function generateTeachers(count = 8) {
        const names = new Set();
        const teachers = [];
        while (teachers.length < count) {
            const name = 'Prof. ' + pick(TEACHER_FIRST) + ' ' + pick(LAST_NAMES);
            if (names.has(name)) continue;
            names.add(name);
            teachers.push(DB.addTeacher({ name }));
        }
        return teachers;
    }

    function generateSubjects(count = 8, teachers = null) {
        if (!teachers) teachers = DB.getTeachers();
        const subjectNames = shuffle(SUBJECT_NAMES).slice(0, count);
        const subjects = [];
        for (const name of subjectNames) {
            const teacher = pick(teachers);
            const subj = DB.addSubject({ name, teacherId: teacher.id });
            // Set avg interrogations: 1–3
            DB.setAvgInterrogations(subj.id, randInt(1, 3));
            subjects.push(subj);
        }
        return subjects;
    }

    function generateSchedule(subjects = null) {
        if (!subjects) subjects = DB.getSubjects();
        const config = DB.getConfig();
        const schoolDays = config.schoolDays || 5;
        // For each weekday, assign 4–6 subjects
        for (let day = 1; day <= schoolDays; day++) {
            const daySubjects = shuffle(subjects).slice(0, randInt(4, Math.min(6, subjects.length)));
            for (const subj of daySubjects) {
                DB.addScheduleEntry({
                    subjectId: subj.id,
                    dayOfWeek: day,
                    hours: randInt(1, 3)
                });
            }
        }
    }

    function generateHistoricalData(daysBack = 30) {
        const students = DB.getStudents();
        const subjects = DB.getSubjects();
        const schedule = DB.getSchedule();
        const data = DB.load();

        if (students.length === 0 || subjects.length === 0) return;

        const today = new Date();
        for (let d = daysBack; d >= 1; d--) {
            const date = new Date(today);
            date.setDate(today.getDate() - d);
            const dateStr = DB.formatDateISO(date);
            const dow = date.getDay() === 0 ? 7 : date.getDay();

            const config = DB.getConfig();
            const schoolDays = config.schoolDays || 5;

            // Skip weekends based on config
            if (dow > schoolDays) continue;

            // 10% chance of vacation day
            if (Math.random() < 0.1) {
                DB.addVacation({ date: dateStr, note: 'Holiday' });
                continue;
            }

            // Get subjects for this day
            const daySubjects = schedule
                .filter(s => s.dayOfWeek === dow)
                .map(s => subjects.find(sub => sub.id === s.subjectId))
                .filter(Boolean);

            // Generate absences (10% of students per day)
            const absentCount = Math.max(0, randInt(0, Math.floor(students.length * 0.15)));
            const absentStudents = shuffle(students).slice(0, absentCount);
            for (const student of absentStudents) {
                if (Math.random() < 0.6) {
                    // Full day absence
                    DB.addAbsence({ studentId: student.id, date: dateStr, subjectId: null });
                } else {
                    // Subject-specific absence
                    if (daySubjects.length > 0) {
                        DB.addAbsence({ studentId: student.id, date: dateStr, subjectId: pick(daySubjects).id });
                    }
                }
            }

            // Generate volunteers (1–2 per subject, 30% chance)
            for (const subj of daySubjects) {
                if (Math.random() < 0.3) {
                    const nonAbsent = students.filter(s => !absentStudents.includes(s));
                    if (nonAbsent.length > 0) {
                        const vol = pick(nonAbsent);
                        DB.addVolunteer({ studentId: vol.id, subjectId: subj.id, date: dateStr });
                    }
                }
            }

            // Generate interrogations
            for (const subj of daySubjects) {
                const avg = data.config.avgInterrogationsPerSubjectPerDay[subj.id] || 1;
                const count = randInt(Math.max(1, avg - 1), avg + 1);

                // Prioritize students not already interrogated in the last X days to vary data
                let eligible = students.filter(s => !absentStudents.includes(s));

                // Simple heuristic for simulation: prefer those with fewer interrogations in this subject
                eligible.sort((a, b) => {
                    const countA = DB.getInterrogations().filter(i => i.studentId === a.id && i.subjectId === subj.id).length;
                    const countB = DB.getInterrogations().filter(i => i.studentId === b.id && i.subjectId === subj.id).length;
                    return countA - countB + (Math.random() - 0.5); // Add some noise
                });

                const selected = eligible.slice(0, Math.min(count, eligible.length));
                for (const student of selected) {
                    const grade = randInt(2, 10);
                    DB.addInterrogation({ studentId: student.id, subjectId: subj.id, date: dateStr, grade });
                }
            }
        }
    }

    function generateAll() {
        DB.resetAll();
        const teachers = generateTeachers(8);
        const subjects = generateSubjects(8, teachers);
        const students = generateStudents(25);
        generateSchedule(subjects);
        generateHistoricalData(30);
        return { students: students.length, subjects: subjects.length, teachers: teachers.length };
    }

    return { generateStudents, generateTeachers, generateSubjects, generateSchedule, generateHistoricalData, generateAll };
})();
