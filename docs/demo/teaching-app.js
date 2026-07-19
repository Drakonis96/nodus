/* Nodus web demo — TEACHING mode. Built from the real teaching vault fixture and
   UI captures. The web version is intentionally smaller, but every represented
   surface and interaction exists in the desktop app. */
(function () {
  const T = window.TEACHING;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const I = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const ICONS = {
    home: I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
    graduation: I('<path d="m22 9-10-5L2 9l10 5 10-5Z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/>'),
    users: I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
    clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
    calendar: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
    book: I('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
    microphone: I('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>'),
    help: I('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.7 2.2c-.7.4-1.2 1-1.2 1.8v.5"/><path d="M12 17h.01"/>'),
    table: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16M15 4v16"/>'),
    notebook: I('<path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M8 2v20M13 7h4M13 11h4"/>'),
    chart: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    file: I('<path d="M6 2h8l5 5v15H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M14 2v5h5M9 13h6M9 17h4"/>'),
    lock: I('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    download: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>'),
    chevronLeft: I('<path d="m14 6-6 6 6 6"/>'),
    chevronRight: I('<path d="m10 6 6 6-6 6"/>'),
    check: I('<path d="m4 12.5 5 5L20 6.5"/>'),
    settings: I('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"/>'),
  };

  const NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { group: 'Organisation' },
    { id: 'courses', label: 'Courses & subjects', icon: 'graduation' },
    { id: 'groups', label: 'Groups', icon: 'users' },
    { id: 'schedule', label: 'Timetable', icon: 'clock' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar' },
    { id: 'materials', label: 'Materials', icon: 'book' },
    { id: 'recordings', label: 'Recordings', icon: 'microphone' },
    { group: 'Assessment' },
    { id: 'questions', label: 'Question bank', icon: 'help' },
    { id: 'rubrics', label: 'Rubrics', icon: 'table' },
    { id: 'exams', label: 'Exams', icon: 'notebook' },
    { id: 'grades', label: 'Grades', icon: 'chart' },
    { group: 'Create · in design' },
    { id: 'planned', label: 'Teaching plans & units', icon: 'file' },
  ];

  const state = { view: 'home', groupOpen: false, rubricOpen: false, examOpen: false, gradesOpen: false, privacy: true, solution: false };

  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  function modal(content) {
    $('#modal-root').innerHTML = `<div class="modal-overlay" id="teach-modal"><div class="modal wide">${content}</div></div>`;
    $('#teach-modal').addEventListener('mousedown', (event) => { if (event.target.id === 'teach-modal') closeModal(); });
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }

  const button = (label, action, icon, primary) => `<button class="btn${primary ? ' primary' : ''}" onclick="${action}">${icon ? ICONS[icon] : ''}${label}</button>`;
  const head = (kicker, title, sub, actions) => `<div class="view-head teach-head"><div><p class="teach-kicker">${kicker}</p><h1 class="view-title">${title}</h1><p class="view-sub">${sub}</p></div><div class="toolbar">${actions || ''}</div></div>`;
  const mark = (icon) => `<span class="teach-mark">${ICONS[icon]}</span>`;

  function renderNav() {
    $('#nav').innerHTML = NAV.map((item) => item.group != null
      ? `<div class="nav-group-label">${item.group}</div>`
      : `<button class="nav-item${state.view === item.id ? ' active' : ''}${item.id === 'planned' ? ' teach-planned' : ''}" onclick="go('${item.id}')">${ICONS[item.icon]}<span>${item.label}</span>${item.id === 'planned' ? '<small>Preview</small>' : ''}</button>`).join('');
  }

  function renderHome() {
    const destinations = [
      ['groups', 'users', 'Groups', 'Keep each class list tied to its subject and academic year.'],
      ['rubrics', 'table', 'Rubrics', 'Build weighted criteria by achievement level.'],
      ['exams', 'notebook', 'Exams', 'Compose printable papers with a live preview.'],
      ['grades', 'chart', 'Grades', 'Apply a published assessment plan without turning every blank into zero.'],
    ];
    return `${head('Teaching vault', 'Your teaching workspace', 'Organise courses, materials and classes, then assess privately with reusable rubrics, printable exams and a defensible gradebook.')}
      <section class="teach-hero"><div><span class="teach-hero-icon">${ICONS.graduation}</span><p>Current course</p><h2>${T.course}</h2><span>${T.year} · 2 subjects · 1 active group</span></div><button class="btn primary" onclick="go('courses')">Open course ${ICONS.chevronRight}</button></section>
      <div class="grid cols-4 teach-stats">
        <div class="card"><span class="stat">1</span><p>Active group</p></div><div class="card"><span class="stat">6</span><p>Students</p></div><div class="card"><span class="stat">1</span><p>Weighted rubric</p></div><div class="card"><span class="stat">1</span><p>Published gradebook</p></div>
      </div>
      <h2 class="teach-section-title">Start</h2><div class="grid cols-2">${destinations.map(([id, icon, title, copy]) => `<article class="card click teach-dest" onclick="go('${id}')">${mark(icon)}<div><h3>${title}</h3><p>${copy}</p></div>${ICONS.chevronRight}</article>`).join('')}</div>
      <h2 class="teach-section-title">Recent activity</h2><div class="card teach-recent">${T.recent.map((item) => `<button onclick="go('${item.kind === 'rubric' ? 'rubrics' : item.kind === 'exam' ? 'exams' : 'grades'}')">${mark(item.kind === 'rubric' ? 'table' : item.kind === 'exam' ? 'notebook' : 'chart')}<span><b>${item.title}</b><small>${item.meta}</small></span>${ICONS.chevronRight}</button>`).join('')}</div>`;
  }

  function renderCourses() {
    return `${head('Organisation', 'Courses & subjects', 'The course hierarchy is the anchor for schedules, materials, groups and assessment.', button('New subject', "GUI.toast('In the desktop app this opens the subject editor.')", 'plus', true))}
      <div class="card teach-course"><div class="teach-course-title">${mark('graduation')}<div><h2>${T.course}</h2><p>${T.year} · Active</p></div></div>
        <div class="teach-subject"><span style="--subject:#ea580c"></span><div><b>History</b><small>Unit 3 · Industrialisation · 2 notes · 1 material</small></div><span class="chip">Year 9 A</span></div>
        <div class="teach-subject"><span style="--subject:#0ea5e9"></span><div><b>Geography</b><small>Physical geography · maps and fieldwork</small></div><span class="chip">No group yet</span></div>
      </div>`;
  }

  function groupList() {
    return `${head('Organisation', 'Groups', 'Student lists by subject and academic year.', button('New group', "GUI.toast('The app creates the empty rows you need and can import names from another group.')", 'plus', true))}
      <div class="card teach-table-wrap"><table class="tbl teach-table"><thead><tr><th>Group</th><th>Subject</th><th>Academic year</th><th>Students</th><th>Updated</th></tr></thead><tbody><tr class="rowlink" onclick="GUI.openGroup()"><td>${mark('users')}<b>${T.group}</b><small>GRP-DOC1</small></td><td>History</td><td>${T.year}</td><td>6</td><td>Today</td></tr></tbody></table></div>`;
  }

  function groupDetail() {
    return `<button class="back-btn" onclick="GUI.closeGroup()">${ICONS.chevronLeft} All groups</button>
      ${head(`History · ${T.year}`, T.group, '6 students on the list.', button('Import from another group', "GUI.toast('Names and surnames are copied; subject-specific comments stay in their original group.')", 'users'))}
      <button class="teach-privacy${state.privacy ? ' on' : ''}" onclick="GUI.togglePrivacy()">${ICONS.lock}<span><b>${state.privacy ? 'The AI will not see your students’ names.' : 'The AI would receive the real names.'}</b><small>${state.privacy ? 'Names are replaced by local identifiers such as STU_BSQV. The names stay visible to you.' : 'Turn privacy back on before using a cloud model with student data.'}</small></span><span class="teach-switch"><i></i></span></button>
      <div class="card teach-table-wrap"><table class="tbl teach-table students"><thead><tr><th>#</th><th>Identifier</th><th>First name</th><th>Surname</th><th>Comments</th></tr></thead><tbody>${T.students.map((s, i) => `<tr><td>${i + 1}</td><td><button class="teach-code" onclick="GUI.copyCode('${s.code}')">${s.code}</button></td><td>${esc(s.first)}</td><td>${esc(s.last)}</td><td>${esc(s.note)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderSchedule() {
    const rows = [['08:15–09:10', ['History', '', 'Geography', 'History', '']], ['09:10–10:05', ['', 'History', '', 'Geography', 'History']], ['11:30–12:25', ['Geography', '', 'History', '', 'Geography']]];
    return `${head('Organisation', 'Timetable', 'Subjects reuse the colours and structure of the current academic year.')}
      <div class="card teach-table-wrap"><table class="teach-schedule"><thead><tr><th>Period</th>${['Monday','Tuesday','Wednesday','Thursday','Friday'].map((d) => `<th>${d}</th>`).join('')}</tr></thead><tbody>${rows.map(([time, cells]) => `<tr><th>${time}</th>${cells.map((cell) => `<td>${cell ? `<button class="teach-class ${cell === 'History' ? 'history' : 'geography'}" onclick="GUI.toast('${cell} · ${time}')">${cell}<small>Year 9</small></button>` : '<button class="teach-empty" onclick="GUI.toast(\'The app lets you place a subject in this slot.\')">+</button>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function renderCalendar() {
    return `${head('Organisation', 'Calendar', 'Classes, deadlines, exams and meetings stay in the vault; reminders are local.')}
      <div class="grid cols-3"><article class="card teach-event"><span>21 JUL</span><div><b>Source commentary due</b><small>History · Year 9 A · Assignment</small></div></article><article class="card teach-event"><span>24 JUL</span><div><b>Written test · unit 3</b><small>55 minutes · Exam</small></div></article><article class="card teach-event"><span>28 JUL</span><div><b>Department meeting</b><small>Social Sciences · Meeting</small></div></article></div>`;
  }

  function renderMaterials() {
    return `${head('Organisation', 'Materials', 'Documents and source packs placed in the course hierarchy.', button('Add material', "GUI.toast('The desktop app imports PDF, documents, slides and images.')", 'plus', true))}
      <div class="list-row" onclick="GUI.toast('The app opens the source beside its annotations and links.')">${mark('file')}<div class="list-main"><div class="list-title"><b>Factory report, 1832</b><span class="chip">Markdown</span></div><p class="list-desc">Primary-source extract used by the rubric and the printable exam.</p><div class="list-meta"><span>History</span><span>Unit 3 · Industrialisation</span><span>Indexed locally</span></div></div>${ICONS.chevronRight}</div>`;
  }

  function renderRecordings() {
    return `${head('Organisation', 'Recordings', 'Record a session or import audio, transcribe locally and link exact moments back to your materials.', button('Record class', "GUI.toast('The desktop app records with a live level meter and transcribes with local Whisper.')", 'microphone', true))}
      <article class="card teach-recording"><button onclick="GUI.playRecording()" class="teach-play">▶</button><div><h3>Class · industrial working conditions</h3><p>History · Unit 3 · 02:00 · transcript ready</p><div class="teach-wave">${Array.from({ length: 54 }, (_, i) => `<i style="height:${8 + ((i * 13) % 22)}px"></i>`).join('')}</div></div></article>`;
  }

  function renderQuestions() {
    return `${head('Assessment', 'Question bank', 'Reusable questions live by subject and topic; the printed exam is assembled separately.', button('New question', "GUI.toast('Questions can also be generated from selected teaching material and always need review.')", 'plus', true))}
      <div class="list-row" onclick="GUI.toast('The app opens the solution, cognitive level and version history.')">${mark('help')}<div class="list-main"><div class="list-title"><b>What changes distinguish the first and second industrial revolutions?</b><span class="chip">Short essay</span></div><p class="list-desc">Expected answer: energy sources, leading sectors and modes of production.</p><div class="list-meta"><span>History</span><span>Industrialisation</span><span>Apply · 2 points</span></div></div>${ICONS.chevronRight}</div>`;
  }

  function rubricList() {
    return `${head('Assessment', 'Rubrics', 'Create criteria and achievement levels, with optional AI assistance from your own material.', button('New rubric', "GUI.toast('The app opens a blank analytic rubric with four levels.')", 'plus', true))}
      <div class="card teach-table-wrap"><table class="tbl teach-table"><thead><tr><th>Rubric</th><th>Subject</th><th>Criteria</th><th>Levels</th><th>Maximum</th></tr></thead><tbody><tr class="rowlink" onclick="GUI.openRubric()"><td>${mark('table')}<b>${T.rubric.title}</b><small>${T.rubric.description}</small></td><td>${T.rubric.subject}</td><td>4</td><td>4</td><td>10</td></tr></tbody></table></div>`;
  }

  function rubricEditor() {
    return `<button class="back-btn" onclick="GUI.closeRubric()">${ICONS.chevronLeft} All rubrics</button>
      ${head('History · 4 criteria · weights 100%', T.rubric.title, 'Weighted analytic rubric · maximum 10', `${button('Generate with AI', "GUI.toast('In the app, AI can draft from a material or your instructions; you approve every cell.')", 'settings')}${button('Word', "GUI.toast('The desktop app exports this rubric as an editable Word document.')", 'download')}${button('PDF', "GUI.toast('The desktop app renders and downloads the printable PDF.')", 'download', true)}`)}
      <div class="teach-rubric-wrap"><table class="teach-rubric"><thead><tr><th>Criterion</th>${T.levels.map((l) => `<th><b>${l.name}</b><span>${String(l.score).replace('.', ',')}</span></th>`).join('')}</tr></thead><tbody>${T.rubric.criteria.map((c) => `<tr><th><b>${c.name}</b><small>${c.description}</small><span>${c.weight}%</span></th>${c.cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="teach-quality">${ICONS.check}<div><b>Quality review: no issues detected</b><span>Weights add up to 100%; level descriptions distinguish observable performance.</span></div></div>`;
  }

  function examList() {
    return `${head('Assessment', 'Exams', 'Build the paper question by question and download it as Word or PDF.', button('New exam', "GUI.toast('The app supports thirteen question types and reusable logos.')", 'plus', true))}
      <article class="card click teach-exam-card" onclick="GUI.openExam()"><div>${mark('notebook')}<span><h3>${T.exam.title}</h3><p>${T.exam.subject}</p><small>EXM-DOC1 · 6 scored questions · ${T.exam.points} points</small></span></div><button class="btn" onclick="event.stopPropagation(); GUI.toast('The desktop app duplicates the full paper and its questions.')">Duplicate</button></article>`;
  }

  function paperPreview() {
    const questions = T.exam.questions;
    return `<article class="teach-paper"><header><small>${T.exam.institution}</small><h2>${T.exam.title}</h2><p>${T.exam.printedSubject} · Duration: ${T.exam.duration} minutes · Total: ${T.exam.points} points</p><div>Name and surname ____________________ &nbsp; Group __________ &nbsp; Date ________</div></header><p class="teach-instructions"><b>Instructions:</b> ${T.exam.instructions}</p>${questions.map((q) => `<section class="teach-paper-q${q.type === 'Section' ? ' section' : ''}"><b>${q.n}. ${q.prompt}</b>${q.points ? `<span>${q.points} ${q.points === 1 ? 'point' : 'points'}</span>` : ''}${q.options ? `<ul>${q.options.map((o) => `<li>□ ${o}</li>`).join('')}</ul>` : ''}${state.solution && q.answer ? `<em>Answer: ${q.answer}</em>` : !q.options && q.type !== 'Section' ? '<i></i><i></i>' : ''}</section>`).join('')}</article>`;
  }

  function examBuilder() {
    return `<button class="back-btn" onclick="GUI.closeExam()">${ICONS.chevronLeft} All exams</button>
      ${head('History · 6 scored questions', T.exam.title, `${T.exam.points} points · ${T.exam.duration} minutes`, `${button('Word', "GUI.toast('The desktop app downloads an editable .docx paper.')", 'download')}${button('PDF', "GUI.toast('The desktop app renders the printable PDF shown in the preview.')", 'download', true)}`)}
      <div class="teach-exam-layout"><div><section class="card teach-exam-head"><h3>Exam header</h3><div class="teach-form"><label>School or institution<input value="${T.exam.institution}" readonly></label><label>Title printed on the exam<input value="${T.exam.title}" readonly></label><label>Subject<input value="${T.exam.printedSubject}" readonly></label><label>Group<input value="${T.exam.group}" readonly></label><label class="span-2">Instructions<textarea readonly>${T.exam.instructions}</textarea></label></div></section>
        <div class="teach-question-list">${T.exam.questions.map((q, index) => `<article class="card teach-question${q.type === 'Section' ? ' section' : ''}"><span>${q.n}</span><div><small>${q.type}</small><b>${q.prompt}</b>${q.answer ? `<button onclick="GUI.revealAnswer(${index})">Reveal answer</button>` : ''}</div><em>${q.points ? `${q.points} p` : 'Section'}</em></article>`).join('')}</div></div>
        <aside class="teach-preview"><div><b>Preview</b><button onclick="GUI.toggleSolutions()">${state.solution ? 'Show exam' : 'Show answer key'}</button></div>${paperPreview()}</aside></div>`;
  }

  function gradeValue(student, index) {
    const status = student.statuses[index];
    if (status === 'exempt') return '<span class="grade-status exempt">Exempt</span>';
    if (status === 'not_assessed') return '<span class="grade-status pending">Not assessed</span>';
    if (status === 'not_submitted') return '<span class="grade-status missing">Not submitted</span>';
    return `<span>${Math.round(student.marks[index])}</span>`;
  }

  function finalGrade(student) {
    let numerator = 0; let denominator = 0;
    T.columns.forEach((col, index) => {
      const status = student.statuses[index];
      if (status === 'exempt' || status === 'not_assessed') return;
      numerator += (status === 'not_submitted' ? 0 : student.marks[index]) * col.weight;
      denominator += col.weight;
    });
    return denominator ? numerator / denominator : 0;
  }

  function gradesList() {
    return `${head('Assessment', 'Grades', 'Gradebooks whose rules come from a published assessment plan.', button('New gradebook', "GUI.toast('Choose a starting model, subject and academic year in the desktop app.')", 'plus', true))}
      <div class="card teach-table-wrap"><table class="tbl teach-table"><thead><tr><th>Gradebook</th><th>Subject</th><th>Model</th><th>Status</th></tr></thead><tbody><tr class="rowlink" onclick="GUI.openGrades()"><td>${mark('chart')}<b>History · Year 9 A</b><small>Version 1 · PLA-DOC1</small></td><td>History</td><td>Mixed secondary</td><td><span class="chip teach-published">Published</span></td></tr></tbody></table></div>`;
  }

  function gradesGrid() {
    return `<button class="back-btn" onclick="GUI.closeGrades()">${ICONS.chevronLeft} All gradebooks</button>
      ${head('History', 'History · Year 9 A', '6 students · published assessment plan', `${button('Analyse', "GUI.analysis()", 'chart')}${button('Export', "GUI.toast('The app exports grade sheets, reports and individual bulletins.')", 'download')}${button('Assessment plan', "GUI.plan()", 'settings')}`)}
      <div class="pills"><button class="pill active">Year 9 A</button><button class="pill">Continuous assessment</button><button class="pill">Ordinary session</button></div>
      <div class="teach-grade-wrap"><table class="teach-grades"><thead><tr><th>#</th><th>Identifier</th><th>First name</th><th>Surname</th>${T.columns.map((c) => `<th title="${c.parent} · ${c.weight}%">${c.name}<small>${c.weight}%</small></th>`).join('')}<th>Final</th></tr></thead><tbody>${T.students.map((s, row) => `<tr><td>${row + 1}</td><td><button class="teach-code" onclick="GUI.copyCode('${s.code}')">${s.code}</button></td><td>${s.first}</td><td>${s.last}</td>${T.columns.map((c, i) => `<td><button class="teach-grade-cell" onclick="GUI.gradeStatus('${s.id}',${i})">${gradeValue(s, i)}</button></td>`).join('')}<td><button class="teach-final" onclick="GUI.explain('${s.id}')">${finalGrade(s).toFixed(1)}</button></td></tr>`).join('')}</tbody></table></div>
      <p class="muted small teach-grade-note">A blank is never silently treated as zero. “Not assessed”, “exempt” and “not submitted” remain explicit states and change the calculation according to the published plan.</p>`;
  }

  function renderPlanned() {
    return `${head('Create · in design', 'Teaching plans & units', 'These sections are visible in the desktop app as feedback previews, not finished tools.')}
      <div class="grid cols-2">${[['Teaching guide / course plan','Connect the annual programme to materials and assessment criteria.'],['Teaching units','Turn the annual plan into timing, activities, resources and assessment links.'],['Learning situations','Design a complete sequence around a challenge, evidence and criteria.'],['Accommodations','Track support measures without exposing student data to AI.']].map(([title, copy]) => `<article class="card teach-design"><span>In design</span><h3>${title}</h3><p>${copy}</p><button class="btn" onclick="GUI.toast('The desktop preview collects feedback before this surface is built.')">Open feedback preview</button></article>`).join('')}</div>`;
  }

  const VIEWS = {
    home: renderHome, courses: renderCourses, groups: () => state.groupOpen ? groupDetail() : groupList(), schedule: renderSchedule,
    calendar: renderCalendar, materials: renderMaterials, recordings: renderRecordings, questions: renderQuestions,
    rubrics: () => state.rubricOpen ? rubricEditor() : rubricList(), exams: () => state.examOpen ? examBuilder() : examList(),
    grades: () => state.gradesOpen ? gradesGrid() : gradesList(), planned: renderPlanned,
  };

  function render() {
    renderNav(); $('#main').innerHTML = (VIEWS[state.view] || VIEWS.home)(); $('#main').scrollTop = 0;
  }

  function go(view) {
    state.view = VIEWS[view] ? view : 'home';
    state.groupOpen = state.rubricOpen = state.examOpen = state.gradesOpen = false;
    closeModal(); history.replaceState(null, '', `#${state.view}`); render();
  }
  window.go = go;
  window.GUI = {
    toast, close: closeModal,
    openGroup() { state.groupOpen = true; render(); }, closeGroup() { state.groupOpen = false; render(); },
    togglePrivacy() { state.privacy = !state.privacy; render(); },
    copyCode(code) { navigator.clipboard?.writeText(code); toast(`${code} copied.`); },
    openRubric() { state.rubricOpen = true; render(); }, closeRubric() { state.rubricOpen = false; render(); },
    openExam() { state.examOpen = true; render(); }, closeExam() { state.examOpen = false; render(); },
    toggleSolutions() { state.solution = !state.solution; render(); }, revealAnswer(index) { const answer = T.exam.questions[index]?.answer || 'No answer stored.'; modal(`<div class="modal-head"><div><h3>Answer key</h3><p class="muted small">Stored with the question in the desktop app</p></div><button class="modal-x" onclick="GUI.close()">×</button></div><div class="teach-answer">${esc(answer)}</div>`); },
    openGrades() { state.gradesOpen = true; render(); }, closeGrades() { state.gradesOpen = false; render(); },
    gradeStatus(studentId, index) { const s = T.students.find((x) => x.id === studentId); const col = T.columns[index]; modal(`<div class="modal-head"><div><h3>${s.first} · ${col.name}</h3><p class="muted small">Value and status are stored separately</p></div><button class="modal-x" onclick="GUI.close()">×</button></div><div class="teach-status-options">${['Evaluated','Not submitted','Not assessed','Exempt'].map((label) => `<button onclick="GUI.toast('${label}: the published plan decides how this state affects the result.'); GUI.close()">${label}</button>`).join('')}</div>`); },
    explain(studentId) { const s = T.students.find((x) => x.id === studentId); modal(`<div class="modal-head"><div><h3>How ${s.first}’s grade was calculated</h3><p class="muted small">Continuous assessment · ordinary session</p></div><button class="modal-x" onclick="GUI.close()">×</button></div><div class="teach-breakdown">${T.columns.map((c, i) => `<div><span>${c.name}<small>${s.statuses[i].replace('_',' ')}</small></span><b>${s.marks[i] == null ? '—' : s.marks[i]}</b><em>${c.weight}%</em></div>`).join('')}<strong>Final projection <b>${finalGrade(s).toFixed(1)}</b></strong></div>`); },
    analysis() { const values = T.students.map(finalGrade); const avg = values.reduce((a,b) => a + b, 0) / values.length; modal(`<div class="modal-head"><div><h3>Class analysis</h3><p class="muted small">Only rows with numeric evidence contribute</p></div><button class="modal-x" onclick="GUI.close()">×</button></div><div class="grid cols-3 teach-analysis"><div class="card"><span>${avg.toFixed(1)}</span><p>Class mean</p></div><div class="card"><span>${values.filter((v) => v >= 5).length}/6</span><p>Passing projection</p></div><div class="card"><span>6</span><p>Students with evidence</p></div></div>`); },
    plan() { modal(`<div class="modal-head"><div><h3>Published assessment plan</h3><p class="muted small">Version 1 · frozen for auditability</p></div><button class="modal-x" onclick="GUI.close()">×</button></div><div class="teach-plan"><div><b>Written tests</b><span>50%</span><small>Unit 3 exam 60% · Map test 40%</small></div><div><b>Source commentary</b><span>30%</span><small>Guided commentary · analytic rubric</small></div><div><b>Classwork</b><span>20%</span><small>Notebook 50% · participation 50%</small></div></div>`); },
    playRecording() { toast('Playback in the desktop app stays linked to the exact transcript second.'); },
  };

  window.addEventListener('hashchange', () => {
    const next = location.hash.slice(1);
    if (!VIEWS[next] || next === state.view) return;
    state.view = next;
    state.groupOpen = state.rubricOpen = state.examOpen = state.gradesOpen = false;
    closeModal(); render();
  });

  const initial = location.hash.slice(1);
  if (VIEWS[initial]) state.view = initial;
  render();
})();
