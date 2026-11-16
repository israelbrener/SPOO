/* V8: a three-tap, keyboard-accessible date-of-birth picker.
 * The original <input type="date"> remains the canonical stored/form value.
 * Year selection is grouped by decade; no typing or 120-item scrolling needed.
 */
(() => {
  'use strict';
  const model = window.VEXYRO_BIRTHDATE_UTILS;
  if (!model) return;
  const { MONTHS, WEEKDAYS, getToday, iso, parse, ageAt, validBirthday, pretty } = model;
  const refreshers = [];
  const dialog = document.createElement('div');
  dialog.id = 'v8-birthdate-overlay';
  dialog.className = 'v8-date-overlay';
  dialog.hidden = true;
  dialog.innerHTML = `
    <div class="v8-date-sheet" role="dialog" aria-modal="true" aria-labelledby="v8-date-title" aria-describedby="v8-date-subtitle" dir="rtl">
      <header class="v8-date-head">
        <div class="v8-date-head-copy"><span class="v8-date-eyebrow">VEXYRO SPORT · הפרטים שלך</span><h2 id="v8-date-title">מתי נולדת?</h2><p id="v8-date-subtitle">בחירת תאריך בלחיצות, בלי להקליד.</p></div>
        <button type="button" class="v8-date-close" data-date-close aria-label="סגירת בחירת תאריך">✕</button>
      </header>
      <div class="v8-date-progress" role="group" aria-label="שלבי בחירת התאריך"><span data-date-progress="year">1 <b>שנה</b></span><span data-date-progress="month">2 <b>חודש</b></span><span data-date-progress="day">3 <b>יום</b></span></div>
      <div class="v8-date-contents" id="v8-date-contents"></div>
      <footer class="v8-date-footer"><button type="button" class="v8-date-back" data-date-back>חזרה לשלב הקודם</button><span>הגיל יחושב אוטומטית</span></footer>
    </div>`;
  document.body.append(dialog);
  const sheet = dialog.querySelector('.v8-date-sheet');
  const contents = dialog.querySelector('#v8-date-contents');
  const steps = ['year', 'month', 'day'];
  let active = null;
  let lastFocus = null;
  let previousOverflow = '';
  let state = { step: 'year', decade: 2010, year: null, month: null };

  function makeButton(label, cls, attribute, value, disabled = false) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = cls;
    el.textContent = label;
    if (attribute) el.dataset[attribute] = String(value);
    el.disabled = disabled;
    return el;
  }

  function renderYear() {
    const todayYear = Number(getToday().slice(0, 4));
    const minYear = todayYear - 121;
    const maxYear = todayYear - 1;
    const minDecade = Math.floor(minYear / 10) * 10;
    const maxDecade = Math.floor(maxYear / 10) * 10;
    state.decade = Math.max(minDecade, Math.min(maxDecade, state.decade));
    contents.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = 'באיזו שנה נולדת?';
    const description = document.createElement('p'); description.className = 'v8-date-help'; description.textContent = 'בחרו עשור, ואחר כך את השנה שלכם.';
    const nav = document.createElement('div'); nav.className = 'v8-decade-nav';
    const older = makeButton('‹ עשור קודם', 'v8-decade-arrow', 'olderDecade', 1, state.decade <= minDecade);
    const newer = makeButton('עשור הבא ›', 'v8-decade-arrow', 'newerDecade', 1, state.decade >= maxDecade);
    const decadePicker = document.createElement('select'); decadePicker.className = 'v8-decade-select'; decadePicker.setAttribute('aria-label', 'בחרו עשור');
    for (let decade = maxDecade; decade >= minDecade; decade -= 10) {
      const first = Math.max(minYear, decade);
      const last = Math.min(maxYear, decade + 9);
      const option = new Option(`${first}–${last}`, String(decade));
      decadePicker.append(option);
    }
    decadePicker.value = String(state.decade);
    const quick = document.createElement('form'); quick.className = 'v9-quick-year'; quick.noValidate = true;
    const quickLabel = document.createElement('label'); quickLabel.htmlFor = 'v9-year-input'; quickLabel.textContent = 'או כתבו את שנת הלידה ישירות';
    const quickRow = document.createElement('div'); quickRow.className = 'v9-quick-year-row';
    const yearInput = document.createElement('input'); yearInput.id = 'v9-year-input'; yearInput.type = 'number'; yearInput.inputMode = 'numeric'; yearInput.min = String(minYear); yearInput.max = String(maxYear); yearInput.placeholder = 'לדוגמה: 2005'; yearInput.autocomplete = 'off';
    const go = makeButton('המשך לחודש ←', 'v9-quick-submit'); go.type = 'submit';
    const error = document.createElement('small'); error.className = 'v9-year-error'; error.setAttribute('role','alert'); error.hidden = true;
    quickRow.append(yearInput,go); quick.append(quickLabel,quickRow,error);
    quick.addEventListener('submit', event => { event.preventDefault(); const year = Number(yearInput.value); if (!Number.isInteger(year) || year < minYear || year > maxYear) { error.textContent = `יש להזין שנה בין ${minYear} ל-${maxYear}`; error.hidden = false; yearInput.focus(); return; } state.year = year; state.step = 'month'; render(); });
    nav.append(older, decadePicker, newer);
    const grid = document.createElement('div'); grid.className = 'v8-year-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'בחירת שנה');
    for (let year = state.decade + 9; year >= state.decade; year--) {
      if (year < minYear || year > maxYear) continue;
      const button = makeButton(String(year), 'v8-date-option', 'chooseYear', year);
      if (year === state.year) {button.classList.add('is-chosen'); button.setAttribute('aria-current', 'date');}
      grid.append(button);
    }
    contents.append(heading, description, quick, nav, grid);
  }

  function renderMonth() {
    contents.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = `בחרו חודש בשנת ${state.year}`;
    const description = document.createElement('p'); description.className = 'v8-date-help'; description.textContent = 'באיזה חודש חל יום ההולדת שלך?';
    const grid = document.createElement('div'); grid.className = 'v8-month-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'בחירת חודש');
    for (let m = 1; m <= 12; m++) {
      const button = makeButton(MONTHS[m - 1], 'v8-date-option', 'chooseMonth', m);
      if (m === state.month) button.classList.add('is-chosen');
      // A month with no valid possible birthdays must not be selectable.
      const max = new Date(Date.UTC(state.year, m, 0)).getUTCDate();
      button.disabled = !Array.from({length:max}, (_, d) => validBirthday(state.year, m, d + 1, getToday())).some(Boolean);
      grid.append(button);
    }
    contents.append(heading, description, grid);
  }

  function renderDay() {
    contents.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = `בחרו יום ב${MONTHS[state.month - 1]} ${state.year}`;
    const desc = document.createElement('p'); desc.className = 'v8-date-help'; desc.textContent = 'לחצו על היום, וזה הכול!';
    const grid = document.createElement('div'); grid.className = 'v8-day-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', `בחירת יום ב${MONTHS[state.month - 1]} ${state.year}`);
    for (const weekday of WEEKDAYS) {
      const label = document.createElement('span'); label.className = 'v8-weekday'; label.textContent = weekday; grid.append(label);
    }
    const offset = new Date(Date.UTC(state.year, state.month - 1, 1)).getUTCDay();
    for (let i = 0; i < offset; i++) {
      const spacer = document.createElement('span'); spacer.className = 'v8-date-spacer'; spacer.setAttribute('aria-hidden', 'true'); grid.append(spacer);
    }
    const maxDays = new Date(Date.UTC(state.year, state.month, 0)).getUTCDate();
    const today = getToday();
    for (let day = 1; day <= maxDays; day++) {
      const button = makeButton(String(day), 'v8-day-option', 'chooseDay', day, !validBirthday(state.year, state.month, day, today));
      button.setAttribute('aria-label', pretty(state.year, state.month, day));
      if (active?.input.value === iso(state.year, state.month, day)) button.classList.add('is-chosen');
      grid.append(button);
    }
    contents.append(heading, desc, grid);
  }

  function render() {
    const idx = steps.indexOf(state.step);
    dialog.querySelectorAll('[data-date-progress]').forEach((marker, i) => {
      marker.classList.toggle('is-current', i === idx);
      marker.classList.toggle('is-done', i < idx);
      if (i === idx) marker.setAttribute('aria-current', 'step'); else marker.removeAttribute('aria-current');
    });
    dialog.querySelector('[data-date-back]').hidden = idx === 0;
    if (state.step === 'year') renderYear();
    if (state.step === 'month') renderMonth();
    if (state.step === 'day') renderDay();
    contents.querySelector('.v8-date-option.is-chosen, .v8-day-option.is-chosen, .v8-date-option:not([disabled]), .v8-day-option:not([disabled])')?.focus({preventScroll: true});
  }

  function close() {
    if (dialog.hidden) return;
    dialog.hidden = true;
    document.body.style.overflow = previousOverflow;
    active = null;
    lastFocus?.focus({preventScroll: true});
    lastFocus = null;
  }

  function open(widget) {
    if (active) close();
    const selected = parse(widget.input.value);
    const todayYear = Number(getToday().slice(0, 4));
    const initialYear = selected?.year || todayYear - 16;
    state = { step: 'year', decade: Math.floor(initialYear / 10) * 10, year: selected?.year || null, month: selected?.month || null };
    active = widget;
    lastFocus = document.activeElement;
    previousOverflow = document.body.style.overflow;
    dialog.hidden = false;
    document.body.style.overflow = 'hidden';
    render();
  }

  function refresh(widget) {
    const selected = parse(widget.input.value);
    const valid = selected && validBirthday(selected.year, selected.month, selected.day, getToday());
    widget.value.textContent = valid ? pretty(selected.year, selected.month, selected.day) : 'לחצו לבחירת תאריך';
    widget.trigger.classList.toggle('is-filled', Boolean(valid));
    widget.help.textContent = valid ? `גיל מחושב: ${ageAt(selected.year, selected.month, selected.day, getToday())} · אפשר לשנות בכל רגע` : 'לא צריך להקליד. בוחרים שנה, חודש ויום.';
  }

  const inputs = Array.from(document.querySelectorAll('input[name="birthDate"][type="date"]'));
  for (const input of inputs) {
    input.classList.add('birthdate-native-value');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.parentElement?.classList.add('v8-birthdate-container');
    const trigger = makeButton('', 'v8-birthdate-trigger');
    trigger.id = `${input.id}-picker-trigger`;
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', 'v8-birthdate-overlay');
    trigger.setAttribute('aria-label', 'בחירת תאריך לידה');
    const icon = document.createElement('span'); icon.className = 'v8-date-trigger-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '▦';
    const value = document.createElement('span'); value.className = 'v8-date-trigger-value';
    const chevron = document.createElement('span'); chevron.className = 'v8-date-trigger-chevron'; chevron.setAttribute('aria-hidden', 'true'); chevron.textContent = '‹';
    trigger.append(icon, value, chevron);
    const help = document.createElement('small'); help.className = 'v8-date-field-hint'; help.setAttribute('aria-live', 'polite');
    input.insertAdjacentElement('afterend', trigger);
    trigger.insertAdjacentElement('afterend', help);
    const label = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
    if (label) label.htmlFor = trigger.id;
    const widget = { input, trigger, value, help };
    trigger.addEventListener('click', () => open(widget));
    input.addEventListener('change', () => refresh(widget));
    input.addEventListener('input', () => refresh(widget));
    refreshers.push(() => refresh(widget));
    refresh(widget);
  }
  document.addEventListener('vexyro:birthdate-refresh', () => refreshers.forEach(fn => fn()));
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-date-close]')) {close(); return;}
    if (event.target.closest('[data-date-back]')) {
      const stepIdx = steps.indexOf(state.step);
      if (stepIdx > 0) {state.step = steps[stepIdx - 1]; render();}
      return;
    }
    if (event.target.closest('[data-older-decade]')) {state.decade -= 10; render(); return;}
    if (event.target.closest('[data-newer-decade]')) {state.decade += 10; render(); return;}
    const yearButton = event.target.closest('[data-choose-year]');
    if (yearButton) {state.year = Number(yearButton.dataset.chooseYear); state.step = 'month'; render(); return;}
    const monthButton = event.target.closest('[data-choose-month]');
    if (monthButton) {state.month = Number(monthButton.dataset.chooseMonth); state.step = 'day'; render(); return;}
    const dayButton = event.target.closest('[data-choose-day]');
    if (dayButton && active) {
      const date = iso(state.year, state.month, Number(dayButton.dataset.chooseDay));
      if (!validBirthday(state.year, state.month, Number(dayButton.dataset.chooseDay), getToday())) return;
      active.input.value = date;
      active.input.dispatchEvent(new Event('input', {bubbles: true}));
      active.input.dispatchEvent(new Event('change', {bubbles: true}));
      refresh(active);
      close();
    }
  });
  dialog.addEventListener('change', event => {
    if (event.target.matches('.v8-decade-select')) {
      state.decade = Number(event.target.value);
      render();
    }
  });
  document.addEventListener('keydown', event => {
    if (dialog.hidden) return;
    if (event.key === 'Escape') {event.preventDefault(); close(); return;}
    if (event.key !== 'Tab') return;
    const focusable = Array.from(sheet.querySelectorAll('button:not([disabled]):not([hidden]), select:not([disabled]), input:not([disabled])'));
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
  });
  window.VEXYRO_BIRTHDATE = Object.freeze({ validBirthday, ageAt, parse, refreshAll: () => refreshers.forEach(fn => fn()) });
})();
