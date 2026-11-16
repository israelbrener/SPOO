/* Shared birthdate calendar rules, usable in the browser and in Node tests. */
((root, factory) => {
  'use strict';
  const utils = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = utils;
  if (root) root.VEXYRO_BIRTHDATE_UTILS = utils;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';
  const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  const WEEKDAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
  const pad = number => String(number).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const parse = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return match ? {year: Number(match[1]), month: Number(match[2]), day: Number(match[3])} : null;
  };
  const getToday = () => {
    const appDate = globalThis.window?.VEXYRO_PLAN?.localDate?.();
    if (typeof appDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(appDate)) return appDate;
    const now = new Date();
    return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  };
  const ageAt = (y, m, d, today) => {
    const [ty, tm, td] = today.split('-').map(Number);
    return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  };
  const validBirthday = (y, m, d, today) => {
    if (![y, m, d].every(Number.isInteger) || !Number.isInteger(y) || y < 1 || y > 9999) return false;
    const candidate = new Date(Date.UTC(y, m - 1, d));
    if (candidate.getUTCFullYear() !== y || candidate.getUTCMonth() + 1 !== m || candidate.getUTCDate() !== d) return false;
    const age = ageAt(y, m, d, today);
    return age >= 1 && age <= 120 && iso(y, m, d) <= today;
  };
  const pretty = (y, m, d) => `${d} ב${MONTHS[m - 1]} ${y}`;
  return Object.freeze({MONTHS, WEEKDAYS, getToday, pad, iso, parse, ageAt, validBirthday, pretty});
});
