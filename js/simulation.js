// ============================================================
// simulation.js — Random data generator for testing (async)
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

    async function generateStudents(count = 25) {
        const names = new Set();
        const students = [];
        while (students.length < count) {
            const name = pick(FIRST_NAMES) + ' ' + pick(LAST_NAMES);
            if (names.has(name)) continue;
            names.add(name);
            const s = await DB.addStudent({ name, image: null });
            if (!s.error) students.push(s);
        }
        return students;
    }

    async function generateTeachers(count = 8) {
        const names = new Set();
        const teachers = [];
        while (teachers.length < count) {
            const name = 'Prof. ' + pick(TEACHER_FIRST) + ' ' + pick(LAST_NAMES);
            if (names.has(name)) continue;
            names.add(name);
            const t = await DB.addTeacher({ name });
            if (!t.error) teachers.push(t);
        }
        return teachers;
    }

    async function generateSubjects(count = 8, teachers = null) {
        if (!teachers) teachers = DB.getTeachers();
        const subjectNames = shuffle(SUBJECT_NAMES).slice(0, count);
        const subjects = [];
        for (const name of subjectNames) {
            const teacher = pick(teachers);
            const subj = await DB.addSubject({ name, teacherId: teacher.id });
            if (!subj.error) {
                await DB.setAvgInterrogations(subj.id, randInt(1, 3));
                subjects.push(subj);
            }
        }
        return subjects;
    }

    async function generateSchedule(subjects = null) {
        if (!subjects) subjects = DB.getSubjects();
        const config = DB.getConfig();
        const schoolDays = config.schoolDays || 5;
        for (let day = 1; day <= schoolDays; day++) {
            const daySubjects = shuffle(subjects).slice(0, randInt(4, Math.min(6, subjects.length)));
            for (const subj of daySubjects) {
                await DB.addScheduleEntry({
                    subjectId: subj.id,
                    dayOfWeek: day,
                    hours: randInt(1, 3)
                });
            }
        }
    }

    async function generateHistoricalData(daysBack = 30) {
        const students = DB.getStudents();
        const subjects = DB.getSubjects();
        const schedule = DB.getSchedule();

        if (students.length === 0 || subjects.length === 0) return;

        const today = new Date();
        for (let d = daysBack; d >= 1; d--) {
            const date = new Date(today);
            date.setDate(today.getDate() - d);
            const dateStr = DB.formatDateISO(date);
            const dow = date.getDay() === 0 ? 7 : date.getDay();

            const config = DB.getConfig();
            const schoolDays = config.schoolDays || 5;

            if (dow > schoolDays) continue;

            // 10% chance of vacation day
            if (Math.random() < 0.1) {
                await DB.addVacation({ date: dateStr, note: 'Holiday' });
                continue;
            }

            // Get subjects for this day
            const daySubjects = schedule
                .filter(s => s.dayOfWeek === dow)
                .map(s => subjects.find(sub => sub.id === s.subjectId))
                .filter(Boolean);

            // Generate absences (up to 15% of students)
            const absentCount = Math.max(0, randInt(0, Math.floor(students.length * 0.15)));
            const absentStudents = shuffle(students).slice(0, absentCount);
            for (const student of absentStudents) {
                if (Math.random() < 0.6) {
                    await DB.addAbsence({ studentId: student.id, date: dateStr, subjectId: null });
                } else {
                    if (daySubjects.length > 0) {
                        await DB.addAbsence({ studentId: student.id, date: dateStr, subjectId: pick(daySubjects).id });
                    }
                }
            }

            // Generate volunteers (1 per subject, 30% chance)
            for (const subj of daySubjects) {
                if (Math.random() < 0.3) {
                    const nonAbsent = students.filter(s => !absentStudents.includes(s));
                    if (nonAbsent.length > 0) {
                        const vol = pick(nonAbsent);
                        await DB.addVolunteer({ studentId: vol.id, subjectId: subj.id, date: dateStr });
                    }
                }
            }

            // Generate interrogations
            for (const subj of daySubjects) {
                const avg = DB.getConfig().avgInterrogationsPerSubjectPerDay[subj.id] || 1;
                const count = randInt(Math.max(1, avg - 1), avg + 1);

                let eligible = students.filter(s => !absentStudents.includes(s));
                // Prefer students with fewer interrogations in this subject
                const currentInterrogs = DB.getInterrogations();
                eligible.sort((a, b) => {
                    const cA = currentInterrogs.filter(i => i.studentId === a.id && i.subjectId === subj.id).length;
                    const cB = currentInterrogs.filter(i => i.studentId === b.id && i.subjectId === subj.id).length;
                    return cA - cB + (Math.random() - 0.5);
                });

                const selected = eligible.slice(0, Math.min(count, eligible.length));
                for (const student of selected) {
                    const grade = randInt(2, 10);
                    await DB.addInterrogation({ studentId: student.id, subjectId: subj.id, date: dateStr, grade });
                }
            }
        }
    }

    async function generateAll(studentCount = 25, subjectCount = 8, teacherCount = 8, daysBack = 30) {
        await DB.resetAll();
        const teachers = await generateTeachers(teacherCount);
        const subjects = await generateSubjects(subjectCount, teachers);
        const students = await generateStudents(studentCount);
        await generateSchedule(subjects);
        await generateHistoricalData(daysBack);
        return { students: students.length, subjects: subjects.length, teachers: teachers.length };
    }

    return { generateStudents, generateTeachers, generateSubjects, generateSchedule, generateHistoricalData, generateAll };
})();
