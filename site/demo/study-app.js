/* Nodus web demo — STUDY mode. A static replica of the app's study vault on its
   own sample workspace (General Biology): the course/subject browser with the
   note editor, the weekly schedule, the calendar, local search over notes,
   materials and transcripts, the material library, recordings with a timed
   transcript, the study chat with citations, the per-subject idea map and graph,
   the question bank, the review session and a study brief. Same shell and
   conventions as app.js / genealogy-app.js. */
(function () {
  const S = window.STUDY;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const main = () => $('#main');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- lookups ----------
  const subjectById = (id) => S.subjects.find((x) => x.id === id);
  const topicById = (id) => S.topics.find((x) => x.id === id);
  const folderById = (id) => S.folders.find((x) => x.id === id);
  const docById = (id) => S.docs.find((x) => x.id === id);
  const materialById = (id) => S.materials.find((x) => x.id === id);
  const recordingById = (id) => S.recordings.find((x) => x.id === id);
  const subjectName = (id) => (subjectById(id) || { name: '—' }).name;
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const bytes = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`;
  const dayFrom = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };
  const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const IDEA_COLORS = { concept: '#22d3ee', principle: '#fbbf24', process: '#818cf8', consequence: '#f472b6' };
  const EDGE_COLORS = { supports: '#34d399', contrasts: '#f87171', applies: '#a78bfa', causes: '#fbbf24' };
  const EVENT_COLORS = { exam: '#f87171', assignment: '#fbbf24', class: '#818cf8', session: '#2dd4bf' };
  const EVENT_LABEL = { exam: 'Exam', assignment: 'Assignment', class: 'Class', session: 'Study session' };
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const DAY_LABEL = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday' };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3400);
  }

  // ---------- icons ----------
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    home: I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
    graduation: I('<path d="m22 9-10-5L2 9l10 5 10-5Z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/>'),
    clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
    calendar: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    book: I('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
    microphone: I('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>'),
    chat: I('<path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 0 1 8-8h2a8 8 0 0 1 8 4Z"/>'),
    bulb: I('<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.4 1 2.3h6c0-.9.3-1.8 1-2.3A7 7 0 0 0 12 2Z"/>'),
    layers: I('<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'),
    help: I('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.7 2.2c-.7.4-1.2 1-1.2 1.8v.5"/><path d="M12 17h.01"/>'),
    flashcards: I('<rect x="3" y="6" width="14" height="12" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v11"/>'),
    report: I('<path d="M6 2h8l5 5v15H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M14 2v5h5M9 13h6M9 17h4"/>'),
    notebook: I('<path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M8 2v20M13 7h4M13 11h4"/>'),
    settings: I('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"/>'),
    folder: I('<path d="M4 5h5l2 3h9a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1Z"/>'),
    hash: I('<path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/>'),
    microscope: I('<path d="M6 18h12M8 18a5 5 0 0 1 5-8"/><path d="m10 6 3-3 4 4-3 3z"/><path d="m11 9 3 3M6 22h12"/>'),
    leaf: I('<path d="M11 20A7 7 0 0 1 20 4c0 9-5 13-11 13Z"/><path d="M4 21c2-6 5-9 9-11"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    play: I('<path d="M8 5v14l11-7-11-7Z" fill="currentColor" stroke="none"/>'),
    star: I('<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9L12 3Z"/>'),
    check: I('<path d="m4 12.5 5 5L20 6.5"/>'),
    x: I('<path d="M6 6l12 12M18 6 6 18"/>'),
    upload: I('<path d="M12 17V5M7 10l5-5 5 5"/><path d="M4 19h16"/>'),
    download: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>'),
    external: I('<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    wand: I('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/>'),
    link: I('<path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>'),
    chevronLeft: I('<path d="m14 6-6 6 6 6"/>'),
    chevronRight: I('<path d="m10 6 6 6-6 6"/>'),
    refresh: I('<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>'),
    trash: I('<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>'),
    edit: I('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>'),
    alert: I('<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>'),
    sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5 3.6 3.6M20.4 20.4 19 19M19 5l1.4-1.4M3.6 20.4 5 19"/>'),
    lock: I('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  };

  const NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { group: 'Organisation' },
    { id: 'courses', label: 'Courses & subjects', icon: 'graduation' },
    { id: 'schedule', label: 'Schedule', icon: 'clock' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'library', label: 'Materials', icon: 'book' },
    { id: 'recordings', label: 'Recordings', icon: 'microphone' },
    { group: 'Analyse' },
    { id: 'chat', label: 'Study chat', icon: 'chat' },
    { id: 'ideas', label: 'Study ideas', icon: 'bulb' },
    { id: 'graph', label: 'Study graph', icon: 'layers' },
    { id: 'questions', label: 'Question bank', icon: 'help' },
    { id: 'review', label: 'Review', icon: 'flashcards' },
    { id: 'deepResearch', label: 'Study research', icon: 'report' },
    { group: 'Write' },
    { id: 'notes', label: 'Notes', icon: 'notebook' },
    { group: '' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  const state = {
    view: 'home',
    browse: { subjectId: null, folderId: null },
    doc: null,
    material: null,
    recording: null,
    subject: 'sub-cell',
    question: 'q-transport',
    bankTab: 'questions',
    calView: 'month',
    calCursor: new Date(),
    note: 'note-doubts',
    settingsTab: 'ai',
    review: { step: 'setup', index: 0, revealed: false, kind: 'flashcards' },
    reportPage: 0,
    toggles: { local: true, whisper: true, reminders: true, telemetry: false },
  };
  let graphAnim = 0;

  // ---------- shared bits ----------
  const viewHead = (icon, kicker, title, sub, right) => `<div class="view-head">
    <div><p class="st-kicker">${kicker}</p><h1 class="view-title">${ICONS[icon]} ${title}</h1>${sub ? `<p class="view-sub">${sub}</p>` : ''}</div>${right || ''}</div>`;

  function subjectMark(sub, size) {
    if (!sub) return '';
    const px = size || 26;
    return `<span class="st-mark" style="width:${px}px;height:${px}px;background:${sub.color}22;color:${sub.color}">${ICONS[sub.icon] || ICONS.book}</span>`;
  }

  function markdown(md) {
    const lines = String(md).split('\n');
    let html = '', list = null;
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    lines.forEach((raw) => {
      const line = raw.trimEnd();
      if (/^# /.test(line)) { closeList(); html += `<h2 class="st-md-h1">${inline(line.slice(2))}</h2>`; return; }
      if (/^## /.test(line)) { closeList(); html += `<h3 class="st-md-h2">${inline(line.slice(3))}</h3>`; return; }
      if (/^> /.test(line)) { closeList(); html += `<blockquote class="quote-block">${inline(line.slice(2))}</blockquote>`; return; }
      if (/^- /.test(line)) { if (list !== 'ul') { closeList(); html += '<ul class="st-md-list">'; list = 'ul'; } html += `<li>${inline(line.slice(2))}</li>`; return; }
      if (/^\d+\. /.test(line)) { if (list !== 'ol') { closeList(); html += '<ol class="st-md-list">'; list = 'ol'; } html += `<li>${inline(line.replace(/^\d+\. /, ''))}</li>`; return; }
      if (!line.trim()) { closeList(); return; }
      closeList(); html += `<p>${inline(line)}</p>`;
    });
    closeList();
    return html;
  }

  // ---------- modals ----------
  function openModal(html, wide) {
    $('#modal-root').innerHTML = `<div class="modal-overlay" id="st-ov"><div class="modal${wide ? ' wide' : ''}">${html}</div></div>`;
    $('#st-ov').addEventListener('mousedown', (e) => { if (e.target.id === 'st-ov') closeModal(); });
  }
  const closeModal = () => { $('#modal-root').innerHTML = ''; };
  const modalHead = (title, sub) => `<div class="modal-head"><div><h3>${title}</h3>${sub ? `<p class="muted small" style="margin:4px 0 0">${sub}</p>` : ''}</div><button class="modal-x" onclick="GUI.close()">${ICONS.x}</button></div>`;

  function ideaModal(id) {
    const idea = S.ideas.find((x) => x.id === id); if (!idea) return;
    const rel = S.edges.filter((e) => e.from === id || e.to === id);
    openModal(`
      ${modalHead(esc(idea.label), `<span class="chip"><span class="dot" style="background:${IDEA_COLORS[idea.type]}"></span>${idea.type}</span> ${esc(subjectName(idea.subjectId))}`)}
      <p style="margin:10px 0 0">${esc(idea.statement)}</p>
      <div class="nav-group-label" style="padding-left:0">Evidence</div>
      <div class="quote-block">“${esc(idea.quote)}”<span class="src">${esc(idea.sourceTitle)} · extracted with ${Math.round(idea.confidence * 100)}% confidence</span></div>
      <div class="nav-group-label" style="padding-left:0">Relations (${rel.length})</div>
      ${rel.map((e) => {
        const other = S.ideas.find((x) => x.id === (e.from === id ? e.to : e.from));
        return `<div class="st-rel"><span class="chip" style="border-color:${EDGE_COLORS[e.type]}55;color:${EDGE_COLORS[e.type]}">${e.type}</span>
          <b class="st-rel-name">${e.from === id ? '→' : '←'} ${esc(other ? other.label : '')}</b>
          <span class="muted small st-rel-basis">${esc(e.basis)}</span></div>`;
      }).join('') || '<p class="muted small">No relations yet.</p>'}
      <div class="tag-row" style="margin-top:16px">
        <button class="btn" onclick="GUI.close();GUI.openDoc('${idea.source}')">${ICONS.notebook} Open the source</button>
        <button class="btn" onclick="GUI.close();window.go('graph')">${ICONS.layers} See it in the graph</button>
        <button class="btn primary" onclick="GUI.toast('In the app: turns this idea and its evidence into questions or flashcards you review before saving.')">${ICONS.wand} Make questions from this</button>
      </div>`, true);
  }

  // ---------- views ----------
  const VIEWS = {
    home() {
      const docs = S.docs.length, mats = S.materials.length, recs = S.recordings.length;
      const due = S.flashcards.length, exam = S.events.find((e) => e.type === 'exam');
      const dest = [
        ['graduation', 'Courses & subjects', 'Organise courses, subjects, topics and notes.', 'courses'],
        ['clock', 'Schedule', 'Lay your subjects out across days and time slots.', 'schedule'],
        ['calendar', 'Calendar', 'Plan events and let Nodi remind you.', 'calendar'],
        ['search', 'Search the workspace', 'Find fragments, pages and moments of audio.', 'search'],
        ['book', 'Study materials', 'Gather documents, recordings and sources.', 'library'],
        ['microphone', 'Recordings', 'Record a class, transcribe it and link notes.', 'recordings'],
        ['help', 'Question bank', 'Prepare questions, tests and exams.', 'questions'],
      ];
      return `
        <div class="st-hero">
          <p class="st-kicker">Study vault</p>
          <h1 class="st-hero-t">Your learning space</h1>
          <p class="st-hero-b">Organise materials and notes, build assessments and query everything you have studied — from a local, private workspace. No Zotero required.</p>
        </div>
        <div class="card st-next">
          <div class="list-title" style="justify-content:space-between;align-items:flex-start">
            <div><div class="nav-group-label" style="padding:0">Recommended next step</div><b style="font-size:16px">${exam ? `Biology final exam in ${exam.inDays} days` : 'Keep reviewing'}</b></div>
            <div class="tag-row">
              <button class="btn" onclick="window.go('chat')">${ICONS.chat} Study chat</button>
              <button class="btn" onclick="window.go('calendar')">${ICONS.calendar} Calendar</button>
              <button class="btn primary" onclick="window.go('review')">${ICONS.flashcards} Start a review</button>
            </div>
          </div>
          <p class="muted small" style="margin-top:8px">${due} card due today, and Ecology is your weakest subject (18% mastery against 62% in Cell biology). A focus session on energy flow is where the next 30 minutes pay off most.</p>
        </div>
        <div class="grid cols-3" style="margin-top:14px">
          <div class="card click" onclick="window.go('courses')"><b class="st-cardt">${ICONS.graduation} Active courses</b><div class="stat">1 <span class="muted" style="font-size:13px;font-weight:400">course</span></div><div class="st-mini"><span><b>${S.subjects.length}</b> subjects</span><span><b>${S.topics.length}</b> topics</span></div></div>
          <div class="card click" onclick="window.go('library')"><b class="st-cardt">${ICONS.book} Materials</b><div class="stat">${docs + mats} <span class="muted" style="font-size:13px;font-weight:400">items</span></div><div class="st-mini"><span><b>${docs}</b> notes</span><span><b>${mats}</b> imported</span></div></div>
          <div class="card click" onclick="window.go('recordings')"><b class="st-cardt">${ICONS.microphone} Recordings</b><div class="stat">${recs} <span class="muted" style="font-size:13px;font-weight:400">class</span></div><div class="st-mini"><span><b>1</b> transcript</span><span><b>${bytes(S.recordings[0].sizeBytes)}</b> local</span></div></div>
        </div>

        <div class="nav-group-label" style="padding-left:0;margin-top:20px">Start here</div>
        <div class="grid cols-3">
          ${dest.map(([icon, title, body, view]) => `<div class="card click st-dest" onclick="window.go('${view}')">
            <span class="st-dest-ic">${ICONS[icon]}</span>
            <b style="display:block;margin-top:10px;font-size:13.5px">${title}</b>
            <span class="muted small" style="display:block;margin-top:4px">${body}</span></div>`).join('')}
        </div>

        <div class="card" style="margin-top:16px">
          <div class="list-title" style="justify-content:space-between"><b class="st-cardt">${ICONS.clock} Recent activity</b><button class="btn ghost small" onclick="window.go('library')">See materials</button></div>
          ${S.docs.map((d) => `<div class="st-recent" onclick="GUI.openDoc('${d.id}')">${ICONS.notebook}<span class="st-recent-t"><b>${esc(d.title)}</b><span class="muted small">${esc(d.kind)} · ${d.shortId}</span></span><span class="muted small">${esc(d.updatedAt)}</span></div>`).join('')}
        </div>`;
    },

    courses() {
      const sub = state.browse.subjectId ? subjectById(state.browse.subjectId) : null;
      const crumbs = `<div class="st-crumbs">
        <button class="st-crumb" onclick="GUI.browse(null)">${esc(S.course.name)}</button>
        ${sub ? `<span class="st-crumb-sep">/</span><button class="st-crumb active">${esc(sub.name)}</button>` : ''}</div>`;

      const rows = [];
      if (!sub) {
        S.subjects.forEach((x) => rows.push({ kind: 'Subject', id: x.id, name: x.name, desc: x.description, color: x.color, icon: x.icon,
          meta: `${S.topics.filter((t) => t.subjectId === x.id).length} topics · ${S.docs.filter((d) => d.subjectId === x.id).length} notes`, open: `GUI.browse('${x.id}')` }));
      } else {
        S.folders.filter((f) => f.subjectId === sub.id).forEach((f) => rows.push({ kind: 'Folder', id: f.id, name: f.name, desc: f.description, color: f.color, icon: 'folder',
          meta: `${S.topics.filter((t) => t.folderId === f.id).length} topics`, open: `GUI.toast('In the app: opens the folder and its topics.')` }));
        S.topics.filter((t) => t.subjectId === sub.id).forEach((t) => rows.push({ kind: 'Topic', id: t.id, name: t.name, desc: t.description, color: t.color, icon: 'hash',
          meta: `${S.docs.filter((d) => d.topicId === t.id).length} notes · ${S.materials.filter((m) => m.topicId === t.id).length} materials`, open: `GUI.toast('In the app: filters everything placed under this topic.')` }));
      }

      const docs = S.docs.filter((d) => !sub || d.subjectId === sub.id);

      return `${viewHead('graduation', 'Organisation', 'Courses &amp; subjects', 'Course → subject → folder → topic → note. The hierarchy keeps each subject\'s context apart — the idea map and the chat never mix them.', `<div class="tag-row">
        <button class="btn" onclick="GUI.toast('In the app: reusable templates — e.g. a Cornell note — for new documents.')">${ICONS.notebook} Templates</button>
        <button class="btn primary" onclick="GUI.toast('In the app: creates a course, subject, folder, topic or note, with its own icon, colour and year.')">${ICONS.plus} New</button></div>`)}
        ${crumbs}
        <div class="card" style="padding:0;overflow:hidden">
          <table class="tbl">
            <thead><tr><th>Name</th><th style="width:110px">Type</th><th style="width:210px">Content</th><th style="width:130px;text-align:right">Actions</th></tr></thead>
            <tbody>${rows.map((r) => `<tr class="rowlink" onclick="${r.open}">
              <td><div class="st-row-name">${subjectMark({ color: r.color, icon: r.icon }, 30)}<span class="st-row-txt"><b>${esc(r.name)}</b><span class="muted small">${esc(r.desc || 'No description')}</span></span></div></td>
              <td class="muted">${r.kind}</td><td style="color:#2dd4bf">${esc(r.meta)}</td>
              <td style="text-align:right"><span class="st-actions">
                <button class="st-ib" title="Rename" onclick="event.stopPropagation();GUI.toast('In the app: rename, restyle or re-describe this item.')">${ICONS.edit}</button>
                <button class="st-ib" title="Move" onclick="event.stopPropagation();GUI.toast('In the app: move it to another location in the hierarchy.')">${ICONS.folder}</button>
                <button class="st-ib danger" title="Delete" onclick="event.stopPropagation();GUI.toast('In the app: deletes it, with a confirmation step.')">${ICONS.trash}</button>
              </span></td></tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="nav-group-label" style="padding-left:0;margin-top:18px">Notes ${sub ? `in ${esc(sub.name)}` : ''} (${docs.length})</div>
        ${docs.map((d) => {
          const t = topicById(d.topicId);
          return `<div class="list-row" onclick="GUI.openDoc('${d.id}')">
            <span class="st-doc-ic">${ICONS.notebook}</span>
            <div class="list-main">
              <div class="list-title"><b>${esc(d.title)}</b><span class="chip">${esc(d.kind)}</span>${d.pinned ? '<span class="chip st-teal">Pinned</span>' : ''}${d.tags.map((x) => `<span class="chip st-amber">${esc(x)}</span>`).join('')}</div>
              <div class="list-desc">${esc(subjectName(d.subjectId))}${t ? ` · ${esc(t.name)}` : ''} · updated ${esc(d.updatedAt)}</div>
            </div></div>`;
        }).join('')}`;
    },

    schedule() {
      const periods = (section) => S.schedule.periods.filter((p) => p.section === section);
      const cellAt = (day, periodId) => S.schedule.cells.find((c) => c.day === day && c.periodId === periodId);
      const row = (p, section, first) => `<tr${section === 'afternoon' && first ? ' class="st-sec-break"' : ''}>
        <th class="st-period">
          <span class="st-secbadge ${section}">${section === 'morning' ? 'Morning' : 'Afternoon'}</span>
          <span class="st-period-t"><b>${esc(p.label)}</b><span class="muted small">${p.start} – ${p.end}</span></span>
        </th>
        ${DAYS.map((day) => {
          const cell = cellAt(day, p.id); const sub = cell && cell.subjectId ? subjectById(cell.subjectId) : null;
          if (sub) return `<td><button class="st-cell has" style="--sc:${sub.color}" onclick="GUI.toast('In the app: pick a subject or type a standalone activity for this slot.')">${subjectMark(sub, 24)}<span>${esc(sub.name)}</span></button></td>`;
          if (cell && cell.activity) return `<td><button class="st-cell has" style="--sc:#818cf8" onclick="GUI.toast('In the app: a standalone activity — tutoring, gym, library.')"><span class="st-mark" style="width:24px;height:24px;background:rgba(129,140,248,0.18);color:#a5b4fc">${ICONS.clock}</span><span>${esc(cell.activity)}</span></button></td>`;
          return `<td><button class="st-cell" onclick="GUI.toast('In the app: pick a subject or type a standalone activity for this slot.')">${ICONS.plus} Add item</button></td>`;
        }).join('')}</tr>`;

      return `${viewHead('clock', 'Organisation', 'Schedule', 'Lay your subjects out across days and morning or afternoon slots. The colour and icon you give a subject are reused everywhere in the vault.', `<div class="tag-row">
        <button class="btn" onclick="GUI.toast('In the app: adds a morning time slot.')">${ICONS.sun} Add morning slot</button>
        <button class="btn" onclick="GUI.toast('In the app: adds an afternoon time slot.')">${ICONS.plus} Add afternoon slot</button></div>`)}
        <div class="card" style="padding:0;overflow:auto">
          <table class="st-grid">
            <thead><tr><th class="st-period-h">Time slot</th>${DAYS.map((d) => `<th>${DAY_LABEL[d]}</th>`).join('')}</tr></thead>
            <tbody>
              ${periods('morning').map((p) => row(p, 'morning', false)).join('')}
              ${periods('afternoon').map((p, i) => row(p, 'afternoon', i === 0)).join('')}
            </tbody>
          </table>
        </div>
        <div class="card" style="margin-top:14px">
          <b class="st-cardt">Subject appearance</b>
          <p class="muted small" style="margin:4px 0 0">Changes also apply in Courses &amp; subjects.</p>
          <div class="grid cols-2" style="margin-top:12px">
            ${S.subjects.map((s) => `<div class="st-style" style="--sc:${s.color}">
              ${subjectMark(s, 30)}<b style="flex:1">${esc(s.name)}</b>
              <span class="st-swatch" style="background:${s.color}" title="${s.color}"></span></div>`).join('')}
          </div>
        </div>`;
    },

    calendar() {
      const cursor = state.calCursor;
      const events = S.events.map((e) => ({ ...e, date: dayFrom(e.inDays) }));
      const byDay = (d) => events.filter((e) => sameDay(e.date, d));
      const monthGrid = () => {
        const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        const start = new Date(first); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
      };
      const chip = (e) => `<button class="st-evchip" onclick="event.stopPropagation();GUI.event('${e.id}')"><span class="dot" style="background:${EVENT_COLORS[e.type]}"></span><span class="st-evchip-t">${esc(e.title)}</span></button>`;
      const title = state.calView === 'year' ? String(cursor.getFullYear())
        : cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i); return d; });

      return `${viewHead('calendar', 'Organisation', 'Calendar', 'Plan classes, deadlines, study sessions and exams. Reminders are local — Nodi tells you even if the app has been closed.', `<button class="btn primary" onclick="GUI.toast('In the app: create an event with type, icon, reminder and a link, and push it to iCloud or Google Calendar.')">${ICONS.plus} New event</button>`)}
        <div class="st-calbar">
          <button class="btn ghost" onclick="GUI.calMove(-1)">${ICONS.chevronLeft}</button>
          <button class="btn ghost" onclick="GUI.calToday()">Today</button>
          <button class="btn ghost" onclick="GUI.calMove(1)">${ICONS.chevronRight}</button>
          <h2 class="st-caltitle">${esc(title)}</h2>
          <div class="st-segments">
            ${['month', 'week', 'year'].map((v) => `<button class="st-seg ${state.calView === v ? 'active' : ''}" onclick="GUI.calView('${v}')">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
          </div>
        </div>
        ${state.calView === 'month' ? `<div class="card" style="padding:0;overflow:hidden">
          <div class="st-calhead">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span>${d}</span>`).join('')}</div>
          <div class="st-calgrid">${monthGrid().map((d) => `<button class="st-calcell ${d.getMonth() !== cursor.getMonth() ? 'off' : ''}" onclick="GUI.toast('In the app: click a day to create an event on it.')">
            <span class="st-caldate ${sameDay(d, new Date()) ? 'today' : ''}">${d.getDate()}</span>
            <span class="st-calevs">${byDay(d).map(chip).join('')}</span></button>`).join('')}</div>
        </div>` : state.calView === 'week' ? `<div class="card" style="padding:0;overflow:auto">
          <div class="st-week">${weekDays.map((d) => `<section>
            <div class="st-weekhead"><span class="muted small">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(d.getDay() + 6) % 7]}</span><strong class="${sameDay(d, new Date()) ? 'today' : ''}">${d.getDate()}</strong></div>
            <div class="st-weekbody">${byDay(d).map((e) => `<button class="st-weekev" onclick="GUI.event('${e.id}')"><b>${esc(e.title)}</b><span class="muted small">${EVENT_LABEL[e.type]}</span></button>`).join('')}</div>
          </section>`).join('')}</div>
        </div>` : `<div class="grid cols-3">${Array.from({ length: 12 }, (_, m) => new Date(cursor.getFullYear(), m, 1)).map((month) => {
          const count = events.filter((e) => e.date.getMonth() === month.getMonth() && e.date.getFullYear() === month.getFullYear()).length;
          return `<div class="card click" onclick="GUI.calMonth(${month.getMonth()})"><b style="text-transform:capitalize">${month.toLocaleDateString('en-GB', { month: 'long' })}</b>
            <p class="muted small" style="margin:6px 0 0">${count ? `${count} event${count > 1 ? 's' : ''}` : 'No events'}</p>
            ${count ? `<div class="tag-row" style="margin-top:8px">${events.filter((e) => e.date.getMonth() === month.getMonth()).map((e) => `<span class="chip" style="border-color:${EVENT_COLORS[e.type]}55;color:${EVENT_COLORS[e.type]}">${EVENT_LABEL[e.type]}</span>`).join('')}</div>` : ''}</div>`;
        }).join('')}</div>`}
        <div class="nav-group-label" style="padding-left:0;margin-top:18px">Upcoming</div>
        ${events.sort((a, b) => a.inDays - b.inDays).map((e) => `<div class="list-row" onclick="GUI.event('${e.id}')">
          <span class="list-dot" style="background:${EVENT_COLORS[e.type]}"></span>
          <div class="list-main"><div class="list-title"><b>${esc(e.title)}</b><span class="chip">${EVENT_LABEL[e.type]}</span>${e.reminder ? `<span class="chip st-teal">Reminder · ${esc(e.reminder)}</span>` : ''}</div>
          <div class="list-meta"><span>${fmtDate(e.date)}</span><span>in ${e.inDays} days</span><span>${esc(subjectName(e.subjectId))}</span></div></div></div>`).join('')}`;
    },

    search() {
      return `${viewHead('search', 'Organisation', 'Search the workspace', 'One local index over notes, imported materials, transcripts, questions and exams — keyword and semantic, with the exact page or timestamp.')}
        <div class="st-searchbar">
          <span class="st-searchic">${ICONS.search}</span>
          <input class="search-input st-searchinput" id="st-search" placeholder="Search notes, materials, transcripts, questions and exams…" autocomplete="off"/>
        </div>
        <div class="tag-row" style="margin-top:10px">
          ${S.savedSearches.map((s) => `<span class="chip link" onclick="GUI.runSearch('${esc(s.query)}')">${ICONS.star} ${esc(s.name)}</span>`).join('')}
          <span class="chip st-index">${ICONS.check} Index ready · 6/6 semantic fragments</span>
        </div>
        <div id="st-results" style="margin-top:16px"></div>`;
    },

    library() {
      return `${viewHead('book', 'Organisation', 'Study materials', 'Import PDFs, documents, slides, audio and more. Everything is extracted, indexed and placed in the hierarchy. Zotero is an option here, never a requirement.', `<div class="tag-row">
        <button class="btn" onclick="GUI.toast('In the app: import from a Zotero collection — optional, this vault does not need it.')">${ICONS.external} From Zotero</button>
        <button class="btn primary" onclick="GUI.toast('In the app: drop files or a folder, fill in metadata and pick one or more locations. OCR is available for scans.')">${ICONS.upload} Add materials</button></div>`)}
        <div class="card" style="padding:0;overflow:auto">
          <table class="tbl">
            <thead><tr><th>Material</th><th style="width:120px">Subject</th><th style="width:130px">Topic</th><th style="width:100px">State</th><th style="width:80px">Format</th><th style="width:90px">Size</th><th style="width:110px;text-align:right">Actions</th></tr></thead>
            <tbody>
              ${S.materials.map((m) => `<tr class="rowlink" onclick="GUI.openMaterial('${m.id}')">
                <td><div class="st-row-name"><span class="st-doc-ic">${ICONS.book}</span><span class="st-row-txt"><b>${esc(m.title)}</b><span class="muted small">${esc(m.fileName)}</span><span class="small" style="color:#2dd4bf">${esc(m.indexStatus)} · ${esc(m.embedding)}</span></span></div></td>
                <td class="muted">${esc(subjectName(m.subjectId))}</td><td class="muted">${esc((topicById(m.topicId) || {}).name || '—')}</td>
                <td><span class="chip st-teal">${esc(m.readState)}</span></td><td class="muted">${esc(m.extension)}</td><td class="muted">${bytes(m.sizeBytes)}</td>
                <td style="text-align:right"><span class="st-actions">
                  <button class="st-ib" title="Re-index" onclick="event.stopPropagation();GUI.toast('In the app: re-extracts the text and rebuilds the embeddings for this material.')">${ICONS.refresh}</button>
                  <button class="st-ib" title="Download" onclick="event.stopPropagation();GUI.toast('In the app: the original file is stored in the vault and downloadable.')">${ICONS.download}</button>
                  <button class="st-ib danger" title="Trash" onclick="event.stopPropagation();GUI.toast('In the app: moves the material to the trash.')">${ICONS.trash}</button>
                </span></td></tr>`).join('')}
              ${S.docs.map((d) => `<tr class="rowlink" onclick="GUI.openDoc('${d.id}')">
                <td><div class="st-row-name"><span class="st-doc-ic">${ICONS.notebook}</span><span class="st-row-txt"><b>${esc(d.title)}</b><span class="muted small">Written in Nodus · ${d.shortId}</span><span class="small" style="color:#2dd4bf">Indexed</span></span></div></td>
                <td class="muted">${esc(subjectName(d.subjectId))}</td><td class="muted">${esc((topicById(d.topicId) || {}).name || '—')}</td>
                <td><span class="chip">${esc(d.kind)}</span></td><td class="muted">MD</td><td class="muted">—</td>
                <td style="text-align:right"><span class="st-actions"><button class="st-ib" title="Open" onclick="event.stopPropagation();GUI.openDoc('${d.id}')">${ICONS.external}</button></span></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="muted small" style="margin-top:12px">${ICONS.lock} Files, extracted text and embeddings live inside this vault on your disk. Nothing is uploaded unless you point a cloud model at it yourself.</p>`;
    },

    recordings() {
      return `${viewHead('microphone', 'Local audio', 'Recordings &amp; transcripts', 'Record a class or import audio, transcribe it with local Whisper, and jump from any line of the transcript back to the exact second.', `<div class="tag-row">
        <button class="btn" onclick="GUI.toast('In the app: import an audio file you already have.')">${ICONS.upload} Upload audio</button>
        <button class="btn primary" onclick="GUI.toast('In the app: records the class with a live level meter, pause and long-silence trimming.')">${ICONS.microphone} Record class</button></div>`)}
        <div class="card" style="padding:0;overflow:auto">
          <table class="tbl">
            <thead><tr><th>Recording</th><th style="width:130px">Subject</th><th style="width:130px">Topic</th><th style="width:100px">Date</th><th style="width:90px">Length</th><th style="width:90px">State</th><th style="width:90px">Size</th></tr></thead>
            <tbody>${S.recordings.map((r) => `<tr class="rowlink" onclick="GUI.openRecording('${r.id}')">
              <td><div class="st-row-name"><span class="st-doc-ic">${ICONS.microphone}</span><span class="st-row-txt"><b>${esc(r.title)}</b><span class="muted small">${esc(r.fileName)} · ${esc(r.session)}</span></span></div></td>
              <td class="muted">${esc(subjectName(r.subjectId))}</td><td class="muted">${esc((topicById(r.topicId) || {}).name || '—')}</td>
              <td class="muted">${esc(r.date)}</td><td class="muted">${mmss(r.durationSeconds)}</td>
              <td><span class="chip st-teal">${esc(r.status)}</span></td><td class="muted">${bytes(r.sizeBytes)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="muted small" style="margin-top:12px">${ICONS.lock} Audio and Whisper stay in this vault. Large audio is excluded from sync; you can delete the audio and keep the transcript.</p>`;
    },

    chat() {
      const c = S.chat;
      return `<div class="st-chat">
        <aside class="st-chat-hist">
          <div class="st-chat-histhead"><b>Chat history</b></div>
          <button class="btn primary" style="width:100%;justify-content:center" onclick="GUI.toast('In the app: starts a new conversation. Every chat keeps its own scope and model.')">${ICONS.plus} New chat</button>
          <div class="st-conv active"><b>${esc(c.title)}</b><span class="muted small">${c.messages.length} messages · now</span></div>
          <div class="st-conv"><b>Gross vs net productivity</b><span class="muted small">4 messages · yesterday</span></div>
        </aside>
        <main class="st-chat-main">
          <header class="st-chat-head">
            <span class="st-chat-ic">${ICONS.chat}</span>
            <div style="flex:1;min-width:0"><b>${esc(c.title)}</b><p class="muted small" style="margin:1px 0 0">Ask your materials and notes, with citations you can open.</p></div>
            <span class="chip">${ICONS.lock} llama3.1 · local</span>
          </header>
          <div class="st-chat-msgs">
            ${c.messages.map((m) => m.who === 'user'
              ? `<div class="msg user">${esc(m.text)}</div>`
              : `<article class="msg ai st-chat-ai">${markdown(m.text)}
                  ${m.citations ? `<div class="st-cites">${m.citations.map((ct) => `<button class="cite" onclick="GUI.citation('${ct.kind}','${ct.targetId}')">${ct.id} · ${esc(ct.title)}</button>`).join('')}</div>` : ''}
                </article>`).join('')}
            <div id="st-chat-live"></div>
          </div>
          <footer class="st-chat-input">
            <input id="st-chat-inp" placeholder="Ask, compare or summarise your materials…" autocomplete="off"/>
            <button class="btn primary" onclick="GUI.chatSend()">Send</button>
          </footer>
        </main>
        <aside class="st-chat-ctx">
          <b class="st-ctx-t">Scope &amp; sources</b>
          <label class="st-ctx-l">Scope</label>
          <div class="st-ctx-scope">Whole library</div>
          <label class="st-ctx-l">Sources in scope</label>
          ${[...S.docs.map((d) => ({ t: d.title, s: 'Note · ' + subjectName(d.subjectId) })), ...S.materials.map((m) => ({ t: m.title, s: 'Material · ' + subjectName(m.subjectId) })), ...S.recordings.map((r) => ({ t: r.title, s: 'Transcript · ' + subjectName(r.subjectId) }))]
            .map((x) => `<div class="st-ctx-src"><span class="st-ctx-cb">${ICONS.check}</span><span class="st-ctx-txt"><b>${esc(x.t)}</b><span class="muted small">${esc(x.s)}</span></span></div>`).join('')}
          <p class="st-ctx-note">Answers are grounded in this vault's content. Citations open the original note, material or the exact second of the recording.</p>
        </aside>
      </div>`;
    },

    ideas() {
      const ideas = S.ideas.filter((i) => i.subjectId === state.subject);
      const types = [...new Set(ideas.map((i) => i.type))];
      return `${viewHead('bulb', 'Guided learning', 'Study ideas', 'Concepts pulled out of your own materials, each with the verbatim line it came from. Subject isolation means Cell biology and Ecology never bleed into each other.', `<div class="tag-row">
        ${S.subjects.map((s) => `<button class="pill ${state.subject === s.id ? 'active' : ''}" onclick="GUI.setSubject('${s.id}')">${esc(s.name)}</button>`).join('')}
        <button class="btn primary" onclick="GUI.toast('In the app: extracts concepts and their relations from the material you choose, always with the source quote.')">${ICONS.wand} Extract ideas</button></div>`)}
        <div class="tag-row" style="margin-bottom:14px">
          <span class="chip">${ideas.length} ideas</span>
          <span class="chip">${S.edges.filter((e) => e.subjectId === state.subject).length} relations</span>
          ${types.map((t) => `<span class="chip"><span class="dot" style="background:${IDEA_COLORS[t]}"></span>${t}</span>`).join('')}
        </div>
        ${ideas.map((i) => {
          const rel = S.edges.filter((e) => e.from === i.id || e.to === i.id);
          return `<div class="list-row" onclick="GUI.idea('${i.id}')">
            <span class="list-dot" style="background:${IDEA_COLORS[i.type]}"></span>
            <div class="list-main">
              <div class="list-title"><b>${esc(i.label)}</b><span class="chip" style="border-color:${IDEA_COLORS[i.type]}55;color:${IDEA_COLORS[i.type]}">${i.type}</span></div>
              <div class="list-desc">${esc(i.statement)}</div>
              <div class="list-meta"><span>${ICONS.notebook} <b>${esc(i.sourceTitle)}</b></span><span>${rel.length} relation${rel.length === 1 ? '' : 's'}</span><span>${Math.round(i.confidence * 100)}% confidence</span></div>
            </div></div>`;
        }).join('')}`;
    },

    graph() {
      return `${viewHead('layers', 'Guided learning', 'Study graph', 'The same ideas as a map. Edges are typed — supports, contrasts, applies, causes — so you can see how a subject actually hangs together.', `<div class="tag-row">
        ${S.subjects.map((s) => `<button class="pill ${state.subject === s.id ? 'active' : ''}" onclick="GUI.setSubject('${s.id}')">${esc(s.name)}</button>`).join('')}</div>`)}
        <div class="graph-wrap">
          <canvas id="st-graph"></canvas>
          <div class="legend">
            <div class="row"><span class="dot" style="background:#22d3ee"></span> concept</div>
            <div class="row"><span class="dot" style="background:#fbbf24"></span> principle</div>
            <div class="row"><span class="dot" style="background:#818cf8"></span> process</div>
            <div class="row"><span class="dot" style="background:#f472b6"></span> consequence</div>
            <div class="row" style="margin-top:6px"><span class="line" style="background:#34d399"></span> supports</div>
            <div class="row"><span class="line" style="background:#f87171"></span> contrasts</div>
            <div class="row"><span class="line" style="background:#a78bfa"></span> applies</div>
            <div class="row"><span class="line" style="background:#fbbf24"></span> causes</div>
          </div>
        </div>
        <p class="muted small" style="margin-top:10px">Click a node to open the idea, its evidence and its relations.</p>`;
    },

    questions() {
      const q = S.questions.find((x) => x.id === state.question) || S.questions[0];
      const card = S.flashcards[0];
      return `${viewHead('help', 'Assessment', 'Question bank', 'Questions, tests, exams and flashcards built from specific content — every one carries the excerpt that justifies it, and nothing is used to assess you until you approve it.', `<div class="tag-row">
        <button class="btn" onclick="GUI.toast('In the app: build a test or an exam from the questions you select.')">${ICONS.plus} New assessment</button>
        <button class="btn primary" onclick="GUI.toast('In the app: generates questions from the material you pick — you review each one before it is approved.')">${ICONS.wand} Generate questions</button></div>`)}
        <div class="pills">
          <button class="pill ${state.bankTab === 'questions' ? 'active' : ''}" onclick="GUI.bankTab('questions')">Questions (${S.questions.length})</button>
          <button class="pill ${state.bankTab === 'cards' ? 'active' : ''}" onclick="GUI.bankTab('cards')">Flashcards (${S.flashcards.length})</button>
        </div>
        ${state.bankTab === 'questions' ? `
        <div class="card" style="padding:0;overflow:auto">
          <table class="tbl">
            <thead><tr><th>Question</th><th style="width:120px">Type</th><th style="width:100px">Difficulty</th><th style="width:100px">Status</th><th style="width:120px">Subject</th><th style="width:180px">Source</th></tr></thead>
            <tbody>${S.questions.map((x) => `<tr class="rowlink" onclick="GUI.selectQuestion('${x.id}')">
              <td><b>${esc(x.prompt)}</b></td><td class="muted">${esc(x.type)}</td><td class="muted">${esc(x.difficulty)}</td>
              <td><span class="chip st-teal">${esc(x.status)}</span></td><td class="muted">${esc(subjectName(x.subjectId))}</td><td class="muted small">${esc(x.sourceTitle)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="card" style="margin-top:14px">
          <div class="list-title" style="justify-content:space-between"><b class="st-cardt">${ICONS.help} ${esc(q.prompt)}</b><span class="chip">${esc(q.level)}</span></div>
          <div class="st-opts">${q.options.map((o) => `<div class="quiz-opt ${o === q.answer ? 'correct' : ''}">${o === q.answer ? ICONS.check : ''} ${esc(o)}</div>`).join('')}</div>
          <div class="nav-group-label" style="padding-left:0">Answer &amp; explanation</div>
          <p style="color:#6ee7b7;margin:0">${esc(q.answer)}</p>
          <p class="muted small" style="margin:6px 0 0">${esc(q.explanation)}</p>
          <div class="nav-group-label" style="padding-left:0">Justifying source</div>
          <p class="muted small" style="margin:0">${esc(q.sourceTitle)}</p>
          <div class="quote-block">${esc(q.excerpt)}</div>
          <div class="st-attempt">
            <div class="list-title" style="justify-content:space-between"><b style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#a5b4fc">Last attempt</b><span class="muted small">${esc(q.lastAttempt.at)}</span></div>
            <p style="margin:8px 0 0">${esc(q.lastAttempt.response)}</p>
            <div class="list-title" style="margin-top:8px"><strong style="font-size:17px;color:#c7d2fe">${q.lastAttempt.score.toFixed(2)} / ${q.lastAttempt.max.toFixed(2)}</strong><span class="muted small">Last score</span></div>
            <p class="muted small" style="margin:6px 0 0">${esc(q.lastAttempt.feedback)}</p>
          </div>
          <div class="tag-row" style="margin-top:14px">
            <button class="btn" onclick="GUI.openDoc('${q.sourceId}')">${ICONS.notebook} Open the source</button>
            <button class="btn" onclick="GUI.toast('In the app: turns approved questions into flashcards with spaced repetition.')">${ICONS.flashcards} Make a flashcard</button>
            <button class="btn primary" onclick="window.go('review')">${ICONS.play} Practise this</button>
          </div>
        </div>` : `
        <div class="card">
          <div class="st-fc">
            <p class="st-fc-side">Front</p><h2 class="st-fc-front">${esc(card.front)}</h2>
            <div class="st-fc-div"></div>
            <p class="st-fc-side back">Back</p><p class="st-fc-back">${esc(card.back)}</p>
            <p class="muted small" style="margin-top:16px">Hint: ${esc(card.hint)}</p>
          </div>
          <div class="grid cols-3" style="margin-top:14px">
            <div class="card"><span class="muted small">Ease factor</span><div class="stat">${card.srs.ease}</div></div>
            <div class="card"><span class="muted small">Interval</span><div class="stat">${card.srs.intervalDays} <span class="muted" style="font-size:13px;font-weight:400">days</span></div></div>
            <div class="card"><span class="muted small">Due</span><div class="stat" style="font-size:20px;padding-top:6px">${esc(card.srs.due)}</div></div>
          </div>
          <p class="muted small" style="margin-top:12px">Built from the approved question above · ${esc(subjectName(card.subjectId))} · ${esc((topicById(card.topicId) || {}).name || '')}</p>
        </div>`}`;
    },

    review() {
      const r = state.review;
      const items = r.kind === 'flashcards' ? S.flashcards.map((c) => ({ front: c.front, back: c.back })) : S.questions.map((q) => ({ front: q.prompt, back: q.answer }));
      const item = items[Math.min(r.index, items.length - 1)];
      return `${viewHead('flashcards', 'Guided learning', 'Review', 'Reopen what you already have or generate a fresh session without leaving the review — a three-step wizard, then the cards.')}
        ${r.step === 'setup' ? `<div class="card st-wizard">
          <div class="st-steps">${[1, 2, 3].map((n) => `<span class="st-step">${n}</span>`).join('')}</div>
          <div class="grid cols-2">
            <label class="st-field">Review mode
              <select class="select" onchange="GUI.reviewKind(this.value)">
                <option value="flashcards" ${r.kind === 'flashcards' ? 'selected' : ''}>Flashcards</option>
                <option value="test" ${r.kind === 'test' ? 'selected' : ''}>Test</option>
                <option value="exam">Exam</option>
              </select></label>
            <label class="st-field">Subject<select class="select"><option>All subjects</option>${S.subjects.map((s) => `<option>${esc(s.name)}</option>`).join('')}</select></label>
            <label class="st-field">Topic<select class="select"><option>All topics</option>${S.topics.map((t) => `<option>${esc(t.name)}</option>`).join('')}</select></label>
            <label class="st-field">Saved group<select class="select"><option>Any group</option></select></label>
            <label class="st-field">Content<select class="select"><option>Reuse saved content</option><option>Create new content with AI</option></select></label>
            <label class="st-field">Number of items<input class="select" value="${items.length}" readonly/></label>
          </div>
          <p class="muted small" style="margin-top:14px">${items.length} item${items.length === 1 ? '' : 's'} available</p>
          <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" onclick="GUI.reviewStart()">${ICONS.play} Start review</button></div>
        </div>` : r.step === 'session' ? `<div class="st-session">
          <div class="st-progress"><span class="muted small">${r.index + 1} / ${items.length}</span><div class="progress" style="flex:1;margin:0 12px"><div style="width:${((r.index + 1) / items.length) * 100}%"></div></div><button class="btn ghost" onclick="GUI.reviewReset()">Exit</button></div>
          <button class="st-card" onclick="GUI.reveal()">
            <p class="st-card-front">${esc(item.front)}</p>
            ${r.revealed ? `<div class="st-fc-div"></div><p class="st-card-back">${esc(item.back)}</p>` : '<p class="muted small" style="margin-top:40px">Click to show the answer</p>'}
          </button>
          ${r.revealed ? (r.kind === 'flashcards' ? `<div class="st-rates">${['Again', 'Hard', 'Good', 'Easy'].map((l) => `<button class="btn" style="justify-content:center" onclick="GUI.reviewNext()">${l}</button>`).join('')}</div>`
            : `<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn primary" onclick="GUI.reviewNext()">Next ${ICONS.chevronRight}</button></div>`) : ''}
        </div>` : `<div class="card st-done">${ICONS.check}<h2 style="margin:12px 0 0">Review complete</h2><p class="muted" style="margin:6px 0 0">${items.length} item${items.length === 1 ? '' : 's'} reviewed</p>
          <button class="btn primary" style="margin-top:18px" onclick="GUI.reviewReset()">Create another review</button></div>`}
        <div class="grid cols-2" style="margin-top:18px">
          ${S.mastery.map((m) => `<div class="card"><div class="list-title" style="justify-content:space-between"><b>${esc(m.scope)}</b><span class="chip">${esc(m.status)}</span></div>
            <div class="progress" style="margin-top:10px;height:7px"><div style="width:${m.mastery * 100}%;background:${m.mastery > 0.5 ? '#2dd4bf' : '#fbbf24'}"></div></div>
            <div class="list-meta" style="margin-top:8px"><span><b>${Math.round(m.mastery * 100)}%</b> mastery</span><span><b>${Math.round(m.confidence * 100)}%</b> confidence</span><span><b>${m.evidence}</b> evidence</span></div></div>`).join('')}
        </div>`;
    },

    deepResearch() {
      const r = S.report, page = r.pages[state.reportPage];
      return `<div class="report">
        <button class="back-btn" onclick="window.go('home')">${ICONS.chevronLeft} Back</button>
        <div class="report-title"><p class="st-kicker" style="text-align:center">Study research</p><h2>${esc(r.title)}</h2><p class="muted small">${esc(r.subtitle)}</p></div>
        <div class="page-tabs">${r.pages.map((p, i) => `<button class="pill ${state.reportPage === i ? 'active' : ''}" onclick="GUI.reportPage(${i})">${i + 1}. ${esc(p.title)}</button>`).join('')}</div>
        <div class="report-body">
          <h2>${esc(page.title)}</h2>
          ${page.body.map((p) => `<p>${esc(p)}</p>`).join('')}
          <div class="cite-row">${page.cites.map((c) => `<span class="cite" onclick="GUI.toast('${esc(c.title).replace(/'/g, '')}')">${c.id} ${esc(c.title)}</span>`).join('')}</div>
        </div>
        <div class="page-nav">
          <button class="btn" ${state.reportPage === 0 ? 'disabled' : ''} onclick="GUI.reportPage(${state.reportPage - 1})">${ICONS.chevronLeft} Previous</button>
          <span class="muted small">Page ${state.reportPage + 1} of ${r.pages.length}</span>
          <button class="btn" ${state.reportPage === r.pages.length - 1 ? 'disabled' : ''} onclick="GUI.reportPage(${state.reportPage + 1})">Next ${ICONS.chevronRight}</button>
        </div>
        <div class="reader-toolbar">
          <button class="btn" onclick="GUI.toast('In the app: exports the brief to Markdown, PDF or DOCX.')">${ICONS.download} Export</button>
          <button class="btn" onclick="GUI.toast('In the app: narrates the brief with a local voice (Piper or Kokoro).')">${ICONS.play} Listen</button>
          <button class="btn primary" onclick="GUI.toast('In the app: writes a new brief over the sources and scope you pick.')">${ICONS.wand} New brief</button>
        </div>
      </div>`;
    },

    notes() {
      const n = S.notes.find((x) => x.id === state.note) || S.notes[0];
      return `${viewHead('notebook', 'Write', 'Notes', 'Free-form scratch space that lives in the vault, alongside the structured material.')}
        <div class="notes-grid">
          <div class="card">
            ${S.notes.map((x) => `<div class="note-item ${x.id === n.id ? 'active' : ''}" onclick="GUI.note('${x.id}')">${ICONS.notebook}<span>${esc(x.title)}</span></div>`).join('')}
            <button class="btn" style="width:100%;justify-content:center;margin-top:8px" onclick="GUI.toast('In the app: creates a new note.')">${ICONS.plus} New note</button>
          </div>
          <div class="card"><h3>${esc(n.title)}</h3><div class="note-body">${esc(n.body)}</div></div>
        </div>`;
    },

    settings() {
      const tabs = [['ai', 'AI &amp; models', 'wand'], ['study', 'Study', 'graduation'], ['privacy', 'Privacy', 'lock']];
      const sw = (key, label, desc) => `<div class="set-row"><span class="lbl"><b>${label}</b><span>${desc}</span></span>
        <button class="switch ${state.toggles[key] ? 'on' : ''}" role="switch" aria-checked="${!!state.toggles[key]}" onclick="GUI.sw('${key}', this)"></button></div>`;
      return `${viewHead('settings', '', 'Settings', 'The same engine and the same settings as every other vault — the mode only changes the sidebar and the assistant\'s persona.')}
        <div class="settings-grid">
          <div class="set-tabs">${tabs.map(([id, label, icon]) => `<button class="set-tab ${state.settingsTab === id ? 'active' : ''}" onclick="GUI.setTab('${id}')">${ICONS[icon]}<span>${label}</span></button>`).join('')}</div>
          <div>
            ${state.settingsTab === 'ai' ? `<div class="card"><h3>${ICONS.wand} Models</h3>
              <div class="set-row"><span class="set-prov"><span class="prov-badge" style="background:rgba(45,212,191,0.15);color:#2dd4bf">OL</span><span class="lbl"><b>Ollama · llama3.1</b><span>Chat, ideas and question generation</span></span></span><span class="chip st-teal">Local</span></div>
              <div class="set-row"><span class="set-prov"><span class="prov-badge" style="background:rgba(45,212,191,0.15);color:#2dd4bf">OL</span><span class="lbl"><b>nomic-embed-text</b><span>Semantic index over your materials</span></span></span><span class="chip st-teal">Local</span></div>
              <div class="set-row"><span class="set-prov"><span class="prov-badge" style="background:rgba(129,140,248,0.15);color:#a5b4fc">WH</span><span class="lbl"><b>Whisper</b><span>Class transcription</span></span></span><span class="chip st-teal">Local</span></div>
              <div class="set-row"><span class="set-prov"><span class="prov-badge" style="background:rgba(251,191,36,0.15);color:#fbbf24">BY</span><span class="lbl"><b>Cloud providers</b><span>Optional — bring your own key</span></span></span><span class="keymask">not configured</span></div>
            </div>` : state.settingsTab === 'study' ? `<div class="card"><h3>${ICONS.graduation} Study</h3>
              ${sw('whisper', 'Transcribe with local Whisper', 'Audio never leaves the machine')}
              ${sw('reminders', 'Local calendar reminders', 'Nodi tells you even after being offline')}
              <div class="set-row"><span class="lbl"><b>Sidebar sections</b><span>The mode hides the research surfaces by default — you can bring any of them back</span></span><button class="btn ghost" onclick="GUI.toast('In the app: re-enable any hidden section for a mixed workspace.')">Customise</button></div>
              <div class="set-row"><span class="lbl"><b>Study tutorial</b><span>Reopen the guided tour of every section</span></span><button class="btn ghost" onclick="GUI.toast('In the app: replays the study tour.')">Replay</button></div>
            </div>` : `<div class="card"><h3>${ICONS.lock} Privacy</h3>
              ${sw('local', 'Local-first storage', 'One SQLite vault on your disk')}
              ${sw('telemetry', 'Telemetry', 'Nodus ships without any')}
              <div class="set-row"><span class="lbl"><b>Encrypted backups</b><span>Automatic, with a master password in the keychain</span></span><span class="chip st-teal">On</span></div>
              <div class="set-row"><span class="lbl"><b>Audit ledger</b><span>Tamper-evident record of every AI call</span></span><span class="chip st-teal">On</span></div>
            </div>`}
          </div>
        </div>`;
    },
  };

  // ---------- document / material / recording readers ----------
  function docModal(id) {
    const d = docById(id); if (!d) return;
    const t = topicById(d.topicId);
    const ideas = S.ideas.filter((i) => i.source === d.id);
    openModal(`
      ${modalHead(esc(d.title), `<span class="chip">${esc(d.kind)}</span> ${esc(subjectName(d.subjectId))}${t ? ` · ${esc(t.name)}` : ''} · ${d.shortId}`)}
      <div class="st-editor">${markdown(d.markdown)}</div>
      ${d.annotation ? `<div class="nav-group-label" style="padding-left:0">Annotation</div>
        <div class="st-annot" style="--ac:${d.annotation.color}"><b>“${esc(d.annotation.text)}”</b><span class="muted small">${esc(d.annotation.note)}</span></div>` : ''}
      ${d.link ? `<div class="nav-group-label" style="padding-left:0">Linked note</div>
        <button class="note-link" onclick="GUI.close();GUI.openDoc('${d.link.to}')">${ICONS.link} ${esc(d.link.label)}</button>` : ''}
      ${ideas.length ? `<div class="nav-group-label" style="padding-left:0">Ideas extracted from this note (${ideas.length})</div>
        <div class="tag-row">${ideas.map((i) => `<span class="chip link" onclick="GUI.close();GUI.idea('${i.id}')"><span class="dot" style="background:${IDEA_COLORS[i.type]}"></span>${esc(i.label)}</span>`).join('')}</div>` : ''}
      <div class="tag-row" style="margin-top:16px">
        <button class="btn" onclick="GUI.toast('In the app: the editor keeps a version history you can restore from.')">${ICONS.clock} Versions</button>
        <button class="btn" onclick="GUI.toast('In the app: generates questions or flashcards from this note, for you to review.')">${ICONS.help} Make questions</button>
        <button class="btn primary" onclick="GUI.close();window.go('chat')">${ICONS.chat} Ask about this</button>
      </div>`, true);
  }

  function materialModal(id) {
    const m = materialById(id); if (!m) return;
    openModal(`
      ${modalHead(esc(m.title), `<span class="chip">${esc(m.extension)}</span> ${esc(m.fileName)} · ${bytes(m.sizeBytes)} · ${esc(subjectName(m.subjectId))}`)}
      <div class="tag-row" style="margin:2px 0 12px"><span class="chip st-teal">${esc(m.readState)}</span><span class="chip st-teal">${ICONS.check} ${esc(m.indexStatus)}</span><span class="chip">${esc(m.embedding)}</span></div>
      <div class="st-editor">${markdown(m.text)}</div>
      ${m.annotation ? `<div class="nav-group-label" style="padding-left:0">Annotation</div>
        <div class="st-annot" style="--ac:${m.annotation.color}"><b>“${esc(m.annotation.text)}”</b><span class="muted small">${esc(m.annotation.note)}</span>
        <button class="note-link" style="margin-top:8px" onclick="GUI.close();GUI.openDoc('${m.annotation.linkedDoc}')">${ICONS.link} ${esc(m.annotation.linkLabel)}</button></div>` : ''}
      <div class="nav-group-label" style="padding-left:0">Details &amp; source</div>
      <div class="st-meta"><span class="st-meta-k">Citation</span><span>${esc(m.citation)}</span></div>
      <div class="st-meta"><span class="st-meta-k">Placement</span><span>${esc(S.course.name)} · ${esc(subjectName(m.subjectId))} · ${esc((folderById(m.folderId) || {}).name || '—')} · ${esc((topicById(m.topicId) || {}).name || '—')}</span></div>
      <div class="st-meta"><span class="st-meta-k">Indexable text</span><span>${m.text.length.toLocaleString()} characters</span></div>
      <div class="tag-row" style="margin-top:16px">
        <button class="btn" onclick="GUI.toast('In the app: select any fragment to annotate it or turn it into a linked note.')">${ICONS.edit} Annotate a fragment</button>
        <button class="btn primary" onclick="GUI.close();GUI.openDoc('doc-cell')">${ICONS.notebook} Create a note from it</button>
      </div>`, true);
  }

  function recordingModal(id) {
    const r = recordingById(id); if (!r) return;
    openModal(`
      ${modalHead(esc(r.title), `${esc(r.session)} · ${mmss(r.durationSeconds)} · ${esc(r.language)} · ${bytes(r.sizeBytes)}`)}
      <div class="st-player">
        <button class="st-play" onclick="GUI.toast('In the app: plays the audio stored in the vault; the transcript follows along.')">${ICONS.play}</button>
        <div class="st-wave">${Array.from({ length: 42 }, (_, i) => `<i style="height:${20 + Math.abs(Math.sin(i * 1.7)) * 70}%"></i>`).join('')}</div>
        <span class="muted small">${mmss(r.durationSeconds)}</span>
      </div>
      ${r.markers.map((mk) => `<div class="st-marker" style="--ac:${mk.color}"><b>${mmss(mk.at)} · ${esc(mk.label)}</b><span class="muted small">${esc(mk.note)}</span></div>`).join('')}
      <div class="nav-group-label" style="padding-left:0">Transcript · local Whisper</div>
      ${r.segments.map((sg) => `<button class="st-seg-row" onclick="GUI.toast('In the app: jumps the audio to ${mmss(sg.start)} and highlights this line.')">
        <span class="st-seg-t">${mmss(sg.start)}</span>
        <span class="st-seg-body"><span class="st-seg-sp">${esc(sg.speaker)} · ${esc(sg.chapter)}</span><span>${esc(sg.text)}</span></span>
        <span class="st-seg-c">${Math.round(sg.confidence * 100)}%</span></button>`).join('')}
      <div class="tag-row" style="margin-top:16px">
        <button class="btn" onclick="GUI.toast('In the app: re-runs Whisper, or produces a cleaned-up or summarised transcript.')">${ICONS.refresh} Reprocess</button>
        <button class="btn" onclick="GUI.toast('In the app: adds a timed marker you can jump back to.')">${ICONS.plus} Add marker</button>
        <button class="btn primary" onclick="GUI.close();GUI.openDoc('doc-cell')">${ICONS.notebook} Note from the transcript</button>
      </div>`, true);
  }

  function eventModal(id) {
    const e = S.events.find((x) => x.id === id); if (!e) return;
    const d = dayFrom(e.inDays);
    openModal(`
      ${modalHead(esc(e.title), `<span class="chip" style="border-color:${EVENT_COLORS[e.type]}55;color:${EVENT_COLORS[e.type]}">${EVENT_LABEL[e.type]}</span> ${esc(subjectName(e.subjectId))}`)}
      <div class="st-meta"><span class="st-meta-k">Starts</span><span>${fmtDate(d)}${e.allDay ? ' · all day' : ' · 09:00'}</span></div>
      ${e.reminder ? `<div class="st-meta"><span class="st-meta-k">Reminder</span><span>${esc(e.reminder)}</span></div>` : ''}
      ${e.notes ? `<div class="st-meta"><span class="st-meta-k">Notes</span><span>${esc(e.notes)}</span></div>` : ''}
      <div class="tag-row" style="margin-top:16px">
        <button class="btn" onclick="GUI.toast('In the app: pushes this event to iCloud.')">${ICONS.calendar} Add to iCloud</button>
        <button class="btn" onclick="GUI.toast('In the app: pushes this event to Google Calendar.')">${ICONS.external} Add to Google Calendar</button>
        <button class="btn primary" onclick="GUI.close();window.go('review')">${ICONS.flashcards} Prepare for it</button>
      </div>`);
  }

  // ---------- search ----------
  function runSearch(q) {
    const box = $('#st-results'); if (!box) return;
    const input = $('#st-search'); if (input && input.value !== q) input.value = q;
    const s = q.trim().toLowerCase();
    if (s.length < 2) {
      box.innerHTML = `<div class="st-empty">
        <p class="muted small">Type at least two characters to search the whole study workspace.</p>
        <div class="nav-group-label" style="padding-left:0">Recent searches</div>
        <div class="tag-row">${S.searchHistory.map((h) => `<button class="pill" onclick="GUI.runSearch('${esc(h)}')">${esc(h)}</button>`).join('')}</div>
      </div>`;
      return;
    }
    const hits = [];
    const push = (kind, title, subtitle, text, loc, open, score) => {
      const i = text.toLowerCase().indexOf(s); if (i < 0) return;
      const from = Math.max(0, i - 60);
      hits.push({ kind, title, subtitle, loc, open, score, snippet: (from ? '…' : '') + text.slice(from, i + s.length + 90).trim() + '…' });
    };
    S.docs.forEach((d) => push('Note', d.title, subjectName(d.subjectId), d.markdown, '', `GUI.openDoc('${d.id}')`, 0.94));
    S.materials.forEach((m) => push('Material', m.title, subjectName(m.subjectId), m.text, 'p. 1', `GUI.openMaterial('${m.id}')`, 0.88));
    S.recordings.forEach((r) => r.segments.forEach((sg) => push('Transcript', r.title, `${subjectName(r.subjectId)} · ${sg.speaker}`, sg.text, mmss(sg.start), `GUI.openRecording('${r.id}')`, 0.82)));
    S.questions.forEach((q2) => push('Question', q2.prompt, subjectName(q2.subjectId), q2.prompt + ' ' + q2.explanation, '', `GUI.selectQuestion('${q2.id}');window.go('questions')`, 0.76));

    const hl = (text) => esc(text).replace(new RegExp(`(${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
    box.innerHTML = hits.length ? `<p class="muted small" style="margin:0 0 10px">${hits.length} result${hits.length === 1 ? '' : 's'} · 7 ms · keyword + semantic</p>` + hits.map((h) => `
      <div class="st-hit" onclick="${h.open}">
        <span class="st-hit-ic">${ICONS[h.kind === 'Note' ? 'notebook' : h.kind === 'Material' ? 'book' : h.kind === 'Transcript' ? 'microphone' : 'help']}</span>
        <span class="st-hit-body">
          <span class="st-hit-t"><b>${esc(h.title)}</b><span class="st-hit-k">${h.kind}</span><span class="muted small">${Math.round(h.score * 100)}%</span></span>
          <span class="muted small">${esc(h.subtitle)}${h.loc ? ` · ${h.loc}` : ''}</span>
          <span class="st-hit-s">${hl(h.snippet)}</span>
        </span></div>`).join('') : `<p class="muted small">No matches for “${esc(q)}”.</p>`;
  }

  // ---------- graph ----------
  function initGraph() {
    cancelAnimationFrame(graphAnim);
    const cv = $('#st-graph'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const wrap = cv.parentElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = wrap.clientWidth * dpr; cv.height = 560 * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = () => cv.width / dpr, H = () => cv.height / dpr;
    const ideas = S.ideas.filter((i) => i.subjectId === state.subject);
    const edges = S.edges.filter((e) => e.subjectId === state.subject);
    const nodes = ideas.map((i, k) => ({ id: i.id, label: i.label, type: i.type, x: W() / 2 + Math.cos(k * 2.2) * 150, y: H() / 2 + Math.sin(k * 2.2) * 120, vx: 0, vy: 0 }));
    const nById = new Map(nodes.map((n) => [n.id, n]));
    const links = edges.map((e) => ({ a: nById.get(e.from), b: nById.get(e.to), type: e.type })).filter((l) => l.a && l.b);
    let ticks = 0;
    function step() {
      ticks++;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; const dx = a.x - b.x, dy = a.y - b.y; const d = Math.hypot(dx, dy) || 1;
        const f = 9000 / (d * d); a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      links.forEach((l) => { const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.hypot(dx, dy) || 1; const f = (d - 190) * 0.02; l.a.vx += (dx / d) * f; l.a.vy += (dy / d) * f; l.b.vx -= (dx / d) * f; l.b.vy -= (dy / d) * f; });
      nodes.forEach((n) => { n.vx += (W() / 2 - n.x) * 0.004; n.vy += (H() / 2 - n.y) * 0.004; n.vx *= 0.86; n.vy *= 0.86; n.x += n.vx; n.y += n.vy; n.x = Math.max(90, Math.min(W() - 90, n.x)); n.y = Math.max(50, Math.min(H() - 50, n.y)); });
    }
    function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
    function draw() {
      ctx.clearRect(0, 0, W(), H());
      links.forEach((l) => {
        ctx.strokeStyle = EDGE_COLORS[l.type] || '#666'; ctx.globalAlpha = 0.65; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke(); ctx.globalAlpha = 1;
        const mx = (l.a.x + l.b.x) / 2, my = (l.a.y + l.b.y) / 2; let ang = Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x);
        ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.abs(ang) > Math.PI / 2 ? ang + Math.PI : ang);
        ctx.fillStyle = EDGE_COLORS[l.type]; ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(l.type, 0, -5); ctx.restore();
      });
      nodes.forEach((n) => {
        ctx.beginPath(); ctx.arc(n.x, n.y, 8, 0, 6.29); ctx.fillStyle = IDEA_COLORS[n.type]; ctx.fill();
        ctx.font = '600 12px Inter, sans-serif'; const tw = ctx.measureText(n.label).width;
        const tx = n.x + 13, ty = n.y;
        ctx.fillStyle = 'rgba(20,20,24,0.94)'; roundRect(ctx, tx, ty - 10, tw + 12, 20, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; roundRect(ctx, tx, ty - 10, tw + 12, 20, 5); ctx.stroke();
        ctx.fillStyle = '#f4f4f5'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(n.label, tx + 6, ty); ctx.textBaseline = 'alphabetic';
      });
    }
    function loop() { if (ticks < 340) step(); draw(); graphAnim = requestAnimationFrame(loop); }
    loop();
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      const hit = nodes.find((n) => Math.hypot(n.x - mx, n.y - my) < 14); if (hit) ideaModal(hit.id);
    };
  }

  // ---------- router ----------
  window.go = function (view) {
    cancelAnimationFrame(graphAnim);
    state.view = view;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const el = main();
    const full = view === 'chat';
    el.innerHTML = `<div class="fade-in st-viewroot ${full ? 'st-full' : 'st-scroll'}">${(VIEWS[view] || VIEWS.home)()}</div>`;
    el.scrollTop = 0;
    if (view === 'graph') initGraph();
    if (view === 'search') { runSearch(''); const b = $('#st-search'); if (b) { b.addEventListener('input', () => runSearch(b.value)); b.focus(); } }
    if (view === 'chat') {
      const inp = $('#st-chat-inp');
      if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') GUI.chatSend(); });
      const box = document.querySelector('.st-chat-msgs'); if (box) box.scrollTop = box.scrollHeight;
    }
    try { history.replaceState(null, '', '#' + view); } catch (e) {}
  };

  let chatTurn = 0;
  window.GUI = {
    toast, close: closeModal, idea: ideaModal, event: eventModal,
    openDoc: docModal, openMaterial: materialModal, openRecording: recordingModal,
    browse(subjectId) { state.browse.subjectId = subjectId; window.go('courses'); },
    setSubject(id) { state.subject = id; window.go(state.view); },
    selectQuestion(id) { state.question = id; if (state.view === 'questions') window.go('questions'); },
    bankTab(tab) { state.bankTab = tab; window.go('questions'); },
    note(id) { state.note = id; window.go('notes'); },
    setTab(id) { state.settingsTab = id; window.go('settings'); },
    sw(key, el) { state.toggles[key] = !state.toggles[key]; el.classList.toggle('on', state.toggles[key]); el.setAttribute('aria-checked', String(state.toggles[key])); },
    runSearch(q) { if (state.view !== 'search') { window.go('search'); } runSearch(q); },
    calView(v) { state.calView = v; window.go('calendar'); },
    calMove(n) { const d = new Date(state.calCursor); if (state.calView === 'month') d.setMonth(d.getMonth() + n); else if (state.calView === 'week') d.setDate(d.getDate() + n * 7); else d.setFullYear(d.getFullYear() + n); state.calCursor = d; window.go('calendar'); },
    calMonth(m) { const d = new Date(state.calCursor); d.setMonth(m); state.calCursor = d; state.calView = 'month'; window.go('calendar'); },
    calToday() { state.calCursor = new Date(); window.go('calendar'); },
    reportPage(i) { state.reportPage = i; window.go('deepResearch'); },
    reviewKind(kind) { state.review.kind = kind; },
    reviewStart() { state.review.step = 'session'; state.review.index = 0; state.review.revealed = false; window.go('review'); },
    reveal() { state.review.revealed = true; window.go('review'); },
    reviewNext() {
      const total = state.review.kind === 'flashcards' ? S.flashcards.length : S.questions.length;
      if (state.review.index + 1 >= total) state.review.step = 'done';
      else { state.review.index++; state.review.revealed = false; }
      window.go('review');
    },
    reviewReset() { state.review = { step: 'setup', index: 0, revealed: false, kind: state.review.kind }; window.go('review'); },
    citation(kind, id) { if (kind === 'document') docModal(id); else if (kind === 'material') materialModal(id); else recordingModal(id); },
    chatSend() {
      const inp = $('#st-chat-inp'); const v = inp && inp.value.trim(); if (!v) return;
      inp.value = '';
      const live = $('#st-chat-live');
      live.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(v)}</div><div class="msg ai" id="st-typing"><span class="typing"><i></i><i></i><i></i></span></div>`);
      const box = document.querySelector('.st-chat-msgs'); box.scrollTop = box.scrollHeight;
      setTimeout(() => {
        const t = $('#st-typing'); if (!t) return;
        t.removeAttribute('id');
        t.innerHTML = markdown(S.chat.canned[chatTurn++ % S.chat.canned.length]);
        box.scrollTop = box.scrollHeight;
      }, 700);
    },
  };

  // ---------- boot ----------
  const nav = $('#nav');
  nav.innerHTML = NAV.map((n) => n.group !== undefined ? `<div class="nav-group-label">${n.group}</div>` : `<button class="nav-item" data-view="${n.id}">${ICONS[n.icon]}<span>${n.label}</span></button>`).join('');
  nav.addEventListener('click', (e) => { const b = e.target.closest('.nav-item'); if (b) window.go(b.dataset.view); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal(); });
  window.addEventListener('resize', () => { if (state.view === 'graph') initGraph(); });
  const initial = (location.hash || '#home').slice(1);
  window.go(VIEWS[initial] ? initial : 'home');
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== state.view) window.go(v); });
})();
