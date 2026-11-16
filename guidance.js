/* Educational guidance and transparent catalog matches, not injury diagnosis or load prescription. */
(() => {
  'use strict';
  const GOAL_LABELS = Object.freeze({ strength: 'שיפור כוח', endurance: 'כושר וסיבולת', flexibility: 'גמישות', 'sport-performance': 'ביצועים בספורט', 'general-fitness': 'כושר כללי' });
  const AREA_LABELS = Object.freeze({ knee: 'ברך', shoulder: 'כתף', back: 'גב', hip: 'ירך או אגן', ankle: 'קרסול או כף רגל', wrist: 'שורש כף היד', elbow: 'מרפק', other: 'אזור אחר' });
  const AREA_TERMS = { knee: ['ברך', 'ברכ'], shoulder: ['כתף', 'כתפ'], back: ['בגב', 'הגב', 'גב '], hip: ['ירך', 'ירכ', 'אגן'], ankle: ['קרסול', 'כף רגל'], wrist: ['שורש כף', 'שורשי כף', 'כף היד', 'כפות היד'], elbow: ['מרפק'], other: [] };
  const SOURCES = Object.freeze([
    { label: 'Mayo Clinic · אימוני כוח', url: 'https://www.mayoclinic.org/healthy-lifestyle/fitness/in-depth/strength-training/art-20046670' },
    { label: 'NHS · כוח וגמישות', url: 'https://www.nhs.uk/live-well/exercise/how-to-improve-strength-flexibility/' },
    { label: 'NHS · התאמה לפני תרגול', url: 'https://www.nhs.uk/live-well/exercise/strength-and-flex-exercise-plan-how-to-videos/' },
  ]);
  const needsGuidance = context => ['guidance', 'unsure'].includes(context?.screening);

  function matchedGoals(exercise, profile) {
    return (profile?.goals || []).filter(goal => {
      if (goal === 'strength') return exercise.category === 'strength';
      if (goal === 'endurance') return exercise.group === 'cardio';
      if (goal === 'flexibility') return exercise.category === 'mobility' || exercise.group === 'mobility';
      if (goal === 'general-fitness') return exercise.level === 'beginner';
      // A sports goal alone does not identify a sport-specific exercise prescription.
      return false;
    });
  }

  function areaCautions(exercise, context) {
    if (!needsGuidance(context)) return [];
    const terms = (context.injuryAreas || []).flatMap(area => AREA_TERMS[area] || []);
    return (exercise.cautions || []).filter(caution => terms.some(term => `${caution.title} ${caution.text}`.includes(term)));
  }

  function overview(profile, context) {
    if (needsGuidance(context)) return [{ title: 'קודם מתאימים למצב שלך', text: 'כשיש כאב, פציעה או ספק בהתאמה, מקבלים הנחיות מרופא/ה או מפיזיותרפיסט/ית לפני שבוחרים תרגילים ועומס. המטרות שלך נשמרות, אבל לא נציע עכשיו מספר סטים או משקל לפי הפציעה.' }];
    if (!profile || !Number.isInteger(profile.age)) return [{ title: 'ההכוונה תופיע אחרי השאלון', text: 'ממלאים מטרה ורמת ניסיון כדי להציג דגשים רלוונטיים לבחירת התרגילים.' }];
    if (profile.age < 18) return [{ title: 'הכוונה לאימוני בני נוער', text: 'מספר הסטים והמשקל צריכים להיבדק עם מדריך מוסמך לאימוני בני נוער. ההכוונה המספרית למבוגרים אינה מוצגת כאן.' }];
    const copy = {
      strength: 'כדאי ללמוד את התנועה בשליטה ולהתקדם בהדרגה. גם סט אחד יכול להועיל; אחרי שמכירים את התרגיל אפשר לשקול 2–3 סטים בהתאם לניסיון ולהתאוששות.',
      endurance: 'המיקוד בספרייה מציג תרגילי תנועה וסיבולת. סיבולת לב־ריאה וסיבולת שריר הן מטרות שונות; בחירת המטרה לא משנה אוטומטית חזרות או משקל.',
      flexibility: 'המיקוד מציג תרגילי תנועתיות וגמישות. שמרו על ההסבר והמשך של כל תרגיל; מספר הסטים לא משתנה אוטומטית בגלל המטרה.',
      'sport-performance': 'כדי להתאים אימון לענף מסוים צריך גם לדעת מהו הענף ומה הדרישות שלו. כרגע אפשר לבחור תרגילי בסיס, בלי להציג אותם כתוכנית ספורט ייעודית.',
      'general-fitness': 'כדאי לשלב תנועה וחיזוק לאורך השבוע. מתחילים בכמות שניתן לבצע בשליטה, ולומדים את הטכניקה לפני שמגדילים את העומס.',
    };
    return (profile.goals || []).filter(goal => copy[goal]).map(goal => ({ title: GOAL_LABELS[goal], text: copy[goal] }));
  }

  function doseHint(exercise, profile, context) {
    if (needsGuidance(context)) return 'מספר הסטים והעומס ייקבעו עם איש מקצוע בהתאם למצב שסימנת.';
    if (!profile || profile.age < 18) return 'את הבחירה בודקים עם מדריך מוסמך לפני התחלה.';
    if (exercise.category !== 'strength') return 'בחרו מספר סבבים לפי התרגול המתאים לכם. ההסבר והמשך בכל סבב נשארים כפי שמופיע בתרגיל.';
    if (profile.experience === 'beginner') return 'להיכרות: מתחילים בסט אחד ולומדים את התנועה. אפשר להתקדם בהדרגה; אין צורך לבחור את המספר המרבי.';
    if ((profile.goals || []).includes('strength')) return 'לכוח: אפשר לשקול 2–3 סטים אחרי היכרות עם התנועה ובהתאם להתאוששות. זו הכוונה כללית, לא מינון אישי.';
    return 'גם סט אחד עשוי להועיל. בוחרים כמות שניתן לבצע בשליטה ומתקדמים בהדרגה.';
  }

  window.VEXYRO_GUIDANCE = Object.freeze({ GOAL_LABELS, AREA_LABELS, SOURCES, needsGuidance, matchedGoals, areaCautions, overview, doseHint });
})();
