/* Pure workout state transitions. Browser storage, playback and rendering live elsewhere. */
(() => {
  'use strict';

  const VERSION = 1;
  const LOAD_VERSION = 1;
  const REP_VERSION = 1;
  const training = window.VEXYRO_TRAINING;
  const KG_KINDS = ['dumbbell', 'barbell', 'machine'];
  const MAX_ITEMS = 64;
  const MAX_SETS = 20;
  const MAX_TOTAL_SETS = 256;
  const MAX_COUNTDOWN_MS = 60 * 60 * 1000;
  const MAX_ELAPSED_MS = 24 * 60 * 60 * 1000;
  const MAX_TIMESTAMP = 8640000000000000;
  const PHASES = ['warmup', 'main', 'cooldown'];
  const STAGES = ['exercise', 'rest', 'review'];

  const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => Number.isInteger(value) && finite(value, min, max);
  const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const timestamp = value => integer(value, 0, MAX_TIMESTAMP);
  const validReps = value => value === null || integer(value, 1, 100);
  // Older plans may carry larger targets. Preserve those plans without clamping or inventing an actual count.
  const plannedRepsDraft = item => item.kind !== 'timed' && integer(item.reps, 1, 100) ? item.reps : null;

  function clock(value) {
    if (!timestamp(value)) throw new TypeError('יש להעביר זמן תקין למעקב האימון.');
    return value;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function makeId(workoutKey, startedAt) {
    let hash = 2166136261;
    for (let i = 0; i < workoutKey.length; i += 1) hash = Math.imul(hash ^ workoutKey.charCodeAt(i), 16777619);
    return `workout-${startedAt}-${(hash >>> 0).toString(36)}`;
  }

  function copyItem(value, catalogById) {
    if (!object(value) || !text(value.exerciseId, 160) || !catalogById.has(value.exerciseId)
      || !PHASES.includes(value.phase) || !integer(value.sets, 1, MAX_SETS)
      || !finite(value.restSeconds, 0, MAX_COUNTDOWN_MS / 1000)) return null;
    const spec = training.loadSpec(catalogById.get(value.exerciseId));
    const hasKind = Object.hasOwn(value, 'loadKind');
    const hasWeight = Object.hasOwn(value, 'weightKg');
    if (hasKind !== hasWeight || (hasKind && (value.loadKind !== spec.kind
      || !training.validWeight(value.weightKg) || (!spec.supportsKg && value.weightKg !== null)))) return null;
    const item = {
      exerciseId: value.exerciseId, phase: value.phase, sets: value.sets,
      kind: value.kind, restSeconds: value.restSeconds,
      loadKind: spec.kind, weightKg: hasWeight ? value.weightKg : null,
    };
    if (value.kind === 'timed') {
      if (!finite(value.durationSeconds, 1, MAX_COUNTDOWN_MS / 1000)) return null;
      item.durationSeconds = value.durationSeconds;
    } else if (value.kind === 'reps' || value.kind === 'hold') {
      if (!integer(value.reps, 1, 1000) || typeof value.perSide !== 'boolean') return null;
      item.reps = value.reps;
      item.perSide = value.perSide;
      if (value.kind === 'reps') {
        if (!finite(value.secondsPerRep, 0.1, 120)) return null;
        item.secondsPerRep = value.secondsPerRep;
      } else {
        if (!finite(value.holdSeconds, 1, 3600)) return null;
        item.holdSeconds = value.holdSeconds;
      }
    } else return null;
    return item;
  }

  function copyItems(values, catalog) {
    if (!Array.isArray(values) || !values.length || values.length > MAX_ITEMS || !Array.isArray(catalog)) return null;
    const byId = new Map(catalog.filter(object).map(exercise => [exercise.id, exercise]));
    const items = values.map(item => copyItem(item, byId));
    if (items.some(item => !item) || items.reduce((sum, item) => sum + item.sets, 0) > MAX_TOTAL_SETS) return null;
    return items;
  }

  function copy(state) {
    const logicalStage = state.stage === 'review' ? state.reviewReturn?.stage : state.stage;
    const legacyDraft = logicalStage === 'exercise' && !resolved(state, state.cursor)
      ? plannedRepsDraft(state.items[state.cursor]) : null;
    return {
      ...state,
      items: state.items.map(item => ({ ...item })),
      completedSets: [...state.completedSets], skipped: [...state.skipped],
      setLoads: state.setLoads ? state.setLoads.map(loads => [...loads])
        : state.completedSets.map(count => Array(count).fill(null)),
      repSchemaVersion: REP_VERSION,
      setReps: state.setReps ? state.setReps.map(reps => [...reps])
        : state.completedSets.map(count => Array(count).fill(null)),
      currentReps: Object.hasOwn(state, 'currentReps') ? state.currentReps : legacyDraft,
      reviewReturn: state.reviewReturn ? { ...state.reviewReturn } : null,
    };
  }

  const movementDuration = item => item.kind === 'timed' ? item.durationSeconds * 1000 : 0;
  const resolved = (state, index) => state.skipped[index] || state.completedSets[index] === state.items[index].sets;
  const pending = (state, from = 0) => state.items.findIndex((item, index) => index >= from && !resolved(state, index));

  function materialize(state, now) {
    const result = copy(state);
    // A wall-clock correction backwards must never add elapsed time or increase a countdown.
    const at = Math.max(clock(now), state.updatedAt);
    if (!state.paused && state.stage !== 'review') {
      result.elapsedMs = Math.min(MAX_ELAPSED_MS, state.elapsedMs + Math.max(0, at - state.activeSince));
      result.activeSince = at;
      if (state.stage === 'rest') {
        result.restRemainingMs = Math.max(0, state.restRemainingMs - Math.max(0, at - state.restStartedAt));
        result.restStartedAt = at;
      }
      if (state.stage === 'exercise' && state.movementRunning) {
        result.movementRemainingMs = Math.max(0, state.movementRemainingMs - Math.max(0, at - state.movementStartedAt));
        result.movementRunning = result.movementRemainingMs > 0;
        result.movementStartedAt = result.movementRunning ? at : null;
      }
    }
    result.updatedAt = at;
    return result;
  }

  function pauseClocks(state) {
    state.paused = true;
    state.activeSince = null;
    state.restStartedAt = null;
    state.movementStartedAt = null;
  }

  function startClocks(state) {
    state.paused = false;
    state.activeSince = state.updatedAt;
    state.restStartedAt = state.stage === 'rest' ? state.updatedAt : null;
    state.movementStartedAt = state.stage === 'exercise' && state.movementRunning ? state.updatedAt : null;
  }

  function enterExercise(state, cursor) {
    state.stage = 'exercise';
    state.cursor = cursor;
    state.restRemainingMs = 0;
    state.restStartedAt = null;
    state.movementRemainingMs = movementDuration(state.items[cursor]);
    state.movementRunning = false;
    state.movementStartedAt = null;
    state.currentReps = plannedRepsDraft(state.items[cursor]);
  }

  function enterReview(state, canReturn) {
    state.reviewReturn = canReturn ? { stage: state.stage, cursor: state.cursor } : null;
    state.stage = 'review';
    state.reviewStartedAt = state.updatedAt;
    pauseClocks(state);
  }

  function create(plan, dayIndex, catalog, now = Date.now()) {
    const at = clock(now);
    const day = object(plan) && Array.isArray(plan.days) && integer(dayIndex, 0, plan.days.length - 1) ? plan.days[dayIndex] : null;
    const items = copyItems(day?.session?.items, catalog);
    if (!text(plan?.id, 256) || !text(plan?.profileFingerprint, 4096) || !validDate(day?.date)
      || !text(day?.session?.title, 250) || !items
      || (plan.schemaVersion >= 3 && items.some(item => !training.validSets(item.sets)))) {
      throw new TypeError('האימון אינו תקין. יש לפתוח אימון מתוך תוכנית תקינה.');
    }
    const workoutKey = `${plan.id}|${day.date}`;
    return {
      schemaVersion: VERSION, id: makeId(workoutKey, at), planId: plan.id, workoutKey,
      scheduledDate: day.date, title: day.session.title, profileFingerprint: plan.profileFingerprint,
      items, cursor: 0, completedSets: items.map(() => 0), skipped: items.map(() => false),
      loadSchemaVersion: LOAD_VERSION, setLoads: items.map(() => []),
      repSchemaVersion: REP_VERSION, setReps: items.map(() => []), currentReps: plannedRepsDraft(items[0]),
      stage: 'exercise', paused: false, startedAt: at, updatedAt: at,
      elapsedMs: 0, activeSince: at,
      restRemainingMs: 0, restStartedAt: null,
      movementRemainingMs: movementDuration(items[0]), movementStartedAt: null, movementRunning: false,
      reviewReturn: null, reviewStartedAt: null,
    };
  }

  function snapshot(state, now = Date.now()) {
    return state ? materialize(state, now) : null;
  }

  function reduce(state, action, now = Date.now()) {
    if (!state || !object(action)) return state;
    const type = action.type;
    if (type === 'complete-set' && (state.stage !== 'exercise' || state.paused)) return state;
    if (type === 'advance' && state.stage !== 'rest') return state;
    if (type === 'skip' && state.stage !== 'exercise') return state;
    if (type === 'pause' && (state.paused || state.stage === 'review')) return state;
    if (type === 'resume' && (!state.paused || state.stage === 'review')) return state;
    if (type === 'finish' && state.stage === 'review') return state;
    if (type === 'return' && (state.stage !== 'review' || !state.reviewReturn || pending(state) < 0)) return state;
    if (type === 'extend-rest' && (state.stage !== 'rest' || !integer(action.seconds, 1, 300))) return state;
    if (type === 'movement-toggle' && (state.stage !== 'exercise' || state.paused || state.items[state.cursor].kind !== 'timed')) return state;
    if (type === 'set-load' && (state.stage !== 'exercise' || !KG_KINDS.includes(state.items[state.cursor].loadKind)
      || !training.validWeight(action.weightKg))) return state;
    if (type === 'set-reps' && (state.stage !== 'exercise' || state.items[state.cursor].kind === 'timed'
      || !validReps(action.reps))) return state;
    if (!['complete-set', 'advance', 'skip', 'pause', 'resume', 'extend-rest', 'movement-toggle', 'finish', 'return', 'set-load', 'set-reps'].includes(type)) return state;

    const result = materialize(state, now);
    if (type === 'pause') pauseClocks(result);
    if (type === 'resume') startClocks(result);
    if (type === 'complete-set') {
      result.completedSets[result.cursor] += 1;
      result.setLoads[result.cursor].push(result.items[result.cursor].weightKg ?? null);
      result.setReps[result.cursor].push(result.items[result.cursor].kind === 'timed' ? null : result.currentReps);
      result.movementRemainingMs = 0;
      result.movementRunning = false;
      result.movementStartedAt = null;
      if (pending(result, result.cursor) < 0) {
        result.restRemainingMs = 0;
        enterReview(result, false);
      } else {
        result.stage = 'rest';
        result.restRemainingMs = result.items[result.cursor].restSeconds * 1000;
        result.restStartedAt = result.updatedAt;
      }
    }
    if (type === 'advance') enterExercise(result, pending(result, result.cursor));
    if (type === 'skip') {
      result.skipped[result.cursor] = true;
      result.movementRemainingMs = 0;
      result.movementRunning = false;
      result.movementStartedAt = null;
      const next = pending(result, result.cursor + 1);
      if (next < 0) enterReview(result, false);
      else enterExercise(result, next);
    }
    if (type === 'extend-rest') result.restRemainingMs = Math.min(MAX_COUNTDOWN_MS, result.restRemainingMs + action.seconds * 1000);
    // This is the next set's chosen load; prior completed sets keep their own recorded values.
    if (type === 'set-load') result.items[result.cursor].weightKg = action.weightKg;
    // Only the current set's draft changes. The plan target and prior set counts remain intact.
    if (type === 'set-reps') result.currentReps = action.reps;
    if (type === 'movement-toggle') {
      result.movementRunning = !result.movementRunning;
      if (result.movementRunning && result.movementRemainingMs === 0) result.movementRemainingMs = movementDuration(result.items[result.cursor]);
      result.movementStartedAt = result.movementRunning ? result.updatedAt : null;
    }
    if (type === 'finish') enterReview(result, pending(result) >= 0);
    if (type === 'return') {
      result.stage = result.reviewReturn.stage;
      result.cursor = result.reviewReturn.cursor;
      result.reviewReturn = null;
      result.reviewStartedAt = null;
      // Returning from a summary never starts a clock implicitly.
      pauseClocks(result);
    }
    return result;
  }

  function validState(value, catalog) {
    if (!object(value) || value.schemaVersion !== VERSION || !text(value.planId, 256)
      || !text(value.profileFingerprint, 4096) || !text(value.title, 250) || !validDate(value.scheduledDate)
      || value.workoutKey !== `${value.planId}|${value.scheduledDate}`
      || !timestamp(value.startedAt) || !timestamp(value.updatedAt) || value.updatedAt < value.startedAt
      || value.id !== makeId(value.workoutKey, value.startedAt)
      || (value.loadSchemaVersion !== undefined && value.loadSchemaVersion !== LOAD_VERSION)
      || !STAGES.includes(value.stage) || typeof value.paused !== 'boolean') return false;
    const items = copyItems(value.items, catalog);
    if (!items || !integer(value.cursor, 0, items.length - 1)
      || !Array.isArray(value.completedSets) || value.completedSets.length !== items.length
      || !Array.isArray(value.skipped) || value.skipped.length !== items.length
      || value.completedSets.some((count, index) => !integer(count, 0, items[index].sets))
      || value.skipped.some((skip, index) => typeof skip !== 'boolean' || (skip && value.completedSets[index] === items[index].sets))
      || !finite(value.elapsedMs, 0, Math.min(MAX_ELAPSED_MS,
        (value.stage === 'review' ? value.reviewStartedAt : value.updatedAt) - value.startedAt))
      || !finite(value.restRemainingMs, 0, MAX_COUNTDOWN_MS)
      || !finite(value.movementRemainingMs, 0, movementDuration(items[value.cursor]))
      || typeof value.movementRunning !== 'boolean') return false;

    const hasLoads = Object.hasOwn(value, 'setLoads');
    if (value.loadSchemaVersion === LOAD_VERSION && (!hasLoads || value.items.some(item => !Object.hasOwn(item, 'loadKind') || !Object.hasOwn(item, 'weightKg')))) return false;
    if (hasLoads && (!Array.isArray(value.setLoads) || value.setLoads.length !== items.length
      || value.setLoads.some((loads, index) => !Array.isArray(loads) || loads.length !== value.completedSets[index]
        || loads.some(load => !training.validWeight(load) || (!KG_KINDS.includes(items[index].loadKind) && load !== null))))) return false;

    const repFields = ['repSchemaVersion', 'setReps', 'currentReps'];
    const hasRepData = repFields.some(field => Object.hasOwn(value, field));
    if (hasRepData && (value.repSchemaVersion !== REP_VERSION || repFields.some(field => !Object.hasOwn(value, field))
      || !Array.isArray(value.setReps) || value.setReps.length !== items.length
      || Array.from(value.setReps).some((reps, index) => !Array.isArray(reps) || reps.length !== value.completedSets[index]
        || Array.from(reps).some(count => !validReps(count) || (items[index].kind === 'timed' && count !== null)))
      || !validReps(value.currentReps) || (items[value.cursor].kind === 'timed' && value.currentReps !== null))) return false;

    let logicalStage = value.stage;
    if (value.stage === 'review') {
      if (!value.paused || !timestamp(value.reviewStartedAt) || value.reviewStartedAt < value.startedAt || value.reviewStartedAt > value.updatedAt) return false;
      if (value.reviewReturn !== null) {
        if (!object(value.reviewReturn) || !['exercise', 'rest'].includes(value.reviewReturn.stage)
          || value.reviewReturn.cursor !== value.cursor || pending(value) < 0) return false;
        logicalStage = value.reviewReturn.stage;
      } else if (value.cursor !== items.length - 1 || items.some((item, index) => !resolved(value, index))) return false;
    } else if (value.reviewReturn !== null || value.reviewStartedAt !== null) return false;

    if (items.some((item, index) => index < value.cursor && !resolved(value, index))) return false;
    if (items.some((item, index) => index > value.cursor && (value.completedSets[index] !== 0 || value.skipped[index]))) return false;
    if (logicalStage === 'exercise' && resolved(value, value.cursor)) return false;
    if (logicalStage === 'rest' && (value.skipped[value.cursor] || value.completedSets[value.cursor] < 1 || pending(value, value.cursor) < 0)) return false;
    if (logicalStage !== 'rest' && value.restRemainingMs !== 0) return false;
    if (logicalStage !== 'exercise' && (value.movementRemainingMs !== 0 || value.movementRunning)) return false;
    if (value.movementRunning && value.movementRemainingMs <= 0) return false;

    const ticking = !value.paused && value.stage !== 'review';
    if (value.activeSince !== (ticking ? value.updatedAt : null)
      || value.restStartedAt !== (ticking && value.stage === 'rest' ? value.updatedAt : null)
      || value.movementStartedAt !== (ticking && value.stage === 'exercise' && value.movementRunning ? value.updatedAt : null)) return false;
    return true;
  }

  function restore(value, catalog, now = Date.now()) {
    try {
      if (!validState(value, catalog)) return null;
      const restored = copy(value);
      restored.items = copyItems(value.items, catalog);
      restored.loadSchemaVersion = LOAD_VERSION;
      // Values were materialized when saved. Do not run their old anchors against today's time.
      restored.updatedAt = Math.max(clock(now), value.updatedAt);
      pauseClocks(restored);
      return restored;
    } catch (_) { return null; }
  }

  function stats(state, now = Date.now()) {
    if (!state) return {
      completedExercises: 0, totalExercises: 0, completedSets: 0, totalSets: 0,
      skippedExercises: 0, elapsedSeconds: 0, restSecondsRemaining: 0, movementSecondsRemaining: 0,
      isComplete: false, hasWork: false, progress: 0,
    };
    const current = materialize(state, now);
    const completedSets = current.completedSets.reduce((sum, count) => sum + count, 0);
    const totalSets = current.items.reduce((sum, item) => sum + item.sets, 0);
    return {
      completedExercises: current.items.filter((item, index) => current.completedSets[index] === item.sets).length,
      totalExercises: current.items.length, completedSets, totalSets,
      skippedExercises: current.skipped.filter(Boolean).length,
      elapsedSeconds: Math.floor(current.elapsedMs / 1000),
      restSecondsRemaining: current.stage === 'rest' ? Math.ceil(current.restRemainingMs / 1000) : 0,
      movementSecondsRemaining: current.stage === 'exercise' ? Math.ceil(current.movementRemainingMs / 1000) : 0,
      isComplete: completedSets === totalSets && !current.skipped.some(Boolean),
      hasWork: completedSets > 0, progress: completedSets / totalSets,
    };
  }

  function record(state, now = Date.now()) {
    if (!state || state.stage !== 'review') return null;
    const totals = stats(state, now);
    if (!totals.hasWork) return null;
    return {
      schemaVersion: VERSION, id: state.id, planId: state.planId, workoutKey: state.workoutKey,
      repSchemaVersion: REP_VERSION,
      scheduledDate: state.scheduledDate, title: state.title, profileFingerprint: state.profileFingerprint,
      status: totals.isComplete ? 'complete' : 'partial', isComplete: totals.isComplete,
      startedAt: new Date(state.startedAt).toISOString(), completedAt: new Date(state.reviewStartedAt).toISOString(),
      completedExercises: totals.completedExercises, totalExercises: totals.totalExercises,
      completedSets: totals.completedSets, totalSets: totals.totalSets,
      skippedExercises: totals.skippedExercises, elapsedSeconds: totals.elapsedSeconds, progress: totals.progress,
      itemResults: state.items.map((item, index) => ({
        index, exerciseId: item.exerciseId, phase: item.phase, plannedSets: item.sets,
        plannedReps: item.kind === 'timed' ? null : item.reps, kind: item.kind,
        perSide: item.kind === 'timed' ? false : item.perSide, restSeconds: item.restSeconds,
        ...(item.kind === 'hold' ? { holdSeconds: item.holdSeconds } : {}),
        ...(item.kind === 'timed' ? { durationSeconds: item.durationSeconds } : {}),
        completedSets: state.completedSets[index], skippedSets: state.skipped[index] ? item.sets - state.completedSets[index] : 0,
        loadKind: item.loadKind ?? null, weightKg: item.weightKg ?? null,
        setLoads: state.setLoads ? [...state.setLoads[index]] : Array(state.completedSets[index]).fill(null),
        setReps: state.setReps ? [...state.setReps[index]] : Array(state.completedSets[index]).fill(null),
      })),
    };
  }

  window.VEXYRO_WORKOUT = Object.freeze({ VERSION, create, reduce, snapshot, restore, stats, record });
})();
