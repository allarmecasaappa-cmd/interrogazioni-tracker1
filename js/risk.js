// ============================================================
// risk.js — Risk Calculation Engine
// ============================================================
const RiskCalculator = (() => {

    /**
     * Compute the "effective I" set for a subject, applying the cycle mechanic.
     *
     * How the cycle works:
     * 1. Build the full list of students interrogated in this subject at any point in history,
     *    sorted by date ASCENDING (oldest first).
     * 2. While the count of students in I >= ceil(X% * N):
     *    - Remove the R oldest students from I. They return to state Z (eligible).
     * 3. Return the remaining set as the effective "already interrogated" state.
     *
     * @param {Object} params
     * @param {number} params.subjectId
     * @param {number} params.N  - total students in class
     * @param {Object} params.data - already loaded data object (perf)
     * @returns {Set<number>} studentIds currently in state I (effectively interrogated)
     */
    /**
     * Compute the "effective I" set for a subject, applying the cycle mechanic.
     *
     * @param {Object} params
     * @param {number} params.subjectId
     * @param {number} params.N  - size of the eligible pool (not DSA/PFP, not noReligion-excluded)
     * @param {Object} params.data - already loaded data object (perf)
     * @param {Set<number>} params.eligibleStudentIds - ids of students in the eligible pool
     * @returns {Set<number>} studentIds currently in state I (effectively interrogated)
     */
    function computeCycleAdjustedI({ subjectId, N, data, eligibleStudentIds }) {
        const config = data.config;
        const threshold = config.cycleThreshold != null ? config.cycleThreshold : 80;
        const returnCount = config.cycleReturn != null ? config.cycleReturn : 2;

        // Only consider interrogations of ELIGIBLE students (not DSA/PFP)
        // so that volunteer-only interrogations don't skew the cycle.
        const subjectInterrogs = data.interrogations
            .filter(i => i.subjectId === subjectId && eligibleStudentIds.has(i.studentId))
            .sort((a, b) => a.date.localeCompare(b.date));

        const studentLastDate = new Map();
        for (const interrog of subjectInterrogs) {
            studentLastDate.set(interrog.studentId, interrog.date);
        }

        let interrogatedList = [...studentLastDate.entries()]
            .sort((a, b) => a[1].localeCompare(b[1]));

        // Apply cycle against eligible N only
        const cycleThresholdCount = Math.ceil((threshold / 100) * N);

        while (interrogatedList.length >= cycleThresholdCount && interrogatedList.length > 0) {
            const toRemove = Math.min(returnCount, interrogatedList.length);
            interrogatedList = interrogatedList.slice(toRemove);
        }

        const wasResetted = interrogatedList.length < studentLastDate.size;
        return { 
            effectiveI: new Set(interrogatedList.map(entry => entry[0])), 
            isCycleRestart: wasResetted 
        };
    }

    /**
     * Calculate risk for a single student in a single subject on a given date.
     *
     * @param {Object} params
     * @param {number} params.studentId
     * @param {number} params.subjectId
     * @param {string} params.date - ISO date string (YYYY-MM-DD)
     * @returns {Object} { risk, status, explanation }
     */
    function calculateRisk({ studentId, subjectId, date }) {
        const data = DB.load();
        const vacations = data.vacations;
        const students = data.students;
        const interrogations = data.interrogations;
        const absences = data.absences;
        const volunteers = data.volunteers;
        const config = data.config;

        // --- Find subject and student objects ---
        const subject = data.subjects.find(s => s.id === subjectId);
        const student = students.find(s => s.id === studentId);

        // Check vacation FIRST (before any config access that could throw)
        if (vacations && vacations.some(v => v.date === date)) {
            return { risk: 0, status: 'vacation', explanation: 'Giorno di vacanza', avgDaily: 1, volunteerCount: 0, absentCount: 0 };
        }

        // --- Collect Data for Statistics ---
        const absentIds = new Set(
            absences
                .filter(a => a.date === date && (a.subjectId === null || a.subjectId === subjectId))
                .map(a => a.studentId)
        );
        const volunteerIds = new Set(
            volunteers
                .filter(v => v.subjectId === subjectId && v.date === date)
                .map(v => v.studentId)
        );
        // Safe access: config.avgInterrogationsPerSubjectPerDay might be null/undefined
        const M = (config.avgInterrogationsPerSubjectPerDay && config.avgInterrogationsPerSubjectPerDay[subjectId]) || 1;

        const baseStats = {
            avgDaily: M,
            volunteerCount: volunteerIds.size,
            absentCount: absentIds.size
        };

        // Check if subject is scheduled for this day
        const dayOfWeek = getDayOfWeek(date);
        const scheduled = data.schedule.filter(s => s.subjectId === subjectId && s.dayOfWeek === dayOfWeek);
        if (scheduled.length === 0) {
            return { risk: 0, status: 'not-scheduled', explanation: 'Materia non in orario oggi', ...baseStats };
        }

        // --- noReligion check (before anything else) ---
        if (subject && subject.isReligion && student && student.noReligion) {
            return { risk: 0, status: 'no-religion', explanation: 'Non partecipi alle lezioni di religione', ...baseStats };
        }

        // --- Determine the participating pool for this subject ---
        // For religion subjects, exclude noReligion students entirely.
        const participatingStudents = (subject && subject.isReligion)
            ? students.filter(s => !s.noReligion)
            : students;

        // Eligible pool = participating students who are NOT DSA and NOT PFP
        const eligibleStudentIds = new Set(
            participatingStudents.filter(s => !s.isDSA && !s.isPFP).map(s => s.id)
        );
        const N_eligible = eligibleStudentIds.size;

        if (participatingStudents.length === 0) {
            return { risk: 0, status: 'no-students', explanation: 'Nessuno studente partecipante', ...baseStats };
        }

        // Compute effective I — only from the eligible pool, with cycle adjustment
        const { effectiveI, isCycleRestart } = computeCycleAdjustedI({ subjectId, N: N_eligible, data, eligibleStudentIds });

        // Students interrogated on this specific date
        const interrogatedToday = new Set(
            interrogations
                .filter(i => i.subjectId === subjectId && i.date === date)
                .map(i => i.studentId)
        );

        // --- Student-specific rules ---

        // 1. Volunteer → 100% (applies to everyone, including DSA/PFP)
        if (volunteerIds.has(studentId)) {
            return { risk: 100, status: 'volunteer', explanation: 'Hai dato disponibilità — verrai interrogato', ...baseStats };
        }

        // 2. DSA or PFP (and not a volunteer) → never eligible
        if (student && (student.isDSA || student.isPFP)) {
            const label = student.isDSA ? 'DSA' : 'PFP';
            return { risk: 0, status: 'dsa-pfp', explanation: `Studente ${label}: non eleggibile per interrogazione casuale`, ...baseStats };
        }

        // 3. Already interrogated (in effective I after cycle) → 0%
        if (effectiveI.has(studentId)) {
            return { risk: 0, status: 'already-interrogated', explanation: 'Già interrogato in questa materia', ...baseStats };
        }

        // 4. Absent today → 0%
        if (absentIds.has(studentId)) {
            return { risk: 0, status: 'absent', explanation: 'Sei assente oggi', ...baseStats };
        }

        // --- Class-level computation (eligible pool only) ---

        const I = effectiveI.size;

        // Absent students who are in the eligible pool
        const A_eligible = [...absentIds].filter(id => eligibleStudentIds.has(id)).length;

        // Volunteers who are in the eligible pool (they take a slot AND leave the random pool)
        const V_eligible = [...volunteerIds].filter(id => eligibleStudentIds.has(id)).length;

        // V_all: all volunteers use slots regardless of DSA/PFP status
        const V_all = volunteerIds.size;

        // E = eligible students still available for random selection
        const E = Math.max(0, N_eligible - I - A_eligible - V_eligible);

        // Available slots for random selection = M minus ALL volunteers
        const Slot = Math.max(0, M - V_all);

        if (E === 0) {
            return { risk: 0, status: 'no-eligible', explanation: 'Nessuno studente eleggibile', ...baseStats };
        }
        if (Slot === 0) {
            return { risk: 0, status: 'no-slots', explanation: 'Tutti gli slot sono coperti dai volontari', ...baseStats };
        }

        // Risk = Slot / E, clamped 0–100
        let risk = (Slot / E) * 100;
        risk = Math.max(0, Math.min(100, risk));
        risk = Math.round(risk * 10) / 10;

        const explanation = `${Slot} slot per ${E} studenti eleggibili (Int=${I}${isCycleRestart ? ' dopo ciclo' : ''})`;

        return { 
            risk, 
            status: 'at-risk', 
            explanation,
            ...baseStats
        };
    }

    /**
     * Calculate risk for all subjects for a given student on a date (scheduled only)
     */
    function calculateDashboard(studentId, date) {
        const data = DB.load();

        // Check vacation first — return a sentinel so the UI can detect it
        if (data.vacations && data.vacations.some(v => v.date === date)) {
            return [{ subjectId: null, subjectName: '—', teacherName: '—', hours: 0, risk: 0, status: 'vacation', explanation: 'Giorno di vacanza', avgDaily: 1, volunteerCount: 0, absentCount: 0 }];
        }

        const dayOfWeek = getDayOfWeek(date);

        // Aggregate schedule entries for this day to compute total hours per subject
        const scheduleForDay = data.schedule.filter(s => s.dayOfWeek === dayOfWeek);
        const subjectHoursMap = {};
        for (const s of scheduleForDay) {
            subjectHoursMap[s.subjectId] = (subjectHoursMap[s.subjectId] || 0) + (s.hours || 1);
        }
        
        const scheduledSubjectIds = Object.keys(subjectHoursMap).map(Number);

        const results = [];
        for (const subjectId of scheduledSubjectIds) {
            const subject = data.subjects.find(s => s.id === subjectId);
            if (!subject) continue;

            const teacher = subject.teacherId
                ? data.teachers.find(t => t.id === subject.teacherId)
                : null;

            const riskResult = calculateRisk({ studentId, subjectId, date });

            results.push({
                subjectId,
                subjectName: subject.name,
                teacherName: teacher ? getSurname(teacher.name) : '—',
                hours: subjectHoursMap[subjectId],
                ...riskResult
            });
        }

        return results;
    }

    /**
     * Calculate risk for ALL subjects for a given student on a date (not just scheduled)
     */
    function calculateAllRisks(studentId, date) {
        const data = DB.load();
        const results = [];

        for (const subject of data.subjects) {
            const riskResult = calculateRisk({ studentId, subjectId: subject.id, date });
            const teacher = subject.teacherId ? data.teachers.find(t => t.id === subject.teacherId) : null;

            results.push({
                subjectId: subject.id,
                subjectName: subject.name,
                teacherName: teacher ? getSurname(teacher.name) : '—',
                ...riskResult
            });
        }

        results.sort((a, b) => b.risk - a.risk);
        return results;
    }

    /**
     * Calculate weekly risk overview (Mon–N of the week containing `date`)
     */
    function calculateWeekly(studentId, date) {
        const weekDates = getWeekDates(date);
        const weekly = {};
        for (const d of weekDates) {
            weekly[d] = calculateDashboard(studentId, d);
        }
        return weekly;
    }

    /**
     * Class statistics for a subject on a date
     */
    function classStats(subjectId, date) {
        const data = DB.load();
        const results = [];
        for (const student of data.students) {
            const r = calculateRisk({ studentId: student.id, subjectId, date });
            results.push({
                studentId: student.id,
                studentName: student.name,
                firstName: student.firstName,
                lastName: student.lastName,
                initials: getInitials(student.name),
                ...r
            });
        }
        // Use unified sorting logic
        return sortBySurname(results);
    }

    /**
     * Get subject history for a student
     */
    function subjectHistory(studentId, subjectId) {
        const data = DB.load();
        return data.interrogations
            .filter(i => i.studentId === studentId && i.subjectId === subjectId)
            .sort((a, b) => b.date.localeCompare(a.date));
    }

    // ---- Helpers ----
    function getDayOfWeek(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.getDay() === 0 ? 7 : d.getDay(); // 1=Mon..7=Sun
    }

    function getWeekDates(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        const day = d.getDay() === 0 ? 7 : d.getDay();
        const monday = new Date(d);
        monday.setDate(d.getDate() - day + 1);
        const dates = [];
        const schoolDays = DB.getConfig().schoolDays || 5;
        for (let i = 0; i < schoolDays; i++) {
            const dd = new Date(monday);
            dd.setDate(monday.getDate() + i);
            dates.push(DB.formatDateISO(dd));
        }
        return dates;
    }

    function getInitials(name) {
        return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }

    function sortBySurname(array, nameProp = 'name') {
        return [...array].sort((a, b) => {
            if (a && b && a.lastName !== undefined && b.lastName !== undefined) {
                const cmp = a.lastName.toLowerCase().localeCompare(b.lastName.toLowerCase());
                if (cmp !== 0) return cmp;
                return (a.firstName || '').toLowerCase().localeCompare((b.firstName || '').toLowerCase());
            }

            const nameA = typeof a === 'string' ? a : (a[nameProp] || '');
            const nameB = typeof b === 'string' ? b : (b[nameProp] || '');
            const surnameA = nameA.split(' ').pop().toLowerCase();
            const surnameB = nameB.split(' ').pop().toLowerCase();
            return surnameA.localeCompare(surnameB);
        });
    }

    function getNextSchoolDay(dateStr, canReturnToday = false) {
        const data = DB.load();
        const config = data.config || {};
        const schoolDays = config.schoolDays || 5;
        const vacations = (data.vacations || []).map(v => v.date);

        const d = new Date(dateStr + 'T00:00:00');
        
        // If we can return today, and today is a school day and not a holiday, return it
        if (canReturnToday) {
            const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
            const dateISO = DB.formatDateISO(d);
            if (dayOfWeek <= schoolDays && !vacations.includes(dateISO)) {
                return dateISO;
            }
        }

        for (let i = 0; i < 30; i++) {
            d.setDate(d.getDate() + 1);
            const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
            const dateISO = DB.formatDateISO(d);

            if (dayOfWeek <= schoolDays && !vacations.includes(dateISO)) {
                return dateISO;
            }
        }
        return dateStr;
    }

    function getSurname(name) {
        if (!name || name === '—') return '—';
        const parts = name.trim().split(' ');
        return parts[parts.length - 1];
    }

    return { calculateRisk, calculateDashboard, calculateAllRisks, calculateWeekly, classStats, subjectHistory, getInitials, getSurname, getWeekDates, getDayOfWeek, sortBySurname, getNextSchoolDay };
})();
