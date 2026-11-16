// Version 2 is retained unchanged to validate existing selected-exercise weeks.
/* User-selected introductory sessions. External videos never determine prescribed load. */
(() => {
  'use strict';
  const legacy = window.VEXYRO_PLAN_LEGACY;
  const VERSION = 2;
  const EQUIPMENT = ['chair', 'wall', 'mat', 'dumbbells', 'band', 'bench', 'barbell', 'cable', 'machine', 'step', 'ball'];
  const DAY_OFFSETS = { 1: [0], 2: [0, 3], 3: [0, 3, 5], 4: [0, 2, 3, 5], 5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  const MAX_SELECTED = 12;

  function localDate(date = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }
  function validationIssue(profile, settings, today = localDate(), catalog = window.VEXYRO_EXERCISES) {
    const basic = legacy.validationIssue(profile, { ...settings, equipment: [] }, today);
    if (basic) return basic;
    if (!Array.isArray(settings.equipment) || settings.equipment.some(value => !EQUIPMENT.includes(value))) return { field: 'equipment', message: 'יש לסמן רק אביזרים שזמינים לך בפועל.' };
    if (!Array.isArray(settings.selectedExercises) || !settings.selectedExercises.length) return { field: 'selectedExercises', message: 'בחרו תחילה את התרגילים שתרצו לשלב בתוכנית.' };
    if (settings.selectedExercises.length > MAX_SELECTED || new Set(settings.selectedExercises).size !== settings.selectedExercises.length) return { field: 'selectedExercises', message: `אפשר לבחור עד ${MAX_SELECTED} תרגילים שונים לשבוע אחד.` };
    const byId = new Map(catalog.map(exercise => [exercise.id, exercise]));
    if (settings.selectedExercises.some(id => !byId.has(id))) return { field: 'selectedExercises', message: 'אחד התרגילים כבר אינו בספרייה. יש לעדכן את הבחירה.' };
    const missing = settings.selectedExercises.map(id => byId.get(id)).filter(exercise => !exercise.equipment.every(value => settings.equipment.includes(value)));
    if (missing.length) return { field: 'equipment', message: `חסר ציוד שסומן כנדרש לתרגילים: ${missing.map(exercise => `${exercise.name} (${exercise.equipmentLabel})`).join('; ')}. סמנו את הציוד אם הוא זמין, או החליפו את התרגילים.` };
    return null;
  }
  const seconds = legacy.estimatedSeconds;
  function item(exercise, phase = 'main', overrides = {}) {
    return { exerciseId: exercise.id, phase, sets: 1, ...exercise.defaultPrescription, ...overrides };
  }
  function build(profile, settings, catalog, now = new Date()) {
    const issue = validationIssue(profile, settings, localDate(now), catalog);
    if (issue) { const error = new Error(issue.message); error.field = issue.field; throw error; }
    const options = {
      sessionMinutes: settings.sessionMinutes, startDate: settings.startDate,
      equipment: [...new Set(settings.equipment)].sort(), screening: 'clear',
      youthSupervision: profile.age < 18 ? Boolean(settings.youthSupervision) : false,
      selectedExercises: [...settings.selectedExercises],
    };
    const byId = new Map(catalog.map(exercise => [exercise.id, exercise]));
    const chosen = options.selectedExercises.map(id => byId.get(id));
    const hasStrength = chosen.some(exercise => exercise.category === 'strength');
    const march = byId.get('march-in-place');
    const slots = DAY_OFFSETS[profile.workoutsPerWeek].map(offset => ({
      offset, strengthDay: hasStrength && [0, 3].includes(offset), main: [],
      warmup: item(march, 'warmup', { durationSeconds: 180, restSeconds: 15 }),
      cooldown: item(march, 'cooldown', { durationSeconds: 60, restSeconds: 0 }),
    }));
    const allItems = slot => [slot.warmup, ...slot.main, slot.cooldown];
    const fits = (slot, exercise) => seconds([slot.warmup, ...slot.main, item(exercise), slot.cooldown]) <= options.sessionMinutes * 60;
    const usage = new Map(chosen.map(exercise => [exercise.id, 0]));
    const pending = chosen.filter(exercise => exercise.id !== march.id).sort((a, b) => {
      if (a.category === 'strength' && b.category !== 'strength') return -1;
      if (b.category === 'strength' && a.category !== 'strength') return 1;
      return seconds([item(b)]) - seconds([item(a)]);
    });
    const unplaced = [];
    // First guarantee that every deliberate choice appears somewhere in the week.
    for (const exercise of pending) {
      const candidates = slots.filter(slot => (exercise.category !== 'strength' || slot.strengthDay) && fits(slot, exercise));
      candidates.sort((a, b) => {
        if (exercise.category !== 'strength' && a.strengthDay !== b.strengthDay) return a.strengthDay ? 1 : -1;
        return seconds(allItems(a)) - seconds(allItems(b)) || a.offset - b.offset;
      });
      const slot = candidates[0];
      if (!slot) { unplaced.push(exercise.name); continue; }
      slot.main.push(item(exercise));
      usage.set(exercise.id, usage.get(exercise.id) + 1);
    }
    if (unplaced.length) {
      const error = new Error(`אין מספיק זמן בשבוע הזה לשילוב כל הבחירות: ${unplaced.join(', ')}. אפשר להגדיל את הזמן הפנוי לאימון או לבחור פחות תרגילים.`);
      error.field = 'selectedExercises';
      throw error;
    }
    // Add variety from the selected catalog only; each movement appears at most once per session.
    for (const slot of slots) {
      const candidates = chosen.filter(exercise => exercise.id !== march.id && (exercise.category !== 'strength' || slot.strengthDay))
        .sort((a, b) => (usage.get(a.id) - usage.get(b.id)) || options.selectedExercises.indexOf(a.id) - options.selectedExercises.indexOf(b.id));
      for (const exercise of candidates) {
        if (slot.main.length >= 6 || slot.main.some(value => value.exerciseId === exercise.id) || !fits(slot, exercise)) continue;
        slot.main.push(item(exercise));
        usage.set(exercise.id, usage.get(exercise.id) + 1);
      }
      if (!slot.main.length) slot.main.push(item(march, 'main', { durationSeconds: 120, restSeconds: 30 }));
    }
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(options.startDate, offset);
      const slot = slots.find(value => value.offset === offset);
      if (!slot) return { date, type: 'rest', title: 'יום מנוחה', session: null };
      const items = allItems(slot);
      const strength = slot.main.some(value => byId.get(value.exerciseId).category === 'strength');
      const mobility = slot.main.some(value => byId.get(value.exerciseId).category === 'mobility');
      const type = strength ? 'strength' : mobility ? 'mobility' : 'movement';
      const title = strength ? (offset === 0 ? 'האימון שבחרת · א׳' : 'האימון שבחרת · ב׳') : mobility ? 'תנועה וגמישות' : 'צעידה בקצב שלך';
      const session = {
        type, title,
        description: strength ? 'תרגילים מהבחירה שלך, סט היכרות אחד לכל תרגיל.' : mobility ? 'תרגילי תנועתיות שבחרת, בקצב נוח.' : 'מפגש תנועה קל בין האימונים.',
        estimatedSeconds: seconds(items), estimatedMinutes: Math.ceil(seconds(items) / 60),
        exerciseCount: new Set(items.map(value => value.exerciseId)).size, items,
      };
      return { date, type, title, session };
    });
    return {
      schemaVersion: VERSION, id: `selected-${now.getTime()}`, createdAt: now.toISOString(),
      profileFingerprint: legacy.fingerprint(profile), settings: options,
      location: profile.trainingLocation, weeklyTarget: profile.workoutsPerWeek,
      goals: [...profile.goals], experience: profile.experience,
      ageGroup: profile.age < 18 ? 'youth' : 'adult', days,
    };
  }
  function validSavedPlan(plan, catalog) {
    try {
      if (plan?.schemaVersion === 1) return legacy.validSavedPlan(plan, catalog);
      if (!plan || plan.schemaVersion !== VERSION || typeof plan.profileFingerprint !== 'string'
        || !Array.isArray(plan.days) || plan.days.length !== 7 || !Array.isArray(plan.goals)
        || typeof plan.createdAt !== 'string' || !Number.isFinite(new Date(plan.createdAt).getTime())) return false;
      const profile = JSON.parse(plan.profileFingerprint);
      if (!legacy.completeProfile(profile) || plan.location !== profile.trainingLocation
        || plan.weeklyTarget !== profile.workoutsPerWeek || plan.experience !== profile.experience
        || plan.ageGroup !== (profile.age < 18 ? 'youth' : 'adult')
        || JSON.stringify([...plan.goals].sort()) !== JSON.stringify([...profile.goals].sort())) return false;
      const expected = build(profile, plan.settings, catalog, new Date(plan.createdAt));
      return JSON.stringify(expected.settings) === JSON.stringify(plan.settings)
        && JSON.stringify(expected.days) === JSON.stringify(plan.days);
    } catch (_) { return false; }
  }
  window.VEXYRO_PLAN_V2 = Object.freeze({ ...legacy, VERSION, EQUIPMENT, MAX_SELECTED, localDate, validDate, addDays, validationIssue, build, validSavedPlan });
})();
