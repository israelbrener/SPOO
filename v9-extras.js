/* V9: achievements and recorded personal bests; no fabricated achievements. */
(() => {
  'use strict';
  const panel = document.getElementById('v9-achievements');
  const view = document.getElementById('view-workout-result');
  if (!panel || !view) return;
  const badge = document.getElementById('result-badge');
  function render() {
    panel.hidden = true;
    panel.replaceChildren();
    if (view.hidden || !badge || !/נשמר/.test(badge.textContent || '')) return;
    let records;
    try { records = JSON.parse(localStorage.getItem('vexyro.workout-history.v1') || '{}').records; } catch (_) { return; }
    if (!Array.isArray(records) || !records.length) return;
    const completed = records.filter(r => r && r.status === 'complete');
    const achievements = [];
    if (completed.length >= 1) achievements.push('🎯 אימון מלא ראשון');
    if (completed.length >= 10) achievements.push('🥉 10 אימונים מלאים');
    if (completed.length >= 50) achievements.push('🥈 50 אימונים מלאים');
    if (completed.length >= 100) achievements.push('👑 100 אימונים מלאים');
    const best = new Map();
    for (const record of records) for (const item of record?.itemResults || []) {
      if (!item?.exerciseId || !Array.isArray(item.setLoads)) continue;
      for (const load of item.setLoads) if (typeof load === 'number' && Number.isFinite(load) && load > (best.get(item.exerciseId) || 0)) best.set(item.exerciseId,load);
    }
    const title = document.createElement('h2'); title.textContent = '🏆 ההישגים והשיאים שלך'; panel.append(title);
    const summary = document.createElement('p'); summary.textContent = `אימונים מלאים שנשמרו: ${completed.length} · תרגילים עם שיא משקל מתועד: ${best.size}`; panel.append(summary);
    for (const achievement of achievements) { const p = document.createElement('p'); p.textContent = achievement; panel.append(p); }
    if (best.size) { const p = document.createElement('p'); p.textContent = '💪 שיאי המשקל מחושבים רק ממשקלים שהזנת בפועל במהלך האימון.'; panel.append(p); }
    panel.hidden = false;
  }
  const observer = new MutationObserver(render);
  observer.observe(badge,{childList:true,characterData:true,subtree:true});
  observer.observe(view,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
  render();
})();
