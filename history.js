/* Read-only history. Planned doses and performed values remain separate. */
(() => {
  'use strict';
  const TIME_ZONE = 'Asia/Jerusalem';
  const PHASES = { warmup: 'חימום', main: 'החלק המרכזי', cooldown: 'סיום הדרגתי' };
  const LOAD_KINDS = ['dumbbell', 'barbell', 'machine', 'band', 'bodyweight'];
  const mounts = new WeakMap();
  let instance = 0;
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
  const count = value => Number.isInteger(value) && value >= 0 && value <= 10000 ? value : null;
  const label = (value, fallback) => typeof value === 'string' && value.trim() ? value : fallback;

  function validDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function localDate(value = Date.now()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function itemData(item, position) {
    const source = item && typeof item === 'object' ? item : {};
    const completedSets = count(source.completedSets);
    const recordedValues = (values, sanitize) => Array.from({ length: Math.min(completedSets ?? 0, 256) }, (_, index) => Array.isArray(values) ? sanitize(values[index]) : null);
    const recordedReps = value => Number.isInteger(value) && value >= 1 && value <= 100 ? value : null;
    return {
      index: count(source.index) ?? position, exerciseId: label(source.exerciseId, ''),
      phase: Object.hasOwn(PHASES, source.phase) ? source.phase : null,
      plannedSets: count(source.plannedSets), completedSets, skippedSets: count(source.skippedSets),
      kind: ['reps', 'hold', 'timed'].includes(source.kind) ? source.kind : null,
      plannedReps: count(source.plannedReps), perSide: typeof source.perSide === 'boolean' ? source.perSide : null,
      holdSeconds: number(source.holdSeconds), durationSeconds: number(source.durationSeconds), restSeconds: number(source.restSeconds),
      loadKind: LOAD_KINDS.includes(source.loadKind) ? source.loadKind : null,
      // A final exercise-level weight cannot tell us what happened in an earlier set.
      setLoads: recordedValues(source.setLoads, number), setReps: recordedValues(source.setReps, recordedReps),
    };
  }

  function rowsFrom(records) {
    const unique = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      if (!record || typeof record !== 'object' || !['complete', 'partial'].includes(record.status)
        || typeof record.id !== 'string' || !record.id || typeof record.completedAt !== 'string') continue;
      const timestamp = Date.parse(record.completedAt);
      if (!Number.isFinite(timestamp)) continue;
      const row = {
        id: record.id, key: label(record.workoutKey, record.id), timestamp, completedAt: record.completedAt,
        day: localDate(timestamp), scheduledDate: validDay(record.scheduledDate) ? record.scheduledDate : null,
        title: label(record.title, 'אימון שנשמר'), status: record.status,
        elapsedSeconds: number(record.elapsedSeconds), completedSets: count(record.completedSets), totalSets: count(record.totalSets),
        items: Array.isArray(record.itemResults) ? record.itemResults.map(itemData) : [],
      };
      if (!unique.has(row.id) || unique.get(row.id).timestamp <= timestamp) unique.set(row.id, row);
    }
    return [...unique.values()].sort((a, b) => b.timestamp - a.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  function summaryFrom(rows, options = {}) {
    const today = validDay(options.today) ? options.today : localDate();
    const weekStart = addDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay());
    const weekEnd = addDays(weekStart, 7);
    const inWeek = row => row.day >= weekStart && row.day < weekEnd;
    const completed = [...new Map([...rows].reverse().filter(row => row.status === 'complete').map(row => [row.key, row])).values()];
    const week = rows.filter(inWeek);
    return {
      today, weekStart, weekEnd, weeklyTarget: Number.isInteger(options.weeklyTarget) && options.weeklyTarget >= 1 && options.weeklyTarget <= 7 ? options.weeklyTarget : null,
      weeklyCompleted: completed.filter(inWeek).length,
      weeklyPartial: week.filter(row => row.status === 'partial').length,
      weeklySaved: week.length,
      weeklySets: week.reduce((sum, row) => sum + (row.completedSets ?? 0), 0),
      weeklyUnknownSets: week.filter(row => row.completedSets === null).length,
      weeklyElapsedSeconds: week.reduce((sum, row) => Math.min(Number.MAX_SAFE_INTEGER, sum + (row.elapsedSeconds ?? 0)), 0),
      weeklyUnknownDuration: week.filter(row => row.elapsedSeconds === null).length,
      allTimeCompleted: completed.length, allTimeSaved: rows.length,
    };
  }

  function entriesFrom(rows, exerciseId, limit = 5) {
    const entries = rows.flatMap(record => record.items.filter(item => item.exerciseId === exerciseId && item.completedSets > 0).map(item => ({ record, item })));
    return entries.slice(0, Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 5);
  }

  function shortDate(day) {
    return validDay(day) ? new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`)) : 'תאריך לא תועד';
  }

  function dateTime(row) {
    return new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE }).format(new Date(row.timestamp));
  }

  function duration(seconds) {
    if (seconds === null) return 'לא תועד';
    const value = Math.floor(seconds);
    if (value < 60) return `${value} שנ׳`;
    const minutes = Math.floor(value / 60);
    return minutes < 60 ? `${minutes} דק׳${value % 60 ? ` ו־${value % 60} שנ׳` : ''}` : `${Math.floor(minutes / 60).toLocaleString('he-IL')} ש׳${minutes % 60 ? ` ו־${minutes % 60} דק׳` : ''}`;
  }

  function loadText(item, index) {
    if (item.loadKind === 'bodyweight') return 'משקל גוף · ללא תוספת';
    if (item.loadKind === 'band') return 'גומייה · ללא רישום ק״ג';
    const weight = item.setLoads[index];
    if (weight === null || weight === undefined) return 'משקל: לא תועד';
    const suffix = { dumbbell: 'לכל משקולת', barbell: 'כולל המוט', machine: 'לפי סימון המכשיר' }[item.loadKind] || 'אופן הרישום לא תועד';
    return `${weight.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ק״ג · ${suffix}`;
  }

  function repsText(item, index) {
    if (item.kind === 'timed') return 'משך בפועל: לא תועד';
    const reps = item.setReps[index];
    if (reps === null || reps === undefined) return item.kind === 'hold' ? 'החזקות שבוצעו: לא תועדו' : 'חזרות שבוצעו: לא תועדו';
    return `${reps.toLocaleString('he-IL')} ${item.kind === 'hold' ? 'החזקות' : 'חזרות'}${item.perSide === true ? ' לכל צד' : item.perSide === null ? ' · חלוקת הצדדים לא תועדה' : ''}`;
  }

  function targetText(item) {
    if (item.kind === 'timed') return item.durationSeconds === null ? 'משך מתוכנן: לא תועד' : `יעד לכל סט: ${duration(item.durationSeconds)}`;
    if (item.plannedReps === null) return 'יעד חזרות: לא תועד';
    const base = `יעד לכל סט: ${item.plannedReps} ${item.kind === 'hold' ? 'החזקות' : 'חזרות'}${item.perSide === true ? ' לכל צד' : ''}`;
    return item.kind === 'hold' ? `${base} · ${item.holdSeconds === null ? 'משך החזקה לא תועד' : `${item.holdSeconds} שניות להחזקה`}` : base;
  }

  function setsText(item) {
    const done = item.completedSets;
    if (done === null) return 'מספר הסטים שבוצעו לא תועד';
    return `${done} ${item.plannedSets === null ? 'סטים תועדו · יעד הסטים לא תועד' : `מתוך ${item.plannedSets} סטים תועדו`}${item.skippedSets ? ` · ${item.skippedSets} דולגו` : ''}`;
  }

  function render(container, options = {}) {
    if (!container || typeof container.replaceChildren !== 'function') return null;
    const previous = mounts.get(container);
    const state = { period: 'all', status: 'all', from: '', to: '', exercise: '', open: '', limit: 20, ...(previous?.state || {}) };
    previous?.destroy();
    const document = container.ownerDocument;
    const rows = rowsFrom(options.records);
    const summary = summaryFrom(rows, options);
    const catalog = new Map((Array.isArray(options.catalog) ? options.catalog : []).map(exercise => [exercise.id, exercise]));
    const name = item => label(catalog.get(item.exerciseId)?.name, `תרגיל ${item.index + 1}`);
    const prefix = `history-${++instance}`;
    const el = (tag, className = '', text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    };
    const button = (text, action, className = 'history-text-button') => {
      const node = el('button', className, text); node.type = 'button'; node.dataset.historyAction = action; return node;
    };
    const badge = status => el('span', `history-badge ${status === 'complete' ? 'is-complete' : 'is-partial'}`, status === 'complete' ? 'כל הסטים' : 'אימון חלקי');
    const section = (title, index) => {
      const node = el('section', 'history-section');
      const heading = el('div', 'history-section-heading');
      heading.append(el('span', 'history-section-index', index), el('h2', '', title)); node.append(heading); return node;
    };
    const empty = (title, copy) => {
      const node = el('div', 'history-empty'); node.append(el('strong', '', title), el('p', '', copy)); return node;
    };
    const selectField = (title, key, entries, value) => {
      const field = el('div', 'history-field');
      const control = el('select'); control.id = `${prefix}-${key}`; control.dataset.historyFilter = key;
      for (const [id, text] of entries) { const option = el('option', '', text); option.value = id; control.append(option); }
      control.value = value;
      const caption = el('label', '', title); caption.htmlFor = control.id; field.append(caption, control); return { field, control };
    };
    const root = el('div', 'history-module'); root.dir = 'rtl';

    const week = section('השבוע שלך', '01');
    week.append(el('p', 'history-date-range', `${shortDate(summary.weekStart)} — ${shortDate(addDays(summary.weekEnd, -1))}`));
    const hero = el('div', 'history-week-card');
    const main = el('div', 'history-week-main');
    const mainCount = el('strong', 'history-week-number', summary.weeklyCompleted);
    main.append(mainCount, el('div', 'history-week-copy', summary.weeklyTarget ? `מתוך ${summary.weeklyTarget} אימונים מלאים השבוע` : 'אימונים מלאים השבוע'));
    hero.append(main);
    if (summary.weeklyTarget) {
      const progress = el('div', 'history-week-track'); progress.setAttribute('role', 'progressbar');
      progress.setAttribute('aria-label', 'אימונים מלאים השבוע'); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(summary.weeklyTarget));
      progress.setAttribute('aria-valuenow', String(Math.min(summary.weeklyCompleted, summary.weeklyTarget)));
      progress.setAttribute('aria-valuetext', `${summary.weeklyCompleted} מתוך ${summary.weeklyTarget} אימונים מלאים`);
      const fill = el('span'); fill.style.width = `${Math.min(100, summary.weeklyCompleted / summary.weeklyTarget * 100)}%`; progress.append(fill); hero.append(progress);
    }
    const metrics = el('div', 'history-week-metrics');
    const metricValues = [['אימונים חלקיים', summary.weeklyPartial], ['סטים שתועדו', summary.weeklySaved && summary.weeklyUnknownSets === summary.weeklySaved ? 'לא תועד' : summary.weeklySets], ['זמן שתועד', summary.weeklySaved && summary.weeklyUnknownDuration === summary.weeklySaved ? 'לא תועד' : duration(summary.weeklyElapsedSeconds)]];
    for (const [title, value] of metricValues) { const metric = el('div', 'history-week-metric'); metric.append(el('span', '', title), el('strong', '', value)); metrics.append(metric); }
    hero.append(metrics); week.append(hero);
    week.append(el('p', 'history-note', 'רק אימונים שנשמרו מופיעים כאן. אימון חלקי נשמר בנפרד ואינו נספר כאימון מלא; הזמן כולל גם מנוחות שתועדו.'));
    if (summary.weeklyUnknownDuration || summary.weeklyUnknownSets) week.append(el('p', 'history-note', 'בחלק מהרשומות חסרים נתוני זמן או סטים. הסכומים כוללים רק את הנתונים שנשמרו.'));
    week.append(el('p', 'history-all-time', `עד היום · ${summary.allTimeCompleted} אימונים מלאים · ${summary.allTimeSaved} רשומות שנשמרו`));
    root.append(week);

    const workouts = section('האימונים ששמרת', '02');
    const filters = el('div', 'history-filters');
    const period = selectField('תקופה', 'period', [['all', 'כל התאריכים'], ['week', 'השבוע'], ['month', '30 הימים האחרונים'], ['custom', 'טווח תאריכים']], state.period);
    const status = selectField('סוג אימון', 'status', [['all', 'מלאים וחלקיים'], ['complete', 'אימונים מלאים'], ['partial', 'אימונים חלקיים']], state.status);
    filters.append(period.field, status.field);
    const dates = el('div', 'history-date-fields');
    for (const [key, title] of [['from', 'מתאריך'], ['to', 'עד תאריך']]) {
      const field = el('div', 'history-field'); const input = el('input'); input.type = 'date'; input.id = `${prefix}-${key}`; input.dataset.historyFilter = key; input.value = state[key];
      const caption = el('label', '', title); caption.htmlFor = input.id; field.append(caption, input); dates.append(field);
    }
    const dateError = el('p', 'history-filter-error', 'תאריך ההתחלה צריך להיות לפני תאריך הסיום או באותו יום.'); dateError.setAttribute('role', 'status');
    const resultCount = el('p', 'history-result-count'); resultCount.setAttribute('aria-live', 'polite');
    const list = el('div', 'history-workout-list');
    const more = button('הצגת אימונים נוספים', 'more', 'history-more-button');
    const detail = el('div', 'history-record-detail'); detail.id = `${prefix}-detail`;
    workouts.append(filters, dates, dateError, resultCount, list, more, detail); root.append(workouts);

    const performance = section('הביצועים שלך לפי תרגיל', '03');
    performance.append(el('p', 'history-note', 'עד 5 רישומים אחרונים. החזרות והמשקל מוצגים כפי שנשמרו בכל סט, עם יחידות המדידה שלהם.'));
    const knownExercises = new Map();
    rows.forEach(row => row.items.filter(item => item.exerciseId && item.completedSets > 0).forEach(item => { if (!knownExercises.has(item.exerciseId)) knownExercises.set(item.exerciseId, name(item)); }));
    const exerciseChoices = [...knownExercises].sort((a, b) => a[1].localeCompare(b[1], 'he') || a[0].localeCompare(b[0], 'en'));
    if (!knownExercises.has(state.exercise)) state.exercise = exerciseChoices[0]?.[0] || '';
    const exerciseSelect = selectField('בחירת תרגיל', 'exercise', exerciseChoices, state.exercise);
    exerciseSelect.field.hidden = !exerciseChoices.length;
    const exerciseList = el('div', 'history-exercise-list'); performance.append(exerciseSelect.field, exerciseList); root.append(performance);

    function setRows(item) {
      const sets = el('ol', 'history-sets');
      for (let index = 0; index < item.setReps.length; index += 1) {
        const row = el('li', 'history-set-row');
        const values = el('div', 'history-set-values'); values.append(el('strong', '', repsText(item, index)), el('span', '', loadText(item, index)));
        row.append(el('span', 'history-set-index', `סט ${index + 1}`), values); sets.append(row);
      }
      if (item.completedSets > 256) sets.append(el('li', 'history-note', 'מוצגים 256 הסטים הראשונים ברשומה.'));
      return sets;
    }

    function openControl(row, text, className = 'history-text-button') {
      const control = button(text, 'open', className); control.dataset.historyRecord = row.id;
      control.setAttribute('aria-controls', detail.id); control.setAttribute('aria-expanded', String(state.open === row.id)); return control;
    }

    function renderDetail(focus = false) {
      const row = rows.find(record => record.id === state.open);
      detail.hidden = !row; detail.replaceChildren();
      root.querySelectorAll('[data-history-record]').forEach(control => control.setAttribute('aria-expanded', String(control.dataset.historyRecord === state.open)));
      if (!row) return;
      const head = el('div', 'history-detail-head'); const heading = el('h3', '', row.title); heading.tabIndex = -1;
      const close = button('סגירה', 'close'); close.setAttribute('aria-label', 'סגירת פרטי האימון'); head.append(heading, close);
      const meta = el('div', 'history-detail-meta'); const time = el('time', '', dateTime(row)); time.dateTime = row.completedAt; meta.append(time, badge(row.status));
      detail.append(head, meta, el('p', 'history-note', `זמן שתועד: ${duration(row.elapsedSeconds)} · ${row.completedSets === null ? 'מספר סטים לא תועד' : `${row.completedSets} סטים תועדו`}`));
      if (row.scheduledDate && row.scheduledDate !== row.day) detail.append(el('p', 'history-note', `תאריך בתוכנית: ${shortDate(row.scheduledDate)}`));
      detail.append(el('p', 'history-detail-explanation', '״כל הסטים״ פירושו שכל הסטים סומנו. החזרות שבוצעו יכולות להיות שונות מהיעד. נתון שלא נשמר מוצג כ״לא תועד״.'));
      if (!row.items.length) detail.append(empty('פירוט התרגילים לא נשמר', 'ברשומה הזו נשמר סיכום האימון בלבד.'));
      for (const item of row.items) {
        const block = el('article', 'history-detail-exercise');
        block.append(el('span', 'history-phase', PHASES[item.phase] || 'שלב לא תועד'), el('h4', '', name(item)), el('p', 'history-item-count', setsText(item)), el('p', 'history-target', targetText(item)));
        if (item.restSeconds !== null) block.append(el('p', 'history-target', `מנוחה מתוכננת בין סטים: ${duration(item.restSeconds)}`));
        if (item.completedSets > 0) block.append(setRows(item));
        else block.append(el('p', 'history-note', item.completedSets === 0 ? 'לא תועדו סטים שבוצעו בתרגיל הזה.' : 'נתוני הביצוע לפי סט לא נשמרו.'));
        detail.append(block);
      }
      if (focus) { heading.focus({ preventScroll: true }); detail.scrollIntoView?.({ block: 'start', behavior: 'auto' }); }
    }

    function renderWorkouts() {
      dates.hidden = state.period !== 'custom';
      const invalidRange = state.period === 'custom' && validDay(state.from) && validDay(state.to) && state.from > state.to;
      dateError.hidden = !invalidRange;
      const filtered = rows.filter(row => !invalidRange && (state.status === 'all' || row.status === state.status)
        && (state.period !== 'week' || row.day >= summary.weekStart && row.day < summary.weekEnd)
        && (state.period !== 'month' || row.day >= addDays(summary.today, -29) && row.day <= summary.today)
        && (state.period !== 'custom' || ((!validDay(state.from) || row.day >= state.from) && (!validDay(state.to) || row.day <= state.to))));
      resultCount.textContent = `${filtered.length} אימונים · תאריכים ושעות לפי ירושלים`;
      list.replaceChildren();
      for (const row of filtered.slice(0, state.limit)) {
        const trigger = openControl(row, '', 'history-workout-button');
        trigger.setAttribute('aria-label', `פתיחת האימון ${row.title}, ${dateTime(row)}, ${row.status === 'complete' ? 'כל הסטים תועדו' : 'אימון חלקי'}`);
        const top = el('span', 'history-workout-top'); const time = el('time', '', dateTime(row)); time.dateTime = row.completedAt; top.append(time, badge(row.status));
        const title = el('span', 'history-workout-title'); const arrow = el('span', 'history-workout-arrow', '←'); arrow.setAttribute('aria-hidden', 'true'); title.append(el('strong', '', row.title), arrow);
        trigger.append(top, title, el('span', 'history-workout-meta', `${duration(row.elapsedSeconds)} · ${row.completedSets === null ? 'סטים לא תועדו' : `${row.completedSets} סטים שתועדו`}`)); list.append(trigger);
      }
      more.hidden = filtered.length <= state.limit;
      if (!filtered.length) {
        const message = rows.length ? empty('אין אימונים בסינון הזה', 'אפשר לשנות את התקופה או את סוג האימון.') : empty('כאן יופיע האימון הראשון שלך', 'אחרי אישור ושמירת סיכום האימון, אפשר לחזור לכאן ולראות בדיוק מה תועד.');
        if (rows.length) message.append(button('הצגת כל האימונים', 'reset'));
        list.append(message);
      }
    }

    function renderPerformance() {
      exerciseList.replaceChildren();
      const entries = entriesFrom(rows, state.exercise);
      if (!entries.length) { exerciseList.append(empty('עדיין אין ביצועים לפי תרגיל', 'הפירוט יופיע כשיישמר אימון עם נתוני התרגילים והסטים.')); return; }
      for (const { record, item } of entries) {
        const card = el('article', 'history-performance-card');
        const head = el('div', 'history-performance-head'); const time = el('time', '', dateTime(record)); time.dateTime = record.completedAt; head.append(time, badge(record.status));
        card.append(head, el('p', 'history-performance-context', `${record.title} · ${PHASES[item.phase] || 'שלב לא תועד'}`), el('p', 'history-target', targetText(item)), setRows(item), openControl(record, 'לפרטי האימון'));
        exerciseList.append(card);
      }
      exerciseList.append(el('p', 'history-note', 'המשקל מתאר את מה שנרשם באותו אימון. מספרים ממכשירים או מסוגי עומס שונים אינם בהכרח שקולים.'));
    }

    function change(event) {
      const key = event.target?.dataset?.historyFilter;
      if (!['period', 'status', 'from', 'to', 'exercise'].includes(key)) return;
      state[key] = event.target.value; state.limit = 20;
      if (key === 'exercise') renderPerformance();
      else renderWorkouts();
    }

    function click(event) {
      const control = event.target.closest?.('[data-history-action]');
      if (!control || !container.contains(control)) return;
      const action = control.dataset.historyAction;
      if (action === 'open') { state.open = control.dataset.historyRecord; renderDetail(true); }
      if (action === 'close') {
        const id = state.open; state.open = ''; renderDetail();
        [...root.querySelectorAll('[data-history-record]')].find(node => node.dataset.historyRecord === id)?.focus();
      }
      if (action === 'more') { state.limit += 20; renderWorkouts(); }
      if (action === 'reset') { state.period = 'all'; state.status = 'all'; state.from = ''; state.to = ''; state.limit = 20; period.control.value = 'all'; status.control.value = 'all'; dates.querySelectorAll('input').forEach(input => { input.value = ''; }); renderWorkouts(); }
    }

    container.replaceChildren(root);
    renderWorkouts(); renderPerformance(); renderDetail();
    container.addEventListener('change', change); container.addEventListener('click', click);
    const controller = { state, destroy() { container.removeEventListener('change', change); container.removeEventListener('click', click); if (mounts.get(container) === controller) mounts.delete(container); } };
    mounts.set(container, controller);
    return controller;
  }

  window.VEXYRO_HISTORY = Object.freeze({
    render, localDate,
    summarize: (records, options) => summaryFrom(rowsFrom(records), options),
    exerciseEntries: (records, exerciseId, limit) => entriesFrom(rowsFrom(records), exerciseId, limit),
  });
})();
