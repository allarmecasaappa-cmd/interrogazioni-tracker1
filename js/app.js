// ============================================================
// app.js — Main Application Controller (SPA Router + UI Logic)
// ============================================================
const App = (() => {
  let currentStudentId = null;
  let currentView = 'dashboard';
  let dashboardMode = localStorage.getItem('dashboardMode') || 'daily'; // 'daily' | 'weekly'
  let selectedDate = DB.formatDateISO();

  async function init() {
    // Starting state
    const savedClassId = localStorage.getItem('currentClassId') || 'Classe-1';
    
    // Show loading indicator
    const main = document.getElementById('main-content');
    if (main) main.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#8E99A4;"><p>Connessione al database...</p></div>';

    try {
      await DB.init(SUPABASE_URL, SUPABASE_ANON_KEY, savedClassId);
      
      // Determine the default day: if it's afternoon or today has no subjects, 
      // the students usually care about the NEXT school day.
      // But we do this AFTER DB.init so we know about vacations.
      selectedDate = RiskCalculator.getNextSchoolDay(DB.formatDateISO(), true); 
      console.log("App init: Starting with school day:", selectedDate);
    } catch (e) {
      if (main) main.innerHTML = `<div style="text-align:center;padding:60px 20px;color:#FF3B30;"><h3>Errore di connessione</h3><p>${e.message}</p><p>Verifica i valori in js/config.js</p></div>`;
      return;
    }

    // Recover session
    const session = DB.getSession();
    if (session.isLoggedIn) {
      // Security/Consistency check: if student or class_admin, their class is fixed.
      // If the localStorage had a different class (e.g. they previously logged in as someone else),
      // we must force the system to load the correct class data for them.
      if (session.user.role !== 'admin' && session.user.classId && session.user.classId !== DB.getCurrentClassId()) {
        localStorage.setItem('currentClassId', session.user.classId);
        await DB.setClassId(session.user.classId);
      }

      currentStudentId = session.user.role === 'student' ? session.user.id : (parseInt(localStorage.getItem('selectedStudentId')) || null);
    }

    // --- Dark Theme Init & Toggle Wiring ---
    const savedTheme = localStorage.getItem('app_theme') || 'light';
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-theme');
      updateThemeTogglesUI(true);
    } else {
      document.body.classList.remove('dark-theme');
      updateThemeTogglesUI(false);
    }

    const toggleDesktop = document.getElementById('theme-toggle-desktop');
    const toggleMobile = document.getElementById('theme-toggle-mobile');

    function toggleTheme() {
      const isDark = document.body.classList.toggle('dark-theme');
      localStorage.setItem('app_theme', isDark ? 'dark' : 'light');
      updateThemeTogglesUI(isDark);
    }

    function updateThemeTogglesUI(isDark) {
      document.querySelectorAll('.theme-toggle-btn, .theme-toggle-btn-mobile').forEach(btn => {
        const sun = btn.querySelector('.sun-icon');
        const moon = btn.querySelector('.moon-icon');
        const label = btn.querySelector('span');
        if (isDark) {
          if (sun) sun.style.display = 'inline-block';
          if (moon) moon.style.display = 'none';
          if (label) label.textContent = 'Tema Chiaro';
        } else {
          if (sun) sun.style.display = 'none';
          if (moon) moon.style.display = 'inline-block';
          if (label) label.textContent = 'Tema Scuro';
        }
      });
    }

    if (toggleDesktop) toggleDesktop.addEventListener('click', toggleTheme);
    if (toggleMobile) toggleMobile.addEventListener('click', toggleTheme);

    // --- Offline Mode Handling ---
    const banner = document.getElementById('offline-banner');
    function updateOnlineStatus() {
      if (navigator.onLine) {
        if (banner) banner.style.display = 'none';
      } else {
        if (banner) banner.style.display = 'block';
      }
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus(); // Check on start

    // --- DB Silent Update Re-render ---
    window.addEventListener('db-updated', () => {
      console.log("DB synchronized. Refreshing current view...");
      handleRoute();
    });

    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  function handleRoute() {
    try {
      const session = DB.getSession();
      const main = document.getElementById('main-content');
      if (!main) return;

      // Auth Guard
      if (!session.isLoggedIn) {
        renderLogin(main);
        return;
      }

      // Verify user still exists in DB
      if (session.user.role === 'student' || session.user.role === 'class_admin') {
        const studentExists = DB.getStudent(session.user.id);
        if (!studentExists) {
          DB.logout();
          return;
        }
      }

      const hash = location.hash.slice(1) || 'dashboard';
      const parts = hash.split('/');
      const route = parts[0];

      // Student Restrictions
      if (session.user.role === 'student') {
        if (['admin'].includes(route)) {
          location.hash = 'dashboard';
          return;
        }
        // Students only see themselves
        currentStudentId = session.user.id;
      }

      document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(el => el.classList.remove('active'));
      document.querySelectorAll(`[data-route="${route}"]`).forEach(el => el.classList.add('active'));

      // Hide/Show Admin nav item based on role (Admin or Class Admin)
      const adminNav = document.querySelectorAll('[data-route="admin"]');
      adminNav.forEach(el => el.style.display = (session.user.role === 'admin' || session.user.role === 'class_admin') ? 'flex' : 'none');

      main.innerHTML = '';

      switch (route) {
        case 'dashboard':
          renderDashboard(main);
          break;
        case 'subject':
          renderSubjectDetail(main, parseInt(parts[1]));
          break;
        case 'registra':
          renderRegistra(main);
          break;
        case 'history':
          renderHistory(main);
          break;
        case 'admin':
          renderAdmin(main);
          break;
        default:
          renderDashboard(main);
      }
    } catch (e) {
      console.error('Routing error:', e);
      const main = document.getElementById('main-content');
      if (main) main.innerHTML = `<div class="card error-state" style="text-align:center;padding:40px 20px;"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><h3>Si è verificato un errore</h3><p style="color:#8E99A4;margin-bottom:20px;">${e.message}</p><button class="btn btn-primary" onclick="location.reload()">Ricarica Pagina</button></div>`;
    }
  }

  // ---- Login View ----
  function renderLogin(container) {
    container.innerHTML = `
      <div class="login-container">
        <div class="card login-card">
          <div class="login-header">
            <div class="login-logo">🕒</div>
            <h2>Bentornato</h2>
            <p>Accedi per gestire le tue interrogazioni</p>
          </div>
          <form id="login-form">
            <div class="form-group">
              <label>Nome Utente (Cognome Nome)</label>
              <input type="text" id="login-username" placeholder="es. Rossi Mario" required autocomplete="username">
            </div>
            <div class="form-group">
              <label>Password (4 caratteri)</label>
              <input type="password" id="login-password" placeholder="••••" required autocomplete="current-password" maxlength="10">
            </div>
            <div id="login-error" class="form-message error" style="display:none;"></div>
            <button type="submit" class="btn btn-primary btn-full">Accedi</button>
          </form>
          <div class="login-footer">
            <p>Sei un nuovo studente? Chiedi le credenziali al tuo docente.</p>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = e.target['login-username'].value.trim();
      const password = e.target['login-password'].value.trim();
      const btn = e.target.querySelector('button');
      const errorDiv = container.querySelector('#login-error');

      btn.disabled = true;
      btn.textContent = 'Verifica...';
      errorDiv.style.display = 'none';

      const res = await DB.login(username, password);
      if (res.error) {
        errorDiv.textContent = res.error;
        errorDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Accedi';
      } else {
        handleRoute();
      }
    });
  }

  // ---- Class Selector UI ----
  function updateClassSelectorUI() {
    const session = DB.getSession();
    let selector = document.getElementById('global-class-selector');

    // Students and Class Admins don't see the class selector
    if (session.user && (session.user.role === 'student' || session.user.role === 'class_admin')) {
      if (selector) selector.remove();
      return;
    }
    if (!selector) {
      selector = document.createElement('select');
      selector.id = 'global-class-selector';
      selector.className = 'class-selector';

      const header = document.querySelector('.mobile-header');
      if (header) {
        header.appendChild(selector);
      } else {
        document.body.appendChild(selector); // Fallback
      }

      selector.addEventListener('change', async (e) => {
        const newClass = e.target.value;
        localStorage.setItem('currentClassId', newClass);
        // Also clear student selection as it might not be valid in the new class
        localStorage.removeItem('selectedStudentId');
        currentStudentId = null;

        const main = document.getElementById('main-content');
        if (main) main.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#8E99A4;"><p>Caricamento classe...</p></div>';

        await DB.setClassId(newClass);
        // Refresh default date for the new class
        selectedDate = RiskCalculator.getNextSchoolDay(DB.formatDateISO(), true);
        handleRoute();
      });
    }

    // Populate options from DB
    const currentClass = DB.getCurrentClassId();
    const classes = DB.getClasses();

    // Fallback if empty (should never happen if DB is initialized properly)
    if (classes.length === 0) {
      classes.push({ id: currentClass });
    }

    selector.innerHTML = classes.map(c => {
      const val = c.id;
      return `<option value="${val}" ${currentClass === val ? 'selected' : ''}>${val}</option>`;
    }).join('');
  }

  // ---- Student Selector ----
  function renderStudentSelector(container, onChange) {
    try {
      const session = DB.getSession();
      const students = RiskCalculator.sortBySurname(DB.getStudents());

      const roleLabels = { admin: 'Admin', class_admin: 'Capoclasse', student: 'Studente' };
      const roleLabel = roleLabels[session.user.role] || 'Utente';
      const roleBg = session.user.role === 'admin' ? 'rgba(74, 144, 217, 0.15)' : (session.user.role === 'class_admin' ? 'rgba(52, 199, 89, 0.15)' : 'rgba(142, 153, 164, 0.15)');
      const roleColor = session.user.role === 'admin' ? '#3A78C4' : (session.user.role === 'class_admin' ? '#34C759' : '#8E99A4');
      const sessionInitials = RiskCalculator.getInitials(session.user.name);

      if (students.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#B0B8C1" stroke-width="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <h3>Nessuno studente configurato</h3>
            <p>Vai nel pannello Admin per aggiungere gli studenti o generare simulazioni.</p>
            <a href="#admin" class="btn btn-primary">Apri Pannello Admin</a>
          </div>`;
        return false;
      }

      if (!currentStudentId || !students.find(s => s.id === currentStudentId)) {
        currentStudentId = students[0].id;
        localStorage.setItem('selectedStudentId', currentStudentId);
      }

      const student = students.find(s => s.id === currentStudentId);

      // Student view (no selector)
      if (session.user.role === 'student') {
        const header = document.createElement('div');
        header.className = 'student-header student-view-only';
        header.innerHTML = `
          <div class="profile-circle" style="background: ${getColorForName(student.name)}">${RiskCalculator.getInitials(student.name)}</div>
          <div class="student-header-info">
            <div class="student-name-display">${student.name}</div>
            <div class="student-class-display">${DB.getCurrentClassId()}</div>
          </div>
          <div class="date-picker-row" style="margin-top: 10px; display: flex; align-items: center;">
            <input type="date" id="date-select" class="date-input" value="${selectedDate}">
            ${selectedDate === DB.formatDateISO() ? '<span class="today-badge">OGGI</span>' : ''}
            ${selectedDate === RiskCalculator.getNextSchoolDay(DB.formatDateISO()) ? '<span class="today-badge" style="background: rgba(156, 39, 176, 0.15); color: #9C27B0; border-color: rgba(156, 39, 176, 0.3);">PROSSIMO</span>' : ''}
          </div>
          <div class="user-logout-group" style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
            <div class="session-user-badge" style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; line-height: 1.2;">
              <span style="font-size: 11px; font-weight: 700; color: #1A1A2E;">${sessionInitials}</span>
              <span style="font-size: 8px; font-weight: 800; color: ${roleColor}; text-transform: uppercase; background: ${roleBg}; padding: 2px 5px; border-radius: 4px; letter-spacing: 0.3px;">${roleLabel}</span>
            </div>
            <button class="btn btn-secondary btn-sm btn-logout-icon-only" title="Esci" style="margin: 0; padding: 6px 8px; height: 32px; display: flex; align-items: center; justify-content: center;">🚪</button>
          </div>
        `;
        container.appendChild(header);

      header.querySelector('#date-select').addEventListener('input', (e) => {
        selectedDate = e.target.value || DB.formatDateISO();
        console.log("Selected date changed to:", selectedDate);
        if (onChange) onChange();
        else handleRoute();
      });

        header.querySelector('.btn-logout-icon-only')?.addEventListener('click', () => {
          if (confirm('Vuoi uscire?')) DB.logout();
        });

        return true;
      }

      // Admin or Class Admin view
      const initials = RiskCalculator.getInitials(student.name);
      const header = document.createElement('div');
      header.className = 'student-header';
      header.innerHTML = `
        <div class="profile-circle" style="background: ${getColorForName(student.name)}">${initials}</div>
        <div class="student-header-info">
          <div class="student-header-top-row">
            <select id="student-select" class="student-select">
              ${students.map(s => `<option value="${s.id}" ${s.id === currentStudentId ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
            <div class="student-class-display admin-header-class">${DB.getCurrentClassId()}</div>
          </div>
          <div class="date-picker-box">
            <input type="date" id="date-select" class="date-input" value="${selectedDate}">
            ${selectedDate === DB.formatDateISO() ? '<span class="today-badge">OGGI</span>' : ''}
            ${selectedDate === RiskCalculator.getNextSchoolDay(DB.formatDateISO()) ? '<span class="today-badge" style="background: rgba(156, 39, 176, 0.15); color: #9C27B0; border-color: rgba(156, 39, 176, 0.3);">PROSSIMO</span>' : ''}
          </div>
        </div>
        <div class="user-logout-group" style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
          <div class="session-user-badge" style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; line-height: 1.2;">
            <span style="font-size: 11px; font-weight: 700; color: #1A1A2E;">${sessionInitials}</span>
            <span style="font-size: 8px; font-weight: 800; color: ${roleColor}; text-transform: uppercase; background: ${roleBg}; padding: 2px 5px; border-radius: 4px; letter-spacing: 0.3px;">${roleLabel}</span>
          </div>
          <button class="btn btn-secondary btn-sm btn-logout-icon-only" title="Esci" style="margin: 0; padding: 6px 8px; height: 32px; display: flex; align-items: center; justify-content: center;">🚪</button>
        </div>
      `;
      container.appendChild(header);

      header.querySelector('#student-select').addEventListener('change', (e) => {
        currentStudentId = parseInt(e.target.value);
        localStorage.setItem('selectedStudentId', currentStudentId);
        if (onChange) onChange();
        else handleRoute();
      });

      header.querySelector('#date-select').addEventListener('input', (e) => {
        selectedDate = e.target.value || DB.formatDateISO();
        console.log("Admin date changed to:", selectedDate);
        if (onChange) onChange();
        else handleRoute();
      });

      header.querySelector('.btn-logout-icon-only')?.addEventListener('click', () => {
        if (confirm('Vuoi uscire?')) DB.logout();
      });

      return true;
    } catch (e) {
      console.error('Student selector error:', e);
      return false;
    }
  }

  // ---- Dashboard (Daily vs Weekly) ----
  function renderDashboard(container) {
    try {
      console.log("Rendering Dashboard. Mode:", dashboardMode, "Date:", selectedDate);
      container.innerHTML = '';
      updateClassSelectorUI();

      if (!renderStudentSelector(container, () => renderDashboard(container))) return;

      // Toggle bar (Daily vs Weekly)
      const toggleContainer = document.createElement('div');
      toggleContainer.className = 'toggle-bar';
      toggleContainer.innerHTML = `
        <button class="toggle-btn ${dashboardMode === 'daily' ? 'active' : ''}" data-mode="daily">Oggi</button>
        <button class="toggle-btn ${dashboardMode === 'weekly' ? 'active' : ''}" data-mode="weekly">Settimana</button>
      `;
      container.appendChild(toggleContainer);

      toggleContainer.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const newMode = btn.dataset.mode;
          console.log("Toggle clicked. Old:", dashboardMode, "New:", newMode);
          dashboardMode = newMode;
          localStorage.setItem('dashboardMode', dashboardMode);
          renderDashboard(container);
        });
      });

      if (dashboardMode === 'daily') {
        renderRiskDashboard(container);
      } else {
        renderWeeklyDashboard(container);
      }
    } catch (e) {
      console.error('Dashboard rendering error:', e);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'card error-state';
      errorDiv.style.cssText = 'text-align:center;padding:40px 20px;';
      errorDiv.innerHTML = `<h3>Errore durante il caricamento</h3><p>${e.message}</p>`;
      container.appendChild(errorDiv);
    }
  }

  function renderRiskDashboard(container) {
    try {
      const results = RiskCalculator.calculateAllRisks(currentStudentId, selectedDate);

      // Extract scheduled items
      const scheduledOnly = results.filter(item => item.status !== 'not-scheduled' && item.status !== 'vacation');

      if (scheduledOnly.length === 0) {
        // Is the whole day a vacation?
        const isVacation = results.some(item => item.status === 'vacation');
        
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state small';
        emptyState.innerHTML = `
          <div class="empty-icon" style="font-size: 48px; margin-bottom: 12px;">${isVacation ? '🏖️' : '🕒'}</div>
          <p style="color:#8E99A4; font-weight:600;">
            ${isVacation ? 'Oggi è un giorno di vacanza.' : 'Nessuna materia in orario per questa data.'}
          </p>
          <p style="color:#B0B8C1; font-size: 13px; margin-top: 4px;">Pianifica il tuo studio per il prossimo giorno scolastico.</p>
        `;
        container.appendChild(emptyState);
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'cards-grid';

      for (const item of scheduledOnly) {
        const card = createRiskCard(item);
        card.addEventListener('click', () => {
          location.hash = `subject/${item.subjectId}`;
        });
        grid.appendChild(card);
      }
      container.appendChild(grid);
    } catch (e) {
      console.error('Daily dashboard error:', e);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'card error-state';
      errorDiv.innerHTML = `<h3>Errore calcolo rischio giornaliero</h3><p>${e.message}</p>`;
      container.appendChild(errorDiv);
    }
  }

  function renderWeeklyDashboard(container) {
    try {
      console.log("renderWeeklyDashboard called. selectedDate:", selectedDate, "studentId:", currentStudentId);

      const dates = RiskCalculator.getWeekDates(selectedDate);
      console.log("Week dates:", dates);

      if (!dates || dates.length === 0) {
        container.insertAdjacentHTML('beforeend', `
          <div class="empty-state small" style="padding:40px 20px; text-align:center;">
            <div style="font-size:48px;margin-bottom:12px;">📅</div>
            <p style="color:#8E99A4;">Nessun giorno scolastico configurato per questa classe.</p>
            <a href="#admin" class="btn btn-secondary btn-sm" style="margin-top:12px;">Configura in Admin</a>
          </div>`);
        return;
      }

      const dayNamesMap = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Gio', 5: 'Ven', 6: 'Sab', 7: 'Dom' };

      const formatDateShort = (d) => {
        if (!d) return '—';
        const parts = d.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
      };

      // Week navigation header
      const currentD = new Date(selectedDate + 'T00:00:00');
      const prevDate = new Date(currentD); prevDate.setDate(currentD.getDate() - 7);
      const nextDate = new Date(currentD); nextDate.setDate(currentD.getDate() + 7);

      const weekNav = document.createElement('div');
      weekNav.className = 'week-navigation-header';
      weekNav.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; padding:10px 14px; background:#fff; border-radius:16px; box-shadow:0 1px 4px rgba(0,0,0,0.06);';
      weekNav.innerHTML = `
        <button class="btn btn-secondary btn-sm" id="prev-week-btn">← Prec.</button>
        <div style="font-weight:700; font-size:14px; color:#1A1A2E;">
          ${formatDateShort(dates[0])} — ${formatDateShort(dates[dates.length - 1])}
        </div>
        <button class="btn btn-secondary btn-sm" id="next-week-btn">Succ. →</button>
      `;
      container.appendChild(weekNav);

      weekNav.querySelector('#prev-week-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        selectedDate = DB.formatDateISO(prevDate);
        renderDashboard(container);
      });
      weekNav.querySelector('#next-week-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        selectedDate = DB.formatDateISO(nextDate);
        renderDashboard(container);
      });

      const weekGrid = document.createElement('div');
      weekGrid.className = 'week-grid';
      weekGrid.style.gridTemplateColumns = `repeat(${dates.length}, 1fr)`;

      for (const date of dates) {
        const d = new Date(date + 'T00:00:00');
        const dayNum = d.getDay() === 0 ? 7 : d.getDay();
        const dayName = dayNamesMap[dayNum] || '?';
        const isToday = date === DB.formatDateISO();

        const dayCol = document.createElement('div');
        dayCol.className = `week-day-column${isToday ? ' today' : ''}`;
        dayCol.innerHTML = `
          <div class="week-day-header${isToday ? ' today' : ''}">
            ${dayName}
            <span class="week-date">${formatDateShort(date)}</span>
          </div>
        `;

        // Get items for this day using calculateDashboard (same as daily, but for each day)
        let items = [];
        let isVacation = false;
        try {
          const dayResults = RiskCalculator.calculateDashboard(currentStudentId, date);
          isVacation = dayResults.some(r => r.status === 'vacation');
          items = dayResults.filter(r => r.status !== 'not-scheduled' && r.status !== 'vacation');
        } catch (dayErr) {
          console.warn("Error computing day data for", date, dayErr);
        }

        if (isVacation) {
          dayCol.insertAdjacentHTML('beforeend', `<div class="week-empty holiday" style="color:#6A1B9A; background:#F3E5F5; border-radius:12px; font-weight:600; font-size:10px; padding:10px 5px; text-align:center; margin:6px;">🏖️ VACANZA</div>`);
        } else if (items.length === 0) {
          dayCol.insertAdjacentHTML('beforeend', `<div class="week-empty" style="font-size:10px; color:#B0B8C1; text-align:center; padding:16px 0;">Nessuna lezione</div>`);
        } else {
          for (const item of items) {
            const mini = document.createElement('div');
            mini.className = `week-card risk-${getRiskLevel(item.risk)} hours-${item.hours || 1}`;
            mini.innerHTML = `
              <div class="week-subject">${item.subjectName}</div>
              <div class="week-risk">${Math.round(item.risk)}%</div>
            `;
            mini.addEventListener('click', (e) => {
              e.stopPropagation();
              selectedDate = date;
              location.hash = `subject/${item.subjectId}`;
            });
            dayCol.appendChild(mini);
          }
        }

        weekGrid.appendChild(dayCol);
      }

      container.appendChild(weekGrid);
      console.log("Weekly dashboard rendered successfully.");

    } catch (e) {
      console.error('Weekly dashboard error:', e);
      container.insertAdjacentHTML('beforeend', `
        <div class="card error-state" style="padding:24px; text-align:center; margin-top:16px;">
          <div style="font-size:36px; margin-bottom:8px;">⚠️</div>
          <h3>Impossibile caricare il calendario</h3>
          <p style="color:#8E99A4; margin-top:8px;">${e.message}</p>
          <button onclick="location.reload()" class="btn btn-primary btn-sm" style="margin-top:16px;">Ricarica Pagina</button>
        </div>`);
    }
  }

  function createRiskCard(item) {
    const card = document.createElement('div');
    card.className = `risk-card risk-${getRiskLevel(item.risk)}`;
    card.innerHTML = `
      <div class="risk-card-top">
        <div class="risk-card-info">
          <div class="risk-subject-name">${item.subjectName}</div>
          <div class="risk-teacher-name">${item.teacherName}</div>
          <div class="risk-status-badge ${item.status}">${formatStatus(item.status)}</div>
        </div>
        <div class="risk-percentage">${Math.round(item.risk)}<span class="risk-percent-sign">%</span></div>
      </div>
      <div class="risk-bar-container">
        <div class="risk-bar" style="width: ${item.risk}%; background: ${getRiskColor(item.risk)}"></div>
      </div>
      <div class="risk-explanation">${item.explanation}</div>
      <div class="risk-card-stats">
        <div class="stat-item" title="Media interrogazioni previste al giorno">
          <span class="stat-label">Media:</span>
          <span class="stat-value">${item.avgDaily || 0}</span>
        </div>
        <div class="stat-item" title="Studenti volontari oggi">
          <span class="stat-label">Volontari:</span>
          <span class="stat-value">${item.volunteerCount || 0}</span>
        </div>
        <div class="stat-item" title="Studenti assenti oggi">
          <span class="stat-label">Assenti:</span>
          <span class="stat-value">${item.absentCount || 0}</span>
        </div>
      </div>
`;
    return card;
  }

  // ---- Subject Detail ----
  function renderSubjectDetail(container, subjectId) {
    container.innerHTML = '';
    updateClassSelectorUI();
    if (!renderStudentSelector(container, () => renderSubjectDetail(container, subjectId))) return;

    const subject = DB.getSubject(subjectId);
    if (!subject) {
      container.insertAdjacentHTML('beforeend', '<div class="card"><p>Materia non trovata.</p></div>');
      return;
    }

    const teacher = subject.teacherId ? DB.getTeacher(subject.teacherId) : null;
    const riskResult = RiskCalculator.calculateRisk({
      studentId: currentStudentId,
      subjectId,
      date: selectedDate
    });

    // Personal Risk Card
    const riskCard = document.createElement('div');
    riskCard.className = `card risk-detail-card risk-${getRiskLevel(riskResult.risk)} `;
    riskCard.innerHTML = `
      <div class="risk-detail-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <h2 style="margin: 0; font-size: 20px; color: var(--text-primary);">${subject.name}</h2>
        ${teacher ? `<span class="risk-detail-teacher" style="color: #6B7280; font-size: 13px; font-weight: 600; background: #F3F4F6; padding: 4px 10px; border-radius: 20px;">👤 ${RiskCalculator.getSurname(teacher.name)}</span>` : ''}
      </div>
      <div class="risk-detail-value">
        <span class="risk-big-number">${Math.round(riskResult.risk)}</span>
        <span class="risk-big-percent">%</span>
      </div>
      <div class="risk-bar-container large">
        <div class="risk-bar" style="width: ${riskResult.risk}%; background: ${getRiskColor(riskResult.risk)}"></div>
      </div>
      <div class="risk-detail-explanation">${riskResult.explanation}</div>
      <div class="risk-detail-status">${formatStatus(riskResult.status)}</div>
      
      <div class="risk-card-stats" style="margin-top: 24px; border-top: 1px dashed #E8EAED; padding-top: 16px;">
        <div class="stat-item" title="Media interrogazioni previste al giorno">
          <span class="stat-label">Media:</span>
          <span class="stat-value" style="font-size: 15px;">${riskResult.avgDaily || 0}</span>
        </div>
        <div class="stat-item" title="Studenti volontari oggi">
          <span class="stat-label">Volontari:</span>
          <span class="stat-value" style="font-size: 15px;">${riskResult.volunteerCount || 0}</span>
        </div>
        <div class="stat-item" title="Studenti assenti oggi">
          <span class="stat-label">Assenti:</span>
          <span class="stat-value" style="font-size: 15px;">${riskResult.absentCount || 0}</span>
        </div>
      </div>
    `;
    container.appendChild(riskCard);

    // Class Statistics (expandable)
    const statsSection = document.createElement('div');
    statsSection.className = 'card expandable-section';
    const stats = RiskCalculator.classStats(subjectId, selectedDate);
    statsSection.innerHTML = `
      <div class="expandable-header" id="toggle-stats">
        <h3>Statistiche Classe</h3>
        <svg class="expand-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="expandable-content" id="stats-content" style="display:none;">
        <div class="class-stats-list">
          ${stats.map(s => `
                <div class="class-stat-row">
                  <div class="stat-circle" style="background: ${getColorForName(s.studentName)}">${s.initials}</div>
                  <div class="stat-name">${s.studentName}</div>
                  <div class="stat-risk ${getRiskLevel(s.risk)}">${Math.round(s.risk)}%</div>
                  <div class="stat-bar-container">
                    <div class="stat-bar" style="width: ${s.risk}%; background: ${getRiskColor(s.risk)}"></div>
                  </div>
                </div>
              `).join('')}
        </div>
      </div>
    `;
    container.appendChild(statsSection);
    statsSection.querySelector('#toggle-stats').addEventListener('click', () => {
      const content = statsSection.querySelector('#stats-content');
      const icon = statsSection.querySelector('.expand-icon');
      if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
      } else {
        content.style.display = 'none';
        icon.style.transform = '';
      }
    });

    // Past Interrogations
    const history = RiskCalculator.subjectHistory(currentStudentId, subjectId);
    const historySection = document.createElement('div');
    historySection.className = 'card';
    historySection.innerHTML = `
      <h3>Il tuo storico interrogazioni</h3>
    ${history.length === 0 ? '<p class="empty-text">Ancora nessuna interrogazione in questa materia.</p>' :
        `<div class="history-list">${history.map(h => `
          <div class="history-item">
            <div class="history-date">${formatDate(h.date)}</div>
            <div class="history-grade">${h.grade != null ? h.grade + '/10' : '—'}</div>
          </div>
        `).join('')}</div>`
      }
`;
    container.appendChild(historySection);

    // All class interrogations for this subject
    const allInterrogations = DB.getInterrogations()
      .filter(i => i.subjectId === subjectId)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 50);

    if (allInterrogations.length > 0) {
      const allSection = document.createElement('div');
      allSection.className = 'card expandable-section';
      allSection.innerHTML = `
        <div class="expandable-header" id = "toggle-all" >
          <h3>Ultime Interrogazioni Classe</h3>
          <svg class="expand-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="expandable-content" id="all-content" style="display:none;">
          <div class="interrogation-list">
            ${allInterrogations.map(i => {
        const stud = DB.getStudent(i.studentId);
        const initials = stud ? RiskCalculator.getInitials(stud.name) : '??';
        return `
                      <div class="interrogation-row">
                        <div class="stat-circle small" style="background: ${stud ? getColorForName(stud.name) : '#ccc'}">${initials}</div>
                        <div class="interrog-name">${stud ? stud.name : 'Unknown'}</div>
                        <div class="interrog-date">${formatDate(i.date)}</div>
                      </div>
                    `;
      }).join('')}
          </div>
        </div>
      `;
      container.appendChild(allSection);
      allSection.querySelector('#toggle-all').addEventListener('click', () => {
        const content = allSection.querySelector('#all-content');
        const icon = allSection.querySelector('.expand-icon');
        if (content.style.display === 'none') {
          content.style.display = 'block';
          icon.style.transform = 'rotate(180deg)';
        } else {
          content.style.display = 'none';
          icon.style.transform = '';
        }
      });
    }

    // Back button
    const back = document.createElement('a');
    back.href = '#dashboard';
    back.className = 'btn btn-secondary back-btn';
    back.textContent = 'Back to Dashboard';
    container.appendChild(back);
  }

  // ---- Registra (Unified Action Center) ----
  function renderRegistra(container) {
    const session = DB.getSession();
    container.innerHTML = '';
    updateClassSelectorUI();
    if (!renderStudentSelector(container, () => renderRegistra(container))) return;

    const subjects = DB.getSubjects();

    // Container for the two columns (on desktop) or stacked (on mobile)
    const layout = document.createElement('div');
    layout.className = 'registra-layout';
    container.appendChild(layout);

    // --- Main Column: Interrogation (Priority) ---
    const mainCol = document.createElement('div');
    mainCol.className = 'registra-main';
    layout.appendChild(mainCol);

    const interrogCard = document.createElement('div');
    interrogCard.className = 'card form-card primary-action';
    interrogCard.innerHTML = `
      <h2>Registra Interrogazione</h2>
      <p class="form-hint">Inserisci i dettagli dell'interrogazione avvenuta.</p>
      <form id="interrog-form">
        ${(session.user.role === 'admin' || session.user.role === 'class_admin') ? `
          <div class="form-group">
            <label>Studente</label>
            <select name="studentId" required>
              ${RiskCalculator.sortBySurname(DB.getStudents()).map(s => `<option value="${s.id}" ${s.id === currentStudentId ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
          </div>
        ` : ''}
        <div class="form-group">
          <label>Materia</label>
          <select name="subjectId" required>
            <option value="">Seleziona materia...</option>
            ${subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Data</label>
          <input type="date" name="date" value="${selectedDate}" required>
        </div>
        <div class="form-group">
          <label>Voto (opzionale)</label>
          <input type="number" name="grade" min="1" max="10" step="0.5" placeholder="es. 7.5">
        </div>
        <button type="submit" class="btn btn-primary btn-block">Salva Interrogazione</button>
        <div id="interrog-msg" class="form-message"></div>
      </form>
    `;
    mainCol.appendChild(interrogCard);

    interrogCard.querySelector('#interrog-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = {
        studentId: form.studentId ? parseInt(form.studentId.value) : currentStudentId,
        subjectId: parseInt(form.subjectId.value),
        date: form.date.value,
        grade: form.grade.value ? parseFloat(form.grade.value) : null
      };
      const result = await DB.addInterrogation(data);
      const msg = interrogCard.querySelector('#interrog-msg');
      if (result.error) {
        msg.className = 'form-message error';
        msg.textContent = result.error;
      } else {
        msg.className = 'form-message success';
        msg.textContent = 'Interrogazione registrata con successo.';
        form.reset();
        form.date.value = selectedDate;
      }
    });

    // --- Side Column: Absence & Volunteer ---
    const sideCol = document.createElement('div');
    sideCol.className = 'registra-side';
    layout.appendChild(sideCol);

    const absenceCard = document.createElement('div');
    absenceCard.className = 'card form-card secondary-action';
    absenceCard.innerHTML = `
      <h3>Segnala Assenza</h3>
      <p class="form-hint">Lo studente non sarà contato nel rischio per la data selezionata.</p>
      <form id="absence-form">
        ${(session.user.role === 'admin' || session.user.role === 'class_admin') ? `
          <div class="form-group">
            <label>Studente</label>
            <select name="studentId" required style="margin-bottom: 8px;">
              ${RiskCalculator.sortBySurname(DB.getStudents()).map(s => `<option value="${s.id}" ${s.id === currentStudentId ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
          </div>
        ` : ''}
        <div class="form-group">
          <label>Data</label>
          <input type="date" name="date" value="${selectedDate}" required>
        </div>
        <button type="submit" class="btn btn-secondary btn-block">Registra Assenza</button>
        <div id="absence-msg" class="form-message"></div>
      </form>
    `;
    sideCol.appendChild(absenceCard);

    absenceCard.querySelector('#absence-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const sId = form.studentId ? parseInt(form.studentId.value) : currentStudentId;
      const result = await DB.addAbsence({
        studentId: sId,
        date: form.date.value
      });
      const msg = absenceCard.querySelector('#absence-msg');
      if (result.error) {
        msg.className = 'form-message error';
        msg.textContent = result.error;
      } else {
        msg.className = 'form-message success';
        msg.textContent = 'Assenza registrata.';
      }
    });

    function getNextScheduledDateForSubject(subjectId, startDateStr) {
      const schedule = DB.getSchedule().filter(s => s.subjectId === subjectId);
      if (schedule.length === 0) return startDateStr;
      const scheduledDays = new Set(schedule.map(s => s.dayOfWeek));
      const vacations = new Set(DB.getVacations().map(v => v.date));

      const d = new Date(startDateStr + 'T00:00:00');
      for (let i = 0; i < 30; i++) {
        const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
        const dateISO = DB.formatDateISO(d);
        if (scheduledDays.has(dayOfWeek) && !vacations.has(dateISO)) {
          return dateISO;
        }
        d.setDate(d.getDate() + 1);
      }
      return startDateStr;
    }

    const volunteerCard = document.createElement('div');
    volunteerCard.className = 'card form-card secondary-action';
    volunteerCard.innerHTML = `
      <h3>Registra Volontario</h3>
      <p class="form-hint">Reset del ciclo interrogazioni per lo studente.</p>
      <form id="volunteer-form">
        ${(session.user.role === 'admin' || session.user.role === 'class_admin') ? `
          <div class="form-group">
            <label>Studente</label>
            <select name="studentId" required style="margin-bottom: 8px;">
              ${RiskCalculator.sortBySurname(DB.getStudents()).map(s => `<option value="${s.id}" ${s.id === currentStudentId ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
          </div>
        ` : ''}
        <div class="form-group">
          <label>Materia</label>
          <select name="subjectId" required>
            <option value="">Seleziona materia...</option>
            ${subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Data</label>
          <input type="date" name="date" value="${selectedDate}" required>
        </div>
        <button type="submit" class="btn btn-secondary btn-block">Registra Volontario</button>
        <div id="volunteer-msg" class="form-message"></div>
      </form>
    `;
    sideCol.appendChild(volunteerCard);

    const volForm = volunteerCard.querySelector('#volunteer-form');
    const volSubjSelect = volForm.querySelector('select[name="subjectId"]');
    const volDateInput = volForm.querySelector('input[name="date"]');

    volSubjSelect.addEventListener('change', () => {
      const subjectId = parseInt(volSubjSelect.value);
      if (!subjectId) return;
      const proposedDate = getNextScheduledDateForSubject(subjectId, selectedDate);
      volDateInput.value = proposedDate;
    });

    volForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const sId = form.studentId ? parseInt(form.studentId.value) : currentStudentId;
      const subjId = parseInt(form.subjectId.value);
      const chosenDate = form.date.value;

      // Client-side verification that the date is a scheduled day for the subject
      const d = new Date(chosenDate + 'T00:00:00');
      const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
      const isScheduled = DB.getSchedule().some(s => s.subjectId === subjId && s.dayOfWeek === dayOfWeek);
      const msg = volunteerCard.querySelector('#volunteer-msg');

      if (!isScheduled) {
        msg.className = 'form-message error';
        msg.textContent = 'La materia selezionata non è in orario per questo giorno della settimana.';
        return;
      }

      const result = await DB.addVolunteer({
        studentId: sId,
        subjectId: subjId,
        date: chosenDate
      });
      if (result.error) {
        msg.className = 'form-message error';
        msg.textContent = result.error;
      } else {
        msg.className = 'form-message success';
        msg.textContent = 'Volontario registrato.';
      }
    });
  }

  function renderHistory(container) {
    container.innerHTML = '';
    updateClassSelectorUI();
    if (!renderStudentSelector(container, () => renderHistory(container))) return;

    const history = DB.getInterrogations()
      .filter(i => i.studentId === currentStudentId)
      .sort((a, b) => b.date.localeCompare(a.date));

    const subjects = DB.getSubjects();

    container.innerHTML += `
        <div class="card">
          <h3>Cronologia Interrogazioni</h3>
          ${history.length === 0 ? '<p class="empty-text">Nessuna interrogazione registrata.</p>' : `
            <div class="history-list">
              ${history.map(i => {
      const subj = subjects.find(s => s.id === i.subjectId);
      return `
                  <div class="history-item">
                    <div class="history-info">
                      <div class="history-subject">${subj ? subj.name : 'Materia sconosciuta'}</div>
                      <div class="history-date">${formatDate(i.date)}</div>
                    </div>
                    <div class="history-grade">${i.grade != null ? i.grade + '/10' : '—'}</div>
                  </div>
                `;
    }).join('')}
            </div>
          `}
        </div>
      `;
  }

  function renderAdmin(container) {
    const session = DB.getSession();
    if (session.user.role !== 'admin' && session.user.role !== 'class_admin') {
      location.hash = 'dashboard';
      return;
    }

    updateClassSelectorUI();
    const currentClass = DB.getCurrentClassId();

    container.innerHTML = `
        <div class="admin-global-header" style="background: linear-gradient(135deg, #4A90D9, #3A78C4); color: white; padding: 16px 20px; border-radius: 12px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 4px 12px rgba(74, 144, 217, 0.2);">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="background: rgba(255,255,255,0.2); width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px;">⚙️</div>
            <div>
              <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.85;">Pannello di Amministrazione</div>
              <div style="font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
                Classe <span style="background: #FFFFFF; color: #4A90D9; padding: 2px 10px; border-radius: 8px; font-size: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">${currentClass}</span>
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
              ${session.user.role === 'admin' 
                ? '<div style="font-size: 11px; font-weight: 600; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid rgba(255,255,255,0.4); background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 6px;">Admin Globale</div>' 
                : '<div style="font-size: 11px; font-weight: 600; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid rgba(255,255,255,0.4); background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 6px;">Capoclasse</div>'
              }
              <button id="admin-logout-btn" class="btn-header-outline">Esci</button>
            </div>
          </div>
        </div>
        <div class="admin-tabs">
          ${session.user.role === 'admin' ? '<button class="admin-tab" data-tab="accessi">Accessi</button>' : ''}
          ${session.user.role === 'admin' ? '<button class="admin-tab active" data-tab="classes">Classi</button>' : ''}
          <button class="admin-tab ${session.user.role !== 'admin' ? 'active' : ''}" data-tab="students">Studenti</button>
          <button class="admin-tab" data-tab="subjects">Materie</button>
          <button class="admin-tab" data-tab="teachers">Docenti</button>
          <button class="admin-tab" data-tab="schedule">Orario</button>
          <button class="admin-tab" data-tab="vacations">Vacanze</button>
          <button class="admin-tab" data-tab="interrogations">Interr.</button>
          <button class="admin-tab" data-tab="absences">Assenze</button>
          <button class="admin-tab" data-tab="volunteers">Volontari</button>
          ${session.user.role === 'admin' ? `
            <button class="admin-tab" data-tab="sim">Simulazione</button>
            <button class="admin-tab" data-tab="reset">Reset</button>
          ` : ''}
        </div>
        <div id="admin-tab-content"></div>
      `;

    const tabs = container.querySelectorAll('.admin-tab');
    const content = container.querySelector('#admin-tab-content');

    const renderTab = (tab) => {
      tabs.forEach(t => t.classList.remove('active'));
      const activeTab = Array.from(tabs).find(t => t.dataset.tab === tab);
      if (activeTab) activeTab.classList.add('active');

      content.innerHTML = '';
      switch (tab) {
        case 'students': renderAdminStudents(content); break;
        case 'classes': renderAdminClasses(content); break;
        case 'accessi': renderAdminAccessi(content); break;
        case 'subjects': renderAdminSubjects(content); break;
        case 'teachers': renderAdminTeachers(content); break;
        case 'schedule': renderAdminSchedule(content); break;
        case 'vacations': renderAdminVacations(content); break;
        case 'interrogations': renderAdminInterrogations(content); break;
        case 'absences': renderAdminAbsences(content); break;
        case 'volunteers': renderAdminVolunteers(content); break;
        case 'sim': renderAdminSimulation(content); break;
        case 'reset': renderAdminReset(content); break;
      }
    };

    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        localStorage.setItem('admin_last_tab', tab);
        renderTab(tab);
      });
    });

    renderTab(localStorage.getItem('admin_last_tab') || (session.user.role === 'admin' ? 'classes' : 'students'));

    container.querySelector('#admin-logout-btn')?.addEventListener('click', () => {
      if (confirm('Vuoi uscire?')) DB.logout();
    });
  }

  function renderAdminClasses(container) {
    const classes = DB.getClasses();
    const currentClass = DB.getCurrentClassId();
    container.innerHTML = `
      <div class="card admin-card">
        <h3>Gestione Classi (${classes.length})</h3>
        <form id="add-class-form" class="admin-inline-form">
          <input type="text" name="classId" placeholder="Nome nuova classe (es. 3A)" required>
          <button type="submit" class="btn btn-primary btn-sm">Aggiungi Classe</button>
        </form>
        <div class="admin-list" id="classes-list">
          ${classes.map(c => `
            <div class="admin-list-item ${c.id === currentClass ? 'active-class-item' : ''}">
              <div class="admin-item-info">
                <span class="admin-item-name">${c.id}</span>
                ${c.id === currentClass ? '<span class="admin-item-extra" style="color:#34C759;font-weight:bold;margin-left:8px;">(Attuale)</span>' : ''}
              </div>
              <div class="admin-item-actions">
                ${c.id !== currentClass ? `<button class="btn btn-primary btn-xs" data-switch="${c.id}">Passa a questa</button>` : ''}
                <button class="btn btn-danger btn-xs" data-delete="${c.id}">Elimina</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    container.querySelector('#add-class-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const newClassId = e.target.classId.value.trim();
      const result = await DB.addClass(newClassId);
      if (result.error) {
        alert(result.error);
      } else {
        renderAdminClasses(container);
        updateClassSelectorUI();
      }
    });

    container.querySelectorAll('[data-switch]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const classId = btn.dataset.switch;
        const main = document.getElementById('main-content');
        if (main) main.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#8E99A4;"><p>Cambio classe in corso...</p></div>';

        await DB.setClassId(classId);
        localStorage.setItem('currentClassId', classId);
        localStorage.removeItem('selectedStudentId');

        handleRoute();
      });
    });

    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('ATTENZIONE: Eliminare questa classe e TUTTI i suoi dati (studenti, materie, voti, orario)? Questa azione non può essere annullata.')) {
          await DB.deleteClass(btn.dataset.delete);
          if (DB.getCurrentClassId() === btn.dataset.delete) {
            const remaining = DB.getClasses();
            if (remaining.length > 0) {
              await DB.setClassId(remaining[0].id);
              localStorage.setItem('currentClassId', remaining[0].id);
            } else {
              await DB.addClass('Classe-1');
              await DB.setClassId('Classe-1');
              localStorage.setItem('currentClassId', 'Classe-1');
            }
            localStorage.removeItem('selectedStudentId');
            handleRoute();
          } else {
            renderAdminClasses(container);
            updateClassSelectorUI();
          }
        }
      });
    });
  }

  async function renderAdminAccessi(container) {
    container.innerHTML = `<div class="card admin-card"><p>Caricamento dati accessi...</p></div>`;
    const logins = await DB.getAdminLogins();

    container.innerHTML = `
      <div class="card admin-card">
        <h3>Ultimi Accessi Amministratore (MAX 10)</h3>
        <p class="admin-hint">Verifica chi è entrato come amministratore globale di recente per monitorare la sicurezza.</p>
        <div class="admin-list scrollable" style="max-height: 400px; overflow-y: auto;">
          ${logins.length === 0 ? '<p class="empty-text">Nessun accesso registrato.</p>' :
        logins.map(l => {
          const d = new Date(l.attempted_at);
          const dateStr = d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT');
          const info = l.device_info ? l.device_info : 'Dispositivo sconosciuto';

          return `
              <div class="admin-list-item" style="display: flex; flex-direction: column; align-items: flex-start; padding: 12px;">
                <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px; color: #1A1A2E;">Data: ${dateStr}</div>
                <div style="font-size: 12px; color: #8E99A4; word-break: break-all;">Info: ${info}</div>
              </div>
            `}).join('')
      }
        </div>
      </div>
    `;
  }

  function renderAdminStudents(container) {
    const session = DB.getSession();
    const students = RiskCalculator.sortBySurname(DB.getStudents());
    const config = DB.getConfig();
    container.innerHTML = `
  <div class="card admin-card" >
        <h3>Studenti (${students.length})</h3>

        <div style="padding: 14px; background: #F5F6F8; border-radius: 12px; margin-bottom: 20px;">
          <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 10px; color: #1A1A2E;">⚙️ Parametri Ciclo Interrogazioni</h4>
          <div class="admin-inline-form" style="margin-bottom: 0;">
            <div>
              <label style="font-size: 12px; color: #8E99A4; display: block; margin-bottom: 4px;">Soglia Ciclo X%</label>
              <input type="number" id="cycle-threshold" min="10" max="100" value="${config.cycleThreshold ?? 80}" style="width: 70px;">
            </div>
            <div style="margin-left: 12px;">
              <label style="font-size: 12px; color: #8E99A4; display: block; margin-bottom: 4px;">Studenti che rientrano R</label>
              <input type="number" id="cycle-return" min="1" max="10" value="${config.cycleReturn ?? 2}" style="width: 60px;">
            </div>
            <button id="save-cycle-btn" class="btn btn-primary btn-sm">Salva</button>
          </div>
          <p style="font-size: 11px; color: #8E99A4; margin-top: 8px;">Quando X% degli studenti è stato interrogato in una materia, gli R interrogati da più tempo tornano eleggibili.</p>
          <div id="cycle-msg" class="form-message"></div>
        </div>

        <div class="admin-student-new-form-container">
          <h4>Aggiungi nuovo studente</h4>
          <form id="add-student-form" class="admin-inline-form">
            <input type="text" name="lastName" placeholder="Cognome" required style="width: 140px;">
            <input type="text" name="firstName" placeholder="Nome" required style="width: 140px;">
            <input type="text" name="password" placeholder="Pass (4 car)" maxlength="4" style="width: 100px;">
            <button type="submit" class="btn btn-primary btn-sm">Aggiungi</button>
          </form>
        </div>
        <div class="admin-list students-admin-list" id="students-list">
          ${students.map(s => `
            <div class="admin-list-item" data-id="${s.id}">
              <div class="admin-item-info">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span class="admin-item-name">${s.lastName} ${s.firstName}</span>
                  ${s.isDSA ? '<span class="student-flag-badge dsa">DSA</span>' : ''}
                  ${s.isPFP ? '<span class="student-flag-badge pfp">PFP</span>' : ''}
                  ${s.noReligion ? '<span class="student-flag-badge no-rel">No Rel.</span>' : ''}
                </div>
                <span class="admin-item-extra">Classe: <strong>${s.classId}</strong> | Pass: <strong>${s.password || '1234'}</strong> | ID: ${s.id}</span>
                <div class="admin-flags-row">
                  ${session.user.role === 'admin' ? `
                    <label style="font-size: 11px; cursor: pointer;">
                      <input type="checkbox" class="capo-checkbox" data-id="${s.id}" ${s.isClassAdmin ? 'checked' : ''}> Capoclasse
                    </label>
                  ` : ''}
                  <label style="font-size: 11px; cursor: pointer;">
                    <input type="checkbox" class="dsa-checkbox" data-id="${s.id}" ${s.isDSA ? 'checked' : ''}> DSA
                  </label>
                  <label style="font-size: 11px; cursor: pointer;">
                    <input type="checkbox" class="pfp-checkbox" data-id="${s.id}" ${s.isPFP ? 'checked' : ''}> PFP
                  </label>
                  <label style="font-size: 11px; cursor: pointer;">
                    <input type="checkbox" class="noreligion-checkbox" data-id="${s.id}" ${s.noReligion ? 'checked' : ''}> No Religione
                  </label>
                </div>
              </div>
              <div class="admin-item-actions">
                <button class="btn btn-secondary btn-xs edit-student-btn" data-id="${s.id}">Modifica</button>
                <button class="btn btn-danger btn-xs" data-delete="${s.id}">Elimina</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
  `;

    container.querySelector('#save-cycle-btn').addEventListener('click', async () => {
      const threshold = parseInt(container.querySelector('#cycle-threshold').value);
      const returnCount = parseInt(container.querySelector('#cycle-return').value);
      if (isNaN(threshold) || isNaN(returnCount) || threshold < 1 || returnCount < 1) {
        const msg = container.querySelector('#cycle-msg');
        msg.className = 'form-message error';
        msg.textContent = 'Valori non validi.';
        return;
      }
      await DB.setCycleConfig(threshold, returnCount);
      const msg = container.querySelector('#cycle-msg');
      msg.className = 'form-message success';
      msg.textContent = `Ciclo aggiornato: ${threshold}% / ${returnCount} studenti.`;
    });

    container.querySelector('#add-student-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const firstName = e.target.firstName.value.trim();
      const lastName = e.target.lastName.value.trim();
      const password = e.target.password.value.trim() || '1234';

      const result = await DB.addStudent({ firstName, lastName, password });
      if (result.error) {
        alert(result.error);
      } else {
        renderAdminStudents(container);
      }
    });
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(`Eliminare questo studente?`)) {
          await DB.deleteStudent(parseInt(btn.dataset.delete));
          renderAdminStudents(container);
        }
      });
    });

    container.querySelectorAll('.capo-checkbox').forEach(chk => {
      chk.addEventListener('change', async () => {
        const id = parseInt(chk.dataset.id);
        const student = DB.getStudent(id);
        if (student) {
          await DB.updateStudent(id, {
            firstName: student.firstName,
            lastName: student.lastName,
            password: student.password,
            isClassAdmin: chk.checked
          });
          renderAdminStudents(container);
        }
      });
    });

    // DSA flag
    container.querySelectorAll('.dsa-checkbox').forEach(chk => {
      chk.addEventListener('change', async () => {
        const id = parseInt(chk.dataset.id);
        const student = DB.getStudent(id);
        if (student) {
          await DB.updateStudent(id, {
            firstName: student.firstName,
            lastName: student.lastName,
            password: student.password,
            isDSA: chk.checked
          });
          renderAdminStudents(container);
        }
      });
    });

    // PFP flag
    container.querySelectorAll('.pfp-checkbox').forEach(chk => {
      chk.addEventListener('change', async () => {
        const id = parseInt(chk.dataset.id);
        const student = DB.getStudent(id);
        if (student) {
          await DB.updateStudent(id, {
            firstName: student.firstName,
            lastName: student.lastName,
            password: student.password,
            isPFP: chk.checked
          });
          renderAdminStudents(container);
        }
      });
    });

    // Edit student logic
    container.querySelectorAll('.edit-student-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        const student = DB.getStudent(id);
        const firstName = prompt('Nome:', student.firstName);
        if (firstName === null) return;
        const lastName = prompt('Cognome:', student.lastName);
        if (lastName === null) return;
        const password = prompt('Password:', student.password || '1234');
        if (password === null) return;

        await DB.updateStudent(id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          password: password.trim()
        });
        renderAdminStudents(container);
      });
    });

    // No Religione flag
    container.querySelectorAll('.noreligion-checkbox').forEach(chk => {
      chk.addEventListener('change', async () => {
        const id = parseInt(chk.dataset.id);
        const student = DB.getStudent(id);
        if (student) {
          await DB.updateStudent(id, {
            firstName: student.firstName,
            lastName: student.lastName,
            password: student.password,
            noReligion: chk.checked
          });
          renderAdminStudents(container);
        }
      });
    });
  }

  function renderAdminSubjects(container) {
    const subjects = DB.getSubjects();
    const teachers = DB.getTeachers();
    const config = DB.getConfig();
    container.innerHTML = `
      <div class="card admin-card">
        <h3>Materie (${subjects.length})</h3>
        <form id="add-subject-form" class="admin-inline-form">
          <input type="text" name="name" placeholder="Nome materia" required>
          <select name="teacherId">
            <option value="">Nessun docente</option>
            ${teachers.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
          </select>
          <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap;">
            <input type="checkbox" name="isReligion"> È Religione
          </label>
          <button type="submit" class="btn btn-primary btn-sm">Aggiungi</button>
        </form>
        <div class="admin-list" id="subjects-list">
          ${subjects.map(s => {
      const t = s.teacherId ? teachers.find(t => t.id === s.teacherId) : null;
      const avg = config.avgInterrogationsPerSubjectPerDay[s.id] || 1;
      return `
              <div class="admin-list-item">
                <div class="admin-item-info">
                  <div style="display:flex;align-items:center;gap:6px;">
                    <span class="admin-item-name">${s.name}</span>
                    ${s.isReligion ? '<span class="student-flag-badge no-rel" style="font-size:9px;">Religione</span>' : ''}
                  </div>
                  <span class="admin-item-detail">${t ? t.name : 'Nessun docente'}</span>
                </div>
                <div class="admin-avg-control">
                  <label>Media/giorno:</label>
                  <input type="number" min="1" max="10" value="${avg}" class="avg-input" data-subject="${s.id}">
                </div>
                <div class="admin-item-actions">
                  <label style="font-size:11px;cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;margin-right:10px;">
                    <input type="checkbox" class="religion-checkbox" data-subject-id="${s.id}" ${s.isReligion ? 'checked' : ''}> Religione
                  </label>
                  <button class="btn btn-secondary btn-xs edit-subject-btn" data-id="${s.id}">Modifica</button>
                  <button class="btn btn-danger btn-xs" data-delete="${s.id}">Elimina</button>
                </div>
              </div>
            `;
    }).join('')}
        </div>
      </div>
    `;

    container.querySelector('#add-subject-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const isReligion = e.target.isReligion.checked;
      const subj = await DB.addSubject({
        name: e.target.name.value,
        teacherId: e.target.teacherId.value ? parseInt(e.target.teacherId.value) : null,
        isReligion
      });
      await DB.setAvgInterrogations(subj.id, 1);
      renderAdminSubjects(container);
    });

    container.querySelectorAll('.avg-input').forEach(inp => {
      inp.addEventListener('change', async () => {
        await DB.setAvgInterrogations(parseInt(inp.dataset.subject), parseInt(inp.value) || 1);
      });
    });

    // Toggle religion flag
    container.querySelectorAll('.religion-checkbox').forEach(chk => {
      chk.addEventListener('change', async () => {
        const subjectId = parseInt(chk.dataset.subjectId);
        await DB.updateSubject(subjectId, { isReligion: chk.checked });
        renderAdminSubjects(container);
      });
    });

    // Modifica materia in linea
    container.querySelectorAll('.edit-subject-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        const subject = DB.getSubject(id);
        const teachers = DB.getTeachers();
        const row = btn.closest('.admin-list-item');

        row.innerHTML = `
          <div class="admin-item-info" style="flex:1;">
            <input type="text" class="edit-name-inp" value="${subject.name}" style="font-size:13px; padding:4px; margin-bottom:4px; width:100%;">
            <select class="edit-teacher-sel" style="font-size:11px; padding:2px; width:100%;">
              <option value="">Nessun docente</option>
              ${teachers.map(t => `<option value="${t.id}" ${t.id === subject.teacherId ? 'selected' : ''}>${t.name}</option>`).join('')}
            </select>
          </div>
          <div class="admin-item-actions">
            <button class="btn btn-primary btn-xs save-btn">✅</button>
            <button class="btn btn-secondary btn-xs cancel-btn">❌</button>
          </div>
        `;

        row.querySelector('.save-btn').addEventListener('click', async () => {
          const name = row.querySelector('.edit-name-inp').value.trim();
          const tId = row.querySelector('.edit-teacher-sel').value;
          if (name) {
            await DB.updateSubject(id, {
              name,
              teacherId: tId ? parseInt(tId) : null
            });
            renderAdminSubjects(container);
          }
        });

        row.querySelector('.cancel-btn').addEventListener('click', () => renderAdminSubjects(container));
      });
    });

    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(`Eliminare la materia e tutti i dati correlati?`)) {
          await DB.deleteSubject(parseInt(btn.dataset.delete));
          renderAdminSubjects(container);
        }
      });
    });
  }

  function renderAdminTeachers(container) {
    const teachers = DB.getTeachers();
    container.innerHTML = `
      <div class="card admin-card">
        <h3>Docenti (${teachers.length})</h3>
        <form id="add-teacher-form" class="admin-inline-form">
          <input type="text" name="name" placeholder="Nome completo docente" required>
          <button type="submit" class="btn btn-primary btn-sm">Aggiungi</button>
        </form>
        <div class="admin-list">
          ${teachers.map(t => `
            <div class="admin-list-item">
              <div class="admin-item-info" style="flex:1;">
                <span class="admin-item-name">${t.name}</span>
              </div>
              <div class="admin-item-actions">
                <button class="btn btn-secondary btn-xs edit-teacher-btn" data-id="${t.id}">Modifica</button>
                <button class="btn btn-danger btn-xs" data-delete="${t.id}">Elimina</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    container.querySelector('#add-teacher-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await DB.addTeacher({ name: e.target.name.value });
      renderAdminTeachers(container);
    });
    container.querySelectorAll('.edit-teacher-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        const teacher = DB.getTeacher(id);
        if (!teacher) return;

        const newName = prompt('Modifica nome docente:', teacher.name);
        if (newName && newName.trim() !== '' && newName !== teacher.name) {
          await DB.updateTeacher(id, { name: newName.trim() });
          renderAdminTeachers(container);
        }
      });
    });

    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(`Delete teacher?`)) {
          await DB.deleteTeacher(parseInt(btn.dataset.delete));
          renderAdminTeachers(container);
        }
      });
    });
  }

  function renderAdminSchedule(container) {
    const schedule = DB.getSchedule();
    const subjects = DB.getSubjects();
    const config = DB.getConfig();
    const schoolDays = config.schoolDays || 5;
    const dayNames = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

    container.innerHTML = `
      <div class="card admin-card">
        <h3>Orario (${schedule.length} voci)</h3>
        
        <div class="admin-setting-row" style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee;">
          <label>Giorni di scuola:</label>
          <select id="setting-school-days" style="padding: 4px 8px; border-radius: 6px;">
            <option value="5" ${schoolDays === 5 ? 'selected' : ''}>5 Giorni (Lun-Ven)</option>
            <option value="6" ${schoolDays === 6 ? 'selected' : ''}>6 Giorni (Lun-Sab)</option>
          </select>
        </div>

        <form id="add-schedule-form" class="admin-inline-form">
          <select name="subjectId" required>
            <option value="">Materia...</option>
            ${subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
          <select name="dayOfWeek" required>
            ${[1, 2, 3, 4, 5, 6].slice(0, schoolDays).map(d => `<option value="${d}">${dayNames[d]}</option>`).join('')}
          </select>
          <input type="number" name="hours" min="1" max="3" value="1" style="width:60px">
          <span>ore</span>
          <button type="submit" class="btn btn-primary btn-sm">Aggiungi</button>
        </form>
        <div class="schedule-grid" style="grid-template-columns: repeat(${schoolDays}, 1fr)">
          ${[1, 2, 3, 4, 5, 6].slice(0, schoolDays).map(day => {
      const daySchedule = schedule.filter(s => s.dayOfWeek === day);
      return `
              <div class="schedule-day">
                <div class="schedule-day-name">${dayNames[day]}</div>
                ${daySchedule.map(s => {
        const subj = subjects.find(sub => sub.id === s.subjectId);
        return `
                    <div class="schedule-item">
                      <span>${subj ? subj.name : '?'} (${s.hours}h)</span>
                      <button class="btn btn-danger btn-xs" data-delete="${s.id}">x</button>
                    </div>
                  `;
      }).join('')}
                ${daySchedule.length === 0 ? '<div class="empty-text">Nessuna materia</div>' : ''}
              </div>
            `;
    }).join('')}
        </div>
      </div>
    `;

    container.querySelector('#setting-school-days').addEventListener('change', async (e) => {
      await DB.setSchoolDays(parseInt(e.target.value));
      renderAdminSchedule(container);
    });

    container.querySelector('#add-schedule-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await DB.addScheduleEntry({
        subjectId: parseInt(e.target.subjectId.value),
        dayOfWeek: parseInt(e.target.dayOfWeek.value),
        hours: parseInt(e.target.hours.value) || 1
      });
      renderAdminSchedule(container);
    });
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await DB.deleteScheduleEntry(parseInt(btn.dataset.delete));
        renderAdminSchedule(container);
      });
    });
  }

  function renderAdminVacations(container) {
    const vacations = DB.getVacations().sort((a, b) => a.date.localeCompare(b.date));
    container.innerHTML = `
      <div class="card admin-card">
        <h3>Giorni di Vacanza (${vacations.length})</h3>
        <form id="add-vacation-form" class="admin-inline-form">
          <input type="date" name="startDate" title="Dal" required>
          <span style="font-size: 13px; color: #8E99A4; display: flex; align-items: center;">-</span>
          <input type="date" name="endDate" title="Al (opzionale)">
          <input type="text" name="note" placeholder="Note (es. Pasqua)">
          <button type="submit" class="btn btn-primary btn-sm">Aggiungi</button>
        </form>
        <div class="admin-list">
          ${vacations.map(v => `
            <div class="admin-list-item">
              <span class="admin-item-name">${formatDate(v.date)}</span>
              <span class="admin-item-detail">${v.note || ''}</span>
              <button class="btn btn-danger btn-xs" data-delete="${v.id}">Elimina</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    container.querySelector('#add-vacation-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const startDateStr = e.target.startDate.value;
      const endDateStr = e.target.endDate.value;
      const note = e.target.note.value;
      
      const start = new Date(startDateStr + 'T00:00:00');
      let endObj = new Date(startDateStr + 'T00:00:00');
      
      if (endDateStr) {
        const endParsed = new Date(endDateStr + 'T00:00:00');
        if (endParsed >= start) {
          endObj = endParsed;
        } else {
          alert('La data di fine non può essere precedente alla data di inizio.');
          return;
        }
      }
      
      let currentDate = new Date(start);
      let btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = '...';
      
      let errors = [];
      while (currentDate <= endObj) {
        const currentStr = DB.formatDateISO(currentDate);
        const result = await DB.addVacation({ date: currentStr, note: note });
        if (result.error && !result.error.includes('already exists')) {
          errors.push(result.error);
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      if (errors.length > 0) alert(errors.join('\\n'));
      renderAdminVacations(container);
    });
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await DB.deleteVacation(parseInt(btn.dataset.delete));
        renderAdminVacations(container);
      });
    });
  }

  function renderAdminInterrogations(container) {
    const interrogations = DB.getInterrogations().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
    const students = RiskCalculator.sortBySurname(DB.getStudents());
    const subjects = DB.getSubjects();

    container.innerHTML = `
      <div class="card admin-card">
        <h3>Interrogazioni (ultime 100)</h3>
        <form id="add-interrog-form" class="admin-inline-form">
          <select name="studentId" required>
            <option value="">Student...</option>
            ${students.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
          <select name="subjectId" required>
            <option value="">Subject...</option>
            ${subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
          <input type="date" name="date" value="${selectedDate}" required>
          <input type="number" name="grade" min="1" max="10" step="0.5" placeholder="Grade" style="width:70px">
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
        <div id="interrog-admin-msg" class="form-message"></div>
        <div class="admin-list scrollable">
          ${interrogations.map(i => {
      const stud = students.find(s => s.id === i.studentId);
      const subj = subjects.find(s => s.id === i.subjectId);
      return `
              <div class="admin-list-item">
                <span class="admin-item-name">${stud ? stud.name : '?'}</span>
                <span class="admin-item-detail">${subj ? subj.name : '?'} — ${formatDate(i.date)}${i.grade != null ? ' — ' + i.grade + '/10' : ''}</span>
                <button class="btn btn-danger btn-xs" data-delete="${i.id}">Delete</button>
              </div>
            `;
    }).join('')}
        </div>
      </div>
    `;

    container.querySelector('#add-interrog-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const result = await DB.addInterrogation({
        studentId: parseInt(form.studentId.value),
        subjectId: parseInt(form.subjectId.value),
        date: form.date.value,
        grade: form.grade.value ? parseFloat(form.grade.value) : null
      });
      const msg = container.querySelector('#interrog-admin-msg');
      if (result.error) {
        msg.className = 'form-message error';
        msg.textContent = result.error;
      } else {
        msg.className = 'form-message success';
        msg.textContent = 'Added.';
        renderAdminInterrogations(container);
      }
    });
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await DB.deleteInterrogation(parseInt(btn.dataset.delete));
        renderAdminInterrogations(container);
      });
    });
  }

  function renderAdminAbsences(container) {
    const absences = DB.getAbsences().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
    const students = RiskCalculator.sortBySurname(DB.getStudents());
    const subjects = DB.getSubjects();

    container.innerHTML = `
      <div class="card admin-card">
        <h3>Absences (showing latest 100)</h3>
        <form id="add-absence-admin-form" class="admin-inline-form">
          <select name="studentId" required>
            <option value="">Student...</option>
            ${students.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
          <select name="subjectId">
            <option value="">Full day</option>
            ${subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
          <input type="date" name="date" value="${selectedDate}" required>
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
        <div class="admin-list scrollable">
          ${absences.map(a => {
      const stud = students.find(s => s.id === a.studentId);
      const subj = a.subjectId ? subjects.find(s => s.id === a.subjectId) : null;
      return `
              <div class="admin-list-item">
                <span class="admin-item-name">${stud ? stud.name : '?'}</span>
                <span class="admin-item-detail">${formatDate(a.date)} — ${subj ? subj.name : 'Full day'}</span>
                <button class="btn btn-danger btn-xs" data-delete="${a.id}">Delete</button>
              </div>
            `;
    }).join('')}
        </div>
      </div>
    `;

    container.querySelector('#add-absence-admin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await DB.addAbsence({
        studentId: parseInt(e.target.studentId.value),
        date: e.target.date.value,
        subjectId: e.target.subjectId.value ? parseInt(e.target.subjectId.value) : null
      });
      renderAdminAbsences(container);
    });
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await DB.deleteAbsence(parseInt(btn.dataset.delete));
        renderAdminAbsences(container);
      });
    });
  }

  function renderAdminVolunteers(container) {
    const volunteers = DB.getVolunteers().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
    const students = RiskCalculator.sortBySurname(DB.getStudents());
    const subjects = DB.getSubjects();

    container.innerHTML = `
      <div class="card admin-card">
        <h3>Volunteers (showing latest 100)</h3>
        <form id="add-volunteer-admin-form" class="admin-inline-form">
          <select name="studentId" required>
            <option value="">Student...</option>
            ${students.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
          <select name="subjectId" required>
            <option value="">Subject...</option>
            ${subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
          <input type="date" name="date" value="${selectedDate}" required>
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
        <div id="vol-admin-msg" class="form-message"></div>
        <div class="admin-list scrollable">
          ${volunteers.map(v => {
      const stud = students.find(s => s.id === v.studentId);
      const subj = subjects.find(s => s.id === v.subjectId);
      return `
              <div class="admin-list-item">
                <span class="admin-item-name">${stud ? stud.name : '?'}</span>
                <span class="admin-item-detail">${subj ? subj.name : '?'} — ${formatDate(v.date)}</span>
                <button class="btn btn-danger btn-xs" data-delete="${v.id}">Delete</button>
              </div>
            `;
    }).join('')}
        </div>
      </div>
    `;

    container.querySelector('#add-volunteer-admin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const result = await DB.addVolunteer({
        studentId: parseInt(e.target.studentId.value),
        subjectId: parseInt(e.target.subjectId.value),
        date: e.target.date.value
      });
      const msg = container.querySelector('#vol-admin-msg');
      if (result.error) {
        msg.className = 'form-message error';
        msg.textContent = result.error;
      } else {
        renderAdminVolunteers(container);
      }
    });
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await DB.deleteVolunteer(parseInt(btn.dataset.delete));
        renderAdminVolunteers(container);
      });
    });
  }

  function renderAdminSimulation(container) {
    container.innerHTML = `
      <div class="card admin-card" style="border-top: 5px solid #FF3B30; background: #FFF5F5;">
        <h3 style="color: #D32F2F;">⚠️ Simulation Mode (DANGER)</h3>
        <p class="admin-hint" style="color: #C62828;">Generate random data for testing. If you provide a new class name, a new class will be created. Otherwise, the current class (${DB.getCurrentClassId()}) will be RESET and populated.</p>
        <div class="sim-controls">
          <div class="form-group" style="grid-column: span 2;">
            <label>New Class name (optional)</label>
            <input type="text" id="sim-class-name" placeholder="es. Classe-TEST (lascia vuoto per attuale)">
          </div>
          <div class="form-group">
            <label>Students</label>
            <input type="number" id="sim-students" min="5" max="40" value="25">
          </div>
          <div class="form-group">
            <label>Subjects</label>
            <input type="number" id="sim-subjects" min="3" max="15" value="8">
          </div>
          <div class="form-group">
            <label>Teachers</label>
            <input type="number" id="sim-teachers" min="3" max="15" value="8">
          </div>
          <div class="form-group">
            <label>Days of history</label>
            <input type="number" id="sim-days" min="7" max="90" value="30">
          </div>
        </div>
        <button id="sim-run" class="btn btn-danger">Generate Simulation Data</button>
        <div id="sim-msg" class="form-message"></div>
      </div>
    `;

    container.querySelector('#sim-run').addEventListener('click', async () => {
      const className = container.querySelector('#sim-class-name').value.trim();
      const targetTxt = className ? `creare la nuova classe "${className}"` : `CANCELLARE TUTTI i dati della classe attuale ("${DB.getCurrentClassId()}")`;

      if (!confirm(`Questa azione andrà a ${targetTxt} e generare dati casuali. Continuare?`)) return;
      if (!className && !confirm(`ATTENZIONE SECONDA CONFERMA: Stai per distruggere e sovrascrivere l'intera classe "${DB.getCurrentClassId()}". Sei assolutamente sicuro?`)) return;

      const btn = container.querySelector('#sim-run');
      btn.disabled = true;
      btn.textContent = 'Generando dati... (attendere)';
      const msg = container.querySelector('#sim-msg');
      msg.className = 'form-message';
      msg.textContent = 'Operazione in corso, potrebbe richiedere 20-60 secondi...';

      try {
        const result = await Simulation.generateAll(
          parseInt(container.querySelector('#sim-students').value),
          parseInt(container.querySelector('#sim-subjects').value),
          parseInt(container.querySelector('#sim-teachers').value),
          parseInt(container.querySelector('#sim-days').value),
          className || null
        );
        msg.className = 'form-message success';
        msg.textContent = `Successo! Classe: ${result.classId}. Generati: ${result.students} studenti, ${result.subjects} materie, ${result.teachers} professori.`;
        if (className) {
          setTimeout(() => handleRoute(), 1500);
        }
      } catch (e) {
        msg.className = 'form-message error';
        msg.textContent = 'Errore durante la generazione: ' + e.message;
      }
      btn.disabled = false;
      btn.textContent = 'Generate Simulation Data';
    });
  }

  function renderAdminReset(container) {
    const session = DB.getSession();
    const isGlobalAdmin = session.user.role === 'admin';

    container.innerHTML = `
      <div class="card admin-card reset-card" style="border-top: 5px solid #FF3B30; background: #FFF5F5;">
        <h3 style="color: #D32F2F;">⚠️ Reset Data (DANGER)</h3>
        <div class="reset-section">
          <h4 style="color: #C62828;">Selective Reset</h4>
          <p class="admin-hint" style="color: #D32F2F;">Delete all records of a specific type (limitato alla classe).</p>
          <div class="reset-buttons">
            ${['students', 'subjects', 'teachers', 'schedule', 'interrogations', 'absences', 'volunteers', 'vacations'].map(entity => `
              <button class="btn btn-secondary btn-sm" data-reset="${entity}">Reset ${entity}</button>
            `).join('')}
          </div>
        </div>
        ${isGlobalAdmin ? `
        <hr>
        <div class="reset-section danger">
          <h4>Full Database Reset</h4>
          <p class="admin-hint">This will permanently delete ALL data. This action cannot be undone.</p>
          <button id="reset-all-btn" class="btn btn-danger">Reset Entire Database</button>
        </div>
        ` : ''}
      </div>
    `;

    container.querySelectorAll('[data-reset]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const entity = btn.dataset.reset;
        if (!confirm(`Sei sicuro di voler ELIMINARE TUTTI i dati per: ${entity}?`)) return;
        if (!confirm(`Ulteriore conferma: L'eliminazione in blocco di "${entity}" non può essere annullata. Procedere?`)) return;
        
        btn.disabled = true;
        btn.textContent = 'Cancellando...';
        await DB.resetSelective(entity);
        btn.textContent = `${entity} cleared`;
        setTimeout(() => {
          btn.textContent = `Reset ${entity}`;
          btn.disabled = false;
        }, 2000);
      });
    });

    if (isGlobalAdmin) {
      container.querySelector('#reset-all-btn')?.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to reset the ENTIRE database?')) return;
        if (!confirm('This is your FINAL confirmation. All data will be permanently deleted. Proceed?')) return;
        await DB.resetAll();
        alert('Database has been reset.');
        location.hash = 'admin';
        renderAdmin(document.getElementById('main-content'));
      });
    }
  }

  // ---- Utility Functions ----
  function getRiskLevel(risk) {
    if (risk <= 1) return 'null';
    if (risk <= 10) return 'low';
    if (risk <= 25) return 'medium';
    if (risk <= 33) return 'high';
    return 'critical';
  }

  function getRiskColor(risk) {
    if (risk <= 1) return '#34C759';   // Verde — Nullo
    if (risk <= 10) return '#4A90D9';  // Azzurro — Basso
    if (risk <= 25) return '#FF9500';  // Arancione — Medio
    if (risk <= 33) return '#FF3B30';  // Rosso chiaro — Alto
    return '#C0392B';                  // Rosso scuro — Altissimo
  }

  function formatStatus(status) {
    const map = {
      'vacation': 'Vacanza',
      'not-scheduled': 'Non in orario',
      'absent': 'Assente',
      'volunteer': 'Volontario',
      'already-interrogated': 'Già interrogato',
      'at-risk': 'A rischio',
      'no-eligible': 'Nessun eleggibile',
      'no-slots': 'Slot coperti',
      'no-students': 'Nessuno studente',
      'no-religion': 'Non in Religione',
      'dsa-pfp': 'DSA / PFP'
    };
    return map[status] || status;
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateShort(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  function getColorForName(name) {
    const colors = [
      '#4A90D9', '#7B68EE', '#E8735A', '#50C878', '#FF8C42',
      '#6B8E8E', '#D4637A', '#8FBC8F', '#9B8EC4', '#E6A65D',
      '#5F9EA0', '#CD853F', '#708090', '#6B5B95', '#88B04B'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);

