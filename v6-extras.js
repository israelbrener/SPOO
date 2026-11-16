/* Version 6: a rotating daily tip and a deliberate new-start control. */
(() => {
  'use strict';
  const tips = [
    ['מתחילים בהדרגה', 'לפני התרגילים המרכזיים, התחילו בכמה דקות של תנועה קלה ועלו בעומס בהדרגה.'],
    ['הטכניקה קודמת למשקל', 'בחרו עומס שמאפשר תנועה מבוקרת. אם הטכניקה נפגעת, הורידו משקל או חזרות.'],
    ['מנוחה היא חלק מהתוכנית', 'ימי מנוחה מאפשרים לגוף להתאושש. אפשר לשלב בהם תנועה קלה לפי ההרגשה.'],
    ['הכינו מים מראש', 'שמרו בקבוק מים קרוב והתאימו את השתייה לחום, למאמץ ולמשך הפעילות.'],
    ['התמדה מעל הכול', 'עדיף אימון מציאותי שמתאים לשבוע שלכם על פני תוכנית עמוסה שקשה להמשיך בה.'],
    ['שימו לב לתחושה', 'כאב חד, סחרחורת או קושי חריג הם סיבה לעצור ולפנות להכוונה מתאימה.'],
    ['עקבו אחר ההתקדמות', 'תיעוד של סטים, משקלים וחזרות עוזר לזהות שינוי לאורך זמן בלי לנחש.'],
  ];

  function updateDailyTip() {
    const title = document.getElementById('v6-tip-title');
    const body = document.getElementById('v6-tip-body');
    const number = document.getElementById('v6-tip-number');
    if (!title || !body || !number) return;
    // Match the app's Israeli training-calendar date instead of assuming the device's UTC date.
    const today = window.VEXYRO_PLAN?.localDate?.() || new Date().toISOString().slice(0, 10);
    const timestamp = Date.parse(`${today}T12:00:00Z`);
    const index = Number.isFinite(timestamp) ? Math.floor(timestamp / 86400000) % tips.length : 0;
    const [heading, guidance] = tips[index];
    title.textContent = heading;
    body.textContent = guidance;
    number.textContent = `טיפ ${index + 1} מתוך ${tips.length}`;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('#v6-start-over');
    if (!button) return;
    const confirmed = window.confirm('להתחיל מחדש? פעולה זו תמחק מהמכשיר הזה את הפרופיל, הבחירה במנוי, תוכניות האימון, האימונים הפעילים וההיסטוריה השמורים בדפדפן. לא ניתן לשחזר נתונים מקומיים שנמחקו.');
    if (!confirmed) return;
    const cleared = window.VEXYRO_RELEASE?.resetLocalData();
    if (!cleared) {
      window.alert('לא הצלחנו למחוק את הנתונים השמורים בדפדפן. בדקו את הרשאות האחסון ונסו שוב.');
      return;
    }
    window.location.reload();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateDailyTip(); });
  updateDailyTip();
  window.setInterval(updateDailyTip, 60 * 60 * 1000);
})();
