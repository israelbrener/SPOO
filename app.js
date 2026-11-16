(() => {
  'use strict';

  // Keep the original key so existing profiles retain their personal details.
  const STORAGE_KEY = 'vexyro.design-profile.v1';
  const PLAN_KEY = 'vexyro.training-plan.v1';
  const ACTIVE_KEY = 'vexyro.active-workout.v1';
  const HISTORY_KEY = 'vexyro.workout-history.v1';
  const CONTEXT_KEY = 'vexyro.training-context.v1';
  const MEMBERSHIP_KEY = 'vexyro.membership-choice.v1';
  const engine = window.VEXYRO_PLAN;
  const runner = window.VEXYRO_WORKOUT;
  const training = window.VEXYRO_TRAINING;
  const guidance = window.VEXYRO_GUIDANCE;
  const historyUI = window.VEXYRO_HISTORY;
  const cloud = window.VEXYRO_ACCOUNT;
  const videoLibrary = window.VEXYRO_VIDEO_LIBRARY;
  const catalog = window.VEXYRO_EXERCISES;
  const schedule = window.VEXYRO_SCHEDULE;
  const screens = ['welcome', 'details', 'membership', 'account', 'videos', 'home', 'history', 'plan-setup', 'plan', 'workout', 'library', 'picker', 'active', 'workout-result'];
  const membershipPlans = Object.freeze({
    trial: { name: 'שבוע חינם', summary: 'שבוע ניסיון · 0 ₪', selected: 'בחרת שבוע ניסיון ללא תשלום.' },
    monthly: { name: 'המסלול החודשי', summary: 'מסלול חודשי · 5 ₪ לחודש', selected: 'בחרת מסלול חודשי במחיר 5 ₪ לחודש.' },
    yearly: { name: 'המסלול השנתי', summary: 'מסלול שנתי · 50 ₪ לשנה', selected: 'בחרת מסלול שנתי במחיר 50 ₪ לשנה.' },
  });
  const GROUP_LABELS = { legs: 'רגליים וישבן', chest: 'חזה', back: 'גב', shoulders: 'כתפיים', arms: 'ידיים', core: 'בטן וליבה', mobility: 'גמישות ותנועתיות', cardio: 'תנועה וסיבולת' };
  const LEVEL_LABELS = { beginner: 'בסיסי', intermediate: 'בינוני', advanced: 'נדרשת מיומנות' };
  const allowed = {
    gender: ['male', 'female', 'other', 'prefer-not-to-say'],
    trainingLocation: ['home', 'gym', 'both'],
    goals: ['strength', 'endurance', 'flexibility', 'sport-performance', 'general-fitness'],
    experience: ['beginner', 'intermediate', 'experienced'],
  };
  const stepCopy = [
    { title: 'נעים להכיר', description: 'נתחיל בכמה פרטים עליך.' },
    { title: 'השגרה שמתאימה לך', description: 'איפה וכמה פעמים בשבוע מתאים לך להתאמן?' },
    { title: 'הדרך שלך קדימה', description: 'מה חשוב לך להשיג, ומאיפה מתחילים?' },
  ];
  const form = document.getElementById('profile-form');
  const fields = Object.fromEntries(['name', 'age', 'height', 'weight'].map(id => [id, document.getElementById(id)]));
  function ageFromBirthDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const birth = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0,10)!==value || birth.getUTCFullYear()<1900) return null;
    const today = engine.localDate();
    if (value > today) return null;
    const [y,m,d]=today.split('-').map(Number);
    const age = y-birth.getUTCFullYear()-(m<birth.getUTCMonth()+1||(m===birth.getUTCMonth()+1&&d<birth.getUTCDate())?1:0);
    return age>=1&&age<=120 ? age : null;
  }
  function updateAgeIfNeeded() {
    if (!profile?.birthDate) return;
    const age = ageFromBirthDate(profile.birthDate);
    if (age===null || age===profile.age) return;
    profile = {...profile, age};
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch (_) {}
    syncChanged();
  }

  const error = document.getElementById('profile-error');
  const toast = document.getElementById('toast');
  let toastTimeout;
  let profile = readProfile();
  let activeScreen = '';
  let currentStep = 0;
  let detailsOrigin = 'welcome';
  let savedPlan = readPlan();
  let draftPlan = null;
  let displayedPlan = null;
  let libraryOrigin = 'home';
  let selectedExerciseIds = new Set();
  let selectedExerciseOptions = {};
  let trainingContext = readTrainingContext();
  let contextStorageFailed = false;
  let workoutHistory = readWorkoutHistory();
  let activeWorkout = readActiveWorkout();
  let viewedWorkout = null;
  let resultView = null;
  let activeRenderedKey = '';
  let activeStorageFailed = false;
  let lastWorkoutAction = 0;
  let savingWorkout = false;
  let membershipChoice = readMembership();
  let membershipOrigin = 'home';
  let videosOrigin = 'home';
  let initializing = true;
  let applyingCloud = false;
  let videoOwnerId;
  let videoWasBlocked = false;
  let authReturnView = null;
  let scheduleState = {trainingDays:[],bodyAreasByDay:{},trainingTimes:{}};
  let activeScheduleDay = null;
  let onboardingSettingsTip = false;

  function validMembership(value) {
    return value?.schemaVersion === 1 && Object.hasOwn(membershipPlans, value.planId)
      && value.billingStatus === 'not_connected' && typeof value.selectedAt === 'string'
      && Number.isFinite(Date.parse(value.selectedAt));
  }

  function readMembership() {
    try { const value = JSON.parse(localStorage.getItem(MEMBERSHIP_KEY)); return validMembership(value) ? value : null; }
    catch (_) { return null; }
  }

  function needsMembershipChoice() { return Boolean(profile?.membershipPending && !membershipChoice); }

  function syncChanged() {
    if (!initializing && !applyingCloud) cloud.changed();
  }

  function readLocalSnapshot() {
    return JSON.parse(JSON.stringify({
      schemaVersion: 1, profile, plan: savedPlan,
      activeWorkout,
      history: { schemaVersion: 1, records: workoutHistory },
      trainingContext: trainingContext.screening ? { schemaVersion: 1, ...trainingContext } : null,
      membership: membershipChoice,
    }));
  }

  function applyRemoteSnapshot(snapshot) {
    authReturnView = null;
    const value = snapshot || { schemaVersion: 1, profile: null, plan: null, activeWorkout: null, history: { schemaVersion: 1, records: [] }, trainingContext: null, membership: null };
    if (value.schemaVersion !== 1 || (value.profile && !validBaseProfile(value.profile))
      || (value.plan && !engine.validSavedPlan(value.plan, catalog))
      || (value.activeWorkout && !runner.restore(value.activeWorkout, catalog))
      || value.history?.schemaVersion !== 1 || !Array.isArray(value.history.records)
      || value.history.records.some(entry => !validHistoryEntry(entry))
      || (value.membership && !validMembership(value.membership))) {
      throw new Error('הנתונים בחשבון אינם תקינים לקריאה. הנתונים שבמכשיר לא הוחלפו.');
    }
    const entries = [[STORAGE_KEY, value.profile], [PLAN_KEY, value.plan], [ACTIVE_KEY, value.activeWorkout],
      [HISTORY_KEY, value.history], [CONTEXT_KEY, value.trainingContext], [MEMBERSHIP_KEY, value.membership]];
    const before = entries.map(([key]) => [key, localStorage.getItem(key)]);
    applyingCloud = true;
    try {
      for (const [key, data] of entries) {
        if (data == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(data));
      }
    } catch (error) {
      for (const [key, data] of before) { try { if (data == null) localStorage.removeItem(key); else localStorage.setItem(key, data); } catch (_) {} }
      applyingCloud = false;
      throw new Error('הדפדפן לא הצליח לטעון את נתוני החשבון. אפשר לנסות שוב.');
    }
    stopAllPlayers();
    profile = readProfile(); savedPlan = readPlan(); workoutHistory = readWorkoutHistory();
    activeWorkout = readActiveWorkout(); trainingContext = readTrainingContext(); membershipChoice = readMembership();
    draftPlan = null; displayedPlan = null; viewedWorkout = null; resultView = null; activeRenderedKey = '';
    selectedExerciseIds = new Set(); selectedExerciseOptions = {};
    setupForm.reset(); fillDetails(); showStep(0);
    applyingCloud = false;
    if (!initializing) showScreen(profile ? (needsMembershipChoice() ? 'membership' : 'home') : 'welcome', { focus: true, externalUpdate: true });
  }

  function renderAccountStatus() {
    const status = { enabled: false, dirty: false, blocked: false, user: null };
    const text = 'שמירה במכשיר הזה';
    document.getElementById('home-account-status').textContent = text;
    document.querySelector('.home-account-status').dataset.sync = status.enabled && !status.dirty && !status.blocked ? 'saved' : 'local';
    document.getElementById('account-preferences').hidden = Boolean(status.blocked);
    document.getElementById('account-membership-label').textContent = membershipChoice ? `${membershipPlans[membershipChoice.planId].summary} · בחירה להדגמה` : 'עוד לא נבחר מסלול';
    document.querySelectorAll('[data-storage-copy]').forEach(element => {
      element.textContent = 'הפרטים נשמרים במכשיר הזה בלבד.';
    });

  }

  function cloudChanged() {
    const status = cloud.getStatus();
    const ownerId = status.user?.id || null;
    const ownerChanged = videoOwnerId !== undefined && ownerId !== videoOwnerId;
    if (!initializing && status.blocked && !videoWasBlocked && ownerId && ownerId === videoOwnerId && activeScreen !== 'account') {
      authReturnView = { ownerId, screen: activeScreen };
    }
    if (ownerChanged || (status.blocked && !videoWasBlocked)) stopAllPlayers();
    if (ownerChanged) { videoLibrary.clear(); authReturnView = null; }
    if (status.blocked && activeWorkout && activeWorkout.stage !== 'review' && !activeWorkout.paused) {
      // Freeze the old account's session in memory without writing under a new identity.
      activeWorkout = runner.reduce(activeWorkout, { type: 'pause' });
    }
    if (ownerId && !status.blocked && videoLibrary.getStatus().userId !== ownerId) videoLibrary.refresh();
    videoOwnerId = ownerId;
    videoWasBlocked = Boolean(status.blocked);
    renderAccountStatus();
    if (!initializing && status.blocked && activeScreen !== 'account') showScreen('account', { focus: true, externalUpdate: true });
    if (!initializing && !status.blocked && authReturnView?.ownerId === ownerId && activeScreen === 'account') {
      const screen = authReturnView.screen;
      authReturnView = null;
      showScreen(screen, { externalUpdate: true });
      if (screen === 'active' && activeWorkout) renderActiveWorkout();
    }
    if (activeScreen === 'account') cloud.render(document.getElementById('account-content'));
  }

  function renderMembership() {
    const selected = membershipChoice?.planId || 'trial';
    document.querySelectorAll('input[name="membershipPlan"]').forEach(input => { input.checked = input.value === selected; });
    document.getElementById('membership-intro-copy').textContent = profile?.name ? `${profile.name}, בוחרים מסלול ומתחילים להתקדם.` : 'כל מה שצריך כדי להתחיל, בקצב שלך.';
    document.getElementById('membership-error').hidden = true;
    updateMembershipSelection();
  }

  function updateMembershipSelection() {
    const id = document.querySelector('input[name="membershipPlan"]:checked')?.value;
    const plan = membershipPlans[id];
    if (!plan) return;
    document.getElementById('membership-selection').textContent = plan.selected;
    document.getElementById('membership-submit-label').textContent = `המשך עם ${plan.name}`;
  }

  function videosChanged() {
    if (initializing) return;
    if (activeScreen === 'library' || activeScreen === 'picker') renderCatalog(activeScreen);
    if (activeScreen === 'workout' && viewedWorkout) openWorkout(viewedWorkout.plan, viewedWorkout.dayIndex);
    if (activeScreen === 'active') activeRenderedKey = '';
  }

  function readTrainingContext() {
    try {
      const value = JSON.parse(localStorage.getItem(CONTEXT_KEY));
      if (value?.schemaVersion !== 1 || !['clear', 'guidance', 'unsure'].includes(value.screening)) return { screening: '', injuryAreas: [] };
      return { screening: value.screening, injuryAreas: value.screening === 'clear' ? [] : [...new Set((Array.isArray(value.injuryAreas) ? value.injuryAreas : []).filter(area => Object.hasOwn(guidance.AREA_LABELS, area)))] };
    } catch (_) { return { screening: '', injuryAreas: [] }; }
  }

  function currentTrainingContext() {
    const setup = document.getElementById('plan-setup-form');
    const screening = setup.querySelector('input[name="screening"]:checked')?.value || trainingContext.screening;
    const injuryAreas = screening === 'clear' ? [] : Array.from(setup.querySelectorAll('input[name="injuryAreas"]:checked'), input => input.value);
    return { screening, injuryAreas };
  }

  function needsAdaptation() { return guidance.needsGuidance(trainingContext); }

  function persistTrainingContext() {
    const next = currentTrainingContext();
    if (!['clear', 'guidance', 'unsure'].includes(next.screening)) return;
    trainingContext = next;
    contextStorageFailed = false;
    try { localStorage.setItem(CONTEXT_KEY, JSON.stringify({ schemaVersion: 1, ...trainingContext })); }
    catch (_) { contextStorageFailed = true; }
    syncChanged();
    if (needsAdaptation() && activeWorkout && activeWorkout.stage !== 'review') {
      activeWorkout = runner.reduce(activeWorkout, { type: 'finish' });
      persistActiveWorkout();
      resultView = null;
    }
    renderPlanningGuidance();
    renderPrescriptionEditors();
  }

  function normalizeName(value) {
    return typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
      : '';
  }

  function inRange(value, min, max) {
    return Number.isFinite(value) && value >= min && value <= max;
  }

  function validWeeklyTarget(value) {
    return Number.isInteger(value) && inRange(value, 1, 7);
  }

  function validBaseProfile(value) {
    return value && typeof value === 'object'
      && typeof value.name === 'string' && normalizeName(value.name).length > 0
      && inRange(value.height, 30, 300) && inRange(value.weight, 1, 700);
  }

  function readProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!validBaseProfile(saved)) return null;
      return {
        ...saved,
        name: normalizeName(saved.name),
        age: saved.birthDate ? ageFromBirthDate(saved.birthDate) : (Number.isInteger(saved.age) && inRange(saved.age, 1, 120) ? saved.age : null),
        gender: allowed.gender.includes(saved.gender) ? saved.gender : '',
        trainingLocation: allowed.trainingLocation.includes(saved.trainingLocation) ? saved.trainingLocation : '',
        workoutsPerWeek: validWeeklyTarget(saved.workoutsPerWeek) ? saved.workoutsPerWeek : null,
        goals: Array.isArray(saved.goals) ? [...new Set(saved.goals.filter(value => allowed.goals.includes(value)))] : [],
        experience: allowed.experience.includes(saved.experience) ? saved.experience : '',
      };
    } catch (_) {
      // The preview remains usable if browser storage is unavailable.
      return null;
    }
  }

  function fillDetails() {
    for (const [key, input] of Object.entries(fields)) {
      input.value = key === 'age' ? (profile?.birthDate || '') : (profile?.[key] == null ? '' : String(profile[key]));
    }
    document.dispatchEvent(new Event('vexyro:birthdate-refresh'));
    for (const group of ['gender', 'trainingLocation', 'workoutsPerWeek', 'experience']) {
      form.querySelectorAll(`input[name="${group}"]`).forEach(input => {
        input.checked = profile?.[group] != null && input.value === String(profile[group]);
      });
    }
    form.querySelectorAll('input[name="goals"]').forEach(input => {
      input.checked = Boolean(profile?.goals?.includes(input.value));
    });
  }

  function updateHome() {
    renderAccountStatus();
    const name = profile?.name || '';
    document.getElementById('home-greeting').textContent = name ? `שלום, ${name}` : 'שלום';
    document.getElementById('avatar-initial').textContent = Array.from(name)[0] || 'א';
    updateAgeIfNeeded();
    const target = validWeeklyTarget(profile?.workoutsPerWeek) ? profile.workoutsPerWeek : null;
    const completed = completedWorkouts();
    const today = engine.localDate();
    const todayDate = new Date(`${today}T12:00:00Z`);
    const weekStart = engine.addDays(today, -todayDate.getUTCDay());
    const weekEnd = engine.addDays(weekStart, 7);
    const weeklyCount = completed.filter(entry => {
      const date = engine.localDate(new Date(entry.completedAt));
      return date >= weekStart && date < weekEnd;
    }).length;
    document.getElementById('weekly-progress-text').textContent = target ? `${weeklyCount} מתוך ${target} אימונים` : `${weeklyCount} אימונים השבוע`;
    const track = document.querySelector('.weekly-track');
    const segments = document.createDocumentFragment();
    for (let i = 0; i < (target || 1); i += 1) {
      const segment = document.createElement('span');
      segment.classList.toggle('is-done', i < weeklyCount);
      segments.append(segment);
    }
    track.replaceChildren(segments);
    track.style.gridTemplateColumns = `repeat(${target || 1}, minmax(0, 1fr))`;
    const matching = savedPlan && savedPlan.profileFingerprint === engine.fingerprint(profile);
    const next = matching ? savedPlan.days.find(day => day.session && day.date >= today && !workoutCompleted(savedPlan.id, day.date)) : null;
    const title = document.getElementById('home-workout-title');
    document.getElementById('home-workout-eyebrow').textContent = next ? `האימון הבא · ${formatDate(next.date)}` : (savedPlan ? 'התוכנית שלך' : 'מתחילים כאן');
    title.textContent = next ? next.session.title : savedPlan ? (matching ? 'השבוע שלך במבט אחד' : 'בונים לפי הפרטים החדשים') : 'התוכנית הראשונה שלך';
    document.getElementById('home-workout-minutes').textContent = next ? `כ־${next.session.estimatedMinutes}` : '0';
    document.getElementById('home-workout-count').textContent = next ? String(next.session.exerciseCount) : '0';
    document.getElementById('home-workout-label').textContent = next ? 'התחלת אימון' : savedPlan && matching ? 'צפייה בתוכנית' : 'בניית התוכנית שלי';
    document.getElementById('home-plan-link').hidden = !savedPlan;
    document.getElementById('home-new-plan').hidden = !savedPlan;
    const resume = document.getElementById('home-resume');
    resume.hidden = !activeWorkout;
    if (activeWorkout) resume.querySelector('strong').textContent = activeWorkout.stage === 'review' ? 'לאישור סיכום האימון' : 'המשך האימון שלך';
    document.getElementById('home-completed-total').textContent = String(completed.length);
    const streak = schedule.streak(profile, workoutHistory, today, engine.addDays);
    const flame = document.querySelector('.metric-card .metric-icon use[href="#i-flame"]')?.closest('.metric-card');
    if (flame) {
      flame.querySelector('.metric-value').textContent = String(streak);
      flame.querySelector('.metric-caption').textContent = streak===1 ? 'יום ברצף' : 'ימים ברצף';
      flame.classList.toggle('streak-active',streak>0);
      flame.classList.toggle('streak-blue',streak>30);
      flame.setAttribute('aria-label',`רצף האימונים שלך: ${streak} ימים`);
    }
    const tip=document.getElementById('home-settings-tip');
    if (tip) tip.hidden = !onboardingSettingsTip;

    const latest = [...workoutHistory].sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    const last = document.getElementById('home-last-workout');
    last.hidden = !latest;
    if (latest) last.textContent = `${latest.status === 'complete' ? 'האימון האחרון הושלם' : 'נשמר אימון חלקי'} · ${formatDate(engine.localDate(new Date(latest.completedAt)), false)} · ${latest.completedSets === 1 ? 'סט אחד' : `${latest.completedSets} סטים`}`;
    const contextNote = document.getElementById('home-training-context-note');
    contextNote.hidden = !needsAdaptation();
    document.getElementById('home-training-context-copy').textContent = 'סימנת כאב, פציעה או ספק בהתאמה. לפני אימון נוסף צריך להתאים את התרגילים והעומס עם איש מקצוע.';
    if (needsAdaptation()) document.getElementById('home-workout-label').textContent = 'להכוונה ולהתאמות';
  }

  function showScreen(requestedScreen, options = {}) {
    let screen = screens.includes(requestedScreen) ? requestedScreen : 'welcome';
    if (['home', 'history', 'membership', 'plan-setup', 'plan', 'workout', 'active', 'workout-result'].includes(screen) && !profile) screen = 'details';
    if (needsMembershipChoice() && ['home', 'history', 'plan-setup', 'plan', 'workout', 'active', 'workout-result'].includes(screen)) screen = 'membership';

    if (activeScreen === 'active' && screen !== 'active' && activeWorkout && !options.externalUpdate) {
      activeWorkout = runner.reduce(activeWorkout, { type: 'pause' });
      persistActiveWorkout();
    }
    stopAllPlayers();
    screens.forEach(id => {
      const section = document.getElementById(`view-${id}`);
      section.hidden = id !== screen;
      section.classList.toggle('is-active', id === screen);
    });
    document.body.dataset.screen = screen;
    activeScreen = screen;
    const titles = { home: 'הבית שלך', history: 'ההתקדמות שלי', membership: 'המסלול שלך', account: 'החשבון שלי', videos: 'הסרטונים המקוריים שלי', 'plan-setup': 'בונים תוכנית', plan: 'השבוע שלך', workout: 'האימון שלך', library: 'ספריית התרגילים', picker: 'בחירת תרגילים', active: 'האימון הפעיל שלך', 'workout-result': 'סיכום האימון' };
    document.title = `VEXYRO SPORT — ${titles[screen] || 'מתחילים להתקדם'}`;
    if (screen === 'home') updateHome();
    if (screen === 'history') renderHistory();
    if (screen === 'membership') renderMembership();
    if (screen === 'account') { document.getElementById('account-settings-form').hidden=true;renderAccountStatus(); document.getElementById('account-content').textContent = 'המידע שלך נשמר בדפדפן במכשיר הזה, ללא צורך בהתחברות.'; renderProfileSummary(); }
    if (screen === 'videos') videoLibrary.render(document.getElementById('videos-content'));
    clearTimeout(toastTimeout);
    toast.hidden = true;
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (options.focus) document.querySelector(`#view-${screen} h1`)?.focus({ preventScroll: true });
  }

  // Web notifications run while this tab is active; real background push requires a service.
  const reminderMinutes=[60,30,15,5];
  const REMINDERS_KEY='vexyro.reminders-sent.v1';
  document.getElementById('enable-reminders')?.addEventListener('click',async()=>{
    if (!('Notification' in window)) {notify('הדפדפן הזה אינו תומך בהתראות.');return;}
    const permission=await Notification.requestPermission();
    notify(permission==='granted'?'התראות הופעלו כל עוד האפליקציה פתוחה.':'לא ניתנה הרשאה להתראות.');
  });
  const remindersSent=(()=>{try {return JSON.parse(localStorage.getItem(REMINDERS_KEY))||{};} catch(_){return {};}})();
  function checkReminders(){
    if(!savedPlan || !('Notification' in window)||Notification.permission!=='granted') return;
    const day=engine.localDate();
    const scheduled=savedPlan.days?.find(entry=>entry.date===day&&entry.session);
    if(!scheduled||workoutCompleted(savedPlan.id,day))return;
    const time=scheduled.session.startTime || savedPlan.settings?.trainingTimes?.[schedule.weekday(day)] || '18:00';
    if(!schedule.validTime(time))return;
    const [year,month,date]=day.split('-').map(Number);
    const [h,m]=time.split(':').map(Number);
    const start=new Date(year,month-1,date,h,m).getTime();
    const now=Date.now();
    for(const mins of reminderMinutes){
      const key=`${savedPlan.id}:${day}:${mins}`;
      if(remindersSent[key])continue;
      if(now>=start-mins*60000 && now<start-(mins-1)*60000){
        try{new Notification('VEXYRO SPORT',{body:`האימון שלך מתחיל בעוד ${mins} דקות`});remindersSent[key]=true;}catch(_){}
      }
    }
    try{const recent=Object.fromEntries(Object.entries(remindersSent).filter(([key])=>key.includes(day)));localStorage.setItem(REMINDERS_KEY,JSON.stringify(recent));}catch(_){}
  }
  setInterval(checkReminders,15000);
  window.addEventListener('focus',checkReminders);
  function renderProfileSummary() {
    const panel = document.getElementById('profile-summary'); if (!panel) return;
    updateAgeIfNeeded();
    panel.replaceChildren(); if (!profile) return;
    const items = [['שם',profile.name],['תאריך לידה',profile.birthDate || 'לא הוזן בגרסה הקודמת'],['גיל מחושב',profile.age ?? '—'],['גובה',profile.height + ' ס״מ'],['משקל',profile.weight + ' ק״ג'],['מין',({male:'זכר',female:'נקבה',other:'אחר','prefer-not-to-say':'לא לציין'})[profile.gender] || 'לא צוין'],['אימונים בשבוע',profile.workoutsPerWeek || '—'],['מטרות', (profile.goals || []).map(goal => guidance.GOAL_LABELS[goal] || goal).join(', ')],['רמת ניסיון',({beginner:'מתחיל/ה',intermediate:'בינוני/ת',experienced:'מנוסה'})[profile.experience] || '—']];
    for (const [label,value] of items) { const row=document.createElement('p'); const title=document.createElement('strong'); title.textContent=label+': '; row.append(title,document.createTextNode(String(value))); panel.append(row); }
  }
  function openAccountSettings() {
    if (!profile) { openDetails('welcome',false); return; }
    const edit = document.getElementById('account-settings-form');
    const values = {...profile};
    for (const key of ['name','birthDate','height','weight','gender','workoutsPerWeek','trainingLocation','experience']) {
      const field=edit.elements.namedItem(key);
      if (field) field.value=values[key]??'';
    }
    edit.querySelectorAll('[name="goals"]').forEach(input=>input.checked=values.goals.includes(input.value));
    document.dispatchEvent(new Event('vexyro:birthdate-refresh'));
    edit.hidden=false;
    document.getElementById('account-settings-error').hidden=true;
    edit.scrollIntoView({behavior:'smooth',block:'start'});
    edit.elements.namedItem('name').focus({preventScroll:true});
  }
  document.getElementById('account-settings-form').addEventListener('submit',event=>{
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = {
      name:normalizeName(data.get('name')),birthDate:String(data.get('birthDate')||''),
      age:ageFromBirthDate(data.get('birthDate')),height:Number(data.get('height')),weight:Number(data.get('weight')),
      gender:data.get('gender'),trainingLocation:data.get('trainingLocation'),
      workoutsPerWeek:Number(data.get('workoutsPerWeek')),goals:data.getAll('goals'),experience:data.get('experience'),
    };
    let issue=null;
    for(let step=0;step<3;step++) {issue=stepIssue(step,values);if(issue) break;}
    const errorNode=document.getElementById('account-settings-error');
    if(issue) {errorNode.textContent=issue.message;errorNode.hidden=false;return;}
    const former=engine.fingerprint(profile);
    profile={...profile,...values,schemaVersion:2};
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(profile));}catch(_){notify('שינויי הפרופיל לא נשמרו במכשיר.');}
    syncChanged();
    event.currentTarget.hidden=true;
    renderProfileSummary();renderAccountStatus();
    if(former!==engine.fingerprint(profile)) notify('הפרטים נשמרו. כעת אפשר להתאים מחדש את תוכנית האימונים.');
    else notify('השינויים נשמרו בפרופיל.');
  });

  const DEFAULT_DAY_OFFSETS={1:[0],2:[0,3],3:[0,3,5],4:[0,2,3,5],5:[0,1,3,4,6],6:[0,1,2,3,4,5],7:[0,1,2,3,4,5,6]};
  function setupWeekSchedule(previous) {
    const expected=profile?.workoutsPerWeek||1;
    let days=previous?.settings?.trainingDays;
    if (!Array.isArray(days) || days.length!==expected) {
      const old=previous?.days?.filter(day=>day.session).map(day=>schedule.weekday(day.date))||[];
      days=old.length===expected?old:DEFAULT_DAY_OFFSETS[expected];
    }
    scheduleState={trainingDays:[...new Set(days)].sort((a,b)=>a-b),bodyAreasByDay:{},trainingTimes:{}};
    const legacyGroups={};
    if(previous?.schemaVersion<6) for(const day of previous.days||[]) {
      if(!day.session)continue;
      const weekday=schedule.weekday(day.date);
      legacyGroups[weekday]=[...new Set(day.session.items.filter(item=>item.phase==='main').map(item=>catalog.find(x=>x.id===item.exerciseId)?.group).filter(x=>schedule.AREA_LABELS[x]))];
    }
    for(const day of scheduleState.trainingDays) {
      scheduleState.bodyAreasByDay[day]=[...(previous?.settings?.bodyAreasByDay?.[day]||legacyGroups[day]||[])];
      scheduleState.trainingTimes[day]=previous?.settings?.trainingTimes?.[day]||'18:00';
    }
    activeScheduleDay=scheduleState.trainingDays[0]??null;
    renderScheduleEditor();
  }
  function scheduleInputForValidation(){
    return {...scheduleState,bodyAreasByDay:Object.fromEntries(scheduleState.trainingDays.map(day=>[day,scheduleState.bodyAreasByDay[day].length?scheduleState.bodyAreasByDay[day]:['cardio']]))};
  }
  function scheduleIssue() { return schedule.issue(profile,scheduleInputForValidation()); }
  function renderScheduleEditor() {
    const tabs=document.getElementById('schedule-day-tabs');
    tabs.replaceChildren(...schedule.WEEKDAYS.map((name,index)=>{
      const selected=scheduleState.trainingDays.includes(index);
      const button=node('button',`schedule-day-tab${selected?' is-selected':''}${index===activeScheduleDay?' is-current':''}`,name);
      button.type='button';button.dataset.scheduleDay=String(index);button.setAttribute('aria-pressed',String(selected));
      button.setAttribute('aria-label',`${name}: ${selected?'יום אימון':'יום מנוחה'}`);
      return button;
    }));
    const editor=document.getElementById('schedule-area-editor');
    const selected=scheduleState.trainingDays.includes(activeScheduleDay);
    editor.hidden=!selected;
    const count=scheduleState.trainingDays.length;
    document.getElementById('schedule-heading').textContent=`בחרת ${count} מתוך ${profile?.workoutsPerWeek||0} ימי אימון`;
    if(!selected)return;
    document.getElementById('schedule-day-title').textContent=`יום ${schedule.WEEKDAYS[activeScheduleDay]} — בוחרים אזורים`;
    document.getElementById('schedule-day-time').value=scheduleState.trainingTimes[activeScheduleDay]||'18:00';
    const areas=scheduleState.bodyAreasByDay[activeScheduleDay]||[];
    document.querySelectorAll('[data-muscle-area]').forEach(button=>{
      const enabled=areas.includes(button.dataset.muscleArea);
      button.classList.toggle('is-selected',enabled);
      button.setAttribute('aria-pressed',String(enabled));
    });
    document.getElementById('schedule-body-summary').textContent=areas.length?`נבחרו ליום הזה: ${areas.map(a=>schedule.AREA_LABELS[a]).join(' · ')}`:'לחצו על אזור במפה כדי לשייך אותו ליום הזה.';
    // Contextual library shortcuts follow the selected muscles for the current day.
    const shortcuts=document.getElementById('v8-muscle-shortcuts');
    const chipList=document.getElementById('v8-muscle-shortcut-list');
    const present=areas.filter(area=>catalog.some(exercise=>exercise.group===area));
    shortcuts.hidden=present.length===0;
    chipList.replaceChildren(...present.map(area=>{
      const count=catalog.filter(exercise=>exercise.group===area).length;
      const button=node('button','v8-muscle-shortcut',`${schedule.AREA_LABELS[area]||GROUP_LABELS[area]} · ${count} תרגילים ←`);
      button.type='button';
      button.dataset.viewMuscleExercises=area;
      button.setAttribute('aria-label',`לצפייה ב${count} תרגילים לאזור ${schedule.AREA_LABELS[area]||GROUP_LABELS[area]}`);
      return button;
    }));
  }
  document.getElementById('schedule-day-tabs').addEventListener('click',event=>{
    const button=event.target.closest('[data-schedule-day]');if(!button)return;
    const day=Number(button.dataset.scheduleDay);
    if(scheduleState.trainingDays.includes(day)) {activeScheduleDay=day;renderScheduleEditor();return;}
    if(scheduleState.trainingDays.length>=profile.workoutsPerWeek){notify('כדי להחליף יום, הסירו תחילה יום קיים בעזרת הכפתור שמתחת למפה.');return;}
    scheduleState.trainingDays.push(day);scheduleState.trainingDays.sort((a,b)=>a-b);
    scheduleState.bodyAreasByDay[day]=[];scheduleState.trainingTimes[day]='18:00';activeScheduleDay=day;renderScheduleEditor();
  });
  document.getElementById('schedule-area-editor').addEventListener('click',event=>{
    const shortcut=event.target.closest('[data-view-muscle-exercises]');
    if(shortcut) {
      libraryOrigin=activeScreen;
      renderLibrary();
      document.getElementById('library-group').value=shortcut.dataset.viewMuscleExercises;
      renderCatalog('library');
      showScreen('library',{focus:true});
      return;
    }
    if(event.target.closest('[data-remove-schedule-day]')) {
      const day=activeScheduleDay;
      scheduleState.trainingDays=scheduleState.trainingDays.filter(d=>d!==day);
      delete scheduleState.bodyAreasByDay[day];delete scheduleState.trainingTimes[day];
      activeScheduleDay=scheduleState.trainingDays[0]??null;
      renderScheduleEditor();return;
    }
    const button=event.target.closest('[data-muscle-area]');if(!button)return;
    const day=activeScheduleDay, area=button.dataset.muscleArea;
    const chosen=scheduleState.bodyAreasByDay[day];
    if(chosen.includes(area)) scheduleState.bodyAreasByDay[day]=chosen.filter(x=>x!==area);
    else scheduleState.bodyAreasByDay[day]=[...chosen,area];
    const issue=scheduleIssue();
    if(issue) {scheduleState.bodyAreasByDay[day]=chosen;notify(issue.message);}
    renderScheduleEditor();
  });
  document.getElementById('schedule-day-time').addEventListener('change',event=>{
    if(activeScheduleDay==null)return;
    const old=scheduleState.trainingTimes[activeScheduleDay];
    scheduleState.trainingTimes[activeScheduleDay]=event.target.value;
    const issue=scheduleIssue();
    if(issue){scheduleState.trainingTimes[activeScheduleDay]=old;notify(issue.message);}
    renderScheduleEditor();
  });
  function renderHistory() {
    historyUI.render(document.getElementById('history-content'), {
      records: workoutHistory, catalog, weeklyTarget: profile?.workoutsPerWeek,
      today: engine.localDate(),
    });
  }

  function showStep(step, options = {}) {
    currentStep = Math.max(0, Math.min(2, step));
    form.querySelectorAll('[data-profile-step]').forEach(section => {
      section.hidden = Number(section.dataset.profileStep) !== currentStep;
    });
    document.querySelectorAll('[data-step-marker]').forEach(marker => {
      const number = Number(marker.dataset.stepMarker);
      marker.classList.toggle('is-current', number === currentStep);
      marker.classList.toggle('is-done', number < currentStep);
      if (number === currentStep) marker.setAttribute('aria-current', 'step');
      else marker.removeAttribute('aria-current');
    });
    document.getElementById('details-heading').textContent = stepCopy[currentStep].title;
    document.getElementById('details-description').textContent = stepCopy[currentStep].description;
    document.getElementById('details-step-label').textContent = `שלב ${currentStep + 1} מתוך 3`;
    document.getElementById('profile-next-label').textContent = currentStep === 2 ? ((!profile || needsMembershipChoice()) ? 'המשך לבחירת מסלול' : 'שמירה והמשך') : 'המשך';
    document.getElementById('profile-back').hidden = currentStep === 0;
    if (options.focus) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.getElementById('details-heading').focus({ preventScroll: true });
    }
  }

  function openDetails(origin, restoreSaved) {
    detailsOrigin = origin;
    if (restoreSaved) fillDetails();
    clearErrors();
    showStep(0);
    showScreen('details', { focus: true });
  }

  function notify(message) {
    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.hidden = false;
    toastTimeout = window.setTimeout(() => { toast.hidden = true; }, 2800);
  }

  function clearErrors() {
    error.hidden = true;
    error.textContent = '';
    form.querySelectorAll('.field-error').forEach(node => {
      node.hidden = true;
      node.textContent = '';
    });
    form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
  }

  function selected(group) {
    return form.querySelector(`input[name="${group}"]:checked`)?.value || '';
  }

  function collectDetails() {
    return {
      name: normalizeName(fields.name.value),
      age: ageFromBirthDate(fields.age.value),
      birthDate: fields.age.value,
      height: fields.height.valueAsNumber,
      weight: fields.weight.valueAsNumber,
      gender: selected('gender'),
      trainingLocation: selected('trainingLocation'),
      workoutsPerWeek: Number(selected('workoutsPerWeek')),
      goals: Array.from(form.querySelectorAll('input[name="goals"]:checked'), input => input.value),
      experience: selected('experience'),
    };
  }

  function stepIssue(step, value) {
    if (step === 0) {
      if (!value.name) return { key: 'name', message: 'יש להזין שם כדי להמשיך.' };
      if (!Number.isInteger(value.age) || !inRange(value.age, 1, 120)) return { key: 'age', message: 'יש להזין תאריך לידה תקין.' };
      if (!inRange(value.height, 30, 300)) return { key: 'height', message: 'יש להזין גובה בין 30 ל־300 ס״מ.' };
      if (!inRange(value.weight, 1, 700)) return { key: 'weight', message: 'יש להזין משקל בין 1 ל־700 ק״ג.' };
      if (!allowed.gender.includes(value.gender)) return { key: 'gender', message: 'יש לבחור אפשרות. אפשר גם לבחור ״לא לציין״.' };
    }
    if (step === 1) {
      if (!allowed.trainingLocation.includes(value.trainingLocation)) return { key: 'trainingLocation', message: 'יש לבחור איפה מתאים לך להתאמן.' };
      if (!validWeeklyTarget(value.workoutsPerWeek)) return { key: 'workoutsPerWeek', message: 'יש לבחור מספר אימונים בשבוע.' };
    }
    if (step === 2) {
      if (value.goals.length === 0 || value.goals.some(goal => !allowed.goals.includes(goal))) return { key: 'goals', message: 'יש לבחור לפחות מטרה אחת.' };
      if (!allowed.experience.includes(value.experience)) return { key: 'experience', message: 'יש לבחור את רמת הניסיון שלך.' };
    }
    return null;
  }

  function showIssue(step, issue) {
    if (currentStep !== step) showStep(step);
    const message = document.getElementById(`${issue.key}-error`);
    if (message) {
      message.textContent = issue.message;
      message.hidden = false;
    } else {
      error.textContent = issue.message;
      error.hidden = false;
    }
    const inputs = fields[issue.key]
      ? [fields[issue.key]]
      : Array.from(form.querySelectorAll(`input[name="${issue.key}"]`));
    inputs.forEach(input => input.setAttribute('aria-invalid', 'true'));
    const focusTarget = issue.key === 'age' ? document.getElementById('age-picker-trigger') : inputs[0];
    if (issue.key === 'age') focusTarget?.setAttribute('aria-invalid', 'true');
    focusTarget?.focus();
  }

  function readPlan() {
    try {
      const value = JSON.parse(localStorage.getItem(PLAN_KEY));
      return engine.validSavedPlan(value, catalog) ? value : null;
    } catch (_) { return null; }
  }

  function node(tag, className = '', text = '') {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text) value.textContent = text;
    return value;
  }

  function icon(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${id}`);
    svg.append(use);
    return svg;
  }

  function formatDate(value, withWeekday = true) {
    return new Intl.DateTimeFormat('he-IL', {
      ...(withWeekday ? { weekday: 'short' } : {}), day: 'numeric', month: 'numeric',
    }).format(new Date(`${value}T12:00:00`));
  }

  function formatSeconds(value) {
    if (value === 60) return 'דקה אחת';
    if (value >= 60 && value % 60 === 0) return `${value / 60} דקות`;
    return `${value} שניות`;
  }

  function chips(containerId, values) {
    document.getElementById(containerId).replaceChildren(...values.map(value => node('span', 'plan-chip', value)));
  }

  function clearPlanIssue() {
    const errorNode = document.getElementById('plan-error');
    errorNode.hidden = true;
    errorNode.textContent = '';
    document.getElementById('plan-guidance').hidden = true;
    document.getElementById('plan-setup-form').querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    document.getElementById('setup-prescription-error').hidden = true;
    if (engine.completeProfile(profile) && profile.age < 13) {
      errorNode.textContent = 'בניית תוכניות לילדים מתחת לגיל 13 עוד לא זמינה בגרסה הזו. אפשר לעיין בהדגמות עם מבוגר ולבנות תוכנית עם מדריך מתאים.';
      errorNode.hidden = false;
      document.getElementById('plan-guidance').hidden = false;
    }
  }

  function showPlanIssue(issue) {
    const errorNode = document.getElementById('plan-error');
    errorNode.textContent = issue.message;
    errorNode.hidden = false;
    document.getElementById('plan-guidance').hidden = !issue.guidance;
    const optionSelector = issue.exerciseId ? `#${invalidPrescriptionField(issue.exerciseId)}` : '#setup-prescription-list select, #setup-prescription-list input';
    const selector = issue.field === 'exerciseOptions' ? optionSelector : issue.field === 'selectedExercises' ? '#setup-pick-exercises' : issue.field === 'startDate' ? '#plan-start-date'
      : ['trainingDays','bodyAreasByDay','trainingTimes'].includes(issue.field) ? '#schedule-day-tabs button'
      : issue.field === 'youthSupervision' ? '#youth-supervision'
      : `input[name="${issue.field}"]`;
    const input = document.getElementById('plan-setup-form').querySelector(selector);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', 'plan-error');
      input.focus();
    } else {
      errorNode.tabIndex = -1;
      errorNode.focus();
    }
  }

  function openPlanSetup(previous = null, preserve = false) {
    const setupForm = document.getElementById('plan-setup-form');
    if (!preserve) {
      setupForm.reset();
      const previousIds = previous?.settings.selectedExercises || previous?.days.flatMap(day => day.session?.items.filter(item => item.phase === 'main').map(item => item.exerciseId) || []) || [];
      selectedExerciseIds = new Set([...new Set(previousIds)].filter(id => catalog.some(exercise => exercise.id === id)).slice(0, engine.MAX_SELECTED));
      selectedExerciseOptions = {};
      for (const id of selectedExerciseIds) {
        const exercise = catalog.find(value => value.id === id);
        const oldItem = previous?.days.flatMap(day => day.session?.items || []).find(item => item.phase === 'main' && item.exerciseId === id);
        const old = { ...oldItem, ...previous?.settings.exerciseOptions?.[id] };
        const defaults = training.defaultOptions(exercise);
        selectedExerciseOptions[id] = {
          sets: training.validSets(old.sets) ? old.sets : defaults.sets,
          weightKg: training.loadSpec(exercise).supportsKg && training.validWeight(old.weightKg) ? old.weightKg : null,
          reps: training.supportsReps(exercise) ? (training.validReps(old.reps) ? old.reps : defaults.reps) : null,
          restSeconds: training.validRest(old.restSeconds) ? old.restSeconds : defaults.restSeconds,
        };
      }
      if (needsAdaptation()) {
        setupForm.querySelector(`input[name="screening"][value="${trainingContext.screening}"]`).checked = true;
        setupForm.querySelectorAll('input[name="injuryAreas"]').forEach(input => { input.checked = trainingContext.injuryAreas.includes(input.value); });
      }
    }
    clearPlanIssue();
    const complete = engine.completeProfile(profile);
    const tooYoung = complete && profile.age < 13;
    document.getElementById('plan-missing-profile').hidden = complete;
    document.getElementById('plan-generate-button').disabled = !complete || tooYoung;
    document.getElementById('plan-youth-note').hidden = !profile || profile.age < 13 || profile.age >= 18;
    document.getElementById('plan-profile-summary').textContent = complete
      ? `${profile.name}, נתחיל בשבוע היכרות · ${profile.workoutsPerWeek} מפגשים · ${engine.LOCATION_LABELS[profile.trainingLocation]}`
      : 'הפרטים מהשאלון יעזרו להכין את השבוע הראשון שלך.';
    const startDate = document.getElementById('plan-start-date');
    startDate.min = engine.localDate();
    startDate.max = engine.addDays(engine.localDate(), 90);
    if (!preserve || !startDate.value) startDate.value = previous?.settings.startDate >= startDate.min ? previous.settings.startDate : startDate.min;
    if (previous) {
      setupForm.querySelectorAll('input[name="equipment"]').forEach(input => { input.checked = previous.settings.equipment.includes(input.value); });
    }
    if(!preserve || scheduleState.trainingDays.length !== (profile?.workoutsPerWeek||1)) setupWeekSchedule(previous);
    else renderScheduleEditor();
    updateSelectionSummary();
    renderPlanningGuidance();
    // Health suitability and youth supervision are asked again for each new draft.
    showScreen('plan-setup', { focus: true });
    if (tooYoung) showPlanIssue({ field: 'age', guidance: true, message: 'בניית תוכניות לילדים מתחת לגיל 13 עוד לא זמינה בגרסה הזו. אפשר לעיין בהדגמות עם מבוגר ולבנות תוכנית עם מדריך מתאים.' });
  }

  function renderPlan(plan) {
    displayedPlan = plan;
    const isDraft = plan !== savedPlan;
    const sessions = plan.days.filter(day => day.session).map(day => day.session);
    const minutes = sessions.map(session => session.estimatedMinutes);
    const minMinutes = Math.min(...minutes);
    const maxMinutes = Math.max(...minutes);
    const strengthCount = sessions.filter(session => session.type === 'strength').length;
    document.getElementById('plan-heading').textContent = isDraft ? 'השבוע הראשון שלך' : 'התוכנית השבועית שלך';
    document.getElementById('plan-subtitle').textContent = `${formatDate(plan.days[0].date, false)} עד ${formatDate(plan.days[6].date, false)} · שבוע היכרות`;
    document.getElementById('plan-state-badge').textContent = isDraft ? 'טיוטה לבדיקה' : 'התוכנית שמורה';
    chips('plan-summary', [
      `${sessions.length} מפגשים`,
      minMinutes === maxMinutes ? `כ־${minMinutes} דקות למפגש` : `כ־${minMinutes}–${maxMinutes} דקות למפגש`,
      engine.LOCATION_LABELS[plan.location] || 'בקצב שלך',
    ]);
    const notice = document.getElementById('plan-notice');
    const explanations = [
      plan.schemaVersion >= 5 ? 'משך כל מפגש מחושב לפי התרגילים, הסטים, החזרות והמנוחות שבחרת.' : `בתוכנית הזו נשמרה הבחירה הקודמת של עד ${plan.settings.sessionMinutes} דקות. בבניית שבוע חדש משך האימון יחושב אוטומטית מהתרגילים ומההגדרות שלך.`,
      strengthCount ? `${strengthCount === 1 ? 'מפגש חיזוק קל אחד' : `${strengthCount} מפגשי חיזוק קל`} בשבוע ההיכרות${sessions.length > strengthCount ? ', ובשאר המפגשים תנועה קלה' : ''}.` : 'השבוע הזה מוקדש לצעידה ולתנועה קלה.',
    ];
    if (plan.schemaVersion >= 2) explanations.unshift(`כל ${plan.settings.selectedExercises.length} התרגילים שבחרת משובצים במהלך השבוע. פתיחה וסיום בצעידה קלה מתווספים לכל מפגש.`);
    if (plan.schemaVersion >= 3) explanations.push(plan.schemaVersion >= 4 ? 'הסטים, החזרות, המשקל והמנוחה הם הבחירה שלך. אומדן הזמן מתחשב בהגדרות שבחרת; משקל שלא הוזן מסומן במפורש.' : 'מספר הסטים והמשקל הם הבחירה שלך. האומדן כולל את כל הסטים והמנוחות ביניהם; משקל שלא הוזן מסומן במפורש.');
    if (plan.schemaVersion === 1) explanations.push('זו התוכנית ששמרת קודם. בבניית שבוע חדש אפשר לבחור בעצמך מתוך הספרייה המורחבת.');
    if (plan.settings.selectedExercises?.some(id => catalog.find(exercise => exercise.id === id)?.level !== 'beginner')) explanations.push('יש כאן תרגילים שדורשים שליטה בטכניקה. קראו את דגשי ההתאמה; המשקל של האדם בסרטון אינו המלצת משקל עבורכם.');
    if (plan.ageGroup === 'youth') explanations.push('לפני התחלה, יש לבדוק את הטיוטה עם מדריך מוסמך לאימוני בני נוער.');
    if (plan.profileFingerprint !== engine.fingerprint(profile)) explanations.unshift('הפרטים בפרופיל השתנו מאז יצירת התוכנית. אפשר לבנות טיוטה חדשה לפי ההעדפות המעודכנות.');
    notice.replaceChildren(...explanations.map(text => node('p', '', text)));
    const daysNode = document.getElementById('plan-days');
    const rows = plan.days.map((day, index) => {
      const done = !isDraft && workoutCompleted(plan.id, day.date);
      const row = node('article', `plan-day${day.session ? '' : ' is-rest'}${day.date === engine.localDate() ? ' is-today' : ''}${done ? ' is-completed' : ''}`);
      const date = node('div', 'plan-day-date');
      date.append(node('small', '', new Intl.DateTimeFormat('he-IL', { weekday: 'short' }).format(new Date(`${day.date}T12:00:00`))), node('strong', '', formatDate(day.date, false)));
      const copy = node('div', 'plan-day-copy');
      copy.append(node('h3', '', day.title));
      copy.append(node('p', '', day.session ? `שעה ${day.session.startTime ? day.session.startTime+' · ' : ''}כ־${day.session.estimatedMinutes} דקות · ${day.session.exerciseCount} ${day.session.exerciseCount === 1 ? 'תרגיל' : 'תרגילים'}` : 'זמן להתאוששות'));
      if (done) copy.append(node('span', 'plan-completed-badge', 'הושלם ונשמר'));
      row.append(date, copy);
      if (day.session) {
        const button = node('button', 'plan-day-open', 'צפייה');
        button.type = 'button';
        button.dataset.workoutDay = String(index);
        button.setAttribute('aria-label', `צפייה באימון ${day.title}, ${formatDate(day.date)}`);
        row.append(button);
      }
      return row;
    });
    daysNode.replaceChildren(...rows);
    document.getElementById('plan-save-button').hidden = !isDraft;
    document.getElementById('plan-edit-button').textContent = isDraft ? 'שינוי הטיוטה' : 'בניית שבוע חדש';
    document.getElementById('plan-home-button').hidden = isDraft;
    document.getElementById('plan-storage-note').textContent = 'שמירת התוכנית אינה מסמנת אימון כהושלם. מצב השמירה והסנכרון מופיע במסך החשבון.';
  }

  function openPlan(plan) {
    if (!plan) { openPlanSetup(); return; }
    renderPlan(plan);
    showScreen('plan', { focus: true });
  }

  function savePlan() {
    if (!draftPlan || displayedPlan !== draftPlan) return;
    if (needsAdaptation()) { openPlanSetup(draftPlan); notify('סומנה מגבלה. יש לקבל התאמה לפני שמירת תוכנית לאימון.'); return; }
    if (draftPlan.profileFingerprint !== engine.fingerprint(profile)) {
      notify('הפרופיל השתנה. יש להכין טיוטה חדשה לפני השמירה.');
      return;
    }
    savedPlan = draftPlan;
    if(savedPlan.schemaVersion >= 6) {
      const epoch={startDate:savedPlan.settings.startDate,trainingDays:[...savedPlan.settings.trainingDays]};
      const old=Array.isArray(profile.scheduleHistory)?profile.scheduleHistory.filter(e=>e?.startDate!==epoch.startDate):[];
      profile={...profile,scheduleHistory:[...old,epoch].sort((a,b)=>a.startDate.localeCompare(b.startDate)).slice(-100)};
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(profile));}catch(_){}
    }
    draftPlan = null;
    displayedPlan = savedPlan;
    let stored = true;
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(savedPlan)); }
    catch (_) { stored = false; }
    syncChanged();
    onboardingSettingsTip = true;
    showScreen('home', { focus: true });
    notify(stored ? 'התוכנית נשמרה. האימון הראשון מחכה לך בבית.' : 'התוכנית מוצגת כעת, אך לא תישמר לאחר רענון בדפדפן הזה.');
  }

  function prescriptionText(item) {
    const sets = item.sets === 1 ? 'סט אחד' : `${item.sets} סטים`;
    const dose = item.kind === 'timed' ? `${item.sets > 1 ? `${sets} · ` : ''}${formatSeconds(item.durationSeconds)}${item.sets > 1 ? ' בכל סט' : ''}`
      : item.kind === 'hold' ? `${sets} · ${item.reps} החזקות${item.perSide ? ' לכל צד' : ''} · ${item.holdSeconds} שניות להחזקה`
      : `${sets} · ${item.reps} חזרות${item.perSide ? ' לכל צד' : ''}`;
    const exercise = catalog.find(value => value.id === item.exerciseId);
    const load = exercise && training.loadSpec(exercise).supportsKg ? ` · ${loadText(exercise, item.weightKg)}` : '';
    return `${dose}${load} · ${item.restSeconds ? `מנוחה: ${formatSeconds(item.restSeconds)}` : 'ללא מנוחה מתוזמנת'}`;
  }

  function loadText(exercise, weight) {
    const spec = training.loadSpec(exercise);
    if (!spec.supportsKg) return spec.kind === 'band' ? 'התנגדות גומייה · ללא רישום ק״ג' : 'משקל גוף · ללא תוספת';
    if (weight == null) return 'משקל לא צוין';
    const suffix = spec.kind === 'dumbbell' ? 'לכל משקולת' : spec.kind === 'barbell' ? 'כולל המוט' : 'לפי סימון המכשיר';
    return `${weight.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ק״ג ${suffix}`;
  }

  function stopPlayer(wrapper) {
    wrapper.querySelectorAll('video').forEach(video => video.pause());
    wrapper.querySelectorAll('.video-frame, .external-video').forEach(player => player.remove());
    const start = wrapper.querySelector('.video-launch');
    if (start) start.hidden = false;
  }

  function stopAllPlayers() {
    document.querySelectorAll('video').forEach(video => video.pause());
    document.querySelectorAll('.exercise-video-wrap').forEach(stopPlayer);
  }

  function exerciseCard(exercise, item, index, initiallyOpen = false) {
    const card = node('details', 'exercise-card');
    card.open = initiallyOpen;
    card.dataset.exerciseId = exercise.id;
    const summary = node('summary');
    const copy = node('span', 'exercise-summary-copy');
    copy.append(node('strong', '', exercise.name));
    const tags = node('span', 'exercise-tags');
    tags.append(node('span', 'exercise-tag', GROUP_LABELS[exercise.group] || 'תנועה'), node('span', `exercise-tag level-${exercise.level}`, LEVEL_LABELS[exercise.level] || 'בסיסי'));
    const goalMatches = guidance.matchedGoals(exercise, profile);
    if (goalMatches.length) tags.append(node('span', 'goal-match-tag', `קשור למטרה: ${goalMatches.map(goal => guidance.GOAL_LABELS[goal]).join(' · ')}`));
    copy.append(tags, node('span', 'exercise-short-description', exercise.description || exercise.videoDescription));
    if (item) copy.append(node('span', '', prescriptionText(item)));
    copy.append(node('span', 'exercise-open-hint', 'הסבר, דגשי התאמה וסרטון'));
    summary.append(node('span', 'exercise-number', String(index + 1).padStart(2, '0')), copy, icon('i-chevron-left'));
    const content = node('div', 'exercise-details');
    content.append(node('p', 'exercise-equipment', `אביזרים: ${exercise.equipmentLabel}`));
    const relatedCautions = guidance.areaCautions(exercise, trainingContext);
    if (relatedCautions.length) content.append(node('p', 'injury-match-note', `יש כאן דגשים לאזור שסימנת: ${relatedCautions.map(caution => caution.title).join(' · ')}. יש לבדוק התאמה עם איש מקצוע לפני ביצוע.`));
    if (item) content.append(node('p', 'exercise-dose', `${prescriptionText(item)}${item.restSeconds ? ` · מנוחה אחרי השלב: ${item.restSeconds} שניות` : ''}`));
    const cautions = node('section', 'exercise-cautions');
    cautions.append(node('h3', '', 'מתי לעצור או לבקש התאמה?'));
    for (const caution of exercise.cautions || []) {
      const row = node('div', 'exercise-caution');
      row.append(node('strong', '', caution.title), node('p', '', caution.text));
      cautions.append(row);
    }
    if (exercise.cautions?.length) content.append(cautions);
    const videoWrap = node('div', 'exercise-video-wrap');
    const launch = node('button', 'video-launch');
    launch.type = 'button';
    launch.setAttribute('aria-label', `צפייה בסרטון ${exercise.name}`);
    const playIcon = node('span', 'video-play-symbol', '▶');
    playIcon.setAttribute('aria-hidden', 'true');
    const ownVideo = videoLibrary.get(exercise.id);
    if (!ownVideo && !['direct','embed'].includes(exercise.video?.kind)) { videoWrap.append(node('p', 'field-hint', 'אין סרטון מקומי לתרגיל הזה. ההסבר הכתוב זמין.')); content.append(videoWrap); } else {
    launch.append(playIcon, node('strong', '', ownVideo ? 'לצפייה בסרטון שלי' : exercise.video.kind==='direct' ? 'לצפייה בסרטון מקומי' : 'לצפייה בהדגמה'), node('span', 'video-provider', ownVideo ? ownVideo.title : exercise.video.kind==='direct' ? 'קובץ הדגמה מקומי' : exercise.video.provider));
    const fallback = node('a', 'video-source-link', ownVideo ? 'פתיחת הסרטון שלי' : 'פתיחת הסרטון באתר המקור');
    fallback.href = ownVideo ? ownVideo.url : (exercise.video.kind === 'direct' ? exercise.video.src : exercise.video.watchUrl);
    fallback.target = '_blank';
    fallback.rel = 'noopener noreferrer';
    launch.addEventListener('click', () => {
      stopAllPlayers();
      launch.hidden = true;
      if (ownVideo || exercise.video.kind === 'direct') {
        const video = node('video', 'external-video');
        video.src = ownVideo ? ownVideo.url : exercise.video.src;
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.setAttribute('aria-label', `הדגמה מצולמת: ${exercise.name}`);
        video.addEventListener('error', () => notify(ownVideo ? 'הסרטון לא נטען. בדקו את החיבור לחשבון או העלו את הקובץ מחדש במסך הסרטונים.' : 'הנגן לא נטען. אפשר לפתוח את הסרטון באתר המקור.'));
        videoWrap.append(video);
      } else if (exercise.video?.kind === 'embed' && !/youtube(?:-nocookie)?\.com|youtu\.be/i.test(exercise.video.embedUrl || '')) {
        const frame = node('iframe', 'video-frame');
        frame.src = exercise.video.embedUrl;
        frame.title = `הדגמה מצולמת של ${exercise.name} — ${exercise.video.provider}`;
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        frame.allowFullscreen = true;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        videoWrap.append(frame);
      }
    });
    card.addEventListener('toggle', () => { if (!card.open) stopPlayer(videoWrap); });
    videoWrap.append(launch);
    content.append(videoWrap, fallback);
    if (!ownVideo && exercise.video.contextNote) content.append(node('p', 'video-context-note', exercise.video.contextNote));
    content.append(node('p', ownVideo ? 'video-context-note custom-video-note' : 'video-context-note', ownVideo ? 'זהו הסרטון ששייכת לתרגיל בחשבון שלך. הוא נטען בלחיצה בלבד.' : 'הסרטון נטען מהמקור בלחיצה. אם הנגן אינו זמין, אפשר להשתמש בקישור שמעל.'));
    }
    content.append(node('h3', '', 'איך עושים?'));
    const steps = node('ol', 'exercise-steps');
    steps.append(...exercise.steps.map(text => node('li', '', text)));
    content.append(steps);
    const cues = node('div', 'exercise-cues');
    cues.append(node('strong', '', 'כדאי לזכור'), ...exercise.cues.map(text => node('p', '', text)));
    content.append(cues);
    const source = node('a', 'exercise-source', 'מקור להנחיות: ');
    const sourceName = node('bdi', '', exercise.source.label);
    sourceName.dir = 'ltr';
    source.href = exercise.source.url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.append(sourceName);
    content.append(source);
    card.append(summary, content);
    return card;
  }

  function openWorkout(plan, dayIndex) {
    const day = plan?.days[dayIndex];
    if (!day?.session) return;
    displayedPlan = plan;
    viewedWorkout = { plan, dayIndex };
    const session = day.session;
    document.getElementById('workout-heading').textContent = session.title;
    document.getElementById('workout-description').textContent = `${formatDate(day.date)} · ${session.description}`;
    chips('workout-summary', [`כ־${session.estimatedMinutes} דקות`, `${session.exerciseCount} ${session.exerciseCount === 1 ? 'תרגיל' : 'תרגילים'}`, engine.LOCATION_LABELS[plan.location] || 'בקצב שלך']);
    const blocks = document.getElementById('workout-blocks');
    const fragment = document.createDocumentFragment();
    const phaseTitles = { warmup: '01 / מתחילים בתנועה', main: '02 / החלק המרכזי', cooldown: '03 / מסיימים בהדרגה' };
    const phaseNotes = { warmup: 'צעידה קלה והדרגתית. הסרטון מדגים את התנועה, ולא משמש שעון אימון.', main: 'פתחו כל תרגיל כדי לראות את ההסבר והסרטון. האומדן אינו מכתיב קצב ביצוע.', cooldown: 'האטו את הצעידה בהדרגה וסיימו בקצב נוח.' };
    let count = 0;
    for (const phase of ['warmup', 'main', 'cooldown']) {
      const group = node('section', 'workout-phase');
      group.append(node('h2', '', phaseTitles[phase]), node('p', 'phase-note', phaseNotes[phase]));
      session.items.filter(item => item.phase === phase).forEach(item => {
        const exercise = catalog.find(value => value.id === item.exerciseId);
        group.append(exerciseCard(exercise, item, count, count === 0));
        count += 1;
      });
      fragment.append(group);
    }
    blocks.replaceChildren(fragment);
    const start = document.getElementById('workout-start-button');
    const isSaved = savedPlan?.id === plan.id && plan.profileFingerprint === engine.fingerprint(profile);
    const done = workoutCompleted(plan.id, day.date);
    start.disabled = !isSaved || Boolean(done) || needsAdaptation();
    start.textContent = done ? 'האימון כבר הושלם' : activeWorkout ? 'להמשך האימון הפתוח' : 'התחלת האימון';
    document.getElementById('workout-launch-note').textContent = needsAdaptation()
      ? 'סומנה פציעה, מגבלה או אי־ודאות. לפני התחלה יש לקבל התאמה מקצועית ולעדכן את ההתאמות שלך.' : done
      ? 'האימון הזה כבר נספר בהתקדמות שלך. אפשר לחזור להסברים ולסרטונים.'
      : !isSaved ? 'כדי להתחיל, יש לשמור תוכנית שמתאימה לפרטים הנוכחיים שלך.'
      : activeWorkout ? 'יש אימון פתוח שנשמר עבורך. אפשר להמשיך ממנו לפני שמתחילים אימון נוסף.'
      : 'מסמנים כל סט, נחים בקצב שלך ומאשרים את הסיכום בסוף. אפשר לראות את מצב השמירה במסך החשבון.';
    showScreen('workout', { focus: true });
  }

  function validHistoryEntry(value) {
    const integer = number => Number.isInteger(number) && number >= 0 && number <= 10000;
    return value && typeof value.id === 'string' && value.id.length < 200
      && typeof value.planId === 'string' && typeof value.workoutKey === 'string'
      && value.workoutKey === `${value.planId}|${value.scheduledDate}`
      && engine.validDate(value.scheduledDate) && typeof value.title === 'string'
      && ['complete', 'partial'].includes(value.status)
      && typeof value.completedAt === 'string' && Number.isFinite(new Date(value.completedAt).getTime())
      && Number.isFinite(value.elapsedSeconds) && value.elapsedSeconds >= 0
      && ['completedExercises', 'totalExercises', 'completedSets', 'totalSets', 'skippedExercises'].every(key => integer(value[key]))
      && value.completedSets > 0 && value.completedSets <= value.totalSets
      && value.completedExercises <= value.totalExercises
      && value.skippedExercises <= value.totalExercises
      && (value.status !== 'complete' || value.completedSets === value.totalSets);
  }

  function readWorkoutHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY));
      if (value?.schemaVersion !== 1 || !Array.isArray(value.records)) return [];
      return [...new Map(value.records.filter(validHistoryEntry).map(entry => [entry.id, entry])).values()];
    } catch (_) { return []; }
  }

  function completedWorkouts() {
    return [...new Map(workoutHistory.filter(entry => entry.status === 'complete').map(entry => [entry.workoutKey, entry])).values()];
  }

  function workoutCompleted(planId, date) {
    return workoutHistory.some(entry => entry.status === 'complete' && entry.workoutKey === `${planId}|${date}`);
  }

  function readActiveWorkout() {
    try {
      const value = JSON.parse(localStorage.getItem(ACTIVE_KEY));
      if (!value || workoutHistory.some(entry => entry.id === value.id)) return null;
      return runner.restore(value, catalog);
    } catch (_) { return null; }
  }

  function persistActiveWorkout() {
    let success = true;
    try {
      if (activeWorkout) {
        activeWorkout = runner.snapshot(activeWorkout);
        localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeWorkout));
      } else localStorage.removeItem(ACTIVE_KEY);
    } catch (_) { success = false; }
    activeStorageFailed = !success;
    const note = document.getElementById('active-storage-note');
    note.hidden = success;
    note.textContent = success ? '' : 'ההתקדמות זמינה כרגע, אך הדפדפן לא הצליח לשמור אותה. רענון עלול לאבד את האימון.';
    syncChanged();
    return success;
  }

  function clockText(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(value / 60);
    const rest = String(value % 60).padStart(2, '0');
    return `${String(minutes).padStart(2, '0')}:${rest}`;
  }

  function startWorkout(plan, dayIndex) {
    if (needsAdaptation()) { openPlanSetup(savedPlan); return; }
    if (activeWorkout) { resumeWorkout(); return; }
    const day = plan?.days[dayIndex];
    if (!day?.session || savedPlan?.id !== plan.id || plan.profileFingerprint !== engine.fingerprint(profile)) {
      notify('יש לשמור תוכנית לפי הפרטים הנוכחיים לפני התחלת האימון.');
      return;
    }
    if (workoutCompleted(plan.id, day.date)) {
      openWorkout(plan, dayIndex);
      return;
    }
    if (plan.schemaVersion >= 6) {
      const today=engine.localDate();
      if (day.date!==today) {notify('אפשר להתחיל אימון רק ביום שבו נקבע. אפשר לערוך ימים ושעות בהגדרות התוכנית.');return;}
      const muscles=new Set((day.session.areas||[]).filter(a=>schedule.MUSCLES.includes(a)));
      for(const entry of workoutHistory) {
        if(entry.status!=='complete'||!Number.isFinite(Date.parse(entry.completedAt)))continue;
        const elapsed=Date.now()-Date.parse(entry.completedAt);
        if(elapsed<0||elapsed>=48*3600*1000)continue;
        const previousMuscles=new Set((entry.itemResults||[]).filter(item=>item.phase==='main'&&item.completedSets>0).map(item=>catalog.find(ex=>ex.id===item.exerciseId)?.group));
        const overlap=[...muscles].find(area=>previousMuscles.has(area));
        if(overlap){notify(`צריך להמתין 48 שעות מאימון ${schedule.AREA_LABELS[overlap]} הקודם. האפליקציה לא תאפשר להתחיל קודם.`);return;}
      }
    }
    try {
      activeWorkout = runner.create(plan, dayIndex, catalog);
      resultView = null;
      activeRenderedKey = '';
      persistActiveWorkout();
      showScreen('active', { focus: false });
      renderActiveWorkout(true);
    } catch (_) { notify('לא ניתן לפתוח את האימון הזה. אפשר לבנות תוכנית חדשה.'); }
  }

  function resumeWorkout() {
    if (!activeWorkout) return;
    if ((needsAdaptation() || activeWorkout.profileFingerprint !== engine.fingerprint(profile)) && activeWorkout.stage !== 'review') {
      activeWorkout = runner.reduce(activeWorkout, { type: 'finish' });
      persistActiveWorkout();
      showWorkoutResult();
      notify(needsAdaptation() ? 'סומנה מגבלה. אפשר לשמור את הביצוע הקיים; לפני המשך צריך לקבל התאמה.' : 'הפרטים השתנו. שמרו את מה שבוצע והכינו תוכנית לפי הפרטים המעודכנים.');
      return;
    }
    if (activeWorkout.stage === 'review') { showWorkoutResult(); return; }
    showScreen('active');
    renderActiveWorkout(true);
  }

  function renderActiveExercise() {
    const item = activeWorkout.items[activeWorkout.cursor];
    const exercise = catalog.find(value => value.id === item.exerciseId);
    document.getElementById('active-heading').textContent = exercise.name;
    document.getElementById('active-description').textContent = exercise.description;
    const phaseLabels = { warmup: 'חימום', main: 'החלק המרכזי', cooldown: 'סיום הדרגתי' };
    document.getElementById('active-phase').textContent = phaseLabels[item.phase] || 'האימון שלך';
    document.getElementById('active-position').textContent = `תרגיל ${activeWorkout.cursor + 1} מתוך ${activeWorkout.items.length}`;
    document.getElementById('active-dose').textContent = item.kind === 'timed' ? formatSeconds(item.durationSeconds)
      : item.kind === 'hold' ? `${item.reps} החזקות${item.perSide ? ' לכל צד' : ''} · ${item.holdSeconds} שניות להחזקה`
      : `${item.reps} חזרות${item.perSide ? ' לכל צד' : ''}`;
    const original = exerciseCard(exercise, null, activeWorkout.cursor, true);
    const content = original.querySelector('.exercise-details');
    const demo = document.getElementById('active-demo');
    demo.replaceChildren(...[content.querySelector('.exercise-video-wrap'),content.querySelector('.video-source-link'),...content.querySelectorAll('.video-context-note')].filter(Boolean));
    const cautions = content.querySelector('.exercise-cautions');
    document.getElementById('active-cautions').replaceChildren(...(cautions ? [cautions] : []));
    document.getElementById('active-instructions').replaceChildren(content);
    document.getElementById('active-howto').open = false;
    document.getElementById('active-goal-note').textContent = guidance.doseHint(exercise, profile, trainingContext);
    renderActiveLoad(true);
    renderActiveReps(true);
  }

  function renderActiveWorkout(focus = false) {
    if (!activeWorkout || activeWorkout.stage === 'review') return;
    const key = `${activeWorkout.id}|${activeWorkout.cursor}`;
    if (key !== activeRenderedKey) {
      stopAllPlayers();
      renderActiveExercise();
      activeRenderedKey = key;
      if (focus) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        document.getElementById('active-heading').focus({ preventScroll: true });
      }
    }
    renderActiveClock();
  }

  function renderActiveClock() {
    if (!activeWorkout || activeScreen !== 'active' || activeWorkout.stage === 'review') return;
    const stats = runner.stats(activeWorkout);
    const item = activeWorkout.items[activeWorkout.cursor];
    const rest = activeWorkout.stage === 'rest';
    const paused = activeWorkout.paused;
    const panel = document.getElementById('active-state-panel');
    panel.dataset.state = paused ? 'paused' : rest ? (stats.restSecondsRemaining > 0 ? 'rest' : 'ready') : 'exercise';
    const progress = document.getElementById('active-progress');
    const percent = Math.round(stats.progress * 100);
    progress.setAttribute('aria-valuenow', String(percent));
    progress.setAttribute('aria-valuetext', `${stats.completedSets} מתוך ${stats.totalSets} סטים הושלמו`);
    document.getElementById('active-progress-fill').style.width = `${percent}%`;
    document.getElementById('active-elapsed').textContent = clockText(stats.elapsedSeconds);
    document.getElementById('active-set-label').textContent = rest
      ? `הושלם סט ${activeWorkout.completedSets[activeWorkout.cursor]} מתוך ${item.sets}`
      : `סט ${Math.min(item.sets, activeWorkout.completedSets[activeWorkout.cursor] + 1)} מתוך ${item.sets}`;
    const pause = document.getElementById('active-pause-button');
    pause.textContent = paused ? 'המשך' : 'השהיה';
    pause.setAttribute('aria-pressed', String(paused));
    pause.setAttribute('aria-label', paused ? 'המשך האימון' : 'השהיית האימון');
    const clock = document.getElementById('active-clock');
    clock.hidden = !rest && item.kind !== 'timed';
    clock.textContent = clockText(rest ? stats.restSecondsRemaining : stats.movementSecondsRemaining);
    const movement = document.getElementById('active-movement-button');
    movement.hidden = rest || item.kind !== 'timed' || paused;
    movement.disabled = stats.movementSecondsRemaining <= 0;
    movement.textContent = activeWorkout.movementRunning ? 'השהיית טיימר התנועה' : 'הפעלת טיימר התנועה';
    document.getElementById('active-extend-button').hidden = !rest;
    const stateTitle = document.getElementById('active-state-title');
    const stateCopy = document.getElementById('active-state-copy');
    if (paused) {
      stateTitle.textContent = 'האימון מושהה';
      stateCopy.textContent = 'הזמן והספירה לא מתקדמים. ממשיכים כשנוח לך.';
    } else if (rest) {
      stateTitle.textContent = stats.restSecondsRemaining > 0 ? 'זמן לנוח' : 'אפשר להמשיך';
      const nextIndex = activeWorkout.completedSets[activeWorkout.cursor] < item.sets ? activeWorkout.cursor : activeWorkout.cursor + 1;
      const next = activeWorkout.items[nextIndex];
      stateCopy.textContent = next ? `בהמשך: ${catalog.find(exercise => exercise.id === next.exerciseId).name}. אפשר להוסיף זמן או להמשיך עכשיו.` : 'אפשר להמשיך לסיכום.';
    } else if (item.kind === 'timed') {
      stateTitle.textContent = stats.movementSecondsRemaining <= 0 ? 'הטיימר הסתיים' : 'משך התנועה';
      stateCopy.textContent = 'אפשר להפעיל טיימר. רק לחיצה על ״סיימתי״ מסמנת את התנועה כבוצעה.';
    } else {
      stateTitle.textContent = 'בקצב שלך';
      stateCopy.textContent = item.perSide ? 'הסט כולל את שני הצדדים. מסמנים רק אחרי שהושלמו שניהם.' : 'מסמנים את הסט רק אחרי הביצוע. אפשר להשהות בכל רגע.';
    }
    document.getElementById('active-primary-button').textContent = paused ? 'המשך האימון' : rest ? (activeWorkout.completedSets[activeWorkout.cursor] < item.sets ? 'המשך לסט הבא' : 'המשך לתרגיל הבא') : item.kind === 'timed' ? 'סיימתי את התנועה' : 'סיימתי סט';
    document.getElementById('active-skip-button').hidden = rest;
    document.getElementById('active-skip-button').disabled = paused;
    document.getElementById('active-storage-note').hidden = !activeStorageFailed;
    renderActiveLoad();
    renderActiveReps();
  }

  function renderActiveLoad(resetInput = false) {
    if (!activeWorkout || activeWorkout.stage === 'review') return;
    const item = activeWorkout.items[activeWorkout.cursor];
    const exercise = catalog.find(value => value.id === item.exerciseId);
    const spec = training.loadSpec(exercise);
    const panel = document.getElementById('active-load-panel');
    panel.hidden = !spec.supportsKg;
    if (!spec.supportsKg) return;
    const input = document.getElementById('active-load-input');
    const editing = activeWorkout.stage === 'exercise';
    document.getElementById('active-load-label').textContent = spec.label;
    document.getElementById('active-load-help').textContent = `${spec.help} המשקל נרשם רק כשמסמנים שהסט בוצע. עדכון לא משנה סטים קודמים.`;
    document.getElementById('active-load-current').textContent = `${editing ? 'המשקל שנבחר לסט הזה' : 'המשקל שנבחר לתרגיל'}: ${loadText(exercise, item.weightKg)}${editing ? '' : ' · אפשר לעדכן אחרי המעבר לסט הבא.'}`;
    input.disabled = !editing;
    document.getElementById('active-load-save').disabled = !editing;
    document.getElementById('active-load-save').textContent = `עדכון המשקל לסט ${Math.min(item.sets, activeWorkout.completedSets[activeWorkout.cursor] + 1)}`;
    if (resetInput) {
      input.value = item.weightKg == null ? '' : String(item.weightKg);
      input.removeAttribute('aria-invalid');
      document.getElementById('active-load-error').hidden = true;
    }
  }

  function renderActiveReps(resetInput = false) {
    if (!activeWorkout || activeWorkout.stage === 'review') return;
    const item = activeWorkout.items[activeWorkout.cursor];
    const panel = document.getElementById('active-reps-panel');
    panel.hidden = item.kind === 'timed';
    if (item.kind === 'timed') return;
    const input = document.getElementById('active-reps-input');
    const editing = activeWorkout.stage === 'exercise';
    const unit = item.kind === 'hold' ? 'החזקות' : 'חזרות';
    const side = item.perSide ? ' לכל צד' : '';
    document.getElementById('active-reps-label').textContent = `${unit} שבוצעו בסט${side}`;
    document.getElementById('active-reps-unit').textContent = unit;
    document.getElementById('active-reps-target').textContent = `תכנון: ${item.reps}${side}`;
    document.getElementById('active-reps-help').textContent = editing
      ? `לפני ״סיימתי סט״, עדכנו את המספר לפי הביצוע בפועל.${item.perSide ? ' המספר הוא לכל צד.' : ''} שדה ריק = לא תועד.`
      : 'זה הדיווח של הסט שסיימת. אפשר להזין מספר חדש לאחר המעבר לסט הבא.';
    input.disabled = !editing;
    const actual = editing ? activeWorkout.currentReps
      : activeWorkout.setReps?.[activeWorkout.cursor]?.[activeWorkout.completedSets[activeWorkout.cursor] - 1];
    document.getElementById('active-reps-current').textContent = editing ? ''
      : actual == null ? 'מספר החזרות בסט הזה לא תועד.' : `בסט שסיימת: ${actual} ${unit}${side} · תוכננו ${item.reps}.`;
    if (resetInput) {
      input.value = actual == null ? '' : String(actual);
      input.removeAttribute('aria-invalid');
      document.getElementById('active-reps-error').hidden = true;
    }
  }

  function chosenActiveReps(focus = true) {
    const input = document.getElementById('active-reps-input');
    const reps = input.value === '' && !input.validity.badInput ? null : input.valueAsNumber;
    const valid = reps === null || training.validReps(reps);
    const error = document.getElementById('active-reps-error');
    error.hidden = valid;
    if (!valid) {
      error.textContent = `יש להזין מספר שלם בין ${training.REPS_MIN} ל־${training.REPS_MAX}, או להשאיר ריק אם לא תועד. אם לא בוצע הסט, אפשר לדלג עליו.`;
      input.setAttribute('aria-invalid', 'true');
      if (focus) input.focus();
      return { valid: false };
    }
    input.removeAttribute('aria-invalid');
    return { valid: true, reps };
  }

  function chosenActiveWeight() {
    const input = document.getElementById('active-load-input');
    const weight = input.value === '' && !input.validity.badInput ? null : input.valueAsNumber;
    if (!training.validWeight(weight)) {
      const error = document.getElementById('active-load-error');
      error.textContent = `יש להזין משקל בין ${training.WEIGHT_MIN} ל־${training.WEIGHT_MAX} ק״ג, בקפיצות של ${training.WEIGHT_STEP}, או להשאיר ריק אם לא תועד. זהו טווח הזנה בלבד.`;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return { valid: false };
    }
    input.removeAttribute('aria-invalid');
    document.getElementById('active-load-error').hidden = true;
    return { valid: true, weightKg: weight };
  }

  function saveActiveWeight() {
    if (!activeWorkout || activeWorkout.stage !== 'exercise') return;
    const chosen = chosenActiveWeight();
    if (!chosen.valid) return;
    actOnWorkout('set-load', { weightKg: chosen.weightKg });
    if (activeScreen === 'active') notify('המשקל עודכן לסט הנוכחי. הסטים הקודמים נשמרו כפי שסומנו.');
  }

  function actOnWorkout(type, extra = {}) {
    if (!activeWorkout) return;
    if ((needsAdaptation() || activeWorkout.profileFingerprint !== engine.fingerprint(profile)) && !['finish', 'pause'].includes(type)) {
      activeWorkout = runner.reduce(activeWorkout, { type: 'finish' });
      persistActiveWorkout();
      showWorkoutResult();
      notify(needsAdaptation() ? 'סומנה מגבלה. לפני המשך צריך לקבל התאמה מקצועית.' : 'הפרטים השתנו. יש להכין תוכנית לפי הפרופיל המעודכן.');
      return;
    }
    if (type === 'complete-set') {
      const item = activeWorkout.items[activeWorkout.cursor];
      const exercise = catalog.find(value => value.id === item.exerciseId);
      const reps = item.kind === 'timed' ? null : chosenActiveReps();
      if (reps && !reps.valid) return;
      if (training.loadSpec(exercise).supportsKg) {
        const chosen = chosenActiveWeight();
        if (!chosen.valid) return;
        activeWorkout = runner.reduce(activeWorkout, { type: 'set-load', weightKg: chosen.weightKg });
      }
      if (reps) activeWorkout = runner.reduce(activeWorkout, { type: 'set-reps', reps: reps.reps });
    }
    const now = Date.now();
    if (['complete-set', 'advance', 'skip', 'finish'].includes(type)) {
      if (now - lastWorkoutAction < 500) return;
      lastWorkoutAction = now;
    }
    activeWorkout = runner.reduce(activeWorkout, { type, ...extra }, now);
    if (['complete-set', 'advance', 'skip', 'pause', 'finish'].includes(type)) stopAllPlayers();
    persistActiveWorkout();
    if (activeWorkout.stage === 'review') showWorkoutResult();
    else {
      renderActiveWorkout(['advance', 'skip', 'return'].includes(type));
      if (['advance', 'set-load'].includes(type)) renderActiveLoad(true);
      if (['advance', 'complete-set'].includes(type)) renderActiveReps(true);
    }
  }

  function showWorkoutResult() {
    if (!activeWorkout || activeWorkout.stage !== 'review') return;
    resultView = { state: runner.snapshot(activeWorkout), record: null };
    renderWorkoutResult();
    showScreen('workout-result', { focus: true });
  }

  function renderWorkoutResult(message = '') {
    if (!resultView) return;
    const { state, record } = resultView;
    const stats = runner.stats(state);
    const saved = Boolean(record);
    document.getElementById('result-heading').textContent = saved ? 'האימון נשמר' : 'רגע לסיכום';
    document.getElementById('result-description').textContent = `${state.title} · ${formatDate(state.scheduledDate)}`;
    document.getElementById('result-badge').textContent = stats.isComplete ? (saved ? 'הושלם ונשמר' : 'כל הסטים סומנו') : stats.hasWork ? 'אימון חלקי' : 'עדיין לא בוצעו סטים';
    document.getElementById('result-badge').classList.toggle('is-partial', !stats.isComplete);
    document.getElementById('result-time').textContent = clockText(stats.elapsedSeconds);
    document.getElementById('result-exercises').textContent = `${stats.completedExercises}/${stats.totalExercises}`;
    document.getElementById('result-sets').textContent = `${stats.completedSets}/${stats.totalSets}`;
    document.getElementById('result-skipped').textContent = String(stats.skippedExercises);
    document.getElementById('result-count-note').textContent = saved
      ? record.status === 'complete' ? 'האימון נוסף להתקדמות שלך. כל אימון בתוכנית נספר פעם אחת.' : 'הביצוע נשמר כאימון חלקי, ואינו מוסיף אימון מלא להתקדמות השבועית.'
      : !stats.hasWork ? 'אין עדיין סטים שבוצעו לשמירה. אפשר לחזור לאימון או לצאת בלי לשנות את ההתקדמות.'
      : stats.isComplete ? 'אישור הסיום יוסיף אימון אחד להתקדמות שלך. צפייה בסיכום לבדה אינה מוסיפה אימון.'
      : 'חלק מהסטים לא בוצעו. אפשר לשמור את הביצוע כאימון חלקי; הוא לא ייספר כאימון מלא.';
    document.getElementById('result-items').replaceChildren(...state.items.map((item, index) => {
      const done = state.completedSets[index];
      const skipped = state.skipped[index];
      const row = node('article', `result-item ${done === item.sets ? 'is-complete' : skipped ? 'is-skipped' : 'is-partial'}`);
      const copy = node('div', 'result-item-copy');
      copy.append(node('strong', 'result-item-name', catalog.find(exercise => exercise.id === item.exerciseId).name));
      const phase = { warmup: 'חימום', main: 'חלק מרכזי', cooldown: 'סיום' }[item.phase] || '';
      copy.append(node('span', 'result-item-meta', `${phase} · ${item.sets === 1 ? (done ? 'סט אחד בוצע' : 'סט אחד מתוכנן') : `${done} מתוך ${item.sets} סטים`}`));
      const exercise = catalog.find(value => value.id === item.exerciseId);
      for (let setIndex = 0; setIndex < done; setIndex += 1) {
        const parts = [`סט ${setIndex + 1}`];
        if (item.kind !== 'timed') {
          const reps = state.setReps?.[index]?.[setIndex];
          const unit = item.kind === 'hold' ? 'החזקות' : 'חזרות';
          parts.push(reps == null ? 'חזרות לא תועדו' : `${reps} ${unit}${item.perSide ? ' לכל צד' : ''}`);
          parts.push(`תכנון: ${item.reps}`);
        } else parts.push(`משך מתוכנן: ${formatSeconds(item.durationSeconds)}`);
        if (training.loadSpec(exercise).supportsKg) parts.push(loadText(exercise, state.setLoads?.[index]?.[setIndex]));
        copy.append(node('span', 'result-item-meta result-set-line', parts.join(' · ')));
      }
      row.append(copy, node('span', 'result-item-status', done === item.sets ? 'בוצע' : skipped ? 'דולג' : 'לא הושלם'));
      return row;
    }));
    const confirm = document.getElementById('result-confirm-button');
    confirm.hidden = saved;
    confirm.disabled = !stats.hasWork || savingWorkout;
    confirm.textContent = stats.isComplete ? 'אישור סיום ושמירה' : 'שמירת האימון החלקי';
    const profileChanged = state.profileFingerprint !== engine.fingerprint(profile);
    document.getElementById('result-return-button').hidden = saved || !state.reviewReturn || profileChanged;
    if (needsAdaptation()) document.getElementById('result-return-button').hidden = true;
    if (!saved && needsAdaptation()) document.getElementById('result-count-note').textContent += ' סומנה מגבלה; לפני אימון נוסף יש לקבל התאמה מקצועית.';
    if (!saved && profileChanged) document.getElementById('result-count-note').textContent += ' פרטי הפרופיל השתנו; יש להכין תוכנית מעודכנת לפני אימון נוסף.';
    document.getElementById('result-home-button').hidden = false;
    document.getElementById('result-history-button').hidden = !saved;
    document.getElementById('result-home-button').textContent = saved ? 'חזרה לבית' : stats.hasWork ? 'לאישור הסיכום אחר כך' : 'יציאה ללא שמירה';
    const note = document.getElementById('result-storage-note');
    note.hidden = !message;
    note.textContent = message;
  }

  function confirmWorkoutResult() {
    if (savingWorkout || !activeWorkout || resultView?.record || activeWorkout.stage !== 'review') return;
    const entry = runner.record(activeWorkout);
    if (!entry || !validHistoryEntry(entry)) return;
    savingWorkout = true;
    const latest = [...new Map([...workoutHistory, ...readWorkoutHistory()].map(record => [record.id, record])).values()];
    const existing = latest.find(record => record.id === entry.id || (entry.status === 'complete' && record.status === 'complete' && record.workoutKey === entry.workoutKey));
    const merged = existing ? latest : [...latest, entry];
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify({ schemaVersion: 1, records: merged }));
      workoutHistory = merged;
      resultView = { state: runner.snapshot(activeWorkout), record: existing || entry };
      activeWorkout = null;
      persistActiveWorkout();
      savingWorkout = false;
      renderWorkoutResult();
    } catch (_) {
      savingWorkout = false;
      renderWorkoutResult('הדפדפן לא הצליח לשמור את הסיכום. ההתקדמות לא עודכנה. אפשר לנסות שוב; הסיכום עדיין פתוח.');
    }
  }

  function renderPlanningGuidance() {
    const context = currentTrainingContext();
    const panel = document.getElementById('setup-goal-guidance');
    const card = node('section', 'goal-guidance-card');
    card.append(node('p', 'eyebrow', 'לפי המטרות שסימנת'), node('h2', '', 'כיוון אישי לבחירה שלך'));
    const list = node('div', 'goal-guidance-list');
    for (const item of guidance.overview(profile, context)) {
      const row = node('div');
      row.append(node('h3', '', item.title), node('p', '', item.text));
      list.append(row);
    }
    card.append(list, node('p', 'prescription-help', 'ההכוונה כללית. בחירה במטרה אינה משנה אוטומטית סטים או משקל, ואין המלצת ק״ג לפי גיל או משקל גוף.'));
    const sourceDetails = node('details', 'guidance-sources');
    sourceDetails.append(node('summary', '', 'על מה מבוססת ההכוונה?'));
    for (const source of guidance.SOURCES) {
      const link = node('a', '', source.label);
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      sourceDetails.append(link);
    }
    card.append(sourceDetails);
    panel.replaceChildren(card);
    const restricted = guidance.needsGuidance(context);
    document.getElementById('setup-injury-details').hidden = !restricted;
    const injury = document.getElementById('setup-injury-guidance');
    const fragments = [node('h3', '', context.screening === 'unsure' ? 'כשלא בטוחים, בודקים התאמה' : 'מתאימים לפני שמתחילים'), node('p', '', 'כדי לבחור תרגילים ועומס למצב שסימנת, צריך הנחיות מרופא/ה או מפיזיותרפיסט/ית. ספריית ההסברים זמינה לעיון, אבל לא נוצרת תוכנית אוטומטית במצב הזה.')];
    if (context.injuryAreas.length) {
      fragments.push(node('p', '', `האזורים שסימנת: ${context.injuryAreas.map(area => guidance.AREA_LABELS[area]).join(', ')}.`));
      const related = catalog.filter(exercise => selectedExerciseIds.has(exercise.id) && guidance.areaCautions(exercise, context).length);
      if (related.length) {
        fragments.push(node('strong', '', 'דגשים מתוך התרגילים שבחרת:'));
        const examples = node('ul');
        for (const exercise of related) {
          const labels = guidance.areaCautions(exercise, context).map(caution => caution.title).join(', ');
          examples.append(node('li', '', `${exercise.name} — ${labels}`));
        }
        fragments.push(examples);
      }
      fragments.push(node('p', 'prescription-help', 'ההתאמה כאן מציגה אזכורים של האזור בדגשי הספרייה. היעדר אזכור אינו אישור שהתרגיל מתאים לפציעה.'));
    }
    fragments.push(node('p', '', 'אם מופיעים כאב או הרגשה לא טובה בזמן תרגול, עוצרים.'));
    injury.replaceChildren(...fragments);
    const storage = document.getElementById('training-context-storage-note');
    storage.hidden = !contextStorageFailed;
    storage.textContent = contextStorageFailed ? 'הבחירה זמינה כרגע, אך הדפדפן לא שמר אותה. לפני אימון לאחר רענון יש לעדכן שוב את ההתאמות.' : '';
    const matches = (profile?.goals || []).map(goal => guidance.GOAL_LABELS[goal]).filter(Boolean);
    document.getElementById('picker-goal-summary').textContent = matches.length ? `המטרות שלך: ${matches.join(' · ')}. הסינון מציג קשר למטרה לפי סוג התרגיל, ואינו קובע התאמה רפואית.` : 'אפשר להוסיף מטרות בפרופיל כדי למקד את הספרייה.';
    const goalFilter = document.getElementById('picker-goal-only');
    goalFilter.disabled = !catalog.some(exercise => guidance.matchedGoals(exercise, profile).length);
    if (goalFilter.disabled) goalFilter.checked = false;
    const healthNote = document.getElementById('picker-health-note');
    healthNote.hidden = !restricted;
    healthNote.textContent = 'סומנה פציעה, מגבלה או אי־ודאות. אפשר לעיין בהסברים; הבחירה בספרייה אינה אישור לביצוע. את התרגילים והעומס מתאימים עם איש מקצוע.';
  }

  function renderPrescriptionEditors() {
    const section = document.getElementById('setup-prescriptions');
    section.hidden = !selectedExerciseIds.size;
    const cards = [...selectedExerciseIds].map(id => {
      const exercise = catalog.find(value => value.id === id);
      const options = selectedExerciseOptions[id] || (selectedExerciseOptions[id] = training.defaultOptions(exercise));
      const spec = training.loadSpec(exercise);
      const card = node('article', 'prescription-card');
      const heading = node('div', 'prescription-card-head');
      heading.append(node('h3', '', exercise.name), node('span', 'exercise-tag', GROUP_LABELS[exercise.group]));
      const fields = node('div', 'prescription-controls');
      const setsField = node('div', 'prescription-field');
      const setsLabel = node('label', '', exercise.category === 'strength' ? 'מספר סטים' : 'מספר סטים / סבבים');
      const sets = node('select');
      sets.id = `sets-${id}`;
      sets.dataset.exerciseSets = id;
      setsLabel.htmlFor = sets.id;
      sets.setAttribute('aria-label', `מספר סטים — ${exercise.name}`);
      for (let number = training.SET_MIN; number <= training.SET_MAX; number += 1) {
        const option = node('option', '', number === 1 ? 'סט אחד' : `${number} סטים`);
        option.value = String(number);
        sets.append(option);
      }
      sets.value = String(options.sets);
      sets.addEventListener('change', () => {
        selectedExerciseOptions[id].sets = Number(sets.value);
        updatePrescriptionMeta(meta, exercise);
      });
      setsField.append(setsLabel, sets);
      fields.append(setsField);
      const loadField = node('div', 'prescription-field');
      if (spec.supportsKg) {
        const label = node('label', '', spec.label);
        const input = node('input');
        input.type = 'number';
        input.id = `weight-${id}`;
        input.dataset.exerciseWeight = id;
        input.inputMode = 'decimal';
        input.min = String(training.WEIGHT_MIN);
        input.max = String(training.WEIGHT_MAX);
        input.step = String(training.WEIGHT_STEP);
        input.value = options.weightKg == null ? '' : String(options.weightKg);
        input.placeholder = 'לא צוין';
        input.setAttribute('aria-label', `${spec.label} — ${exercise.name}`);
        input.setAttribute('aria-describedby', `load-help-${id}`);
        label.htmlFor = input.id;
        input.addEventListener('input', () => {
          const weight = input.value === '' && !input.validity.badInput ? null : input.valueAsNumber;
          selectedExerciseOptions[id].weightKg = weight;
          input.setAttribute('aria-invalid', String(!training.validWeight(weight)));
          updatePrescriptionMeta(meta, exercise);
        });
        loadField.append(label, input);
      } else {
        loadField.append(node('span', '', 'התנגדות'), node('p', 'prescription-resistance', loadText(exercise, null)));
      }
      fields.append(loadField);
      const repsField = node('div', 'prescription-field');
      if (training.supportsReps(exercise)) {
        const unit = exercise.defaultPrescription.kind === 'hold' ? 'החזקות' : 'חזרות';
        const label = node('label', '', `${unit} בכל סט${exercise.defaultPrescription.perSide ? ' לכל צד' : ''}`);
        const input = node('input');
        input.type = 'number';
        input.id = `reps-${id}`;
        input.inputMode = 'numeric';
        input.min = String(training.REPS_MIN);
        input.max = String(training.REPS_MAX);
        input.step = '1';
        input.value = String(options.reps);
        input.setAttribute('aria-label', `${label.textContent} — ${exercise.name}`);
        label.htmlFor = input.id;
        input.addEventListener('input', () => {
          selectedExerciseOptions[id].reps = input.valueAsNumber;
          input.setAttribute('aria-invalid', String(!training.validReps(input.valueAsNumber)));
          updatePrescriptionMeta(meta, exercise);
        });
        repsField.append(label, input);
      } else {
        repsField.append(node('span', '', 'משך מתוכנן בכל סט'), node('p', 'prescription-resistance', formatSeconds(exercise.defaultPrescription.durationSeconds)));
      }
      const restField = node('div', 'prescription-field');
      const restLabel = node('label', '', 'מנוחה אחרי סט (שניות)');
      const rest = node('input');
      rest.type = 'number';
      rest.id = `rest-${id}`;
      rest.inputMode = 'numeric';
      rest.min = String(training.REST_MIN);
      rest.max = String(training.REST_MAX);
      rest.step = '1';
      rest.value = String(options.restSeconds);
      rest.setAttribute('aria-label', `מנוחה אחרי סט בשניות — ${exercise.name}`);
      rest.setAttribute('aria-describedby', `rest-help-${id}`);
      restLabel.htmlFor = rest.id;
      rest.addEventListener('input', () => {
        selectedExerciseOptions[id].restSeconds = rest.valueAsNumber;
        rest.setAttribute('aria-invalid', String(!training.validRest(rest.valueAsNumber)));
        updatePrescriptionMeta(meta, exercise);
      });
      const restHelp = node('p', 'prescription-help', '0 = ללא טיימר מנוחה. אפשר להאריך או להמשיך בזמן האימון.');
      restHelp.id = `rest-help-${id}`;
      restField.append(restLabel, rest, restHelp);
      fields.append(repsField, restField);
      const help = node('p', 'prescription-help', spec.help + (spec.supportsKg ? ' שדה ריק = לא צוין; 0 נרשם כ־0 ק״ג. מזינים ק״ג בלבד.' : ''));
      help.id = `load-help-${id}`;
      const meta = node('p', 'prescription-meta', prescriptionText({ exerciseId: id, ...exercise.defaultPrescription, ...options }));
      updatePrescriptionMeta(meta, exercise);
      card.append(heading, fields, help, meta, node('p', 'prescription-help', guidance.doseHint(exercise, profile, currentTrainingContext())));
      return card;
    });
    document.getElementById('setup-prescription-list').replaceChildren(...cards);
  }

  function updatePrescriptionMeta(meta, exercise) {
    const options = selectedExerciseOptions[exercise.id];
    meta.textContent = training.validOptions(exercise, options)
      ? prescriptionText({ exerciseId: exercise.id, ...exercise.defaultPrescription, ...options })
      : 'יש לתקן את השדות המסומנים לפני יצירת הטיוטה.';
  }

  function invalidPrescriptionField(id) {
    const exercise = catalog.find(value => value.id === id);
    const options = selectedExerciseOptions[id];
    if (!training.validSets(options?.sets)) return `sets-${id}`;
    if (training.loadSpec(exercise).supportsKg && !training.validWeight(options?.weightKg)) return `weight-${id}`;
    if (training.supportsReps(exercise) && !training.validReps(options?.reps)) return `reps-${id}`;
    if (!training.validRest(options?.restSeconds)) return `rest-${id}`;
    return `sets-${id}`;
  }

  function validatePrescriptionInputs() {
    for (const id of selectedExerciseIds) {
      const exercise = catalog.find(value => value.id === id);
      const options = selectedExerciseOptions[id];
      if (training.validOptions(exercise, options)) continue;
      const message = document.getElementById('setup-prescription-error');
      message.textContent = `יש לבדוק את ההגדרות של ״${exercise.name}״: ${training.SET_MIN}–${training.SET_MAX} סטים, ${training.REPS_MIN}–${training.REPS_MAX} חזרות בתרגיל לפי חזרות, ${training.REST_MIN}–${training.REST_MAX} שניות מנוחה ומשקל תקין.`;
      message.hidden = false;
      const input = document.getElementById(invalidPrescriptionField(id));
      input?.setAttribute('aria-invalid', 'true');
      input?.focus();
      return false;
    }
    return true;
  }

  function updateSelectionSummary() {
    const ids = [...selectedExerciseIds];
    document.getElementById('setup-selected-summary').textContent = ids.length
      ? `${ids.length} נבחרו: ${ids.map(id => catalog.find(exercise => exercise.id === id)?.name).filter(Boolean).join(', ')}`
      : 'עדיין לא נבחרו תרגילים.';
    document.getElementById('setup-pick-exercises').querySelector('span').textContent = ids.length ? 'שינוי בחירת התרגילים' : 'בחירת תרגילים';
    document.getElementById('picker-selection-count').textContent = `${ids.length} נבחרו`;
    document.getElementById('picker-done').disabled = ids.length === 0;
    for (const id of ids) if (!selectedExerciseOptions[id]) selectedExerciseOptions[id] = training.defaultOptions(catalog.find(exercise => exercise.id === id));
    renderPrescriptionEditors();
  }

  function resetCatalogFilters(mode) {
    document.getElementById(`${mode}-search`).value = '';
    document.getElementById(`${mode}-group`).value = 'all';
    document.getElementById(`${mode}-equipment`).value = 'all';
    if (mode === 'picker') {
      document.getElementById('picker-selected-only').checked = false;
      document.getElementById('picker-goal-only').checked = false;
    }
  }

  function renderCatalog(mode) {
    const query = document.getElementById(`${mode}-search`).value.trim().toLocaleLowerCase('he');
    const group = document.getElementById(`${mode}-group`).value;
    const equipment = document.getElementById(`${mode}-equipment`).value;
    const onlySelected = mode === 'picker' && document.getElementById('picker-selected-only').checked;
    const onlyGoals = mode === 'picker' && document.getElementById('picker-goal-only').checked;
    const filtered = catalog.filter(exercise => {
      const haystack = [exercise.name, exercise.id, exercise.description, exercise.equipmentLabel, exercise.video.title, GROUP_LABELS[exercise.group]].join(' ').toLocaleLowerCase('he');
      return (!query || query.split(/\s+/).every(term => haystack.includes(term)))
        && (group === 'all' || exercise.group === group)
        && (equipment === 'all' || equipment === 'none' ? (equipment !== 'none' || exercise.equipment.length === 0) : exercise.equipment.includes(equipment))
        && (!onlySelected || selectedExerciseIds.has(exercise.id))
        && (!onlyGoals || guidance.matchedGoals(exercise, profile).length > 0);
    });
    const container = document.getElementById(mode === 'picker' ? 'picker-results' : 'exercise-library');
    stopAllPlayers();
    const rows = filtered.map(exercise => {
      const index = catalog.indexOf(exercise);
      const card = exerciseCard(exercise, null, index);
      if (mode !== 'picker') return card;
      const wrapper = node('article', `picker-card${selectedExerciseIds.has(exercise.id) ? ' is-selected' : ''}`);
      const label = node('label', 'exercise-select-label');
      const input = node('input', 'exercise-select-input');
      input.type = 'checkbox';
      input.checked = selectedExerciseIds.has(exercise.id);
      input.setAttribute('aria-label', `בחירת ${exercise.name}`);
      const labelText = node('span', '', input.checked ? 'נבחר לתוכנית' : 'הוספה לתוכנית');
      label.append(input, labelText);
      input.addEventListener('change', () => {
        const errorNode = document.getElementById('picker-error');
        errorNode.hidden = true;
        if (input.checked && selectedExerciseIds.size >= engine.MAX_SELECTED) {
          input.checked = false;
          errorNode.textContent = `אפשר לבחור עד ${engine.MAX_SELECTED} תרגילים לשבוע אחד. הסירו בחירה כדי להוסיף תרגיל אחר.`;
          errorNode.hidden = false;
          notify(errorNode.textContent);
          return;
        }
        if (input.checked) selectedExerciseIds.add(exercise.id);
        else selectedExerciseIds.delete(exercise.id);
        wrapper.classList.toggle('is-selected', input.checked);
        labelText.textContent = input.checked ? 'נבחר לתוכנית' : 'הוספה לתוכנית';
        updateSelectionSummary();
        if (onlySelected && !input.checked) renderCatalog(mode);
      });
      wrapper.append(card, label);
      return wrapper;
    });
    const orderedGroups = ['chest','back','shoulders','arms','legs','core','cardio','mobility'];
    const sections = orderedGroups.flatMap(key => {
      const matching = filtered.map((exercise, i) => ({exercise, card: rows[i]})).filter(entry => entry.exercise.group === key);
      if (!matching.length) return [];
      const section = node('section', 'exercise-group-section');
      const heading = node('h2', 'exercise-group-title', `${GROUP_LABELS[key]} · ${matching.length} תרגילים`);
      const grid = node('div', 'exercise-group-grid');
      grid.append(...matching.map(entry => entry.card));
      section.append(heading, grid);
      return [section];
    });
    container.replaceChildren(...sections);
    document.getElementById(`${mode}-result-count`).textContent = `${filtered.length} מתוך ${catalog.length} תרגילים`;
    document.getElementById(`${mode}-empty`).hidden = filtered.length > 0;
  }

  function openPicker() {
    resetCatalogFilters('picker');
    document.getElementById('picker-error').hidden = true;
    document.getElementById('picker-description').textContent = `${catalog.length} תרגילים לבחירה, ללא מגבלת כמות. סרטונים מקומיים יוצגו רק לתרגילים שזמין עבורם קובץ.`;
    updateSelectionSummary();
    renderPlanningGuidance();
    renderCatalog('picker');
    showScreen('picker', { focus: true });
  }

  function renderLibrary() {
    resetCatalogFilters('library');
    document.getElementById('library-description').textContent = `${catalog.length} תרגילים עם הסברים בעברית וסרטוני הדגמה של אנשים, לבית ולחדר כושר.`;
    renderCatalog('library');
  }

  for (const mode of ['picker', 'library']) {
    document.getElementById(`${mode}-search`).addEventListener('input', () => renderCatalog(mode));
    document.getElementById(`${mode}-group`).addEventListener('change', () => renderCatalog(mode));
    document.getElementById(`${mode}-equipment`).addEventListener('change', () => renderCatalog(mode));
  }
  document.getElementById('picker-selected-only').addEventListener('change', () => renderCatalog('picker'));
  document.getElementById('picker-goal-only').addEventListener('change', () => renderCatalog('picker'));

  const setupForm = document.getElementById('plan-setup-form');
  setupForm.addEventListener('input', clearPlanIssue);
  setupForm.addEventListener('change', clearPlanIssue);
  setupForm.addEventListener('change', event => {
    if (['screening', 'injuryAreas'].includes(event.target.name)) persistTrainingContext();
  });
  setupForm.addEventListener('submit', event => {
    event.preventDefault();
    clearPlanIssue();
    const data = new FormData(setupForm);
    const settings = {
      startDate: data.get('startDate') || '',
      equipment: data.getAll('equipment'),
      selectedExercises: [...selectedExerciseIds],
      exerciseOptions: Object.fromEntries([...selectedExerciseIds].map(id => [id, { ...selectedExerciseOptions[id] }])),
      screening: data.get('screening') || '',
      youthSupervision: data.has('youthSupervision'),
      trainingDays:[...scheduleState.trainingDays],
      bodyAreasByDay:JSON.parse(JSON.stringify(scheduleState.bodyAreasByDay)),
      trainingTimes:{...scheduleState.trainingTimes},
    };
    const issue = engine.validationIssue(profile, settings);
    if (issue) { showPlanIssue(issue); return; }
    if (!validatePrescriptionInputs()) return;
    try {
      draftPlan = engine.build(profile, settings, catalog);
      openPlan(draftPlan);
    } catch (error) {
      showPlanIssue({ field: error.field || 'selectedExercises', message: error.message });
    }
  });

  form.addEventListener('input', clearErrors);
  form.addEventListener('change', clearErrors);
  form.addEventListener('submit', event => {
    event.preventDefault();
    clearErrors();
    const values = collectDetails();
    const issue = stepIssue(currentStep, values);
    if (issue) {
      showIssue(currentStep, issue);
      return;
    }
    if (currentStep < 2) {
      showStep(currentStep + 1, { focus: true });
      return;
    }
    for (let step = 0; step < 3; step += 1) {
      const earlierIssue = stepIssue(step, values);
      if (earlierIssue) {
        showIssue(step, earlierIssue);
        return;
      }
    }
    profile = { ...profile, ...values, schemaVersion: 2, membershipPending: !profile || Boolean(profile.membershipPending) };
    fields.name.value = profile.name;
    let stored = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (_) {
      stored = false;
    }
    syncChanged();
    if (detailsOrigin === 'plan-setup') openPlanSetup(null, true);
    else {onboardingSettingsTip = true;showScreen('home', { focus: true });}
    if (!stored) notify('הפרטים מוצגים כעת. בדפדפן הזה הם לא יישמרו לאחר רענון.');
  });

  document.getElementById('active-reps-input').addEventListener('input', () => {
    if (!activeWorkout || activeWorkout.stage !== 'exercise' || activeWorkout.items[activeWorkout.cursor].kind === 'timed') return;
    const chosen = chosenActiveReps(false);
    if (chosen.valid) actOnWorkout('set-reps', { reps: chosen.reps });
  });

  document.getElementById('membership-form').addEventListener('change', updateMembershipSelection);
  document.getElementById('membership-form').addEventListener('submit', event => {
    event.preventDefault();
    const planId = new FormData(event.currentTarget).get('membershipPlan');
    if (!profile || !Object.hasOwn(membershipPlans, planId)) return;
    membershipChoice = { schemaVersion: 1, planId, selectedAt: new Date().toISOString(), billingStatus: 'not_connected' };
    profile = { ...profile, membershipPending: false };
    let stored = true;
    try {
      localStorage.setItem(MEMBERSHIP_KEY, JSON.stringify(membershipChoice));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (_) { stored = false; }
    syncChanged();
    onboardingSettingsTip = membershipOrigin !== 'account';
    showScreen(membershipOrigin === 'account' ? 'account' : 'home', { focus: true });
    notify(stored ? 'המסלול נבחר. לא בוצע חיוב.' : 'הבחירה זמינה כעת, אך לא נשמרה במכשיר. לא בוצע חיוב.');
  });

  async function continueWithAccount(button) {
    button.disabled = true;
    try {
      await cloud.enable();
      if (cloud.getStatus().enabled && !cloud.getStatus().blocked) {
        if (profile) showScreen('home', { focus: true }); else openDetails('welcome', false);
      } else showScreen('account', { focus: true });
    } catch (_) { showScreen('account', { focus: true }); }
    finally { button.disabled = false; }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-open-account')) { showScreen('account', { focus: true }); return; }
    if (button.hasAttribute('data-edit-account-settings')) {if(activeScreen!=='account')showScreen('account',{focus:true});openAccountSettings();return;}
    if (button.hasAttribute('data-cancel-account-settings')) {document.getElementById('account-settings-form').hidden=true;return;}
    if (button.hasAttribute('data-dismiss-settings-tip')) {onboardingSettingsTip=false;document.getElementById('home-settings-tip').hidden=true;return;}
    
    if (button.hasAttribute('data-local-continue')) { if (profile) showScreen('home', { focus: true }); else openDetails('welcome', false); return; }
    if (button.hasAttribute('data-open-membership')) { membershipOrigin = activeScreen; showScreen('membership', { focus: true }); return; }
    if (button.hasAttribute('data-membership-back')) { if (needsMembershipChoice()) openDetails('welcome', true); else showScreen(membershipOrigin, { focus: true }); return; }
    if (button.hasAttribute('data-open-videos')) { videosOrigin = activeScreen; showScreen('videos', { focus: true }); return; }
    if (button.hasAttribute('data-videos-back')) { showScreen(screens.includes(videosOrigin) ? videosOrigin : 'home', { focus: true }); return; }
    if (button.hasAttribute('data-open-history')) { showScreen('history', { focus: true }); return; }
    if (button.hasAttribute('data-start-workout')) {
      if (viewedWorkout) startWorkout(viewedWorkout.plan, viewedWorkout.dayIndex);
      return;
    }
    if (button.hasAttribute('data-open-adaptations')) {
      openPlanSetup(savedPlan);
      setupForm.querySelector('input[name="screening"]')?.focus();
      return;
    }
    if (button.hasAttribute('data-resume-workout')) { resumeWorkout(); return; }
    if (button.hasAttribute('data-active-exit')) {
      if (activeWorkout) activeWorkout = runner.reduce(activeWorkout, { type: 'pause' });
      const stored = persistActiveWorkout();
      showScreen('home', { focus: true });
      notify(stored ? 'האימון מושהה. אפשר להמשיך מאותה נקודה.' : 'האימון מושהה וזמין כרגע. רענון עלול לאבד את ההתקדמות.');
      return;
    }
    if (button.hasAttribute('data-active-pause')) { actOnWorkout(activeWorkout?.paused ? 'resume' : 'pause'); return; }
    if (button.hasAttribute('data-active-complete')) {
      actOnWorkout(activeWorkout?.paused ? 'resume' : activeWorkout?.stage === 'rest' ? 'advance' : 'complete-set');
      return;
    }
    if (button.hasAttribute('data-active-skip')) { actOnWorkout('skip'); return; }
    if (button.hasAttribute('data-active-extend')) { actOnWorkout('extend-rest', { seconds: 30 }); return; }
    if (button.hasAttribute('data-active-movement')) { actOnWorkout('movement-toggle'); return; }
    if (button.hasAttribute('data-active-load-save')) { saveActiveWeight(); return; }
    if (button.hasAttribute('data-active-finish')) { actOnWorkout('finish'); return; }
    if (button.hasAttribute('data-result-confirm')) { confirmWorkoutResult(); return; }
    if (button.hasAttribute('data-result-return')) {
      if (!activeWorkout || resultView?.record || needsAdaptation() || activeWorkout.profileFingerprint !== engine.fingerprint(profile)) return;
      activeWorkout = runner.reduce(activeWorkout, { type: 'return' });
      persistActiveWorkout();
      resultView = null;
      showScreen('active');
      renderActiveWorkout(true);
      return;
    }
    if (button.hasAttribute('data-result-home')) {
      if (activeWorkout && !runner.stats(activeWorkout).hasWork) {
        activeWorkout = null;
        persistActiveWorkout();
      }
      showScreen('home', { focus: true });
      return;
    }
    if (button.hasAttribute('data-form-back')) {
      clearErrors();
      if (currentStep > 0) showStep(currentStep - 1, { focus: true });
      else showScreen(profile && screens.includes(detailsOrigin) ? detailsOrigin : 'welcome', { focus: true });
      return;
    }
    if (button.hasAttribute('data-nutrition-soon')) { notify('האפשרות הזו תפותח בהמשך'); return; }
    if (button.hasAttribute('data-edit-profile')) {
      openDetails(profile ? activeScreen : 'welcome', true);
      return;
    }
    if (button.hasAttribute('data-open-training')) {
      if (needsAdaptation()) { openPlanSetup(savedPlan); return; }
      if (!savedPlan || savedPlan.profileFingerprint !== engine.fingerprint(profile)) openPlanSetup();
      else {
        const index = savedPlan.days.findIndex(day => day.session && day.date >= engine.localDate() && !workoutCompleted(savedPlan.id, day.date));
        if (activeWorkout) resumeWorkout();
        else if (index >= 0) startWorkout(savedPlan, index);
        else openPlan(savedPlan);
      }
      return;
    }
    if (button.hasAttribute('data-open-plan')) {
      openPlan(['home', 'history'].includes(activeScreen) ? savedPlan : displayedPlan || savedPlan);
      return;
    }
    if (button.hasAttribute('data-edit-plan')) { openPlanSetup(displayedPlan || savedPlan); return; }
    if (button.hasAttribute('data-new-plan')) { openPlanSetup(savedPlan); openPicker(); return; }
    if (button.hasAttribute('data-open-picker')) { openPicker(); return; }
    if (button.hasAttribute('data-picker-done') || button.hasAttribute('data-picker-back')) {
      updateSelectionSummary();
      renderPlanningGuidance();
      showScreen('plan-setup', { focus: true });
      return;
    }
    if (button.hasAttribute('data-reset-picker-filters')) {
      resetCatalogFilters('picker');
      renderCatalog('picker');
      return;
    }
    if (button.hasAttribute('data-save-plan')) { savePlan(); return; }
    if (button.hasAttribute('data-workout-day')) {
      openWorkout(displayedPlan, Number(button.dataset.workoutDay));
      return;
    }
    if (button.hasAttribute('data-open-library')) {
      libraryOrigin = activeScreen;
      renderLibrary();
      showScreen('library', { focus: true });
      return;
    }
    if (button.hasAttribute('data-library-back')) {
      showScreen(screens.includes(libraryOrigin) ? libraryOrigin : 'home', { focus: true });
      return;
    }
    if (button.dataset.go) {
      showScreen(button.dataset.go, { focus: true });
      return;
    }
    if (button.hasAttribute('data-soon')) notify(button.dataset.message || 'האפשרות הזו תתווסף בהמשך.');
  });

  window.addEventListener('storage', event => {
    if (event.key === MEMBERSHIP_KEY) {
      membershipChoice = readMembership();
      if (activeScreen === 'membership') renderMembership();
      renderAccountStatus();
      return;
    }
    if (event.key === CONTEXT_KEY) {
      trainingContext = readTrainingContext();
      setupForm.querySelectorAll('input[name="screening"]').forEach(input => { input.checked = input.value === trainingContext.screening; });
      setupForm.querySelectorAll('input[name="injuryAreas"]').forEach(input => { input.checked = trainingContext.injuryAreas.includes(input.value); });
      if (needsAdaptation() && activeWorkout && activeWorkout.stage !== 'review') {
        activeWorkout = runner.reduce(activeWorkout, { type: 'finish' });
        persistActiveWorkout();
        if (activeScreen === 'active') showWorkoutResult();
      }
      if (activeScreen === 'home') updateHome();
      if (['plan-setup', 'picker'].includes(activeScreen)) {
        renderPlanningGuidance();
        renderPrescriptionEditors();
        if (activeScreen === 'picker') renderCatalog('picker');
      }
      if (activeScreen === 'workout-result') renderWorkoutResult();
      return;
    }
    if (event.key === HISTORY_KEY) {
      workoutHistory = readWorkoutHistory();
      if (activeWorkout && workoutHistory.some(entry => entry.id === activeWorkout.id)) {
        activeWorkout = null;
        if (['active', 'workout-result'].includes(activeScreen)) {
          showScreen('home', { focus: true });
          notify('האימון נשמר בכרטיסייה אחרת. ההתקדמות עודכנה.');
        }
      }
      if (activeScreen === 'home') updateHome();
      if (activeScreen === 'plan' && displayedPlan) renderPlan(displayedPlan);
      if (activeScreen === 'history') renderHistory();
      return;
    }
    if (event.key === ACTIVE_KEY) {
      activeWorkout = readActiveWorkout();
      activeRenderedKey = '';
      if (['active', 'workout-result'].includes(activeScreen)) {
        stopAllPlayers();
        showScreen('home', { focus: true, externalUpdate: true });
        notify('האימון עודכן בכרטיסייה אחרת. אפשר להמשיך מהעדכון האחרון.');
      } else if (activeScreen === 'home') updateHome();
      return;
    }
    if (event.key === PLAN_KEY) {
      savedPlan = readPlan();
      if (activeScreen === 'home') updateHome();
      return;
    }
    if (event.key !== STORAGE_KEY) return;
    profile = readProfile();
    if (profile && activeScreen === 'home') updateHome();
    if (profile && activeScreen === 'history') renderHistory();
    if (!profile && ['home', 'history'].includes(activeScreen)) showScreen('welcome');
  });

  function pauseForBackground() {
    if (!activeWorkout || activeWorkout.stage === 'review' || activeWorkout.paused) return;
    activeWorkout = runner.reduce(activeWorkout, { type: 'pause' });
    stopAllPlayers();
    persistActiveWorkout();
    renderActiveClock();
  }
  document.addEventListener('visibilitychange', () => {if(document.hidden) pauseForBackground(); else {updateAgeIfNeeded();if(activeScreen==='home')updateHome();checkReminders();}});
  window.addEventListener('pagehide', pauseForBackground);
  window.setInterval(() => {
    if (activeScreen !== 'active' || !activeWorkout || activeWorkout.paused) return;
    persistActiveWorkout();
    renderActiveClock();
  }, 1000);

  window.setInterval(()=>{updateAgeIfNeeded();if(activeScreen==='home')updateHome();},3600000);

  async function initialize() {
    const main = document.querySelector('main');

    main.inert = true;
    document.getElementById('startup-notice').hidden = false;
    try {
      await Promise.allSettled([

        videoLibrary.init({ catalog, onChange: videosChanged }),
      ]);
    } finally {
      initializing = false;
      main.inert = false;
      document.getElementById('startup-notice').hidden = true;
      fillDetails(); showStep(0); renderAccountStatus();
      showScreen(profile ? (needsMembershipChoice() ? 'membership' : 'home') : 'details');
    }
  }
  initialize();
})();
