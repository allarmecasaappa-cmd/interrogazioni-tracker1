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
    function computeCycleAdjustedI({ subjectId, N, data }) {
        const config = data.config;
        const threshold = config.cycleThreshold != null ? config.cycleThreshold : 80;
        const returnCount = config.cycleReturn != null ? config.cycleReturn : 2;

        // All interrogations for this subject, sorted by date ASC (oldest first)
        const subjectInterrogs = data.interrogations
            .filter(i => i.subjectId === subjectId)
            .sort((a, b) => a.date.localeCompare(b.date));

        // Build a map: studentId -> latest interrogation date in this subject
        // We process in chronological order; later entries overwrite earlier ones.
        // Students are ordered by their MOST RECENT interrogation date for removal priority.
        // We maintain the list as: oldest-most-recent-date first.
        const studentLastDate = new Map();
        for (const interrog of subjectInterrogs) {
            studentLastDate.set(interrog.studentId, interrog.date);
        }

        // Convert to sorted array: [studentId, lastDate] sorted by lastDate ASC (oldest first)
        let interrogatedList = [...studentLastDate.entries()]
            .sort((a, b) => a[1].localeCompare(b[1]));

        // Apply cycle: while I count >= threshold% of N, remove the R oldest
        const cycleThresholdCount = Math.ceil((threshold / 100) * N);

        while (interrogatedList.length >= cycleThresholdCount && interrogatedList.length > 0) {
            // Remove the R oldest students
            const toRemove = Math.min(returnCount, interrogatedList.length);
            interrogatedList = interrogatedList.slice(toRemove);
        }

        return new Set(interrogatedList.map(entry => entry[0]));
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

        // Check vacation
        if (vacations.some(v => v.date === date)) {
            return { risk: 0, status: 'vacation', explanation: 'Giorno di vacanza' };
        }

        // Check if subject is scheduled for this day
        const dayOfWeek = getDayOfWeek(date);
        const scheduled = data.schedule.filter(s => s.subjectId === subjectId && s.dayOfWeek === dayOfWeek);
        if (scheduled.length === 0) {
            return { risk: 0, status: 'not-scheduled', explanation: 'Materia non in orario oggi' };
        }

        const N = students.length;
        if (N === 0) return { risk: 0, status: 'no-students', explanation: 'Nessuno studente in classe' };

        // Compute effective I with cycle adjustment
        const effectiveI = computeCycleAdjustedI({ subjectId, N, data });

        // Students interrogated on this specific date (for slots/eligible counting)
        const interrogatedToday = new Set(
            interrogations
                .filter(i => i.subjectId === subjectId && i.date === date)
                .map(i => i.studentId)
        );

        // Students absent (full day or this subject) on date
        const absentIds = new Set(
            absences
                .filter(a => a.date === date && (a.subjectId === null || a.subjectId === subjectId))
                .map(a => a.studentId)
        );
        const A = absentIds.size;

        // Volunteers for this subject on this date
        const volunteerIds = new Set(
            volunteers
                .filter(v => v.subjectId === subjectId && v.date === date)
                .map(v => v.studentId)
        );
        const V = volunteerIds.size;

        // Average interrogations per day for this subject
        const M = config.avgInterrogationsPerSubjectPerDay[subjectId] || 1;

        // --- Student-specific rules (checked first) ---

        // 1. Volunteer → 100%
        if (volunteerIds.has(studentId)) {
            return { risk: 100, status: 'volunteer', explanation: 'Hai dato disponibilità — verrai interrogato' };
        }

        // 2. Already interrogated (in effective I after cycle) → 0%
        if (effectiveI.has(studentId)) {
            return { risk: 0, status: 'already-interrogated', explanation: 'Già interrogato in questa materia' };
        }

        // 3. Absent today → 0%
        if (absentIds.has(studentId)) {
            return { risk: 0, status: 'absent', explanation: 'Sei assente oggi' };
        }

        // --- Class-level computation ---

        // I for slot computation = students in effective I set
        const I = effectiveI.size;

        // Eligible = N - I - A - V (but I has already been cycle-adjusted)
        const E = Math.max(0, N - I - A - V);

        // Available slots = max(0, M - V)
        const Slot = Math.max(0, M - V);

        if (E === 0) {
            return { risk: 0, status: 'no-eligible', explanation: 'Nessuno studente eleggibile' };
        }
        if (Slot === 0) {
            return { risk: 0, status: 'no-slots', explanation: 'Tutti gli slot sono coperti dai volontari' };
        }

        // Risk = Slot / E, clamped 0–100
        let risk = (Slot / E) * 100;
        risk = Math.max(0, Math.min(100, risk));
        risk = Math.round(risk * 10) / 10;

        const explanation = `${Slot} slot per ${E} studenti eleggibili (I=${I} dopo ciclo)`;

        return { risk, status: 'at-risk', explanation };
    }

    /**
     * Calculate risk for all subjects for a given student on a date (scheduled only)
     */
    function calculateDashboard(studentId, date) {
        const data = DB.load();
        const dayOfWeek = getDayOfWeek(date);

        const scheduledSubjectIds = [...new Set(
            data.schedule
                .filter(s => s.dayOfWeek === dayOfWeek)
                .map(s => s.subjectId)
        )];

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
                initials: getInitials(student.name),
                ...r
            });
        }
        // Sort by surname (last word of the name)
        results.sort((a, b) => {
            const surnameA = a.studentName.split(' ').pop().toLowerCase();
            const surnameB = b.studentName.split(' ').pop().toLowerCase();
            return surnameA.localeCompare(surnameB);
        });
        return results;
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

    function getNextSchoolDay(dateStr) {
        const data = DB.load();
        const schoolDays = data.config.schoolDays || 5;
        const vacations = data.vacations.map(v => v.date);

        const d = new Date(dateStr + 'T00:00:00');
        for (let i = 0; i < 30; i++) {
            d.setDate(d.getDate() + 1);
            const currentStr = DB.formatDateISO(d);
            const day = d.getDay() === 0 ? 7 : d.getDay();

            if (day <= schoolDays && !vacations.includes(currentStr)) {
                return currentStr;
            }
        }
        return DB.formatDateISO(d);
    }

    function getSurname(name) {
        if (!name || name === '—') return '—';
        const parts = name.trim().split(' ');
        return parts[parts.length - 1];
    }

    return { calculateRisk, calculateDashboard, calculateAllRisks, calculateWeekly, classStats, subjectHistory, getInitials, getSurname, getWeekDates, getDayOfWeek, sortBySurname, getNextSchoolDay };
})();
