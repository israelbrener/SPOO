/* User-selected introductory sessions. External videos never determine prescribed load. */
(() => {
  'use strict';
  const legacy = window.VEXYRO_PLAN_LEGACY;
  const previous = window.VEXYRO_PLAN_V2;
  const previousSets = window.VEXYRO_PLAN_V3;
  const previousDuration = window.VEXYRO_PLAN_V4;
  const training = window.VEXYRO_TRAINING;
  const VERSION = 5;
  const EQUIPMENT = ['chair', 'wall', 'mat', 'dumbbells', 'band', 'bench', 'barbell', 'cable', 'machine', 'step', 'ball'];
  const DAY_OFFSETS = { 1: [0], 2: [0, 3], 3: [0, 3, 5], 4: [0, 2, 3, 5], 5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  const MAX_SELECTED = 500;

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
    // Validate current inputs directly: legacy validators also require a time budget.
    if (!legacy.completeProfile(profile)) return { field: 'profile', message: 'יש להשלים קודם גיל, שגרת אימון, מטרות וניסיון בפרופיל.' };
    if (profile.age < 13) return { field: 'age', guidance: true, message: 'בניית תוכנית אוטומטית לילדים מתחת לגיל 13 עוד לא זמינה בגרסה הזו. אפשר לעיין בהדגמות עם מבוגר ולבנות תוכנית עם מדריך מתאים.' };
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { field: 'settings', message: 'יש להשלים את הגדרות התוכנית.' };
    if (Object.hasOwn(settings, 'sessionMinutes')) return { field: 'sessionMinutes', message: 'בתוכנית חדשה משך האימון מחושב מהתרגילים. אין לשלוח בחירת זמן לאימון.' };
    if (!validDate(settings.startDate) || settings.startDate < today || settings.startDate > addDays(today, 90)) return { field: 'startDate', message: 'בחרו תאריך התחלה מהיום ועד שלושה חודשים קדימה.' };
    if (!['clear', 'guidance', 'unsure'].includes(settings.screening)) return { field: 'screening', message: 'יש לענות על שאלת ההתאמה לפני הצגת הטיוטה.' };
    if (settings.screening !== 'clear') return { field: 'screening', guidance: true, message: 'כדי להכין תוכנית שמתאימה למצב הזה, נדרשת התאמה עם איש מקצוע. ספריית ההסברים פתוחה לעיון.' };
    if (profile.age < 18 && !settings.youthSupervision) return { field: 'youthSupervision', message: 'לפני התחלה בגיל הזה, יש לבדוק את הטיוטה עם מדריך מוסמך לאימוני בני נוער.' };
    if (!Array.isArray(settings.equipment) || settings.equipment.some(value => !EQUIPMENT.includes(value))) return { field: 'equipment', message: 'יש לסמן רק אביזרים שזמינים לך בפועל.' };
    if (!Array.isArray(settings.selectedExercises) || !settings.selectedExercises.length) return { field: 'selectedExercises', message: 'בחרו תחילה את התרגילים שתרצו לשלב בתוכנית.' };
    if (settings.selectedExercises.length > MAX_SELECTED || new Set(settings.selectedExercises).size !== settings.selectedExercises.length) return { field: 'selectedExercises', message: `אפשר לבחור עד ${MAX_SELECTED} תרגילים שונים לשבוע אחד.` };
    const byId = new Map(catalog.map(exercise => [exercise.id, exercise]));
    if (settings.selectedExercises.some(id => !byId.has(id))) return { field: 'selectedExercises', message: 'אחד התרגילים כבר אינו בספרייה. יש לעדכן את הבחירה.' };
    const missing = settings.selectedExercises.map(id => byId.get(id)).filter(exercise => !exercise.equipment.every(value => settings.equipment.includes(value)));
    if (missing.length) return { field: 'equipment', message: `חסר ציוד שסומן כנדרש לתרגילים: ${missing.map(exercise => `${exercise.name} (${exercise.equipmentLabel})`).join('; ')}. סמנו את הציוד אם הוא זמין, או החליפו את התרגילים.` };
    const options = settings.exerciseOptions;
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).length !== settings.selectedExercises.length
      || settings.selectedExercises.some(id => !Object.hasOwn(options, id))) {
      return { field: 'exerciseOptions', message: 'יש להשלים לכל תרגיל את מספר הסטים, החזרות וזמן המנוחה. אפשר להשאיר משקל במצב ״טרם נבחר״.' };
    }
    for (const id of settings.selectedExercises) {
      const exercise = byId.get(id);
      if (!training.validOptions(exercise, options[id])) {
        return { field: 'exerciseOptions', exerciseId: id,
          message: `יש לבדוק את ההגדרות של ${exercise.name}: ${training.SET_MIN}–${training.SET_MAX} סטים, ${training.REPS_MIN}–${training.REPS_MAX} חזרות בתרגיל המבוסס על חזרות, ${training.REST_MIN}–${training.REST_MAX} שניות מנוחה ומשקל תקין אם נדרש.` };
      }
    }
    return null;
  }

  function setSeconds(item) {
    if (item.kind === 'timed') return item.durationSeconds;
    const repetitions = item.reps * (item.perSide ? 2 : 1);
    return repetitions * (item.kind === 'hold' ? item.holdSeconds + 4 : item.secondsPerRep);
  }

  function seconds(items) {
    // Rest between sets; one final rest and a 15-second transition between occurrences.
    return items.reduce((sum, item, index) => sum + setSeconds(item) * item.sets
      + item.restSeconds * (item.sets - 1)
      + (index < items.length - 1 ? item.restSeconds + 15 : 0), 0);
  }

  function item(exercise, phase = 'main', selection = null, overrides = {}) {
    return {
      exerciseId: exercise.id, phase, ...exercise.defaultPrescription,
      sets: selection?.sets ?? 1, weightKg: selection?.weightKg ?? null,
      ...(selection ? { reps: selection.reps, restSeconds: selection.restSeconds } : {}),
      loadKind: training.loadSpec(exercise).kind, ...overrides,
    };
  }
  function build(profile, settings, catalog, now = new Date()) {
    const issue = validationIssue(profile, settings, localDate(now), catalog);
    if (issue) { const error = new Error(issue.message); error.field = issue.field; throw error; }
    const options = {
      startDate: settings.startDate,
      equipment: [...new Set(settings.equipment)].sort(), screening: 'clear',
      youthSupervision: profile.age < 18 ? Boolean(settings.youthSupervision) : false,
      selectedExercises: [...settings.selectedExercises],
      exerciseOptions: Object.fromEntries(settings.selectedExercises.map(id => [id, {
        sets: settings.exerciseOptions[id].sets, weightKg: settings.exerciseOptions[id].weightKg,
        reps: settings.exerciseOptions[id].reps, restSeconds: settings.exerciseOptions[id].restSeconds,
      }])),
    };
    const byId = new Map(catalog.map(exercise => [exercise.id, exercise]));
    const chosen = options.selectedExercises.map(id => byId.get(id));
    const hasStrength = chosen.some(exercise => exercise.category === 'strength');
    const march = byId.get('march-in-place');
    const mainItem = exercise => item(exercise, 'main', options.exerciseOptions[exercise.id]);
    const slots = DAY_OFFSETS[profile.workoutsPerWeek].map(offset => ({
      offset, strengthDay: hasStrength && [0, 3].includes(offset), main: [],
      warmup: item(march, 'warmup', null, { durationSeconds: 180, restSeconds: 15 }),
      cooldown: item(march, 'cooldown', null, { durationSeconds: 60, restSeconds: 0 }),
    }));
    const allItems = slot => [slot.warmup, ...slot.main, slot.cooldown];
    const eligible = (slot, exercise) => exercise.category !== 'strength' || slot.strengthDay;
    const placementSeconds = exercise => {
      const value = mainItem(exercise);
      return seconds([value]) + value.restSeconds + 15;
    };
    const usage = new Map(chosen.map(exercise => [exercise.id, 0]));
    const pending = [...chosen].sort((a, b) => {
      if (a.category === 'strength' && b.category !== 'strength') return -1;
      if (b.category === 'strength' && a.category !== 'strength') return 1;
      return placementSeconds(b) - placementSeconds(a)
        || options.selectedExercises.indexOf(a.id) - options.selectedExercises.indexOf(b.id);
    });
    // Place every choice once, longest first, balancing eligible sessions without a time ceiling.
    for (const exercise of pending) {
      const candidates = slots.filter(slot => eligible(slot, exercise));
      candidates.sort((a, b) => {
        if (exercise.category !== 'strength' && a.strengthDay !== b.strengthDay) return a.strengthDay ? 1 : -1;
        return seconds(allItems(a)) - seconds(allItems(b)) || a.offset - b.offset;
      });
      const slot = candidates[0];
      slot.main.push(mainItem(exercise));
      usage.set(exercise.id, usage.get(exercise.id) + 1);
    }
    // Keep all requested weekly sessions. Repeat a choice only to fill an otherwise empty day.
    for (const slot of slots) {
      if (slot.main.length) continue;
      const candidates = chosen.filter(exercise => eligible(slot, exercise));
      candidates.sort((a, b) => {
        if (slot.strengthDay && (a.category === 'strength') !== (b.category === 'strength')) return a.category === 'strength' ? -1 : 1;
        return usage.get(a.id) - usage.get(b.id) || placementSeconds(a) - placementSeconds(b)
          || options.selectedExercises.indexOf(a.id) - options.selectedExercises.indexOf(b.id);
      });
      const repeat = candidates[0];
      if (repeat) {
        slot.main.push(mainItem(repeat));
        usage.set(repeat.id, usage.get(repeat.id) + 1);
      } else slot.main.push(item(march, 'main', null, { durationSeconds: 120, restSeconds: 30 }));
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
        description: strength ? 'התרגילים, הסטים והחזרות שבחרת, עם המנוחות שהגדרת.' : mobility ? 'תרגילי תנועתיות לפי הסטים, החזרות והמנוחות שבחרת.' : 'תנועה בקצב שלך, לפי הבחירות בתוכנית.',
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
      if (plan?.schemaVersion === 2) return previous.validSavedPlan(plan, catalog);
      if (plan?.schemaVersion === 3) return previousSets.validSavedPlan(plan, catalog);
      if (plan?.schemaVersion === 4) return previousDuration.validSavedPlan(plan, catalog);
      if (!plan || plan.schemaVersion !== VERSION || typeof plan.profileFingerprint !== 'string'
        || !Array.isArray(plan.days) || plan.days.length !== 7 || !Array.isArray(plan.goals)
        || typeof plan.createdAt !== 'string' || !Number.isFinite(new Date(plan.createdAt).getTime())) return false;
      const profile = JSON.parse(plan.profileFingerprint);
      if (!legacy.completeProfile(profile) || plan.location !== profile.trainingLocation
        || plan.weeklyTarget !== profile.workoutsPerWeek || plan.experience !== profile.experience
        || plan.ageGroup !== (profile.age < 18 ? 'youth' : 'adult')
        || JSON.stringify([...plan.goals].sort()) !== JSON.stringify([...profile.goals].sort())) return false;
      const expected = build(profile, plan.settings, catalog, new Date(plan.createdAt));
      return plan.id === expected.id && JSON.stringify(expected.settings) === JSON.stringify(plan.settings)
        && JSON.stringify(expected.days) === JSON.stringify(plan.days);
    } catch (_) { return false; }
  }
  window.VEXYRO_PLAN_V5 = Object.freeze({ ...legacy, VERSION, EQUIPMENT, MAX_SELECTED, localDate, validDate, addDays, validationIssue, build, validSavedPlan, estimatedSeconds: seconds });
})();
