// ============================================================
// db.js — Supabase-based data layer (cache-based approach)
// ============================================================
// Strategia: manteniamo una cache in-memory.
// DB.init() carica tutto da Supabase alla startup.
// Ogni write aggiorna Supabase + la cache locale.
// Le funzioni di lettura (getStudents, load, ecc.) sono SINCRONE
// e leggono dalla cache → risk.js e app.js non richiedono async.
// Solo le funzioni di SCRITTURA sono async.
// ============================================================

const DB = (() => {

  let _client = null;
  let _cache = null;
  let _currentClassId = 'Classe-1';
  let _session = {
    user: null, // { id, name, role: 'student'|'admin', classId }
    isLoggedIn: false
  };

  // ---- helpers ----

  function formatDateISO(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function _defaultCache() {
    return {
      students: [],
      subjects: [],
      teachers: [],
      schedule: [],
      interrogations: [],
      absences: [],
      volunteers: [],
      vacations: [],
      config: {
        avgInterrogationsPerSubjectPerDay: {},
        schoolDays: 5,
        cycleThreshold: 80,
        cycleReturn: 2
      }
    };
  }

  // ---- row mappers (snake_case DB → camelCase app) ----

  function mapSubject(r) {
    return { id: r.id, name: r.name, teacherId: r.teacher_id };
  }
  function mapStudent(r) {
    return {
      id: r.id,
      name: r.name,
      firstName: r.first_name || '',
      lastName: r.last_name || '',
      password: r.password,
      classId: r.class_id,
      image: r.image,
      isClassAdmin: r.is_class_admin || false
    };
  }
  function mapSchedule(r) {
    return { id: r.id, subjectId: r.subject_id, dayOfWeek: r.day_of_week, hours: r.hours };
  }
  function mapInterrogation(r) {
    return { id: r.id, studentId: r.student_id, subjectId: r.subject_id, date: r.date, grade: r.grade };
  }
  function mapAbsence(r) {
    return { id: r.id, studentId: r.student_id, subjectId: r.subject_id, date: r.date };
  }
  function mapVolunteer(r) {
    return { id: r.id, studentId: r.student_id, subjectId: r.subject_id, date: r.date };
  }

  // ---- DB init & load ----

  async function init(url, key, classId = 'Classe-1') {
    _client = supabase.createClient(url, key);
    _currentClassId = classId;
    await _loadAll();
  }

  async function _loadAll() {
    const [
      classesRes, studRes, subjRes, teachRes, schedRes,
      interrogRes, absRes, volRes, vacRes,
      cfgRes, avgRes
    ] = await Promise.all([
      _client.from('classes').select('*'),
      _client.from('students').select('*').eq('class_id', _currentClassId),
      _client.from('subjects').select('*').eq('class_id', _currentClassId),
      _client.from('teachers').select('*').eq('class_id', _currentClassId),
      _client.from('schedule').select('*').eq('class_id', _currentClassId),
      _client.from('interrogations').select('*').eq('class_id', _currentClassId),
      _client.from('absences').select('*').eq('class_id', _currentClassId),
      _client.from('volunteers').select('*').eq('class_id', _currentClassId),
      _client.from('vacations').select('*').eq('class_id', _currentClassId),
      _client.from('config').select('*').eq('id', 1).single(),
      _client.from('subject_avg').select('*').eq('class_id', _currentClassId)
    ]);

    const cfg = cfgRes.data || {};
    const avgMap = {};
    (avgRes.data || []).forEach(r => { avgMap[r.subject_id] = r.avg_per_day; });

    _cache = {
      classes: (classesRes.data || []),
      students: (studRes.data || []).map(mapStudent),
      subjects: (subjRes.data || []).map(mapSubject),
      teachers: (teachRes.data || []),
      schedule: (schedRes.data || []).map(mapSchedule),
      interrogations: (interrogRes.data || []).map(mapInterrogation),
      absences: (absRes.data || []).map(mapAbsence),
      volunteers: (volRes.data || []).map(mapVolunteer),
      vacations: (vacRes.data || []),
      config: {
        schoolDays: cfg.school_days ?? 5,
        cycleThreshold: cfg.cycle_threshold ?? 80,
        cycleReturn: cfg.cycle_return ?? 2,
        avgInterrogationsPerSubjectPerDay: avgMap
      }
    };
  }

  // Synchronous read of the full cache (used by risk.js)
  function load() {
    return _cache || _defaultCache();
  }

  function getCurrentClassId() {
    return _currentClassId;
  }

  async function setClassId(classId) {
    _currentClassId = classId;
    if (_session.user && _session.user.role === 'admin') {
      await _loadAll();
    }
  }

  // ---- Auth & Session ----

  function getSession() {
    if (!_session.isLoggedIn) {
      const saved = localStorage.getItem('app_session');
      if (saved) {
        _session = JSON.parse(saved);
        _currentClassId = _session.user.classId || _currentClassId;
      }
    }
    return _session;
  }

  async function login(username, password) {
    // 1. Check for block (5 failed attempts in last 15 mins)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60000).toISOString();
    const { data: attempts, error: attErr } = await _client
      .from('login_attempts')
      .select('*')
      .eq('username', username)
      .eq('success', false)
      .gt('attempted_at', fifteenMinsAgo);

    if (attempts && attempts.length >= 5) {
      return { error: 'Troppi tentativi falliti. Riprova tra 15 minuti.' };
    }

    // 2. Check Admin
    if (username.toLowerCase() === 'admin') {
      const { data: admin, error: admErr } = await _client
        .from('admins')
        .select('*')
        .eq('username', 'AdMiN')
        .eq('password', password)
        .single();

      if (admin) {
        await _logAttempt(username, true);
        _session = {
          user: { id: 'admin', name: 'Admin', role: 'admin', classId: _currentClassId },
          isLoggedIn: true
        };
        localStorage.setItem('app_session', JSON.stringify(_session));
        await _loadAll();
        return { success: true, role: 'admin' };
      }
    }

    // 3. Check Student (username = "Cognome Nome")
    // Note: for simplicity we search in students table
    const allStuds = _cache ? _cache.students : [];
    // If cache not loaded, we might need a direct query. 
    // But DB.init loads everything for 'Classe-1' at start. 
    // For a login across classes, we need a cross-class search.

    const { data: student, error: studErr } = await _client
      .from('students')
      .select('*')
      .eq('password', password);

    // Manual follow-up check for name since it's split/combined
    const found = (student || []).find(s => {
      const fullName = `${s.last_name} ${s.first_name}`.toLowerCase();
      const altFullName = `${s.name}`.toLowerCase();
      return fullName === username.toLowerCase() || altFullName === username.toLowerCase();
    });

    if (found) {
      await _logAttempt(username, true);
      const role = found.is_class_admin ? 'class_admin' : 'student';
      _session = {
        user: { id: found.id, name: found.name, role: role, classId: found.class_id },
        isLoggedIn: true
      };
      _currentClassId = found.class_id;
      localStorage.setItem('app_session', JSON.stringify(_session));
      await _loadAll();
      return { success: true, role: role };
    }

    await _logAttempt(username, false);
    return { error: 'Credenziali non valide.' };
  }

  async function _logAttempt(username, success) {
    await _client.from('login_attempts').insert({ username, success });
  }

  function logout() {
    _session = { user: null, isLoggedIn: false };
    localStorage.removeItem('app_session');
    location.reload();
  }

  // ---- Classes ----

  function getClasses() {
    return (_cache || _defaultCache()).classes || [];
  }

  async function addClass(id) {
    const { data, error } = await _client
      .from('classes').insert({ id }).select().single();
    if (error) return { error: error.message };
    _cache.classes.push(data);
    return data;
  }

  async function deleteClass(id) {
    const { error } = await _client.from('classes').delete().eq('id', id);
    if (error) return { error: error.message };
    _cache.classes = _cache.classes.filter(c => c.id !== id);
    return true;
  }

  // ---- Students ----

  function getStudents() { return (_cache || _defaultCache()).students; }
  function getStudent(id) { return getStudents().find(s => s.id === id) || null; }

  async function updateStudent(id, updates) {
    // Only Global Admin can change is_class_admin
    const dbUpdates = {
      first_name: updates.firstName,
      last_name: updates.lastName,
      name: updates.lastName + ' ' + updates.firstName,
      password: updates.password,
      image: updates.image
    };

    if (_session.user && _session.user.role === 'admin' && updates.isClassAdmin !== undefined) {
      dbUpdates.is_class_admin = updates.isClassAdmin;
    }

    const { data, error } = await _client
      .from('students').update(dbUpdates).eq('id', id).select().single();
    if (error) return { error: error.message };
    const idx = _cache.students.findIndex(s => s.id === id);
    if (idx !== -1) _cache.students[idx] = mapStudent(data);
    return data;
  }

  async function addStudent(s) {
    const { data, error } = await _client
      .from('students').insert({
        first_name: s.firstName,
        last_name: s.lastName,
        name: s.lastName + ' ' + s.firstName,
        password: s.password || '1234',
        class_id: _currentClassId
      }).select().single();
    if (error) return { error: error.message };
    _cache.students.push(mapStudent(data));
    return data;
  }

  async function deleteStudent(id) {
    await _client.from('students').delete().eq('id', id);
    _cache.students = _cache.students.filter(s => s.id !== id);
    _cache.interrogations = _cache.interrogations.filter(i => i.studentId !== id);
    _cache.absences = _cache.absences.filter(a => a.studentId !== id);
    _cache.volunteers = _cache.volunteers.filter(v => v.studentId !== id);
  }

  // ---- Subjects ----

  function getSubjects() { return (_cache || _defaultCache()).subjects; }
  function getSubject(id) { return getSubjects().find(s => s.id === id) || null; }

  async function addSubject(s) {
    const { data, error } = await _client
      .from('subjects')
      .insert({ name: s.name, teacher_id: s.teacherId || null, class_id: _currentClassId })
      .select().single();
    if (error) return { error: error.message };
    const mapped = mapSubject(data);
    _cache.subjects.push(mapped);
    return mapped;
  }

  async function updateSubject(id, updates) {
    const dbUpdates = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.teacherId !== undefined) dbUpdates.teacher_id = updates.teacherId;
    const { data, error } = await _client
      .from('subjects').update(dbUpdates).eq('id', id).select().single();
    if (error) return null;
    const mapped = mapSubject(data);
    const idx = _cache.subjects.findIndex(s => s.id === id);
    if (idx !== -1) _cache.subjects[idx] = mapped;
    return mapped;
  }

  async function deleteSubject(id) {
    await _client.from('subjects').delete().eq('id', id);
    _cache.subjects = _cache.subjects.filter(s => s.id !== id);
    _cache.schedule = _cache.schedule.filter(sc => sc.subjectId !== id);
    _cache.interrogations = _cache.interrogations.filter(i => i.subjectId !== id);
    _cache.absences = _cache.absences.filter(a => a.subjectId !== id);
    _cache.volunteers = _cache.volunteers.filter(v => v.subjectId !== id);
    delete _cache.config.avgInterrogationsPerSubjectPerDay[id];
  }

  // ---- Teachers ----

  function getTeachers() { return (_cache || _defaultCache()).teachers; }
  function getTeacher(id) { return getTeachers().find(t => t.id === id) || null; }

  async function addTeacher(t) {
    const { data, error } = await _client
      .from('teachers').insert({ name: t.name, class_id: _currentClassId }).select().single();
    if (error) return { error: error.message };
    _cache.teachers.push(data);
    return data;
  }

  async function updateTeacher(id, updates) {
    const { data, error } = await _client
      .from('teachers').update({ name: updates.name }).eq('id', id).select().single();
    if (error) return null;
    const idx = _cache.teachers.findIndex(t => t.id === id);
    if (idx !== -1) _cache.teachers[idx] = data;
    return data;
  }

  async function deleteTeacher(id) {
    await _client.from('teachers').delete().eq('id', id);
    _cache.teachers = _cache.teachers.filter(t => t.id !== id);
    _cache.subjects.forEach(s => { if (s.teacherId === id) s.teacherId = null; });
  }

  // ---- Schedule ----

  function getSchedule() { return (_cache || _defaultCache()).schedule; }

  async function addScheduleEntry(entry) {
    const { data, error } = await _client
      .from('schedule')
      .insert({ subject_id: entry.subjectId, day_of_week: entry.dayOfWeek, hours: entry.hours, class_id: _currentClassId })
      .select().single();
    if (error) return { error: error.message };
    const mapped = mapSchedule(data);
    _cache.schedule.push(mapped);
    return mapped;
  }

  async function deleteScheduleEntry(id) {
    await _client.from('schedule').delete().eq('id', id);
    _cache.schedule = _cache.schedule.filter(s => s.id !== id);
  }

  async function clearSchedule() {
    await _client.from('schedule').delete().neq('id', 0);
    _cache.schedule = [];
  }

  // ---- Interrogations ----

  function getInterrogations() { return (_cache || _defaultCache()).interrogations; }

  async function addInterrogation(entry) {
    const data = _cache || _defaultCache();
    // Validation: no duplicate
    if (data.interrogations.find(i =>
      i.studentId === entry.studentId &&
      i.subjectId === entry.subjectId &&
      i.date === entry.date
    )) return { error: 'Duplicate interrogation for same day and subject' };
    // Validation: no vacation
    if (data.vacations.some(v => v.date === entry.date))
      return { error: 'Cannot add interrogation on a vacation day' };
    // Validation: absence conflict
    if (data.absences.find(a =>
      a.studentId === entry.studentId &&
      a.date === entry.date &&
      (a.subjectId === null || a.subjectId === entry.subjectId)
    )) return { error: 'Student is absent on this day/subject' };

    const { data: row, error } = await _client
      .from('interrogations')
      .insert({
        student_id: entry.studentId,
        subject_id: entry.subjectId,
        date: entry.date,
        grade: entry.grade ?? null,
        class_id: _currentClassId
      }).select().single();
    if (error) return { error: error.message };
    const mapped = mapInterrogation(row);
    _cache.interrogations.push(mapped);
    return mapped;
  }

  async function updateInterrogation(id, updates) {
    const { data, error } = await _client
      .from('interrogations').update({ grade: updates.grade }).eq('id', id).select().single();
    if (error) return null;
    const mapped = mapInterrogation(data);
    const idx = _cache.interrogations.findIndex(i => i.id === id);
    if (idx !== -1) _cache.interrogations[idx] = mapped;
    return mapped;
  }

  async function deleteInterrogation(id) {
    await _client.from('interrogations').delete().eq('id', id);
    _cache.interrogations = _cache.interrogations.filter(i => i.id !== id);
  }

  // ---- Absences ----

  function getAbsences() { return (_cache || _defaultCache()).absences; }

  async function addAbsence(entry) {
    const { data, error } = await _client
      .from('absences')
      .insert({
        student_id: entry.studentId,
        date: entry.date,
        subject_id: entry.subjectId ?? null,
        class_id: _currentClassId
      }).select().single();
    if (error) return { error: error.message };
    const mapped = mapAbsence(data);
    _cache.absences.push(mapped);
    return mapped;
  }

  async function deleteAbsence(id) {
    await _client.from('absences').delete().eq('id', id);
    _cache.absences = _cache.absences.filter(a => a.id !== id);
  }

  // ---- Volunteers ----

  function getVolunteers() { return (_cache || _defaultCache()).volunteers; }

  async function addVolunteer(entry) {
    const data = _cache || _defaultCache();
    // Validation: already interrogated
    if (data.interrogations.find(i =>
      i.studentId === entry.studentId &&
      i.subjectId === entry.subjectId &&
      i.date === entry.date
    )) return { error: 'Already interrogated in this subject on this date' };
    // Duplicate volunteer
    if (data.volunteers.find(v =>
      v.studentId === entry.studentId &&
      v.subjectId === entry.subjectId &&
      v.date === entry.date
    )) return { error: 'Already volunteered for this subject on this date' };

    const { data: row, error } = await _client
      .from('volunteers')
      .insert({
        student_id: entry.studentId,
        subject_id: entry.subjectId,
        date: entry.date,
        class_id: _currentClassId
      }).select().single();
    if (error) return { error: error.message };
    const mapped = mapVolunteer(row);
    _cache.volunteers.push(mapped);
    return mapped;
  }

  async function deleteVolunteer(id) {
    await _client.from('volunteers').delete().eq('id', id);
    _cache.volunteers = _cache.volunteers.filter(v => v.id !== id);
  }

  // ---- Vacations ----

  function getVacations() { return (_cache || _defaultCache()).vacations; }

  async function addVacation(entry) {
    const data = _cache || _defaultCache();
    if (data.vacations.some(v => v.date === entry.date))
      return { error: 'Vacation already exists for this date' };
    const { data: row, error } = await _client
      .from('vacations').insert({ date: entry.date, note: entry.note || null, class_id: _currentClassId }).select().single();
    if (error) return { error: error.message };
    _cache.vacations.push(row);
    return row;
  }

  async function deleteVacation(id) {
    await _client.from('vacations').delete().eq('id', id);
    _cache.vacations = _cache.vacations.filter(v => v.id !== id);
  }

  // ---- Config ----

  function getConfig() { return (_cache || _defaultCache()).config; }

  async function setAvgInterrogations(subjectId, avg) {
    await _client.from('subject_avg').upsert({ subject_id: subjectId, class_id: _currentClassId, avg_per_day: avg });
    _cache.config.avgInterrogationsPerSubjectPerDay[subjectId] = avg;
  }

  async function setSchoolDays(days) {
    await _client.from('config').update({ school_days: days }).eq('id', 1);
    _cache.config.schoolDays = days;
  }

  async function setCycleConfig(threshold, returnCount) {
    await _client.from('config').update({ cycle_threshold: threshold, cycle_return: returnCount }).eq('id', 1);
    _cache.config.cycleThreshold = threshold;
    _cache.config.cycleReturn = returnCount;
  }

  // ---- Reset ----

  async function resetAll() {
    // Delete in dependency order
    await Promise.all([
      _client.from('interrogations').delete().neq('id', 0),
      _client.from('absences').delete().neq('id', 0),
      _client.from('volunteers').delete().neq('id', 0),
    ]);
    await Promise.all([
      _client.from('vacations').delete().eq('class_id', _currentClassId),
      _client.from('schedule').delete().eq('class_id', _currentClassId),
      _client.from('subject_avg').delete().eq('class_id', _currentClassId),
    ]);
    await _client.from('subjects').delete().eq('class_id', _currentClassId);
    await _client.from('students').delete().eq('class_id', _currentClassId);
    await _client.from('teachers').delete().eq('class_id', _currentClassId);
    await _client.from('config').update({
      school_days: 5, cycle_threshold: 80, cycle_return: 2
    }).eq('id', 1);
    _cache = _defaultCache();
  }

  async function resetSelective(entity) {
    if (entity === 'students') {
      await Promise.all([
        _client.from('interrogations').delete().eq('class_id', _currentClassId),
        _client.from('absences').delete().eq('class_id', _currentClassId),
        _client.from('volunteers').delete().eq('class_id', _currentClassId),
      ]);
      await _client.from('students').delete().eq('class_id', _currentClassId);
      _cache.students = []; _cache.interrogations = []; _cache.absences = []; _cache.volunteers = [];
    } else if (entity === 'subjects') {
      await Promise.all([
        _client.from('interrogations').delete().eq('class_id', _currentClassId),
        _client.from('absences').delete().eq('class_id', _currentClassId),
        _client.from('volunteers').delete().eq('class_id', _currentClassId),
        _client.from('schedule').delete().eq('class_id', _currentClassId),
        _client.from('subject_avg').delete().eq('class_id', _currentClassId),
      ]);
      await _client.from('subjects').delete().eq('class_id', _currentClassId);
      _cache.subjects = []; _cache.schedule = []; _cache.interrogations = [];
      _cache.absences = []; _cache.volunteers = [];
      _cache.config.avgInterrogationsPerSubjectPerDay = {};
    } else if (entity === 'teachers') {
      await _client.from('teachers').delete().eq('class_id', _currentClassId);
      _cache.teachers = [];
      _cache.subjects.forEach(s => s.teacherId = null);
    } else if (entity === 'interrogations') {
      await _client.from('interrogations').delete().eq('class_id', _currentClassId);
      _cache.interrogations = [];
    } else if (entity === 'absences') {
      await _client.from('absences').delete().eq('class_id', _currentClassId);
      _cache.absences = [];
    } else if (entity === 'volunteers') {
      await _client.from('volunteers').delete().eq('class_id', _currentClassId);
      _cache.volunteers = [];
    } else if (entity === 'vacations') {
      await _client.from('vacations').delete().eq('class_id', _currentClassId);
      _cache.vacations = [];
    } else if (entity === 'schedule') {
      await _client.from('schedule').delete().eq('class_id', _currentClassId);
      _cache.schedule = [];
    }
  }

  return {
    formatDateISO, load, init, setClassId, getCurrentClassId,
    getStudents, getStudent, addStudent, updateStudent, deleteStudent,
    getSubjects, getSubject, addSubject, updateSubject, deleteSubject,
    getTeachers, getTeacher, addTeacher, updateTeacher, deleteTeacher,
    getSchedule, addScheduleEntry, deleteScheduleEntry, clearSchedule,
    getInterrogations, addInterrogation, updateInterrogation, deleteInterrogation,
    getAbsences, addAbsence, deleteAbsence,
    getVolunteers, addVolunteer, deleteVolunteer,
    getVacations, addVacation, deleteVacation,
    getConfig, setAvgInterrogations, setSchoolDays, setCycleConfig,
    resetAll, resetSelective,
    getClasses, addClass, deleteClass,
    getSession, login, logout
  };
})();
