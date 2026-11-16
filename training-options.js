/* Input limits describe this product's controls, not a safe or recommended training load. */
(() => {
  'use strict';
  const SET_MIN = 1;
  const SET_MAX = 6;
  const WEIGHT_MIN = 0;
  const WEIGHT_MAX = 500;
  const WEIGHT_STEP = 0.25;
  const REPS_MIN = 1;
  const REPS_MAX = 100;
  const REST_MIN = 0;
  const REST_MAX = 600;
  const SPECS = {
    dumbbell: {
      kind: 'dumbbell', label: 'משקל לכל משקולת (ק״ג)',
      help: 'מזינים את המשקל של משקולת אחת, גם כשמחזיקים שתי משקולות.', supportsKg: true,
    },
    barbell: {
      kind: 'barbell', label: 'משקל כולל במוט (ק״ג)',
      help: 'כולל משקל המוט והצלחות יחד.', supportsKg: true,
    },
    machine: {
      kind: 'machine', label: 'משקל במכשיר (ק״ג)',
      help: 'מזינים את המספר המסומן במכשיר; המספר אינו בהכרח שקול במכשירים שונים.', supportsKg: true,
    },
    band: {
      kind: 'band', label: 'התנגדות גומייה',
      help: 'לגומייה לא מזינים משקל בקילוגרמים.', supportsKg: false,
    },
    bodyweight: {
      kind: 'bodyweight', label: 'משקל גוף',
      help: 'לתרגיל הזה לא מזינים תוספת משקל.', supportsKg: false,
    },
  };
  Object.values(SPECS).forEach(Object.freeze);

  function loadSpec(exercise) {
    const equipment = Array.isArray(exercise?.equipment) ? exercise.equipment : [];
    if (equipment.includes('dumbbells')) return SPECS.dumbbell;
    if (equipment.includes('barbell')) return SPECS.barbell;
    if (equipment.includes('machine') || equipment.includes('cable')) return SPECS.machine;
    if (equipment.includes('band')) return SPECS.band;
    return SPECS.bodyweight;
  }

  function validSets(value) {
    return Number.isInteger(value) && value >= SET_MIN && value <= SET_MAX;
  }

  function validWeight(value) {
    return value === null || (typeof value === 'number' && Number.isFinite(value)
      && value >= WEIGHT_MIN && value <= WEIGHT_MAX && Number.isInteger(value / WEIGHT_STEP));
  }

  // Version 3 plans stored exactly these two fields. Keep their validator stable.
  function validLegacyOptions(exercise, options) {
    return Boolean(options && typeof options === 'object' && !Array.isArray(options)
      && Object.hasOwn(options, 'sets') && Object.hasOwn(options, 'weightKg')
      && Object.keys(options).every(key => key === 'sets' || key === 'weightKg')
      && validSets(options.sets) && validWeight(options.weightKg)
      && (loadSpec(exercise).supportsKg || options.weightKg === null));
  }

  function supportsReps(exercise) {
    return ['reps', 'hold'].includes(exercise?.defaultPrescription?.kind);
  }

  function validReps(value) {
    return Number.isInteger(value) && value >= REPS_MIN && value <= REPS_MAX;
  }

  function validRest(value) {
    return Number.isInteger(value) && value >= REST_MIN && value <= REST_MAX;
  }

  function validOptions(exercise, options) {
    const keys = ['sets', 'weightKg', 'reps', 'restSeconds'];
    return Boolean(options && typeof options === 'object' && !Array.isArray(options)
      && keys.every(key => Object.hasOwn(options, key))
      && Object.keys(options).every(key => keys.includes(key))
      && validLegacyOptions(exercise, { sets: options.sets, weightKg: options.weightKg })
      && (supportsReps(exercise) ? validReps(options.reps) : options.reps === null)
      && validRest(options.restSeconds));
  }

  function defaultOptions(exercise) {
    const dose = exercise?.defaultPrescription;
    return {
      sets: SET_MIN, weightKg: null,
      reps: supportsReps(exercise) ? (validReps(dose?.reps) ? dose.reps : 5) : null,
      restSeconds: validRest(dose?.restSeconds) ? dose.restSeconds : 45,
    };
  }
  window.VEXYRO_TRAINING = Object.freeze({
    SET_MIN, SET_MAX, WEIGHT_MIN, WEIGHT_MAX, WEIGHT_STEP, REPS_MIN, REPS_MAX, REST_MIN, REST_MAX,
    loadSpec, validSets, validWeight, supportsReps, validReps, validRest, validOptions, validLegacyOptions, defaultOptions,
  });
})();
