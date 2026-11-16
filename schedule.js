/* Weekly strength scheduling and streak accounting, shared by UI and plan engine. */
(() => {
  'use strict';
  const WEEKDAYS = Object.freeze(['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']);
  const AREA_LABELS = Object.freeze({chest:'חזה',back:'גב',shoulders:'כתפיים',arms:'ידיים',legs:'רגליים',core:'בטן',mobility:'גמישות',cardio:'סיבולת'});
  const MUSCLES = Object.freeze(['chest','back','shoulders','arms','legs','core']);
  const isDay = n => Number.isInteger(n) && n >= 0 && n <= 6;
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay();
  const minute = (day, time) => day * 1440 + Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const maxCount = area => area === 'core' ? 3 : 2;
  function issue(profile, settings, catalog) {
    const days = settings?.trainingDays;
    if (!Array.isArray(days) || days.length !== profile?.workoutsPerWeek || days.some(d => !isDay(d)) || new Set(days).size !== days.length) {
      return {field:'trainingDays',message:`יש לבחור בדיוק ${profile?.workoutsPerWeek || 0} ימי אימון שונים בשבוע.`};
    }
    const areas = settings?.bodyAreasByDay;
    const times = settings?.trainingTimes;
    if (!areas || typeof areas !== 'object' || Array.isArray(areas) || !times || typeof times !== 'object' || Array.isArray(times)) {
      return {field:'bodyAreasByDay',message:'יש לבחור אזורי גוף ושעת אימון לכל יום.'};
    }
    if (Object.keys(areas).some(key => !days.includes(Number(key))) || Object.keys(times).some(key => !days.includes(Number(key)))) {
      return {field:'bodyAreasByDay',message:'יש להסיר אזורים ושעות שנשמרו לימים שאינם ימי אימון.'};
    }
    for (const day of days) {
      const values = areas[day];
      if (!Array.isArray(values) || !values.length || values.some(a => !Object.hasOwn(AREA_LABELS,a)) || new Set(values).size !== values.length) {
        return {field:'bodyAreasByDay',message:`בחרו לפחות אזור אחד תקין ליום ${WEEKDAYS[day]}.`};
      }
      if (!validTime(times[day])) return {field:'trainingTimes',message:`בחרו שעת אימון תקינה ליום ${WEEKDAYS[day]}.`};
    }
    for (const area of MUSCLES) {
      const slots = days.filter(day => areas[day].includes(area)).map(day => minute(day,times[day])).sort((a,b) => a-b);
      if (slots.length > maxCount(area)) return {field:'bodyAreasByDay',message:`אפשר לקבוע אימון ${AREA_LABELS[area]} עד ${maxCount(area)} פעמים בשבוע.`};
      if (slots.length > 1) {
        for (let i=0; i<slots.length; i++) {
          const next = i === slots.length-1 ? slots[0] + 10080 : slots[i+1];
          if (next-slots[i] < 2880) return {field:'bodyAreasByDay',message:`חייבות לעבור לפחות 48 שעות בין אימוני ${AREA_LABELS[area]}, כולל מעבר בין שבועות.`};
        }
      }
    }
    if (catalog && Array.isArray(settings.selectedExercises)) {
      const chosen = settings.selectedExercises.map(id => catalog.find(exercise => exercise.id === id)).filter(Boolean);
      for (const exercise of chosen) {
        if (!days.some(day => areas[day].includes(exercise.group))) return {field:'bodyAreasByDay',message:`בחרו יום שמתאים ל${AREA_LABELS[exercise.group] || exercise.group} כדי לשלב את ${exercise.name}.`};
      }
      for (const day of days) {
        for (const area of areas[day]) {
          if (!chosen.some(exercise => exercise.group === area)) return {field:'selectedExercises',message:`ביום ${WEEKDAYS[day]} בחרת ${AREA_LABELS[area]}, אבל עוד לא הוספת תרגיל מתאים לאזור הזה.`};
        }
      }
    }
    return null;
  }
  // Schedule history is deliberately part of the profile snapshot to survive cloud imports.
  function streak(profile, records, today, addDays) {
    const log = Array.isArray(profile?.scheduleHistory) ? profile.scheduleHistory.filter(item => /^\d{4}-\d\d-\d\d$/.test(item.startDate) && Array.isArray(item.trainingDays) && item.trainingDays.every(isDay)).sort((a,b) => a.startDate.localeCompare(b.startDate)) : [];
    if (!log.length || log[0].startDate > today) return 0;
    const completed = new Set(records.filter(r => r.status === 'complete' && /^\d{4}-\d\d-\d\d$/.test(r.scheduledDate || '')).map(r => r.scheduledDate));
    let count = 0, started = false, index = 0, day = log[0].startDate;
    // Bounded to 10 years, so corrupt historical data cannot stall the page.
    for (let n=0; day <= today && n < 3660; n++, day = addDays(day,1)) {
      while (index + 1 < log.length && log[index+1].startDate <= day) index++;
      const training = log[index].trainingDays.includes(weekday(day));
      if (training && completed.has(day)) { started = true; count++; }
      else if (training && day < today) { started = false; count = 0; }
      else if (!training && started) count++;
      // Do not prematurely reset on a scheduled day that has not ended.
    }
    return count;
  }
  window.VEXYRO_SCHEDULE = Object.freeze({WEEKDAYS,AREA_LABELS,MUSCLES,validTime,weekday,issue,streak});
})();
