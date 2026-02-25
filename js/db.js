// ============================================================
// db.js — localStorage-based data layer
// ============================================================
const DB = (() => {
  const STORAGE_KEY = 'interrogation_tracker';

  function formatDateISO(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function _defaultData() {
    return {
      students: [],
      subjects: [],
      teachers: [],
      schedule: [],       // { id, subjectId, dayOfWeek (1=Mon..5=Fri), hours }
      interrogations: [], // { id, studentId, subjectId, date, grade }
      absences: [],       // { id, studentId, date, subjectId (null=full day) }
      volunteers: [],     // { id, studentId, subjectId, date }
      vacations: [],      // { id, date, note }
      config: {
        avgInterrogationsPerSubjectPerDay: {}, // subjectId -> number
        schoolDays: 5,
        cycleThreshold: 80, // X%: when I >= X% of N, oldest R students re-enter pool
        cycleReturn: 2      // R: number of students returning per cycle
      },
      nextId: 1
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return _defaultData();
      const d = JSON.parse(raw);
      // ensure all keys exist
      const def = _defaultData();
      for (const k of Object.keys(def)) {
        if (!(k in d)) d[k] = def[k];
      }
      if (!d.config) d.config = def.config;
      if (!d.config.schoolDays) d.config.schoolDays = 5;
      if (d.config.cycleThreshold == null) d.config.cycleThreshold = 80;
      if (d.config.cycleReturn == null) d.config.cycleReturn = 2;
      if (!d.config.avgInterrogationsPerSubjectPerDay) d.config.avgInterrogationsPerSubjectPerDay = {};
      return d;
    } catch {
      return _defaultData();
    }
  }

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function genId(data) {
    return data.nextId++;
  }

  // ---- Students ----
  function getStudents() { return load().students; }
  function getStudent(id) { return load().students.find(s => s.id === id) || null; }
  function addStudent(s) {
    const d = load();
    s.id = genId(d);
    d.students.push(s);
    save(d);
    return s;
  }
  function updateStudent(id, updates) {
    const d = load();
    const idx = d.students.findIndex(s => s.id === id);
    if (idx === -1) return null;
    Object.assign(d.students[idx], updates);
    save(d);
    return d.students[idx];
  }
  function deleteStudent(id) {
    const d = load();
    d.students = d.students.filter(s => s.id !== id);
    d.interrogations = d.interrogations.filter(i => i.studentId !== id);
    d.absences = d.absences.filter(a => a.studentId !== id);
    d.volunteers = d.volunteers.filter(v => v.studentId !== id);
    save(d);
  }

  // ---- Subjects ----
  function getSubjects() { return load().subjects; }
  function getSubject(id) { return load().subjects.find(s => s.id === id) || null; }
  function addSubject(s) {
    const d = load();
    s.id = genId(d);
    d.subjects.push(s);
    save(d);
    return s;
  }
  function updateSubject(id, updates) {
    const d = load();
    const idx = d.subjects.findIndex(s => s.id === id);
    if (idx === -1) return null;
    Object.assign(d.subjects[idx], updates);
    save(d);
    return d.subjects[idx];
  }
  function deleteSubject(id) {
    const d = load();
    d.subjects = d.subjects.filter(s => s.id !== id);
    d.schedule = d.schedule.filter(sc => sc.subjectId !== id);
    d.interrogations = d.interrogations.filter(i => i.subjectId !== id);
    d.absences = d.absences.filter(a => a.subjectId !== id);
    d.volunteers = d.volunteers.filter(v => v.subjectId !== id);
    delete d.config.avgInterrogationsPerSubjectPerDay[id];
    save(d);
  }

  // ---- Teachers ----
  function getTeachers() { return load().teachers; }
  function getTeacher(id) { return load().teachers.find(t => t.id === id) || null; }
  function addTeacher(t) {
    const d = load();
    t.id = genId(d);
    d.teachers.push(t);
    save(d);
    return t;
  }
  function updateTeacher(id, updates) {
    const d = load();
    const idx = d.teachers.findIndex(t => t.id === id);
    if (idx === -1) return null;
    Object.assign(d.teachers[idx], updates);
    save(d);
    return d.teachers[idx];
  }
  function deleteTeacher(id) {
    const d = load();
    d.teachers = d.teachers.filter(t => t.id !== id);
    // remove teacher assignment from subjects
    d.subjects.forEach(s => { if (s.teacherId === id) s.teacherId = null; });
    save(d);
  }

  // ---- Schedule ----
  function getSchedule() { return load().schedule; }
  function addScheduleEntry(entry) {
    const d = load();
    entry.id = genId(d);
    d.schedule.push(entry);
    save(d);
    return entry;
  }
  function deleteScheduleEntry(id) {
    const d = load();
    d.schedule = d.schedule.filter(s => s.id !== id);
    save(d);
  }
  function clearSchedule() {
    const d = load();
    d.schedule = [];
    save(d);
  }

  // ---- Interrogations ----
  function getInterrogations() { return load().interrogations; }
  function addInterrogation(entry) {
    const d = load();
    // Validation: no duplicate same day + subject + student
    const dup = d.interrogations.find(i =>
      i.studentId === entry.studentId &&
      i.subjectId === entry.subjectId &&
      i.date === entry.date
    );
    if (dup) return { error: 'Duplicate interrogation for same day and subject' };
    // Validation: no interrogation on vacation day
    if (d.vacations.some(v => v.date === entry.date))
      return { error: 'Cannot add interrogation on a vacation day' };
    // Validation: conflict with absence on same day for same subject or full day
    const absConflict = d.absences.find(a =>
      a.studentId === entry.studentId &&
      a.date === entry.date &&
      (a.subjectId === null || a.subjectId === entry.subjectId)
    );
    if (absConflict) return { error: 'Student is absent on this day/subject' };

    entry.id = genId(d);
    d.interrogations.push(entry);
    save(d);
    return entry;
  }
  function updateInterrogation(id, updates) {
    const d = load();
    const idx = d.interrogations.findIndex(i => i.id === id);
    if (idx === -1) return null;
    Object.assign(d.interrogations[idx], updates);
    save(d);
    return d.interrogations[idx];
  }
  function deleteInterrogation(id) {
    const d = load();
    d.interrogations = d.interrogations.filter(i => i.id !== id);
    save(d);
  }

  // ---- Absences ----
  function getAbsences() { return load().absences; }
  function addAbsence(entry) {
    const d = load();
    entry.id = genId(d);
    d.absences.push(entry);
    save(d);
    return entry;
  }
  function updateAbsence(id, updates) {
    const d = load();
    const idx = d.absences.findIndex(a => a.id === id);
    if (idx === -1) return null;
    Object.assign(d.absences[idx], updates);
    save(d);
    return d.absences[idx];
  }
  function deleteAbsence(id) {
    const d = load();
    d.absences = d.absences.filter(a => a.id !== id);
    save(d);
  }

  // ---- Volunteers ----
  function getVolunteers() { return load().volunteers; }
  function addVolunteer(entry) {
    const d = load();
    // Validation: cannot volunteer if already interrogated for that subject on that date
    const alreadyDone = d.interrogations.find(i =>
      i.studentId === entry.studentId &&
      i.subjectId === entry.subjectId &&
      i.date === entry.date
    );
    if (alreadyDone) return { error: 'Already interrogated in this subject on this date' };
    // Check duplicate volunteer
    const dup = d.volunteers.find(v =>
      v.studentId === entry.studentId &&
      v.subjectId === entry.subjectId &&
      v.date === entry.date
    );
    if (dup) return { error: 'Already volunteered for this subject on this date' };
    entry.id = genId(d);
    d.volunteers.push(entry);
    save(d);
    return entry;
  }
  function deleteVolunteer(id) {
    const d = load();
    d.volunteers = d.volunteers.filter(v => v.id !== id);
    save(d);
  }

  // ---- Vacations ----
  function getVacations() { return load().vacations; }
  function addVacation(entry) {
    const d = load();
    if (d.vacations.some(v => v.date === entry.date))
      return { error: 'Vacation already exists for this date' };
    entry.id = genId(d);
    d.vacations.push(entry);
    save(d);
    return entry;
  }
  function deleteVacation(id) {
    const d = load();
    d.vacations = d.vacations.filter(v => v.id !== id);
    save(d);
  }

  // ---- Config ----
  function getConfig() { return load().config; }
  function setAvgInterrogations(subjectId, avg) {
    const d = load();
    d.config.avgInterrogationsPerSubjectPerDay[subjectId] = avg;
    save(d);
  }

  function setSchoolDays(days) {
    const d = load();
    d.config.schoolDays = days;
    save(d);
  }

  function setCycleConfig(threshold, returnCount) {
    const d = load();
    d.config.cycleThreshold = threshold;
    d.config.cycleReturn = returnCount;
    save(d);
  }

  // ---- Reset ----
  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
  }
  function resetSelective(entity) {
    const d = load();
    if (entity === 'students') { d.students = []; d.interrogations = []; d.absences = []; d.volunteers = []; }
    else if (entity === 'subjects') { d.subjects = []; d.schedule = []; d.interrogations = []; d.absences = []; d.volunteers = []; d.config.avgInterrogationsPerSubjectPerDay = {}; }
    else if (entity === 'teachers') { d.teachers = []; d.subjects.forEach(s => s.teacherId = null); }
    else if (entity === 'interrogations') { d.interrogations = []; }
    else if (entity === 'absences') { d.absences = []; }
    else if (entity === 'volunteers') { d.volunteers = []; }
    else if (entity === 'vacations') { d.vacations = []; }
    else if (entity === 'schedule') { d.schedule = []; }
    save(d);
  }

  return {
    formatDateISO,
    load, save, getStudents, getStudent, addStudent, updateStudent, deleteStudent,
    getSubjects, getSubject, addSubject, updateSubject, deleteSubject,
    getTeachers, getTeacher, addTeacher, updateTeacher, deleteTeacher,
    getSchedule, addScheduleEntry, deleteScheduleEntry, clearSchedule,
    getInterrogations, addInterrogation, updateInterrogation, deleteInterrogation,
    getAbsences, addAbsence, updateAbsence, deleteAbsence,
    getVolunteers, addVolunteer, deleteVolunteer,
    getVacations, addVacation, deleteVacation,
    getConfig, setAvgInterrogations, setSchoolDays, setCycleConfig,
    resetAll, resetSelective
  };
})();
