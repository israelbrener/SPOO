// Version 1 is retained only to validate and display existing saved weeks.
/* A small, deterministic introductory catalog. This is not an AI or clinical engine. */
(() => {
  'use strict';
  const VERSION = 1;
  const DURATION_CHOICES = [10, 15, 20, 25, 30];
  const DAY_OFFSETS = {
    1: [0], 2: [0, 3], 3: [0, 3, 5], 4: [0, 2, 3, 5],
    5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6],
  };
  const LOCATION_LABELS = { home: 'בבית', gym: 'בחדר כושר', both: 'בבית או בחדר כושר' };

  function localDate(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    return Number.isFinite(date.getTime()) && localDate(date) === value;
  }

  function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + amount);
    return localDate(date);
  }

  function fingerprint(profile) {
    return JSON.stringify({
      age: profile?.age,
      trainingLocation: profile?.trainingLocation,
      workoutsPerWeek: profile?.workoutsPerWeek,
      goals: [...(profile?.goals || [])].sort(),
      experience: profile?.experience,
    });
  }

  function completeProfile(profile) {
    return Boolean(profile && Number.isInteger(profile.age) && profile.age >= 1 && profile.age <= 120
      && Object.hasOwn(LOCATION_LABELS, profile.trainingLocation)
      && Number.isInteger(profile.workoutsPerWeek) && profile.workoutsPerWeek >= 1 && profile.workoutsPerWeek <= 7
      && Array.isArray(profile.goals) && profile.goals.length > 0 && profile.goals.length <= 5
      && profile.goals.every(value => ['strength', 'endurance', 'flexibility', 'sport-performance', 'general-fitness'].includes(value))
      && ['beginner', 'intermediate', 'experienced'].includes(profile.experience));
  }

  function validationIssue(profile, settings, today = localDate()) {
    if (!completeProfile(profile)) return { field: 'profile', message: 'יש להשלים קודם גיל, שגרת אימון, מטרות וניסיון בפרופיל.' };
    if (profile.age < 13) return { field: 'age', guidance: true, message: 'בניית תוכנית אוטומטית לילדים מתחת לגיל 13 עוד לא זמינה בגרסה הזו. אפשר לעיין בהדגמות עם מבוגר ולבנות תוכנית עם מדריך מתאים.' };
    if (!DURATION_CHOICES.includes(settings.sessionMinutes)) return { field: 'sessionMinutes', message: 'בחרו כמה זמן פנוי יש לאימון.' };
    if (!validDate(settings.startDate) || settings.startDate < today || settings.startDate > addDays(today, 90)) return { field: 'startDate', message: 'בחרו תאריך התחלה מהיום ועד שלושה חודשים קדימה.' };
    if (!['clear', 'guidance', 'unsure'].includes(settings.screening)) return { field: 'screening', message: 'יש לענות על שאלת ההתאמה לפני הצגת הטיוטה.' };
    if (settings.screening !== 'clear') return { field: 'screening', guidance: true, message: 'כדי להכין תוכנית שמתאימה למצב הזה, נדרשת התאמה עם איש מקצוע. ספריית ההסברים פתוחה לעיון.' };
    if (profile.age < 18 && !settings.youthSupervision) return { field: 'youthSupervision', message: 'לפני התחלה בגיל הזה, יש לבדוק את הטיוטה עם מדריך מוסמך לאימוני בני נוער.' };
    if (!Array.isArray(settings.equipment) || settings.equipment.some(value => !['chair', 'wall'].includes(value))) return { field: 'equipment', message: 'יש לבחור רק אביזרים שזמינים לך בפועל.' };
    return null;
  }

  function exerciseSeconds(item) {
    if (item.kind === 'timed') return item.durationSeconds;
    const repetitions = item.reps * (item.perSide ? 2 : 1);
    if (item.kind === 'hold') return repetitions * (item.holdSeconds + 4);
    return repetitions * item.secondsPerRep;
  }

  function estimatedSeconds(items) {
    // No rest after the final exercise. 15 seconds per change of exercise is a UI estimate.
    return items.reduce((sum, item, index) => sum + exerciseSeconds(item)
      + (index < items.length - 1 ? item.restSeconds + 15 : 0), 0);
  }

  function makeItem(exercise, phase, overrides = {}) {
    return { exerciseId: exercise.id, phase, sets: 1, ...exercise.defaultPrescription, ...overrides };
  }

  function buildSession(type, sequence, settings, profile, catalog) {
    const byId = Object.fromEntries(catalog.map(exercise => [exercise.id, exercise]));
    const permitted = id => byId[id] && byId[id].equipment.every(item => settings.equipment.includes(item));
    const warmup = makeItem(byId['march-in-place'], 'warmup', { durationSeconds: 180, restSeconds: 15 });
    const cooldown = makeItem(byId['march-in-place'], 'cooldown', { durationSeconds: 60, restSeconds: 0 });
    const mainIds = type === 'strength'
      ? (sequence % 2 === 0
        ? ['sit-to-stand', 'wall-push-up', 'calf-raise', 'side-leg-raise', 'chest-open', 'seated-rotation']
        : ['seated-march', 'wall-push-up', 'sit-to-stand', 'side-leg-raise', 'seated-rotation', 'chest-open'])
      : ['seated-rotation', 'chest-open'];
    const main = [];
    const fits = candidate => estimatedSeconds([warmup, ...candidate, cooldown]) <= settings.sessionMinutes * 60;

    if (type === 'mobility' || profile.goals.includes('endurance') || !mainIds.some(permitted)) {
      main.push(makeItem(byId['march-in-place'], 'main', { durationSeconds: 120, restSeconds: 30 }));
    }
    for (const id of mainIds.filter(permitted)) {
      const item = makeItem(byId[id], 'main');
      if (fits([...main, item])) main.push(item);
    }
    // Even without household props the catalog can offer a short walking introduction.
    if (!main.length) main.push(makeItem(byId['march-in-place'], 'main', { durationSeconds: 120, restSeconds: 30 }));
    const items = [warmup, ...main, cooldown];
    const hasStrength = main.some(item => byId[item.exerciseId].category === 'strength');
    const actualType = hasStrength ? 'strength' : (settings.equipment.includes('chair') ? 'mobility' : 'movement');
    return {
      type: actualType,
      title: actualType === 'strength' ? (sequence % 2 === 0 ? 'היכרות עם חיזוק' : 'חיזוק ותנועה')
        : actualType === 'mobility' ? 'תנועה וגמישות' : 'צעידה בקצב שלך',
      description: actualType === 'strength' ? 'תרגילי בסיס, סט היכרות אחד לכל תרגיל.'
        : actualType === 'mobility' ? 'מפגש קל עם צעידה ותנועתיות בישיבה.' : 'מפגש תנועה קצר ללא אביזרי כושר.',
      estimatedSeconds: estimatedSeconds(items),
      estimatedMinutes: Math.ceil(estimatedSeconds(items) / 60),
      exerciseCount: new Set(items.map(item => item.exerciseId)).size,
      items,
    };
  }

  function build(profile, settings, catalog, now = new Date()) {
    const issue = validationIssue(profile, settings, localDate(now));
    if (issue) throw new Error(issue.message);
    const normalizedSettings = {
      sessionMinutes: settings.sessionMinutes,
      startDate: settings.startDate,
      equipment: [...new Set(settings.equipment)].sort(),
      screening: 'clear',
      youthSupervision: profile.age < 18 ? Boolean(settings.youthSupervision) : false,
    };
    const activeOffsets = DAY_OFFSETS[profile.workoutsPerWeek];
    const mobilityOnly = profile.goals.length === 1 && profile.goals[0] === 'flexibility';
    let strengthSequence = 0;
    let movementSequence = 0;
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(normalizedSettings.startDate, offset);
      if (!activeOffsets.includes(offset)) return { date, type: 'rest', title: 'יום מנוחה', session: null };
      const type = !mobilityOnly && [0, 3].includes(offset) ? 'strength' : 'mobility';
      const session = buildSession(type, type === 'strength' ? strengthSequence++ : movementSequence++, normalizedSettings, profile, catalog);
      return { date, type: session.type, title: session.title, session };
    });
    return {
      schemaVersion: VERSION,
      id: `intro-${now.getTime()}`,
      createdAt: now.toISOString(),
      profileFingerprint: fingerprint(profile),
      settings: normalizedSettings,
      location: profile.trainingLocation,
      weeklyTarget: profile.workoutsPerWeek,
      goals: [...profile.goals],
      experience: profile.experience,
      ageGroup: profile.age < 18 ? 'youth' : 'adult',
      days,
    };
  }

  function validSavedPlan(plan, catalog) {
    if (!plan || plan.schemaVersion !== VERSION || !Array.isArray(plan.days) || plan.days.length !== 7
      || typeof plan.id !== 'string' || typeof plan.profileFingerprint !== 'string'
      || !DURATION_CHOICES.includes(plan.settings?.sessionMinutes)
      || !validDate(plan.settings?.startDate)
      || !Array.isArray(plan.settings?.equipment)
      || plan.settings.equipment.some(value => !['chair', 'wall'].includes(value))
      || !Number.isInteger(plan.weeklyTarget) || !Object.hasOwn(DAY_OFFSETS, plan.weeklyTarget)
      || plan.settings.screening !== 'clear'
      || !['adult', 'youth'].includes(plan.ageGroup)
      || !Object.hasOwn(LOCATION_LABELS, plan.location)
      || !Array.isArray(plan.goals)
      || !['beginner', 'intermediate', 'experienced'].includes(plan.experience)
      || typeof plan.createdAt !== 'string' || !Number.isFinite(new Date(plan.createdAt).getTime())) return false;
    let snapshot;
    try { snapshot = JSON.parse(plan.profileFingerprint); } catch (_) { return false; }
    if (!completeProfile(snapshot) || snapshot.age < 13
      || plan.ageGroup !== (snapshot.age < 18 ? 'youth' : 'adult')
      || (snapshot.age < 18 && plan.settings.youthSupervision !== true)
      || plan.weeklyTarget !== snapshot.workoutsPerWeek || plan.location !== snapshot.trainingLocation
      || plan.experience !== snapshot.experience
      || JSON.stringify([...plan.goals].sort()) !== JSON.stringify([...snapshot.goals].sort())) return false;
    const byId = Object.fromEntries(catalog.map(exercise => [exercise.id, exercise]));
    let active = 0;
    for (let i = 0; i < plan.days.length; i += 1) {
      const day = plan.days[i];
      if (day?.date !== addDays(plan.settings.startDate, i)) return false;
      if (day.type === 'rest' && day.session === null) continue;
      const session = day.session;
      if (!session || !['strength', 'mobility', 'movement'].includes(session.type)
        || !Array.isArray(session.items) || session.items.length < 3 || session.items.length > 10) return false;
      for (const item of session.items) {
        if (!byId[item.exerciseId] || !['warmup', 'main', 'cooldown'].includes(item.phase)
          || item.sets !== 1 || !['timed', 'reps', 'hold'].includes(item.kind)
          || !Number.isFinite(item.restSeconds) || item.restSeconds < 0 || item.restSeconds > 90
          || !Number.isFinite(exerciseSeconds(item)) || exerciseSeconds(item) <= 0 || exerciseSeconds(item) > 300
          || !byId[item.exerciseId].equipment.every(value => plan.settings.equipment.includes(value))) return false;
      }
      const seconds = estimatedSeconds(session.items);
      if (seconds > plan.settings.sessionMinutes * 60 || session.estimatedSeconds !== seconds
        || session.estimatedMinutes !== Math.ceil(seconds / 60)) return false;
      active += 1;
    }
    if (active !== plan.weeklyTarget) return false;
    // Regeneration rejects corrupt doses, substituted sessions and adjacent strength days.
    // We use the original creation date, so legitimate past weeks remain viewable.
    try {
      const expected = build(snapshot, plan.settings, catalog, new Date(plan.createdAt));
      return JSON.stringify(expected.days) === JSON.stringify(plan.days);
    } catch (_) { return false; }
  }

  window.VEXYRO_PLAN_LEGACY = Object.freeze({
    VERSION, DURATION_CHOICES, LOCATION_LABELS, localDate, addDays, validDate,
    fingerprint, completeProfile, validationIssue, build, validSavedPlan, estimatedSeconds,
  });
})();
