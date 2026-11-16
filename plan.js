/* Version 6: exercise-led sessions assigned to chosen weekdays and body areas. */
(() => {
  'use strict';
  const legacy = window.VEXYRO_PLAN_LEGACY;
  const v2 = window.VEXYRO_PLAN_V2;
  const v3 = window.VEXYRO_PLAN_V3;
  const v4 = window.VEXYRO_PLAN_V4;
  const v5 = window.VEXYRO_PLAN_V5;
  const schedule = window.VEXYRO_SCHEDULE;
  const training = window.VEXYRO_TRAINING;
  const VERSION = 6;
  const EQUIPMENT = v5.EQUIPMENT;
  const MAX_SELECTED = 500;
  const { localDate, validDate, addDays, estimatedSeconds } = v5;
  function validationIssue(profile, settings, today = localDate(), catalog = window.VEXYRO_EXERCISES) {
    if (!legacy.completeProfile(profile)) return {field:'profile',message:'יש להשלים תחילה את הפרופיל.'};
    if (profile.age < 13) return {field:'age',guidance:true,message:'בניית תוכנית אוטומטית לילדים מתחת לגיל 13 עדיין אינה זמינה.'};
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.hasOwn(settings,'sessionMinutes')) return {field:'settings',message:'הגדרות האימון אינן תקינות.'};
    if (!validDate(settings.startDate) || settings.startDate < today || settings.startDate > addDays(today,90)) return {field:'startDate',message:'בחרו תאריך התחלה מהיום ועד 90 ימים קדימה.'};
    if (!['clear','guidance','unsure'].includes(settings.screening)) return {field:'screening',message:'יש לענות על שאלת ההתאמה.'};
    if (settings.screening !== 'clear') return {field:'screening',guidance:true,message:'לפני תוכנית חדשה עם כאב או מגבלה נדרשת התאמה מקצועית.'};
    if (profile.age < 18 && !settings.youthSupervision) return {field:'youthSupervision',message:'בגיל הזה נדרשת בדיקת התוכנית עם מדריך מוסמך לאימוני בני נוער.'};
    if (!Array.isArray(settings.equipment) || settings.equipment.some(value=>!EQUIPMENT.includes(value))) return {field:'equipment',message:'הציוד שסומן אינו תקין.'};
    if (!Array.isArray(settings.selectedExercises) || !settings.selectedExercises.length || settings.selectedExercises.length>MAX_SELECTED || new Set(settings.selectedExercises).size !== settings.selectedExercises.length) return {field:'selectedExercises',message:'יש לבחור לפחות תרגיל אחד. מספר התרגילים הזמינים מוגבל רק לגודל הספרייה.'};
    const byId = new Map(catalog.map(x=>[x.id,x]));
    if (settings.selectedExercises.some(id=>!byId.has(id))) return {field:'selectedExercises',message:'יש תרגיל לא מוכר בבחירה.'};
    for (const id of settings.selectedExercises) {
      const exercise = byId.get(id);
      if (!exercise.equipment.every(value=>settings.equipment.includes(value))) return {field:'equipment',message:`חסר ציוד מתאים לתרגיל ${exercise.name}.`};
      if (!settings.exerciseOptions || !training.validOptions(exercise, settings.exerciseOptions[id])) return {field:'exerciseOptions',exerciseId:id,message:`הגדרות הסטים, החזרות או המנוחה של ${exercise.name} אינן תקינות.`};
    }
    if (Object.keys(settings.exerciseOptions).length !== settings.selectedExercises.length) return {field:'exerciseOptions',message:'יש להשלים הגדרות לכל תרגיל.'};
    return schedule.issue(profile,settings,catalog);
  }
  function item(exercise, phase='main', selection=null, overrides={}) {
    return {exerciseId:exercise.id,phase,...exercise.defaultPrescription,sets:selection?.sets??1,weightKg:selection?.weightKg??null,
      ...(selection?{reps:selection.reps,restSeconds:selection.restSeconds}:{}),loadKind:training.loadSpec(exercise).kind,...overrides};
  }
  function build(profile,settings,catalog,now=new Date()) {
    const issue = validationIssue(profile,settings,localDate(now),catalog);
    if (issue) {const error = new Error(issue.message);error.field=issue.field;throw error;}
    const opts = {
      startDate:settings.startDate,equipment:[...new Set(settings.equipment)].sort(),screening:'clear',
      youthSupervision:profile.age<18?Boolean(settings.youthSupervision):false,
      selectedExercises:[...settings.selectedExercises],
      exerciseOptions:Object.fromEntries(settings.selectedExercises.map(id=>[id,{sets:settings.exerciseOptions[id].sets,weightKg:settings.exerciseOptions[id].weightKg,reps:settings.exerciseOptions[id].reps,restSeconds:settings.exerciseOptions[id].restSeconds}])),
      trainingDays:[...settings.trainingDays].sort((a,b)=>a-b),
      bodyAreasByDay:Object.fromEntries([...settings.trainingDays].sort((a,b)=>a-b).map(day=>[day,[...settings.bodyAreasByDay[day]].sort()])),
      trainingTimes:Object.fromEntries([...settings.trainingDays].sort((a,b)=>a-b).map(day=>[day,settings.trainingTimes[day]])),
    };
    const byId = new Map(catalog.map(exercise=>[exercise.id,exercise]));
    const slots = Array.from({length:7},(_,offset)=>({date:addDays(opts.startDate,offset),offset})).filter(s=>opts.trainingDays.includes(schedule.weekday(s.date))).map(s=>({
      ...s,weekday:schedule.weekday(s.date),main:[],
      warmup:item(byId.get('march-in-place'),'warmup',null,{durationSeconds:180,restSeconds:15}),
      cooldown:item(byId.get('march-in-place'),'cooldown',null,{durationSeconds:60,restSeconds:0}),
    }));
    const itemSeconds = s => estimatedSeconds([s.warmup,...s.main,s.cooldown]);
    const chosen = opts.selectedExercises.map(id=>byId.get(id));
    // Assign every requested exercise at least once to the least busy compatible day.
    for (const exercise of chosen) {
      const candidates = slots.filter(s=>opts.bodyAreasByDay[s.weekday].includes(exercise.group));
      candidates.sort((a,b)=>itemSeconds(a)-itemSeconds(b)||a.offset-b.offset);
      candidates[0].main.push(item(exercise,'main',opts.exerciseOptions[exercise.id]));
    }
    // Every selected day/area has at least one matching exercise, even if it repeats.
    for (const slot of slots) for (const area of opts.bodyAreasByDay[slot.weekday]) {
      if (slot.main.some(x=>byId.get(x.exerciseId).group===area)) continue;
      const matching=chosen.filter(ex=>ex.group===area).sort((a,b)=>a.id.localeCompare(b.id));
      slot.main.push(item(matching[0],'main',opts.exerciseOptions[matching[0].id]));
    }
    const days=Array.from({length:7},(_,offset)=>{
      const date=addDays(opts.startDate,offset);
      const slot=slots.find(s=>s.offset===offset);
      if (!slot) return {date,type:'rest',title:'יום מנוחה',session:null};
      const items=[slot.warmup,...slot.main,slot.cooldown];
      const areas=opts.bodyAreasByDay[slot.weekday];
      const strength=slot.main.some(x=>byId.get(x.exerciseId).category==='strength');
      const mobility=slot.main.some(x=>byId.get(x.exerciseId).category==='mobility');
      const type=strength?'strength':mobility?'mobility':'movement';
      const title=`אימון ${areas.map(a=>schedule.AREA_LABELS[a]).join(' + ')}`;
      const session={type,title,description:'התרגילים והמשקלים שבחרת, לפי אזורי הגוף של היום.',startTime:opts.trainingTimes[slot.weekday],areas:[...areas],
        estimatedSeconds:estimatedSeconds(items),estimatedMinutes:Math.ceil(estimatedSeconds(items)/60),exerciseCount:new Set(items.map(x=>x.exerciseId)).size,items};
      return {date,type,title,session};
    });
    return {schemaVersion:VERSION,id:`selected-${now.getTime()}`,createdAt:now.toISOString(),profileFingerprint:legacy.fingerprint(profile),settings:opts,
      location:profile.trainingLocation,weeklyTarget:profile.workoutsPerWeek,goals:[...profile.goals],experience:profile.experience,ageGroup:profile.age<18?'youth':'adult',days};
  }
  function validSavedPlan(plan,catalog) {
    try {
      if (plan?.schemaVersion===1) return legacy.validSavedPlan(plan,catalog);
      if (plan?.schemaVersion===2) return v2.validSavedPlan(plan,catalog);
      if (plan?.schemaVersion===3) return v3.validSavedPlan(plan,catalog);
      if (plan?.schemaVersion===4) return v4.validSavedPlan(plan,catalog);
      if (plan?.schemaVersion===5) return v5.validSavedPlan(plan,catalog);
      if (!plan||plan.schemaVersion!==VERSION||typeof plan.profileFingerprint!=='string'||!Array.isArray(plan.days)||plan.days.length!==7||!Array.isArray(plan.goals)||!Number.isFinite(Date.parse(plan.createdAt))) return false;
      const profile=JSON.parse(plan.profileFingerprint);
      if (!legacy.completeProfile(profile)||plan.location!==profile.trainingLocation||plan.weeklyTarget!==profile.workoutsPerWeek||plan.experience!==profile.experience||plan.ageGroup!==(profile.age<18?'youth':'adult')||JSON.stringify([...plan.goals].sort())!==JSON.stringify([...profile.goals].sort())) return false;
      const expected=build(profile,plan.settings,catalog,new Date(plan.createdAt));
      return plan.id===expected.id && JSON.stringify(expected.settings)===JSON.stringify(plan.settings) && JSON.stringify(expected.days)===JSON.stringify(plan.days);
    } catch(_) {return false;}
  }
  window.VEXYRO_PLAN=Object.freeze({...v5,VERSION,EQUIPMENT,MAX_SELECTED,validationIssue,build,validSavedPlan});
})();
