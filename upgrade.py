from pathlib import Path
p=Path('index.html'); s=p.read_text()
s=s.replace('<circle cx="12" cy="13" r="8"/><circle cx="12" cy="13" r="4"/><path d="M3 2v9m-2-9v5m4-5v5m-2 4v11M21 2v20M17 2v7c0 3 4 3 4 0"/>','<path d="M12 21C6 18 4 13 5 9c1-4 4-5 7-3 3-2 6-1 7 3 1 4-1 9-7 12Z"/><path d="M12 6c0-3 1-4 3-5M12 6C9 3 7 3 6 3"/><path d="M12 11v6M9 14h6"/>')
s=s.replace('<script src="app.js" defer></script>','<script src="app.js" defer></script>\n  <script src="v4-enhancements.js" defer></script>')
# check actual app include later
if 'v4-enhancements.js' not in s: s=s.replace('</head>','  <script src="v4-enhancements.js" defer></script>\n</head>')
# replace SVGs with more anatomical shapes
start='<svg class="body-map-silhouette" viewBox="0 0 130 230" aria-hidden="true"><circle cx="65" cy="22" r="17"/><path d="M50 43 Q65 50 80 43 L103 55 L117 112 L105 119 L90 83 L87 135 L82 211 L67 211 L64 146 L61 211 L46 211 L43 135 L40 83 L25 119 L13 112 L27 55Z"/></svg>'
def body(back=False):
    muscle= '#93c9ae' if not back else '#8cb5d5'
    parts='''<defs><linearGradient id="anatomy" x1="0" x2="1"><stop stop-color="#173a33"/><stop offset=".45" stop-color="#6b9c83"/><stop offset="1" stop-color="#173a33"/></linearGradient></defs>
    <path class="body-outline" d="M52 42Q65 48 78 42L94 48Q102 51 107 68L119 115Q122 125 112 128Q105 129 102 121L89 86L88 129L85 155L82 212Q82 222 72 222Q64 221 64 212L62 153L59 212Q58 223 49 222Q40 222 41 212L44 155L42 129L41 86L28 121Q24 130 16 128Q7 126 11 115L23 68Q28 51 36 48Z" fill="url(#anatomy)"/>
    <path d="M53 43Q65 50 77 43L82 51Q65 62 48 51Z" fill="#b3d1bb" opacity=".8"/>
    <ellipse cx="65" cy="23" rx="15" ry="19" fill="url(#anatomy)"/><path d="M54 27Q65 35 76 27M57 19h3m10 0h3" fill="none" stroke="#163a30" stroke-width="1"/>'''
    if not back:
      parts+='''<path d="M44 57Q53 52 64 67L63 89Q47 91 43 77Z M86 57Q77 52 66 67L67 89Q83 91 87 77Z" fill="#b9d8b7" stroke="#284f43"/>
      <path d="M48 94Q56 91 63 96L63 129Q53 126 47 115Z M82 94Q74 91 67 96L67 129Q77 126 83 115Z" fill="#a1c6a4" stroke="#284f43"/>
      <path d="M30 56Q20 72 21 88L29 99L39 66Z M100 56Q110 72 109 88L101 99L91 66Z" fill="#86b7a1" stroke="#284f43"/>
      <path d="M45 137Q51 129 60 139L58 177L45 183Z M85 137Q79 129 70 139L72 177L85 183Z" fill="#b2d1b4" stroke="#284f43"/>
      <path d="M48 98l12 7m-11 3 11 6m-9 4 9 5m20-25-12 7m11 3-11 6m9 4-9 5" stroke="#315e4c" stroke-width="1"/>'''
    else:
      parts+='''<path d="M45 54Q65 66 85 54L79 93Q65 104 51 93Z" fill="#b5d0ce" stroke="#315e65"/>
      <path d="M45 60Q53 77 62 87L60 102Q49 92 45 76Z M85 60Q77 77 68 87L70 102Q81 92 85 76Z" fill="#8eb9b4" stroke="#315e65"/>
      <path d="M48 102Q65 109 82 102L81 132Q65 138 49 132Z" fill="#92b9b5" stroke="#315e65"/>
      <path d="M46 138Q55 132 61 142L58 176L44 185Z M84 138Q75 132 69 142L72 176L86 185Z" fill="#9dc9b8" stroke="#315e65"/>
      <path d="M64 55v75M52 64l10 17m16-17L68 81M51 112l10 13m18-13-10 13" stroke="#315e65" fill="none" stroke-width="1"/>'''
    parts+='''<path d="M41 154L43 205M89 154L87 205M24 77l-7 39m89-39 7 39" fill="none" stroke="#c6e5d0" opacity=".5" stroke-width="2"/>'''
    return '<svg class="body-map-silhouette anatomy-art" viewBox="0 0 130 230" aria-hidden="true">'+parts+'</svg>'
s=s.replace(start,body(False),1).replace(start,body(True),1)
s=s.replace('<p id="schedule-body-summary" role="status">','<p class="anatomy-help">לחצו על שם קבוצת השרירים כדי לסמן אותה. אזור שנבחר יואר בירוק.</p><p id="schedule-body-summary" role="status">')
s=s.replace('לומדים את התנועה</h1>','לומדים את התנועה</h1>')
p.write_text(s)
# group exercise cards by area in both picker and library
p=Path('app.js');s=p.read_text();s=s.replace('container.replaceChildren(...rows);','''const orderedGroups = ['chest','back','shoulders','arms','legs','core','cardio','mobility'];
    const sections = orderedGroups.flatMap(key => {
      const matching = filtered.map((exercise, i) => ({exercise, card: rows[i]})).filter(entry => entry.exercise.group === key);
      if (!matching.length) return [];
      const section = node('section', 'exercise-group-section');
      const heading = node('h2', 'exercise-group-title', `${GROUP_LABELS[key]} · ${matching.length} תרגילים`);
      const grid = node('div', 'exercise-group-grid');
      grid.append(...matching.map(entry => entry.card));
      section.append(heading, grid);
      return [section];
    });
    container.replaceChildren(...sections);''');p.write_text(s)
