/* ===== מתכנן מערכת השעות — לוגיקה ===== */
'use strict';

const STORAGE_KEY = 'maarechet-copy-v1';
const WELCOME_KEY = 'maarechet-copy-welcomed';
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
const LESSON_TYPES = ['פרונטלי', 'פרטני', 'שהות'];
// מיפוי סוג שעה -> קטגוריית מכסה
const TYPE_TO_CAT = {
  'פרונטלי': 'frontal',
  'פרטני': 'prati',
  'שהות': 'shehut'
};
const CAT_LABELS = { frontal: 'פרונטלי', prati: 'פרטני', shehut: 'שהות' };

const PALETTE = ['#6c5ce7', '#00b894', '#e17055', '#0984e3', '#fdcb6e', '#e84393',
  '#00cec9', '#a29bfe', '#fab1a0', '#55efc4', '#ff7675', '#74b9ff',
  '#b8860b', '#6ab04c', '#eb4d4b', '#22a6b3', '#be2edd', '#f0932b'];

/* ===== מצב ===== */
let state = null;

function emptyState() {
  return {
    settings: { schoolName: '', year: 'תשפ"ז', hoursDefault: 9, hoursFriday: 4 },
    teachers: [], classes: [], subjects: [], lessons: [], students: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = Object.assign(emptyState(), parsed);
      state.settings = Object.assign(emptyState().settings, parsed.settings || {});
      return;
    }
  } catch (e) { console.error('load failed', e); }
  state = emptyState();
}

let saveTimer = null;
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const ind = document.getElementById('save-indicator');
  ind.textContent = '✓ נשמר';
  ind.classList.remove('saving');
}

function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }

/* ===== עזרים ===== */
const byId = (arr, id) => arr.find(x => x.id === id);
const teacher = id => byId(state.teachers, id);
const klass = id => byId(state.classes, id);
const subject = id => byId(state.subjects, id);
const student = id => byId(state.students, id);
const studentsOf = cid => state.students.filter(s => s.classId === cid);
const lessonStudents = l => (l.studentIds || []);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function hoursFor(day) {
  return day === 'ו' ? (+state.settings.hoursFriday || 0) : (+state.settings.hoursDefault || 9);
}
function maxHours() {
  return Math.max(+state.settings.hoursDefault || 9, +state.settings.hoursFriday || 0);
}
function nextColor() {
  return PALETTE[state.subjects.length % PALETTE.length];
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ===== ספירות ===== */
function teacherCounts(tid) {
  const c = { frontal: 0, prati: 0, shehut: 0 };
  for (const l of state.lessons) {
    if (l.teacherIds.includes(tid)) c[TYPE_TO_CAT[l.type] || 'frontal']++;
  }
  return c;
}
function classSubjectCounts(cid) {
  const m = {};
  for (const l of state.lessons) {
    if (l.classIds.includes(cid) && l.subjectId) m[l.subjectId] = (m[l.subjectId] || 0) + 1;
  }
  return m;
}
function classQuotaOf(c, sid) {
  const q = (c.subjectQuotas || []).find(x => x.subjectId === sid);
  return q ? +q.weeklyHours || 0 : 0;
}
function setClassQuota(c, sid, hours) {
  c.subjectQuotas = c.subjectQuotas || [];
  const i = c.subjectQuotas.findIndex(x => x.subjectId === sid);
  if (hours > 0) {
    if (i >= 0) c.subjectQuotas[i].weeklyHours = hours;
    else c.subjectQuotas.push({ subjectId: sid, weeklyHours: hours });
  } else if (i >= 0) c.subjectQuotas.splice(i, 1);
}
function statusClass(actual, target) {
  if (!target) return 'none';
  if (actual === target) return 'ok';
  return actual < target ? 'under' : 'over';
}

/* ===== התנגשויות ===== */
function computeConflicts() {
  const conflicts = [];
  for (const day of DAYS) {
    for (let h = 1; h <= hoursFor(day); h++) {
      const slot = state.lessons.filter(l => l.day === day && l.hour === h);
      // מורה בשני שיעורים שונים באותה שעה
      const perTeacher = {};
      for (const l of slot) for (const tid of l.teacherIds) (perTeacher[tid] = perTeacher[tid] || []).push(l.id);
      for (const [tid, ids] of Object.entries(perTeacher)) {
        if (ids.length > 1 && teacher(tid)) {
          conflicts.push({ kind: 'teacher', day, hour: h, id: tid, lessonIds: ids,
            text: 'המורה ' + teacher(tid).name + ' משובץ/ת ב-' + ids.length + ' שיעורים שונים ביום ' + day + "' שעה " + h });
        }
      }
      // שיבוץ ביום חופשי של מורה (למשל כשהיום החופשי סומן אחרי שהשיבוץ כבר היה קיים)
      for (const l of slot) for (const tid of l.teacherIds) {
        const t = teacher(tid);
        if (t && (t.freeDays || []).includes(day)) {
          conflicts.push({ kind: 'teacher', day, hour: h, id: tid, lessonIds: [l.id],
            text: 'המורה ' + t.name + ' משובץ/ת ביום החופשי שלו/ה — יום ' + day + "' שעה " + h });
        }
      }
      // הערה: כמה שיבוצים באותה כיתה באותה שעה זה מצב לגיטימי
      // (שני מורים שכל אחד מלמד תוכן אחר, קבוצות מקבילות) — לא נחשב התנגשות
    }
  }
  // שיבוצים ללא מורה — תזכורת להשלמה
  for (const l of state.lessons) {
    if (l.classIds.length && !l.teacherIds.length && klass(l.classIds[0])) {
      const cls = l.classIds.map(c => klass(c) ? klass(c).name : '').filter(Boolean).join('+');
      const sub = l.subjectId && subject(l.subjectId) ? ' (' + subject(l.subjectId).name + ')' : '';
      conflicts.push({ kind: 'missing', day: l.day, hour: l.hour, id: l.classIds[0], lessonIds: [l.id],
        text: 'חסר מורה בכיתה ' + cls + ' — יום ' + l.day + "' שעה " + l.hour + sub });
    }
  }
  return conflicts;
}

function renderConflictBar() {
  const conflicts = computeConflicts();
  const bar = document.getElementById('conflict-bar');
  const list = document.getElementById('conflict-list');
  const teacherConf = conflicts.filter(c => c.kind === 'teacher');
  bar.hidden = conflicts.length === 0;
  document.getElementById('conflict-count').textContent = conflicts.length;
  list.innerHTML = conflicts.map((c, i) =>
    '<button class="conflict-item ' + (c.kind !== 'teacher' ? 'warn' : '') + '" data-i="' + i + '">' +
    '<span class="tag">' + (c.kind === 'teacher' ? '⛔ התנגשות מורה:' : '❓ להשלמה:') + '</span> ' + esc(c.text) + '</button>'
  ).join('');
  list.querySelectorAll('.conflict-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = conflicts[+btn.dataset.i];
      const tab = c.kind === 'teacher' ? 'teachers-board' : 'classes-board';
      switchTab(tab);
      const sel = 'td.slot[data-day="' + c.day + '"][data-hour="' + c.hour + '"][data-col="' + c.id + '"]';
      const cell = document.querySelector('#tab-' + tab + ' ' + sel);
      if (cell) {
        cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        cell.classList.remove('flash'); void cell.offsetWidth; cell.classList.add('flash');
      }
    });
  });
  return conflicts;
}

/* ===== רינדור לוחות ===== */
// filterClassId: בתצוגה של כיתה מסוימת מציגים רק את תלמידיה, עם מונה לשאר (קבוצות מעורבבות)
function chipHtml(l, mode, showStudents, filterClassId) {
  const sub = l.subjectId ? subject(l.subjectId) : null;
  const color = sub ? sub.color : '#b8bdc9';
  let mainLabel = sub ? sub.name : (l.type !== 'פרונטלי' ? l.type : 'שיעור');
  let secondLine = '', missing = false;
  if (mode === 'class') {
    secondLine = l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').filter(Boolean).join(' + ');
    if (!secondLine) { secondLine = '❓ חסר מורה'; missing = true; }
  } else {
    secondLine = l.classIds.map(c => klass(c) ? klass(c).name : '').filter(Boolean).join(' + ');
  }
  const typeBadge = (l.type && l.type !== 'פרונטלי' && (sub || mode === 'class'))
    ? ' <span class="chip-type">' + esc(l.type) + '</span>' : '';
  const shared = l.classIds.length > 1 ? ' shared' : '';
  const title = (sub ? sub.name + ' | ' : '') + l.type +
    (l.classIds.length ? ' | כיתות: ' + l.classIds.map(c => klass(c) ? klass(c).name : '').join(', ') : '') +
    (l.teacherIds.length ? ' | מורים: ' + l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').join(', ') : '');
  return '<span class="chip' + shared + '" style="--sub-color:' + color + '22;--sub-border:' + color + '" title="' + esc(title) + '">' +
    '<span class="chip-subject">' + esc(mainLabel) + typeBadge + '</span>' +
    (secondLine ? '<span class="chip-teachers' + (missing ? ' missing' : '') + '">' + esc(secondLine) + '</span>' : '') +
    (l.note ? '<span class="chip-note">' + esc(l.note) + '</span>' : '') +
    (showStudents && lessonStudents(l).length ? studentsLineHtml(l, filterClassId) : '') +
    '</span>';
}

function studentsLineHtml(l, filterClassId) {
  const all = lessonStudents(l).map(sid => student(sid)).filter(Boolean);
  let shown = all, others = 0;
  if (filterClassId) {
    shown = all.filter(s => s.classId === filterClassId);
    others = all.length - shown.length;
  }
  if (!shown.length && !others) return '';
  const names = shown.map(s => s.name).join(', ');
  return '<span class="chip-students">🧑‍🎓 ' + esc(names) +
    (others ? (names ? ' ' : '') + '(+' + others + ' מכיתות אחרות)' : '') + '</span>';
}

// סדר תצוגת מורים: מחנכות לפי סדר הכיתות, אחריהן מחנכות ללא כיתה, ואז המקצועיים
function orderedTeachers() {
  const seen = new Set();
  const ordered = [];
  for (const c of state.classes) {
    const t = teacher(c.homeroomTeacherId);
    if (t && !seen.has(t.id)) { ordered.push(t); seen.add(t.id); }
  }
  for (const t of state.teachers) if (t.role === 'מחנכת' && !seen.has(t.id)) { ordered.push(t); seen.add(t.id); }
  for (const t of state.teachers) if (!seen.has(t.id)) { ordered.push(t); seen.add(t.id); }
  return ordered;
}

// סה"כ שובץ מול סה"כ מכסה
function teacherTotals(t) {
  const c = teacherCounts(t.id);
  const q = t.quota || {};
  return { tot: c.frontal + c.prati + c.shehut, qtot: (+q.frontal || 0) + (+q.prati || 0) + (+q.shehut || 0) };
}

function teacherSummaryHtml(t) {
  const c = teacherCounts(t.id);
  const q = t.quota || { frontal: 0, prati: 0, shehut: 0 };
  const seg = cat => '<b class="' + statusClass(c[cat], +q[cat] || 0) + '">' + c[cat] + '/' + (+q[cat] || 0) + '</b>';
  return '<span class="tsum" title="פרונטלי + פרטני + שהות (בפועל/מכסה)">' +
    seg('frontal') + ' + ' + seg('prati') + ' + ' + seg('shehut') + '</span>';
}

function boardHtml(columns, mode) {
  // columns: [{id, headHtml}]
  let html = '<table class="board"><thead><tr>' +
    '<th class="col-day">יום</th><th class="col-hour">שעה</th>' +
    columns.map(col => '<th data-col="' + col.id + '">' + col.headHtml + '</th>').join('') +
    '</tr></thead><tbody>';

  const conflicts = computeConflicts();
  const confSet = new Set();
  for (const c of conflicts) confSet.add(c.kind + '|' + c.day + '|' + c.hour + '|' + c.id);
  // שיעורים שמעורבים בהתנגשות מורה — מסומנים גם בלוח הכיתות
  const badLessons = new Set();
  for (const c of conflicts) if (c.kind === 'teacher') c.lessonIds.forEach(id => badLessons.add(id));

  for (const day of DAYS) {
    const hrs = hoursFor(day);
    if (!hrs) continue;
    for (let h = 1; h <= hrs; h++) {
      html += '<tr' + (h === 1 ? ' class="day-start"' : '') + '>';
      if (h === 1) html += '<td class="col-day" rowspan="' + hrs + '"><span class="day-label">' + day + "'</span></td>";
      html += '<td class="col-hour">' + h + '</td>';
      for (const col of columns) {
        const lessons = state.lessons.filter(l => l.day === day && l.hour === h &&
          (mode === 'class' ? l.classIds.includes(col.id) : l.teacherIds.includes(col.id)));
        const confKey = (mode === 'class' ? 'class' : 'teacher') + '|' + day + '|' + h + '|' + col.id;
        let cls = confSet.has(confKey) ? (mode === 'class' ? ' warn-dup' : ' conflict') : '';
        if (mode === 'class' && lessons.some(l => badLessons.has(l.id))) cls = ' conflict';
        if (mode === 'class' && !cls && confSet.has('missing|' + day + '|' + h + '|' + col.id)) cls = ' warn-dup';
        if (mode === 'teacher' && (teacher(col.id).freeDays || []).includes(day)) cls += ' dayoff';
        html += '<td class="slot' + cls + '" data-day="' + day + '" data-hour="' + h + '" data-col="' + col.id + '">' +
          lessons.map(l => chipHtml(l, mode, mode === 'class', mode === 'class' ? col.id : undefined)).join('') + '</td>';
      }
      html += '</tr>';
    }
  }
  html += '</tbody></table>';
  return html;
}

// אות היום נצמדת בגלילה — מוודאים שהיא נעצרת בדיוק מתחת לכותרת הדביקה
function setDayLabelOffset(wrap) {
  const thead = wrap.querySelector('thead');
  if (thead) wrap.style.setProperty('--head-h', thead.offsetHeight + 'px');
}

function renderClassesBoard() {
  const wrap = document.getElementById('classes-board-wrap');
  if (!state.classes.length) {
    wrap.innerHTML = '<div class="board-hint" style="padding:30px;text-align:center">עדיין אין כיתות. אפשר להוסיף בלשונית ⚙️ הגדרות, או לטעון שם רשימות לדוגמה.</div>';
    return;
  }
  const cols = state.classes.map(c => {
    const counts = classSubjectCounts(c.id);
    const target = (c.subjectQuotas || []).reduce((a, q) => a + (+q.weeklyHours || 0), 0);
    // מול התקן נספרים רק מקצועות שהוגדר להם תקן
    const actual = target
      ? (c.subjectQuotas || []).reduce((a, q) => a + (counts[q.subjectId] || 0), 0)
      : Object.values(counts).reduce((a, b) => a + b, 0);
    const hm = teacher(c.homeroomTeacherId);
    const mini = target
      ? '<span class="quota-mini ' + statusClass(actual, target) + '" title="שעות ששובצו מול התקן הכיתתי">' + actual + '/' + target + ' שע\'</span>'
      : '<span class="quota-mini none">' + actual + ' שע\' שובצו</span>';
    return { id: c.id, headHtml: esc(c.name) + (hm ? '<br><span style="font-weight:400;font-size:.78rem">' + esc(hm.name) + '</span>' : '') + mini };
  });
  wrap.innerHTML = boardHtml(cols, 'class');
  setDayLabelOffset(wrap);
  wrap.querySelectorAll('td.slot').forEach(td => td.addEventListener('click', () => {
    if (copySource) { pasteLessonTo(td.dataset.day, +td.dataset.hour, td.dataset.col); return; }
    openLessonModal({ day: td.dataset.day, hour: +td.dataset.hour, classId: td.dataset.col });
  }));
}

function renderTeachersBoard() {
  const wrap = document.getElementById('teachers-board-wrap');
  if (!state.teachers.length) {
    wrap.innerHTML = '<div class="board-hint" style="padding:30px;text-align:center">עדיין אין מורים. אפשר להוסיף בלשונית ⚙️ הגדרות, או לטעון שם רשימות לדוגמה.</div>';
    return;
  }
  const cols = orderedTeachers().map(t => {
    const { tot, qtot } = teacherTotals(t);
    return {
      id: t.id,
      headHtml: esc(t.name) +
        '<span class="quota-mini ' + statusClass(tot, qtot) + '" title="סך שעות ששובצו מול סך המכסה">שובצו ' + tot + ' / ' + qtot + '</span>' +
        teacherSummaryHtml(t)
    };
  });
  wrap.innerHTML = boardHtml(cols, 'teacher');
  setDayLabelOffset(wrap);
  wrap.querySelectorAll('td.slot').forEach(td => td.addEventListener('click', () => {
    if (copySource) {
      // שיבוץ בלי כיתה (שהות/תפקיד) מדביקים ישירות על תא של מורה
      if (copySource.lessons.every(l => !l.classIds.length)) {
        pasteTeacherLessonTo(td.dataset.day, +td.dataset.hour, td.dataset.col);
      } else {
        toast('שיבוץ עם כיתות מדביקים בלוח הכיתות — או ✔ סיום');
      }
      return;
    }
    openLessonModal({ day: td.dataset.day, hour: +td.dataset.hour, teacherId: td.dataset.col });
  }));
}

/* ===== מכסות ===== */
function renderQuotas() {
  // מורים
  const tq = document.getElementById('teacher-quotas');
  tq.innerHTML = orderedTeachers().map(t => {
    const c = teacherCounts(t.id);
    const q = t.quota || { frontal: 0, prati: 0, shehut: 0 };
    const bars = ['frontal', 'prati', 'shehut'].map(cat => {
      const target = +q[cat] || 0, actual = c[cat];
      const pct = target ? Math.min(100, actual / target * 100) : (actual ? 100 : 0);
      const st = statusClass(actual, target);
      return '<div class="bar-block"><div class="bar-label"><span>' + CAT_LABELS[cat] + '</span><b>' + actual + '/' + target + '</b></div>' +
        '<div class="bar ' + (st === 'over' ? 'over' : st === 'ok' ? 'ok' : '') + '"><i style="width:' + pct + '%"></i></div></div>';
    }).join('');
    return '<div class="tq-row"><div class="tq-head"><span class="tq-name">' + esc(t.name) + '</span>' +
      '<span class="tq-role">' + esc(t.role || '') + ' | מכסה: ' + (+q.frontal || 0) + '+' + (+q.prati || 0) + '+' + (+q.shehut || 0) + '</span></div>' +
      '<div class="tq-bars">' + bars + '</div></div>';
  }).join('') || '<p class="section-hint">אין מורים עדיין.</p>';

  // כיתות
  const cq = document.getElementById('class-quotas');
  cq.innerHTML = state.classes.map(c => {
    const counts = classSubjectCounts(c.id);
    const sids = new Set([...(c.subjectQuotas || []).map(q => q.subjectId), ...Object.keys(counts)]);
    if (!sids.size) return '<div class="cq-class"><h3>' + esc(c.name) + '</h3><p class="section-hint">אין תקן ואין שיבוצים עדיין.</p></div>';
    let totalT = 0, totalA = 0;
    const rows = [...sids].filter(sid => subject(sid)).map(sid => {
      const t = classQuotaOf(c, sid), a = counts[sid] || 0;
      totalT += t;
      if (t) totalA += a; // בסיכום מול התקן נספרים רק מקצועות עם תקן
      const gap = a - t;
      const gapHtml = !t ? '<span class="section-hint">ללא תקן</span>'
        : gap === 0 ? '<span class="gap-ok">✓ מדויק</span>'
        : gap < 0 ? '<span class="gap-under">חסרות ' + (-gap) + '</span>'
        : '<span class="gap-over">עודף ' + gap + '</span>';
      return '<tr><td>' + esc(subject(sid).name) + '</td><td>' + (t || '—') + '</td><td>' + a + '</td><td>' + gapHtml + '</td></tr>';
    }).join('');
    return '<div class="cq-class"><h3>' + esc(c.name) + '</h3>' +
      '<table class="cq-table"><tr><th>מקצוע</th><th>תקן שבועי</th><th>שובץ</th><th>מצב</th></tr>' + rows +
      '<tr class="cq-total"><td>סה"כ מול התקן</td><td>' + totalT + '</td><td>' + totalA + '</td><td>' +
      (totalT ? (totalA === totalT ? '<span class="gap-ok">✓ הכיתה קיבלה את מלוא התקן</span>' : totalA < totalT ? '<span class="gap-under">חסרות ' + (totalT - totalA) + ' שעות</span>' : '<span class="gap-over">עודף ' + (totalA - totalT) + ' שעות</span>') : '') +
      '</td></tr></table></div>';
  }).join('') || '<p class="section-hint">אין כיתות עדיין.</p>';
}

/* ===== מערכת אישית ===== */
function renderPersonalTargets() {
  const kind = document.getElementById('personal-kind').value;
  const sel = document.getElementById('personal-target');
  sel.hidden = kind === 'splits';
  document.getElementById('btn-print-multi').hidden = kind === 'splits';
  document.getElementById('print-picker').hidden = true; // נסגר בהחלפת סוג
  if (kind === 'splits') return;
  const items = kind === 'class' ? state.classes : orderedTeachers();
  const prev = sel.value;
  sel.innerHTML = items.map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function renderPersonal() {
  renderPersonalTargets();
  const kind = document.getElementById('personal-kind').value;
  const id = document.getElementById('personal-target').value;
  const view = document.getElementById('personal-view');
  if (kind === 'splits') { renderSplitsReport(view); return; }
  const target = kind === 'class' ? klass(id) : teacher(id);
  if (!target) { view.innerHTML = '<p class="section-hint" style="text-align:center">אין נתונים להצגה עדיין.</p>'; return; }

  let sub = '';
  if (kind === 'class') {
    const hm = teacher(target.homeroomTeacherId);
    sub = hm ? 'מחנכת: ' + hm.name : '';
  } else {
    const c = teacherCounts(target.id); const q = target.quota || {};
    sub = 'פרונטלי ' + c.frontal + '/' + (+q.frontal || 0) + ' · פרטני ' + c.prati + '/' + (+q.prati || 0) + ' · שהות ' + c.shehut + '/' + (+q.shehut || 0);
  }

  let html = '<h2 class="pv-title">' + (state.settings.schoolName ? esc(state.settings.schoolName) + ' — ' : '') + 'מערכת שעות ' + esc(state.settings.year || '') + ' — ' + esc(target.name) + '</h2>' +
    '<p class="pv-sub">' + esc(sub) + '</p>' +
    '<table class="pv-table"><tr><th style="width:42px">שעה</th>' + DAYS.map(d => '<th>' + d + "'</th>").join('') + '</tr>';
  for (let h = 1; h <= maxHours(); h++) {
    html += '<tr><td class="hour-cell">' + h + '</td>';
    for (const day of DAYS) {
      if (h > hoursFor(day)) { html += '<td style="background:#f3f2f8"></td>'; continue; }
      if (kind === 'teacher' && (target.freeDays || []).includes(day)) {
        html += '<td style="background:#f3f2f8;color:#9a96ad">' + (h === 1 ? 'יום חופשי' : '') + '</td>';
        continue;
      }
      const lessons = state.lessons.filter(l => l.day === day && l.hour === h &&
        (kind === 'class' ? l.classIds.includes(id) : l.teacherIds.includes(id)));
      html += '<td>' + lessons.map(l => chipHtml(l, kind === 'class' ? 'class' : 'teacher', true, kind === 'class' ? id : undefined)).join('') + '</td>';
    }
    html += '</tr>';
  }
  html += '</table>';
  view.innerHTML = html;
}

/* ===== דוח פיצולים ותלמידים ===== */
function renderSplitsReport(view) {
  const assignedAnywhere = new Set(state.lessons.flatMap(lessonStudents));
  let html = '<h2 class="pv-title">' + (state.settings.schoolName ? esc(state.settings.schoolName) + ' — ' : '') +
    'דוח פיצולים ושיוך תלמידים — ' + esc(state.settings.year || '') + '</h2>' +
    '<p class="pv-sub">כל המשבצות שבהן הכיתה מפוצלת לקבוצות (2+ שיבוצים באותה שעה) או שיש שיוך תלמידים</p>';
  let any = false;

  for (const c of state.classes) {
    const roster = studentsOf(c.id);
    const never = roster.filter(s => !assignedAnywhere.has(s.id));
    let rows = '';
    for (const day of DAYS) {
      for (let h = 1; h <= hoursFor(day); h++) {
        const slot = state.lessons.filter(l => l.day === day && l.hour === h && l.classIds.includes(c.id));
        if (slot.length < 2 && !slot.some(l => lessonStudents(l).length)) continue;
        const slotLabel = 'יום ' + day + "' שעה " + h;
        slot.forEach((l, i) => {
          const sub = l.subjectId && subject(l.subjectId) ? subject(l.subjectId).name : l.type;
          const who = l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').filter(Boolean).join(' + ') || '❓ חסר מורה';
          // בסקציה של כיתה מציגים רק את תלמידיה; לשאר — מונה (קבוצות מעורבבות חוצות-כיתות)
          const allSt = lessonStudents(l).map(sid => student(sid)).filter(Boolean);
          const mine = allSt.filter(s => s.classId === c.id);
          const others = allSt.length - mine.length;
          const names = mine.map(s => s.name).join(', ') + (others ? (mine.length ? ' ' : '') + '(+' + others + ' מכיתות אחרות)' : '');
          rows += '<tr>' + (i === 0 ? '<td rowspan="' + (slot.length + (slotHasMissing(slot, roster) ? 1 : 0)) + '" class="splits-slot">' + slotLabel + '</td>' : '') +
            '<td><b>' + esc(sub) + '</b>' + (l.note ? ' <span class="section-hint">(' + esc(l.note) + ')</span>' : '') + '</td>' +
            '<td>' + esc(who) + '</td><td>' + (names ? esc(names) : '<span class="section-hint">—</span>') + '</td></tr>';
        });
        // מי מהכיתה לא נמצא באף קבוצה בשעה זו (מוצג רק כשמתחילים לשייך שמות במשבצת)
        if (slotHasMissing(slot, roster)) {
          const inSlot = new Set(slot.flatMap(lessonStudents));
          const missing = roster.filter(s => !inSlot.has(s.id)).map(s => s.name);
          rows += '<tr><td colspan="3" class="splits-missing">❓ לא משובצים בשעה זו: ' + esc(missing.join(', ')) + '</td></tr>';
        }
      }
    }
    if (!rows && !never.length) continue;
    any = true;
    html += '<div class="cq-class"><h3>כיתה ' + esc(c.name) + '</h3>';
    if (never.length) {
      html += '<div class="splits-never">🕐 <b>טרם שובצו לאף קבוצה:</b> ' + esc(never.map(s => s.name).join(', ')) + '</div>';
    }
    if (rows) {
      html += '<table class="cq-table splits-table"><tr><th>מתי</th><th>קבוצה</th><th>מורה</th><th>תלמידים</th></tr>' + rows + '</table>';
    }
    html += '</div>';
  }
  view.innerHTML = html + (any ? '' : '<p class="section-hint" style="text-align:center">אין עדיין פיצולים או שיוכי תלמידים. מפצלים בלוח הכיתות ומשייכים תלמידים בחלונית השיבוץ (🧑‍🎓).</p>');
}

function slotHasMissing(slot, roster) {
  if (!roster.length || !slot.some(l => lessonStudents(l).length)) return false;
  const inSlot = new Set(slot.flatMap(lessonStudents));
  return roster.some(s => !inSlot.has(s.id));
}

/* ===== הגדרות ===== */
function renderSetup() {
  const s = state.settings;
  document.getElementById('set-school-name').value = s.schoolName || '';
  document.getElementById('set-year').value = s.year || '';
  document.getElementById('set-hours-default').value = s.hoursDefault;
  document.getElementById('set-hours-friday').value = s.hoursFriday;

  // מורים
  const tt = document.getElementById('teachers-table');
  tt.innerHTML = '<tr><th>שם</th><th>תפקיד</th><th>פרונטלי</th><th>פרטני</th><th>שהות</th><th>ימים חופשיים</th><th></th></tr>' +
    state.teachers.map(t => {
      const q = t.quota || {};
      const fd = t.freeDays || [];
      return '<tr data-id="' + t.id + '">' +
        '<td><input type="text" data-f="name" value="' + esc(t.name) + '"></td>' +
        '<td><select data-f="role"><option' + (t.role === 'מחנכת' ? ' selected' : '') + '>מחנכת</option><option' + (t.role === 'מקצועי' ? ' selected' : '') + '>מקצועי</option></select></td>' +
        '<td><input type="number" min="0" data-f="frontal" value="' + (+q.frontal || 0) + '"></td>' +
        '<td><input type="number" min="0" data-f="prati" value="' + (+q.prati || 0) + '"></td>' +
        '<td><input type="number" min="0" data-f="shehut" value="' + (+q.shehut || 0) + '"></td>' +
        '<td><span class="fd-wrap" title="סימון יום = המורה לא זמין/ה ביום זה">' +
          DAYS.map(d => '<label class="fd"><input type="checkbox" data-fd="' + d + '"' + (fd.includes(d) ? ' checked' : '') + '><span>' + d + '</span></label>').join('') +
        '</span></td>' +
        '<td><button class="btn-del" title="מחיקה">🗑️</button></td></tr>';
    }).join('');
  tt.querySelectorAll('tr[data-id]').forEach(tr => {
    const t = teacher(tr.dataset.id);
    tr.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', () => {
      const f = inp.dataset.f;
      if (f === 'name' || f === 'role') t[f] = inp.value.trim() || t[f];
      else { t.quota = t.quota || {}; t.quota[f] = +inp.value || 0; }
      save(); renderAllBoards();
    }));
    tr.querySelectorAll('[data-fd]').forEach(inp => inp.addEventListener('change', () => {
      t.freeDays = [...tr.querySelectorAll('[data-fd]:checked')].map(i => i.dataset.fd);
      save(); renderAllBoards();
    }));
    tr.querySelector('.btn-del').addEventListener('click', () => {
      const used = state.lessons.filter(l => l.teacherIds.includes(t.id)).length;
      if (!confirm('למחוק את ' + t.name + '?' + (used ? ' (משובץ/ת ב-' + used + ' שיעורים — השיבוצים יוסרו ממנו/ה)' : ''))) return;
      state.lessons.forEach(l => l.teacherIds = l.teacherIds.filter(x => x !== t.id));
      state.lessons = state.lessons.filter(l => l.teacherIds.length || l.classIds.length);
      state.classes.forEach(c => { if (c.homeroomTeacherId === t.id) c.homeroomTeacherId = null; });
      state.teachers = state.teachers.filter(x => x.id !== t.id);
      save(); renderAll();
    });
  });

  // כיתות
  const ct = document.getElementById('classes-table');
  ct.innerHTML = '<tr><th>שם הכיתה</th><th>מחנכת</th><th></th></tr>' +
    state.classes.map(c =>
      '<tr data-id="' + c.id + '">' +
      '<td><input type="text" data-f="name" value="' + esc(c.name) + '"></td>' +
      '<td><select data-f="homeroom"><option value="">—</option>' +
      state.teachers.map(t => '<option value="' + t.id + '"' + (c.homeroomTeacherId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') +
      '</select></td>' +
      '<td><button class="btn-del" title="מחיקה">🗑️</button></td></tr>'
    ).join('');
  ct.querySelectorAll('tr[data-id]').forEach(tr => {
    const c = klass(tr.dataset.id);
    tr.querySelector('[data-f="name"]').addEventListener('change', e => { c.name = e.target.value.trim() || c.name; save(); renderAllBoards(); });
    tr.querySelector('[data-f="homeroom"]').addEventListener('change', e => { c.homeroomTeacherId = e.target.value || null; save(); renderAllBoards(); });
    tr.querySelector('.btn-del').addEventListener('click', () => {
      const used = state.lessons.filter(l => l.classIds.includes(c.id)).length;
      if (!confirm('למחוק את כיתה ' + c.name + '?' + (used ? ' (יש לה ' + used + ' שיבוצים — הם יוסרו ממנה)' : ''))) return;
      state.lessons.forEach(l => l.classIds = l.classIds.filter(x => x !== c.id));
      state.lessons = state.lessons.filter(l => l.teacherIds.length || l.classIds.length);
      const goneStudents = new Set(studentsOf(c.id).map(s => s.id));
      state.lessons.forEach(l => { if (l.studentIds) l.studentIds = l.studentIds.filter(x => !goneStudents.has(x)); });
      state.students = state.students.filter(s => s.classId !== c.id);
      state.classes = state.classes.filter(x => x.id !== c.id);
      save(); renderAll();
    });
  });

  // מקצועות
  const st = document.getElementById('subjects-table');
  st.innerHTML = '<tr><th>שם המקצוע</th><th>צבע</th><th></th></tr>' +
    state.subjects.map(sb =>
      '<tr data-id="' + sb.id + '">' +
      '<td><input type="text" data-f="name" value="' + esc(sb.name) + '"></td>' +
      '<td><input type="color" data-f="color" value="' + sb.color + '"></td>' +
      '<td><button class="btn-del" title="מחיקה">🗑️</button></td></tr>'
    ).join('');
  st.querySelectorAll('tr[data-id]').forEach(tr => {
    const sb = subject(tr.dataset.id);
    tr.querySelector('[data-f="name"]').addEventListener('change', e => { sb.name = e.target.value.trim() || sb.name; save(); renderAllBoards(); });
    tr.querySelector('[data-f="color"]').addEventListener('change', e => { sb.color = e.target.value; save(); renderAllBoards(); });
    tr.querySelector('.btn-del').addEventListener('click', () => {
      if (!confirm('למחוק את המקצוע ' + sb.name + '? שיבוצים קיימים יישארו בלי מקצוע.')) return;
      state.lessons.forEach(l => { if (l.subjectId === sb.id) l.subjectId = null; });
      state.classes.forEach(c => c.subjectQuotas = (c.subjectQuotas || []).filter(q => q.subjectId !== sb.id));
      state.subjects = state.subjects.filter(x => x.id !== sb.id);
      save(); renderAll();
    });
  });

  renderStudentsCard();

  // מטריצת תקן כיתתי
  const mq = document.getElementById('class-quotas-table');
  if (!state.subjects.length || !state.classes.length) {
    mq.innerHTML = '<tr><td class="section-hint">כדי להזין תקן — צריך קודם מקצועות וכיתות.</td></tr>';
  } else {
    mq.innerHTML = '<tr><th>מקצוע \\ כיתה</th>' + state.classes.map(c => '<th>' + esc(c.name) + '</th>').join('') + '</tr>' +
      state.subjects.map(sb =>
        '<tr><td>' + esc(sb.name) + '</td>' +
        state.classes.map(c => {
          const v = classQuotaOf(c, sb.id);
          return '<td><input type="number" min="0" max="30" data-cid="' + c.id + '" data-sid="' + sb.id + '" value="' + (v || '') + '" placeholder="—"></td>';
        }).join('') + '</tr>'
      ).join('');
    mq.querySelectorAll('input[data-cid]').forEach(inp => inp.addEventListener('change', () => {
      setClassQuota(klass(inp.dataset.cid), inp.dataset.sid, +inp.value || 0);
      save(); renderAllBoards();
    }));
  }
}

/* ===== תלמידים בחלונית השיבוץ ===== */
// משבצות "אחיות" — אותה קבוצה: אותם מורים + אותו מקצוע + אותן כיתות
function siblingLessons(ref, excludeId) {
  const t = JSON.stringify([...ref.teacherIds].sort());
  const c = JSON.stringify([...ref.classIds].sort());
  return state.lessons.filter(l => l.id !== excludeId &&
    l.subjectId === ref.subjectId &&
    JSON.stringify([...l.teacherIds].sort()) === t &&
    JSON.stringify([...l.classIds].sort()) === c);
}

let studentsTouched = false; // האם המשתמשת נגעה במקטע התלמידים בחלונית הנוכחית

// initialSet: סט מזהים לסימון התחלתי (מעריכה); בלי פרמטר — משמרים את הסימונים הנוכחיים
function renderLessonStudents(initialSet) {
  const ctx = modalCtx;
  if (!ctx) return;
  const checkedClasses = [...document.querySelectorAll('#lesson-classes input:checked')].map(i => i.value);
  const checked = initialSet ||
    new Set([...document.querySelectorAll('#lesson-students input:checked')].map(i => i.value));
  const pool = state.students.filter(s => checkedClasses.includes(s.classId));

  // ⚠️ כבר בקבוצה אחרת באותה שעה | 🕐 טרם שובץ לאף קבוצה
  const inOtherGroup = new Map();
  for (const l of state.lessons) {
    if (l.day === ctx.day && l.hour === ctx.hour && l.id !== ctx.editingId) {
      const label = (l.subjectId && subject(l.subjectId) ? subject(l.subjectId).name : l.type) + (l.note ? ' · ' + l.note : '');
      lessonStudents(l).forEach(sid => inOtherGroup.set(sid, label));
    }
  }
  const assignedAnywhere = new Set(state.lessons.flatMap(lessonStudents));

  document.getElementById('lesson-students').innerHTML = pool.map(s => {
    let badge = '';
    if (inOtherGroup.has(s.id)) badge = ' <span title="כבר בקבוצה אחרת בשעה זו: ' + esc(inOtherGroup.get(s.id)) + '">⚠️</span>';
    else if (!assignedAnywhere.has(s.id)) badge = ' <span title="טרם שובץ/ה לאף קבוצה">🕐</span>';
    return '<label><input type="checkbox" value="' + s.id + '"' + (checked.has(s.id) ? ' checked' : '') + '> ' + esc(s.name) + badge + '</label>';
  }).join('') || '<span class="section-hint">אין תלמידים בכיתות שסומנו — אפשר להוסיף כאן למטה או בהגדרות</span>';

  // בחירת כיתה להוספת שם חדש (רק כשמסומנות כמה כיתות)
  const clsSel = document.getElementById('new-student-class');
  clsSel.hidden = checkedClasses.length <= 1;
  clsSel.innerHTML = checkedClasses.map(cid => '<option value="' + cid + '">' + esc(klass(cid) ? klass(cid).name : '') + '</option>').join('');

  // סנכרון לקבוצה: כמה משבצות נוספות יש לאותה קבוצה (מורים+מקצוע+כיתות כפי שמסומן כרגע)
  const refTeachers = [...document.querySelectorAll('#lesson-teachers input:checked')].map(i => i.value);
  const sibs = siblingLessons({ teacherIds: refTeachers, classIds: checkedClasses, subjectId: resolveSubjectId(false) }, ctx.editingId);
  document.getElementById('students-sync-row').hidden = !sibs.length;
  document.getElementById('students-sync-count').textContent = sibs.length;
  updateStudentsCount();
}

function updateStudentsCount() {
  document.getElementById('students-count').textContent =
    document.querySelectorAll('#lesson-students input:checked').length;
}

function addInlineStudent() {
  const name = document.getElementById('new-student-name').value.trim();
  if (!name) return;
  const checkedClasses = [...document.querySelectorAll('#lesson-classes input:checked')].map(i => i.value);
  if (!checkedClasses.length) { toast('קודם מסמנים כיתה'); return; }
  const cid = checkedClasses.length === 1 ? checkedClasses[0] : document.getElementById('new-student-class').value;
  let st = studentsOf(cid).find(s => s.name === name);
  if (!st) {
    st = { id: uid(), name, classId: cid };
    state.students.push(st);
    save();
    toast('✨ נוסף/ה תלמיד/ה: ' + name + ' (' + klass(cid).name + ')');
  }
  const cur = new Set([...document.querySelectorAll('#lesson-students input:checked')].map(i => i.value));
  cur.add(st.id);
  document.getElementById('new-student-name').value = '';
  renderLessonStudents(cur);
}

/* ===== עוזר חכם — הצעות לתא ===== */
function freeTeachersAt(day, hour) {
  const busy = new Set();
  for (const l of state.lessons) if (l.day === day && l.hour === hour) l.teacherIds.forEach(t => busy.add(t));
  return state.teachers
    .filter(t => !busy.has(t.id) && !(t.freeDays || []).includes(day))
    .map(t => ({ t, counts: teacherCounts(t.id) }))
    .filter(x => (+x.t.quota?.frontal || 0) > 0 && x.counts.frontal < +x.t.quota.frontal);
}

function subjectTeacherIds(sid) {
  const s = new Set();
  for (const l of state.lessons) if (l.subjectId === sid) l.teacherIds.forEach(t => s.add(t));
  return s;
}

function computeSuggestions(day, hour, classId) {
  const c = klass(classId);
  if (!c) return { items: [], free: [] };
  const counts = classSubjectCounts(classId);
  const free = freeTeachersAt(day, hour);
  const freeIds = new Set(free.map(x => x.t.id));

  const gaps = (c.subjectQuotas || [])
    .map(q => ({ sid: q.subjectId, gap: (+q.weeklyHours || 0) - (counts[q.subjectId] || 0) }))
    .filter(g => g.gap > 0 && subject(g.sid))
    .sort((a, b) => b.gap - a.gap);

  const items = [];
  for (const g of gaps) {
    const experienced = subjectTeacherIds(g.sid);
    // עדיפות: מורה שכבר מלמד את המקצוע > המחנכת > כל מורה פנוי
    let cand = free.find(x => experienced.has(x.t.id));
    let why = cand ? 'מלמד/ת את המקצוע ופנוי/ה' : '';
    if (!cand && c.homeroomTeacherId && freeIds.has(c.homeroomTeacherId)) {
      cand = free.find(x => x.t.id === c.homeroomTeacherId);
      why = 'המחנכת פנויה';
    }
    if (!cand) { cand = free[0]; why = cand ? 'פנוי/ה בשעה זו' : ''; }
    items.push({ sid: g.sid, gap: g.gap, teacher: cand ? cand.t : null, why });
    if (items.length >= 5) break;
  }
  return { items, free };
}

function renderSuggestions() {
  const box = document.getElementById('smart-suggestions');
  const ctx = modalCtx;
  if (!ctx || ctx.editingId || !ctx.classId) { box.hidden = true; return; }
  const { items, free } = computeSuggestions(ctx.day, ctx.hour, ctx.classId);
  if (!items.length && !free.length) { box.hidden = true; return; }

  let html = '<p class="sugg-title">💡 הצעות חכמות לתא הזה</p>';
  if (items.length) {
    html += items.map((it, i) =>
      '<button type="button" class="sugg-item" data-i="' + i + '">' +
      '<span class="sugg-subject">' + esc(subject(it.sid).name) + '</span>' +
      '<span class="sugg-gap">חסרות ' + it.gap + ' שע\' לתקן</span>' +
      (it.teacher ? '<span class="sugg-teacher">' + esc(it.teacher.name) + ' · ' + esc(it.why) + '</span>'
        : '<span class="sugg-teacher">אין מורה פנוי כרגע</span>') +
      '</button>').join('');
  } else {
    html += '<p class="sugg-free">אין מקצועות חסרים מול התקן לכיתה זו 🎉 (או שטרם הוגדר תקן בהגדרות)</p>';
  }
  if (free.length) {
    const names = free.slice(0, 8).map(x => x.t.name).join(', ');
    html += '<p class="sugg-free"><b>פנויים בשעה זו ומתחת למכסה:</b> ' + esc(names) + (free.length > 8 ? ' ועוד ' + (free.length - 8) : '') + '</p>';
  }
  box.innerHTML = html;
  box.hidden = false;

  const { items: its } = { items };
  box.querySelectorAll('.sugg-item').forEach(btn => btn.addEventListener('click', () => {
    const it = its[+btn.dataset.i];
    document.getElementById('lesson-subject').value = subject(it.sid).name;
    document.querySelectorAll('#lesson-teachers input').forEach(cb => { cb.checked = it.teacher ? cb.value === it.teacher.id : false; });
    document.getElementById('lesson-type').value = 'פרונטלי';
    updateAssignModeUI();
    toast('ההצעה מולאה — אפשר לשנות ואז לשמור');
  }));
}

/* ===== מצב שכפול (שיבוץ בודד או בלוק שלם) ===== */
let copySource = null; // {lessons: [...]}

function describeLesson(l) {
  const sub = l.subjectId && subject(l.subjectId) ? subject(l.subjectId).name : l.type;
  const who = l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').filter(Boolean).join(' + ') || '❓ חסר מורה';
  return sub + ' · ' + who + (l.note ? ' (' + l.note + ')' : '');
}

function startCopyMode(lessonIds) {
  const lessons = lessonIds.map(id => byId(state.lessons, id)).filter(Boolean);
  if (!lessons.length) return;
  copySource = { lessons };
  closeModal();
  document.getElementById('copy-bar-text').textContent = lessons.length === 1
    ? describeLesson(lessons[0])
    : 'בלוק של ' + lessons.length + ' שיבוצים: ' + lessons.map(describeLesson).join(' ┃ ');
  document.getElementById('copy-bar').hidden = false;
  document.body.classList.add('copying');
  switchTab('classes-board');
}

function endCopyMode() {
  copySource = null;
  document.getElementById('copy-bar').hidden = true;
  document.body.classList.remove('copying');
}

function pasteLessonTo(day, hour, classId) {
  if (!copySource) return;
  const allTeachers = [...new Set(copySource.lessons.flatMap(l => l.teacherIds))];
  const blocked = freeDayViolators(allTeachers, day);
  if (blocked.length) { toast('⛔ יום ' + day + "' הוא יום חופשי של: " + blocked.join(', ')); return; }
  let added = 0, skipped = 0, sharedPaste = false;
  for (const src of copySource.lessons) {
    // שיעור משותף לכמה כיתות נשאר משותף בהדבקה (כשמדביקים באחת מהכיתות שלו);
    // שיעור של כיתה אחת מודבק לכיתה שלוחצים עליה
    const targetClasses = (src.classIds.length > 1 && src.classIds.includes(classId))
      ? [...src.classIds] : [classId];
    if (targetClasses.length > 1) sharedPaste = true;
    const dup = state.lessons.some(l => l.day === day && l.hour === hour &&
      l.subjectId === src.subjectId &&
      JSON.stringify([...l.classIds].sort()) === JSON.stringify([...targetClasses].sort()) &&
      JSON.stringify([...l.teacherIds].sort()) === JSON.stringify([...src.teacherIds].sort()));
    if (dup) { skipped++; continue; }
    // תלמידים עוברים בהעתקה רק כשהיעד הוא אותן כיתות (שעה אחרת לאותם ילדים)
    const sameClasses = JSON.stringify([...targetClasses].sort()) === JSON.stringify([...src.classIds].sort());
    state.lessons.push({
      id: uid(), day, hour, classIds: targetClasses,
      teacherIds: [...src.teacherIds], subjectId: src.subjectId, type: src.type, note: src.note,
      studentIds: sameClasses ? [...lessonStudents(src)] : []
    });
    added++;
  }
  save(); renderAllBoards();
  toast(added
    ? '✓ הודבקו ' + added + (sharedPaste ? ' — שיעור משותף, נכנס לכל הכיתות שלו' : '') + (skipped ? ' (' + skipped + ' כבר היו)' : '')
    : 'הכל כבר קיים בתא הזה');
}

// הדבקת שיבוץ ללא כיתה (שהות/תפקיד/פרטני) על תא בלוח המורים
function pasteTeacherLessonTo(day, hour, teacherId) {
  if (!copySource) return;
  const blocked = freeDayViolators([teacherId], day);
  if (blocked.length) { toast('⛔ יום ' + day + "' הוא יום חופשי של: " + blocked.join(', ')); return; }
  let added = 0;
  for (const src of copySource.lessons) {
    const dup = state.lessons.some(l => l.day === day && l.hour === hour &&
      !l.classIds.length && l.teacherIds.length === 1 && l.teacherIds[0] === teacherId &&
      l.type === src.type && l.subjectId === src.subjectId);
    if (dup) continue;
    state.lessons.push({
      id: uid(), day, hour, classIds: [], teacherIds: [teacherId],
      subjectId: src.subjectId, type: src.type, note: src.note, studentIds: []
    });
    added++;
  }
  save(); renderAllBoards();
  toast(added ? '✓ הודבק אצל ' + ((teacher(teacherId) || {}).name || '') + ' — ובסיום ✔' : 'כבר קיים בתא הזה');
}

/* ===== תלמידים — כרטיס הגדרות ===== */
function renderStudentsCard() {
  const sel = document.getElementById('students-class-select');
  const prev = sel.value;
  sel.innerHTML = state.classes.map(c =>
    '<option value="' + c.id + '">' + esc(c.name) + ' (' + studentsOf(c.id).length + ' תלמידים)</option>').join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  const cid = sel.value;
  const list = document.getElementById('students-list');
  if (!cid) { list.innerHTML = '<span class="section-hint">קודם צריך להגדיר כיתות</span>'; return; }
  list.innerHTML = studentsOf(cid).map(s =>
    '<span class="student-tag">' + esc(s.name) + ' <button class="btn-del" data-sid="' + s.id + '" title="מחיקה">🗑</button></span>').join('') ||
    '<span class="section-hint">אין תלמידים בכיתה זו עדיין — הדביקי רשימה למעלה</span>';
  list.querySelectorAll('[data-sid]').forEach(b => b.addEventListener('click', () => {
    const s = student(b.dataset.sid);
    if (!confirm('למחוק את ' + s.name + '? השם יוסר גם מכל הקבוצות שהוא משויך אליהן.')) return;
    state.lessons.forEach(l => { if (l.studentIds) l.studentIds = l.studentIds.filter(x => x !== s.id); });
    state.students = state.students.filter(x => x.id !== s.id);
    save(); renderStudentsCard();
  }));
}

function addStudentsFromPaste() {
  const cid = document.getElementById('students-class-select').value;
  if (!cid) { toast('קודם צריך להגדיר כיתות'); return; }
  const names = document.getElementById('students-paste').value.split('\n').map(x => x.trim()).filter(Boolean);
  if (!names.length) { toast('הדביקי שמות — שם בכל שורה'); return; }
  let added = 0;
  for (const name of names) {
    if (!studentsOf(cid).some(s => s.name === name)) { state.students.push({ id: uid(), name, classId: cid }); added++; }
  }
  document.getElementById('students-paste').value = '';
  save(); renderStudentsCard();
  toast(added ? '✓ נוספו ' + added + ' תלמידים לכיתה ' + klass(cid).name : 'כל השמות כבר קיימים בכיתה');
}

/* ===== חלונית שיבוץ ===== */
let modalCtx = null; // {day, hour, classId?, teacherId?, editingId?}

// שמות המורים מתוך הרשימה שהיום הזה הוא יום חופשי שלהם
function freeDayViolators(teacherIds, day) {
  return teacherIds.map(id => teacher(id))
    .filter(t => t && (t.freeDays || []).includes(day))
    .map(t => t.name);
}

// שדה המקצוע הוא טקסט חופשי — תרגום שם ↔ מזהה, עם יצירה אוטומטית של מקצוע חדש
function resolveSubjectId(createIfMissing) {
  const name = document.getElementById('lesson-subject').value.trim();
  if (!name) return null;
  let sb = state.subjects.find(s => s.name === name);
  if (!sb && createIfMissing) {
    sb = { id: uid(), name, color: nextColor() };
    state.subjects.push(sb);
    toast('✨ נוסף מקצוע חדש: ' + name);
  }
  return sb ? sb.id : null;
}

function renderTeacherChecklist(selectedIds) {
  document.getElementById('lesson-teachers').innerHTML = state.teachers.map(t =>
    '<label><input type="checkbox" value="' + t.id + '"' + (selectedIds.includes(t.id) ? ' checked' : '') + '> ' + esc(t.name) + '</label>').join('') ||
    '<span class="section-hint">אין מורים — הקלידי שם למעלה כדי להוסיף</span>';
  document.querySelectorAll('#lesson-teachers input').forEach(cb => cb.addEventListener('change', updateAssignModeUI));
  applyTeacherFilter();
}

function applyTeacherFilter() {
  const q = document.getElementById('teacher-filter').value.trim();
  document.querySelectorAll('#lesson-teachers label').forEach(lb => {
    lb.style.display = (!q || lb.textContent.includes(q) || lb.querySelector('input').checked) ? '' : 'none';
  });
  const exact = state.teachers.some(t => t.name === q);
  const btn = document.getElementById('btn-new-teacher-inline');
  btn.hidden = !q || exact;
  if (!btn.hidden) btn.textContent = '➕ הוספת "' + q + '" כמורה חדש/ה';
}

function addInlineTeacher() {
  const name = document.getElementById('teacher-filter').value.trim();
  if (!name || state.teachers.some(t => t.name === name)) return;
  const t = { id: uid(), name, role: 'מקצועי', quota: { frontal: 0, prati: 0, shehut: 0 } };
  state.teachers.push(t);
  save();
  const checked = [...document.querySelectorAll('#lesson-teachers input:checked')].map(i => i.value);
  checked.push(t.id);
  document.getElementById('teacher-filter').value = '';
  renderTeacherChecklist(checked);
  updateAssignModeUI();
  toast('✨ נוסף/ה מורה חדש/ה: ' + name + ' (את המכסה קובעים בהגדרות)');
}

function slotLessonsFor(ctx) {
  return state.lessons.filter(l => l.day === ctx.day && l.hour === ctx.hour &&
    (ctx.classId ? l.classIds.includes(ctx.classId) : l.teacherIds.includes(ctx.teacherId)));
}

function openLessonModal(ctx) {
  modalCtx = ctx;
  studentsTouched = false;
  document.getElementById('students-sync').checked = true;
  const existing = slotLessonsFor(ctx);
  modalCtx.editingId = existing.length === 1 ? existing[0].id : null;
  fillModal();
  document.getElementById('modal-backdrop').hidden = false;
}

function fillModal() {
  const ctx = modalCtx;
  const colName = ctx.classId ? ('כיתה ' + (klass(ctx.classId) ? klass(ctx.classId).name : ''))
    : (teacher(ctx.teacherId) ? teacher(ctx.teacherId).name : '');
  document.getElementById('modal-title').textContent =
    'שיבוץ — יום ' + ctx.day + "' שעה " + ctx.hour + ' — ' + colName;

  // שיעורים קיימים בתא
  const existing = slotLessonsFor(ctx);
  const holder = document.getElementById('slot-lessons');
  if (existing.length) {
    holder.innerHTML = '<label style="font-weight:700;font-size:.9rem">שיבוצים בתא זה: ' +
      (existing.length >= 2 ? '<button type="button" class="btn small" id="btn-copy-block">📋 שכפול כל התא כבלוק</button>' : '') + '</label>' +
      existing.map(l => {
        const sub = l.subjectId && subject(l.subjectId) ? subject(l.subjectId).name : l.type;
        const who = l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').filter(Boolean).join(' + ');
        return '<div class="slot-lesson-row' + (l.id === ctx.editingId ? ' editing' : '') + '">' +
          '<span class="grow">' + esc(sub) + (who ? ' · ' + esc(who) : '') + (l.note ? ' <small>(' + esc(l.note) + ')</small>' : '') + '</span>' +
          (l.id === ctx.editingId ? '<span style="font-size:.75rem;color:var(--primary);font-weight:700">בעריכה</span>'
            : '<button class="btn small" data-edit="' + l.id + '">✏️ עריכה</button>') +
          '<button class="btn small" data-copy="' + l.id + '" title="שכפול לתאים אחרים">📋</button>' +
          '<button class="btn small danger" data-del="' + l.id + '" title="מחיקת השיבוץ הזה">🗑</button></div>';
      }).join('') +
      (ctx.editingId
        ? '<button class="btn small add" id="btn-new-in-slot">+ שיבוץ נוסף באותו תא</button>'
        : '<div class="new-in-slot-hint">➕ הטופס שלמטה יוסיף <b>שיבוץ חדש</b> לתא הזה, בנוסף לקיימים</div>');
  } else {
    holder.innerHTML = '';
  }
  holder.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    modalCtx.editingId = b.dataset.edit; fillModal();
  }));
  holder.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => startCopyMode([b.dataset.copy])));
  const blockBtn = document.getElementById('btn-copy-block');
  if (blockBtn) blockBtn.addEventListener('click', () => startCopyMode(existing.map(l => l.id)));
  holder.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('למחוק את השיבוץ הזה?')) return;
    state.lessons = state.lessons.filter(l => l.id !== b.dataset.del);
    if (modalCtx.editingId === b.dataset.del) modalCtx.editingId = null;
    const remaining = slotLessonsFor(modalCtx);
    if (!modalCtx.editingId && remaining.length === 1) modalCtx.editingId = remaining[0].id;
    save(); renderAllBoards(); fillModal();
    toast('השיבוץ נמחק ✓');
  }));
  const newBtn = document.getElementById('btn-new-in-slot');
  if (newBtn) newBtn.addEventListener('click', () => { modalCtx.editingId = null; fillModal(); });

  const editing = ctx.editingId ? byId(state.lessons, ctx.editingId) : null;

  // מקצוע — הקלדה חופשית עם השלמות
  document.getElementById('subjects-datalist').innerHTML =
    state.subjects.map(sb => '<option value="' + esc(sb.name) + '"></option>').join('');
  const editSub = editing && editing.subjectId ? subject(editing.subjectId) : null;
  document.getElementById('lesson-subject').value = editSub ? editSub.name : '';

  // סוג
  document.getElementById('lesson-type').innerHTML = LESSON_TYPES.map(t =>
    '<option' + ((editing ? editing.type === t : t === 'פרונטלי') ? ' selected' : '') + '>' + t + '</option>').join('');

  // מורים — רשימה מסתננת תוך כדי הקלדה
  const selT = editing ? editing.teacherIds : (ctx.teacherId ? [ctx.teacherId] : []);
  document.getElementById('teacher-filter').value = '';
  renderTeacherChecklist(selT);
  document.getElementById('teacher-filter').oninput = applyTeacherFilter;
  document.getElementById('teacher-filter').onkeydown = e => {
    if (e.key === 'Enter' && !document.getElementById('btn-new-teacher-inline').hidden) addInlineTeacher();
  };
  document.getElementById('btn-new-teacher-inline').onclick = addInlineTeacher;

  // כיתות
  const selC = editing ? editing.classIds : (ctx.classId ? [ctx.classId] : []);
  document.getElementById('lesson-classes').innerHTML = state.classes.map(c =>
    '<label><input type="checkbox" value="' + c.id + '"' + (selC.includes(c.id) ? ' checked' : '') + '> ' + esc(c.name) + '</label>').join('') ||
    '<span class="section-hint">אין כיתות — הוסיפי בהגדרות</span>';

  document.getElementById('lesson-note').value = editing ? (editing.note || '') : '';
  document.getElementById('lesson-delete').hidden = !editing;

  // מצבי שיבוץ: כיתות (משותף/נפרד) ומורים (יחד/כל אחד תוכן משלו)
  document.querySelector('input[name="assign-mode"][value="together"]').checked = true;
  document.querySelector('input[name="teacher-mode"][value="together"]').checked = true;
  document.querySelectorAll('#lesson-classes input').forEach(cb => cb.addEventListener('change', updateAssignModeUI));
  document.querySelectorAll('input[name="assign-mode"], input[name="teacher-mode"]').forEach(r => { r.onchange = updateAssignModeUI; });
  document.getElementById('check-all-classes').onclick = () => {
    const boxes = [...document.querySelectorAll('#lesson-classes input')];
    const allChecked = boxes.every(b => b.checked);
    boxes.forEach(b => b.checked = !allChecked);
    updateAssignModeUI();
  };

  // כפתורי שכבה — לחיצה מסמנת את כל כיתות השכבה (מופיעים רק לשכבות עם 2+ כיתות)
  const grades = {};
  for (const c of state.classes) { const g = classGrade(c.name); if (g) (grades[g] = grades[g] || []).push(c.id); }
  const gradeHolder = document.getElementById('grade-buttons');
  gradeHolder.innerHTML = Object.entries(grades).filter(([, ids]) => ids.length >= 2)
    .map(([g, ids]) => '<button type="button" class="btn small" data-grade="' + g + '">שכבת ' + g + "'</button>").join('');
  gradeHolder.querySelectorAll('[data-grade]').forEach(b => b.addEventListener('click', () => {
    const ids = grades[b.dataset.grade];
    const boxes = ids.map(id => document.querySelector('#lesson-classes input[value="' + id + '"]')).filter(Boolean);
    const allChecked = boxes.every(cb => cb.checked);
    boxes.forEach(cb => { cb.checked = !allChecked; });
    updateAssignModeUI();
  }));
  updateAssignModeUI();
  document.getElementById('students-box').hidden = true; // מקטע התלמידים מתחיל מקופל
  renderLessonStudents(new Set(editing ? lessonStudents(editing) : []));
  if (editing && lessonStudents(editing).length) document.getElementById('students-box').hidden = false;
  renderSuggestions();
}

function updateAssignModeUI() {
  const checkedClasses = [...document.querySelectorAll('#lesson-classes input:checked')].map(i => i.value);
  const checkedTeachers = [...document.querySelectorAll('#lesson-teachers input:checked')].map(i => i.value);
  const editing = modalCtx && modalCtx.editingId;

  // מצב כיתות: משותף / נפרד לכל כיתה
  const showClassMode = !editing && checkedClasses.length >= 2;
  document.getElementById('assign-mode-row').hidden = !showClassMode;
  const classSplit = showClassMode && document.querySelector('input[name="assign-mode"]:checked').value === 'split';
  document.getElementById('teachers-row').hidden = classSplit;
  document.getElementById('split-teachers-row').hidden = !classSplit;

  // מצב מורים: יחד / כל מורה תוכן משלו
  const showTeacherMode = !editing && !classSplit && checkedTeachers.length >= 2;
  document.getElementById('teacher-mode-row').hidden = !showTeacherMode;
  const teacherEach = showTeacherMode && document.querySelector('input[name="teacher-mode"]:checked').value === 'each';
  document.getElementById('split-subjects-row').hidden = !teacherEach;
  document.getElementById('subject-row').hidden = teacherEach;

  // תלמידים — רלוונטי לשיבוץ בודד (לא במצבי פיצול; שם משייכים בעריכת כל קבוצה אחרי היצירה)
  const showStudents = !classSplit && !teacherEach && checkedClasses.length > 0;
  document.getElementById('students-row').hidden = !showStudents;
  if (showStudents) renderLessonStudents();

  if (classSplit) {
    const holder = document.getElementById('split-teachers');
    const prev = {}, prevSub = {};
    holder.querySelectorAll('select[data-cid]').forEach(s => { prev[s.dataset.cid] = s.value; });
    holder.querySelectorAll('select[data-cid-sub]').forEach(s => { prevSub[s.dataset.cidSub] = s.value; });
    const mainSubject = resolveSubjectId(false);
    holder.innerHTML = checkedClasses.map(cid => {
      const c = klass(cid);
      const def = (cid in prev) ? prev[cid] : (c.homeroomTeacherId || '');
      const defSub = (cid in prevSub) ? prevSub[cid] : (mainSubject || '');
      return '<div class="split-line"><span>' + esc(c.name) + '</span>' +
        '<select data-cid="' + cid + '"><option value="">— ללא מורה —</option>' +
        state.teachers.map(t => '<option value="' + t.id + '"' + (def === t.id ? ' selected' : '') + '>' +
          esc(t.name) + (c.homeroomTeacherId === t.id ? ' 🏠 (המחנכת)' : '') + '</option>').join('') +
        '</select>' +
        '<select data-cid-sub="' + cid + '" title="מקצוע לכיתה זו"><option value="">מקצוע: כמו למעלה</option>' +
        state.subjects.map(sb => '<option value="' + sb.id + '"' + (defSub === sb.id ? ' selected' : '') + '>' + esc(sb.name) + '</option>').join('') +
        '</select></div>';
    }).join('');
  }

  if (teacherEach) {
    const holder = document.getElementById('split-subjects');
    const prev = {}, prevG = {};
    holder.querySelectorAll('select').forEach(s => { prev[s.dataset.tid] = s.value; });
    holder.querySelectorAll('input[data-tid]').forEach(i => { prevG[i.dataset.tid] = i.value; });
    const mainSubject = resolveSubjectId(false);
    holder.innerHTML = checkedTeachers.map(tid => {
      const t = teacher(tid);
      const def = (tid in prev) ? prev[tid] : mainSubject;
      return '<div class="split-line"><span>' + esc(t ? t.name : '') + '</span><select data-tid="' + tid + '">' +
        '<option value="">— ללא מקצוע —</option>' +
        state.subjects.map(sb => '<option value="' + sb.id + '"' + (def === sb.id ? ' selected' : '') + '>' + esc(sb.name) + '</option>').join('') +
        '</select>' +
        '<input type="text" data-tid="' + tid + '" list="group-datalist" class="group-input" placeholder="קבוצה (מתקדמים...)" value="' + esc(prevG[tid] || '') + '">' +
        '</div>';
    }).join('');
  }
}

function closeModal() {
  document.getElementById('modal-backdrop').hidden = true;
  modalCtx = null;
}

function saveLessonFromModal() {
  const ctx = modalCtx;
  const classIds = [...document.querySelectorAll('#lesson-classes input:checked')].map(i => i.value);
  // במצב "כל מורה תוכן משלו" המקצוע נקבע פר-מורה — לא יוצרים מקצוע מהשדה הראשי המוסתר
  const teacherEachMode = !ctx.editingId && !document.getElementById('teacher-mode-row').hidden &&
    document.querySelector('input[name="teacher-mode"]:checked').value === 'each';
  const common = {
    day: ctx.day, hour: ctx.hour,
    subjectId: teacherEachMode ? null : resolveSubjectId(true),
    type: document.getElementById('lesson-type').value,
    note: document.getElementById('lesson-note').value.trim()
  };

  // שיבוץ נפרד לכל כיתה — נוצר שיעור נפרד עם המורה שנבחר לה
  const splitMode = !ctx.editingId && !document.getElementById('assign-mode-row').hidden &&
    document.querySelector('input[name="assign-mode"]:checked').value === 'split';
  if (splitMode) {
    const sels = [...document.querySelectorAll('#split-teachers select[data-cid]')];
    const blocked = freeDayViolators(sels.map(s => s.value).filter(Boolean), ctx.day);
    if (blocked.length) { toast('⛔ יום ' + ctx.day + "' הוא יום חופשי של: " + blocked.join(', ')); return; }
    for (const s of sels) {
      const subSel = document.querySelector('#split-teachers select[data-cid-sub="' + s.dataset.cid + '"]');
      const subjectId = (subSel && subSel.value) ? subSel.value : common.subjectId;
      state.lessons.push(Object.assign({ id: uid(), classIds: [s.dataset.cid], teacherIds: s.value ? [s.value] : [] }, common, { subjectId }));
    }
    save(); closeModal(); renderAllBoards();
    toast(sels.length + ' שיבוצים נשמרו — אחד לכל כיתה ✓');
    return;
  }

  const teacherIds = [...document.querySelectorAll('#lesson-teachers input:checked')].map(i => i.value);
  if (!teacherIds.length && !classIds.length) { toast('צריך לבחור לפחות מורה אחד או כיתה אחת'); return; }

  const blocked = freeDayViolators(teacherIds, ctx.day);
  if (blocked.length) { toast('⛔ יום ' + ctx.day + "' הוא יום חופשי של: " + blocked.join(', ')); return; }

  // כל מורה מלמד תוכן משלו — שיעור נפרד לכל מורה עם המקצוע שלו
  if (teacherEachMode) {
    const sels = [...document.querySelectorAll('#split-subjects select')];
    for (const s of sels) {
      const group = (document.querySelector('#split-subjects input[data-tid="' + s.dataset.tid + '"]') || {}).value || '';
      state.lessons.push(Object.assign({ id: uid(), classIds, teacherIds: [s.dataset.tid] }, common,
        { subjectId: s.value || null, note: group.trim() || common.note }));
    }
    save(); closeModal(); renderAllBoards();
    toast(sels.length + ' שיבוצים נשמרו — קבוצה לכל מורה ✓');
    return;
  }
  // תלמידים — רק כאלה שהכיתה שלהם עדיין מסומנת
  const studentIds = [...document.querySelectorAll('#lesson-students input:checked')].map(i => i.value)
    .filter(sid => { const s = student(sid); return s && classIds.includes(s.classId); });
  const data = Object.assign({ teacherIds, classIds, studentIds }, common);
  let savedLesson;
  if (ctx.editingId) {
    savedLesson = byId(state.lessons, ctx.editingId);
    Object.assign(savedLesson, data);
  } else {
    savedLesson = Object.assign({ id: uid() }, data);
    state.lessons.push(savedLesson);
  }

  // סנכרון שמות לכל המשבצות של אותה קבוצה — רק אם נגעו במקטע התלמידים והצ'קבוקס מסומן
  let synced = 0;
  if (studentsTouched && !document.getElementById('students-sync-row').hidden &&
      document.getElementById('students-sync').checked) {
    const sibs = siblingLessons(savedLesson, savedLesson.id);
    sibs.forEach(l => { l.studentIds = [...studentIds]; });
    synced = sibs.length;
  }

  save(); closeModal(); renderAllBoards();
  toast(synced ? '✓ נשמר, והשמות עודכנו גם ב-' + synced + ' משבצות נוספות של הקבוצה' : 'השיבוץ נשמר ✓');
}

/* ===== רשימות לדוגמה (גנריות) ===== */
function loadSampleData() {
  if ((state.teachers.length || state.classes.length) &&
    !confirm('הרשימות לדוגמה יתווספו לרשימות הקיימות (בלי כפילויות בשמות). להמשיך?')) return;

  const q = (f, p, s) => ({ frontal: f, prati: p, shehut: s });
  const sampleClasses = ['ז1', 'ז2', 'ח1', 'ח2', 'ט1', 'ט2'];
  const sampleTeachers = [];
  sampleClasses.forEach((c, i) => sampleTeachers.push(['מחנכת ' + c, 'מחנכת', q(22, 4, 8)]));
  for (let i = 1; i <= 6; i++) sampleTeachers.push(['מורה מקצועי/ת ' + i, 'מקצועי', q(18, 3, 6)]);
  const sampleSubjects = ['חינוך', 'שחרית', 'מתמטיקה', 'אנגלית', 'עברית', 'חנ"ג', 'מדעים',
    'אומנות', 'מוזיקה', 'היסטוריה', 'תנ"ך', 'אזרחות', 'מחשבים'];

  for (const [name, role, quota] of sampleTeachers) {
    if (!state.teachers.some(t => t.name === name)) state.teachers.push({ id: uid(), name, role, quota });
  }
  for (const name of sampleClasses) {
    if (!state.classes.some(c => c.name === name)) {
      const hm = state.teachers.find(t => t.name === 'מחנכת ' + name);
      state.classes.push({ id: uid(), name, homeroomTeacherId: hm ? hm.id : null, subjectQuotas: [] });
    }
  }
  for (const name of sampleSubjects) {
    if (!state.subjects.some(s => s.name === name)) state.subjects.push({ id: uid(), name, color: nextColor() });
  }
  save(); renderAll();
  toast('רשימות הדוגמה נטענו — אפשר לערוך אותן בחופשיות ✓');
}

// זיהוי שכבה מתוך שם כיתה (משמש את כפתורי השכבה בחלונית השיבוץ)
function classGrade(name) {
  const m = (name || '').trim().match(/^(יג|יב|יא|י|ט|ח|ז)/);
  return m ? m[1] : null;
}

/* ===== ייצוא / ייבוא ===== */
function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'מערכת-שעות-' + (state.settings.year || '').replace(/["\s]/g, '') + '-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('קובץ הגיבוי ירד להורדות ✓');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.teachers) || !Array.isArray(parsed.lessons)) throw new Error('bad format');
      if (!confirm('הקובץ יחליף את כל הנתונים הנוכחיים. להמשיך?')) return;
      state = Object.assign(emptyState(), parsed);
      state.settings = Object.assign(emptyState().settings, parsed.settings || {});
      save(); renderAll();
      toast('הנתונים שוחזרו מהקובץ ✓');
    } catch (e) {
      toast('⚠️ הקובץ אינו קובץ גיבוי תקין');
    }
  };
  reader.readAsText(file);
}

/* ===== הדפסת סדין מלא — 6 עמודות לעמוד, כל השבוע ===== */
const SHEET_COLS_PER_PAGE = 6;

function printBoard(mode) { // 'class' | 'teacher'
  const cols = mode === 'class'
    ? state.classes.map(c => ({ id: c.id, name: c.name, sub: (teacher(c.homeroomTeacherId) || {}).name || '' }))
    : orderedTeachers().map(t => {
        const { tot, qtot } = teacherTotals(t);
        const c = teacherCounts(t.id);
        const q = t.quota || {};
        return {
          id: t.id, name: t.name, sub: tot + '/' + qtot + " שע'",
          sub2: c.frontal + '/' + (+q.frontal || 0) + ' + ' + c.prati + '/' + (+q.prati || 0) + ' + ' + c.shehut + '/' + (+q.shehut || 0)
        };
      });
  if (!cols.length) { toast('אין מה להדפיס עדיין'); return; }

  const chunks = [];
  for (let i = 0; i < cols.length; i += SHEET_COLS_PER_PAGE) chunks.push(cols.slice(i, i + SHEET_COLS_PER_PAGE));

  const title = (state.settings.schoolName ? esc(state.settings.schoolName) + ' — ' : '') +
    (mode === 'class' ? 'לוח כיתות' : 'לוח מורים') + ' — ' + esc(state.settings.year || '');

  document.getElementById('print-sheets').innerHTML = chunks.map((chunk, pi) => {
    let h = '<section class="print-page"><h2 class="sheet-title">' + title +
      (chunks.length > 1 ? ' (עמוד ' + (pi + 1) + ' מתוך ' + chunks.length + ')' : '') + '</h2>';
    h += '<table class="sheet-table"><tr><th class="w1">יום</th><th class="w1">שעה</th>' +
      chunk.map(c => '<th>' + esc(c.name) +
        (c.sub ? '<br><small>' + esc(c.sub) + '</small>' : '') +
        (c.sub2 ? '<br><small dir="ltr" title="פרונטלי + פרטני + שהות">' + esc(c.sub2) + '</small>' : '') +
        '</th>').join('') + '</tr>';
    for (const day of DAYS) {
      const hrs = hoursFor(day);
      if (!hrs) continue;
      for (let hr = 1; hr <= hrs; hr++) {
        h += '<tr' + (hr === 1 ? ' class="day-start"' : '') + '>';
        if (hr === 1) h += '<td class="dcell" rowspan="' + hrs + '">' + day + "'</td>";
        h += '<td class="hcell">' + hr + '</td>';
        for (const c of chunk) {
          const ls = state.lessons.filter(l => l.day === day && l.hour === hr &&
            (mode === 'class' ? l.classIds.includes(c.id) : l.teacherIds.includes(c.id)));
          h += '<td>' + ls.map(l => {
            const sub = l.subjectId && subject(l.subjectId) ? subject(l.subjectId).name : (l.type !== 'פרונטלי' ? l.type : '');
            let whoHtml = '';
            if (mode === 'class') {
              const names = l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').filter(Boolean).join(' + ');
              whoHtml = names ? ' ' + esc(names) : ' <span class="pc-missing">❓ חסר מורה</span>';
            } else {
              const cn = l.classIds.map(x => klass(x) ? klass(x).name : '').filter(Boolean).join(' + ');
              whoHtml = cn ? ' ' + esc(cn) : '';
            }
            return '<div class="pcell"><b>' + esc(sub) + '</b>' + whoHtml +
              (l.note ? ' <i>(' + esc(l.note) + ')</i>' : '') + '</div>';
          }).join('') + '</td>';
        }
        h += '</tr>';
      }
    }
    return h + '</table></section>';
  }).join('');

  fitSheetsToPage();
  document.body.classList.add('printing-board');
  const cleanup = () => { document.body.classList.remove('printing-board'); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 3000); // רשת ביטחון אם afterprint לא נורה
}

// התאמה לעמוד: מקטינים את הפונט בפועל (לא transform) עד שהתוכן נכנס בעמוד אחד.
// כיווץ אמיתי משנה את גובה הפריסה — ולכן שבירת העמודים תמיד נכונה והתוכן לא נחתך.
// עמוד עם class‏ landscape נמדד לרוחב; אחרת לאורך (הסדין).
function fitSheetsToPage() {
  const holder = document.getElementById('print-sheets');
  const first = holder.querySelector('.print-page');
  if (!first) return;
  const landscape = first.classList.contains('landscape');
  const width = landscape ? 1062 : 733;   // רוחב הדפסה: ‎297-16 / ‎210-16 מ"מ בפיקסלים
  const availBase = landscape ? 726 : 1026; // גובה הדפסה בהתאם
  holder.style.cssText = 'display:block;position:absolute;top:0;inset-inline-start:0;width:' + width + 'px;visibility:hidden;z-index:-1';
  holder.querySelectorAll('.print-page').forEach(pg => {
    const tbl = pg.querySelector('table');
    const title = pg.querySelector('.sheet-title');
    const avail = availBase - (title ? title.offsetHeight + 4 : 0);
    for (const f of [1, 0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48, 0.42]) {
      tbl.style.setProperty('--fs', f);
      if (tbl.offsetHeight <= avail) break;
    }
  });
  holder.style.cssText = '';
}

/* ===== הדפסת מערכות אישיות — עמוד אחד מובטח לכל מערכת ===== */
function personalCellHtml(l, kind, targetId) {
  const sub = l.subjectId && subject(l.subjectId) ? subject(l.subjectId).name : (l.type !== 'פרונטלי' ? l.type : '');
  let who = '';
  if (kind === 'class') {
    const names = l.teacherIds.map(t => teacher(t) ? teacher(t).name : '').filter(Boolean).join(' + ');
    who = names ? ' ' + esc(names) : ' <span class="pc-missing">❓ חסר מורה</span>';
  } else {
    const cnm = l.classIds.map(x => klass(x) ? klass(x).name : '').filter(Boolean).join(' + ');
    who = cnm ? ' ' + esc(cnm) : '';
  }
  const all = lessonStudents(l).map(s => student(s)).filter(Boolean);
  let stLine = '';
  if (all.length) {
    let shown = all, others = 0;
    if (kind === 'class') { shown = all.filter(s => s.classId === targetId); others = all.length - shown.length; }
    const names = shown.map(s => s.name).join(', ');
    if (names || others) stLine = '<div class="pc-students">🧑‍🎓 ' + esc(names) + (others ? (names ? ' ' : '') + '(+' + others + ')' : '') + '</div>';
  }
  return '<div class="pcell"><b>' + esc(sub) + '</b>' + who + (l.note ? ' <i>(' + esc(l.note) + ')</i>' : '') + stLine + '</div>';
}

function personalPageHtml(kind, target) {
  let subTitle = '';
  if (kind === 'class') {
    const hm = teacher(target.homeroomTeacherId);
    subTitle = hm ? 'מחנכת: ' + hm.name : '';
  } else {
    const c = teacherCounts(target.id); const q = target.quota || {};
    subTitle = 'פרונטלי ' + c.frontal + '/' + (+q.frontal || 0) + ' · פרטני ' + c.prati + '/' + (+q.prati || 0) + ' · שהות ' + c.shehut + '/' + (+q.shehut || 0);
  }
  let h = '<section class="print-page landscape"><h2 class="sheet-title">' +
    (state.settings.schoolName ? esc(state.settings.schoolName) + ' — ' : '') +
    'מערכת שעות ' + esc(state.settings.year || '') + ' — ' + esc(target.name) +
    (subTitle ? ' <small>(' + esc(subTitle) + ')</small>' : '') + '</h2>';
  h += '<table class="sheet-table"><tr><th class="w1">שעה</th>' + DAYS.map(d => '<th>' + d + "'</th>").join('') + '</tr>';
  for (let hr = 1; hr <= maxHours(); hr++) {
    h += '<tr><td class="hcell">' + hr + '</td>';
    for (const day of DAYS) {
      if (hr > hoursFor(day)) { h += '<td class="offcell"></td>'; continue; }
      if (kind === 'teacher' && (target.freeDays || []).includes(day)) {
        h += '<td class="offcell">' + (hr === 1 ? 'יום חופשי' : '') + '</td>'; continue;
      }
      const ls = state.lessons.filter(l => l.day === day && l.hour === hr &&
        (kind === 'class' ? l.classIds.includes(target.id) : l.teacherIds.includes(target.id)));
      h += '<td>' + ls.map(l => personalCellHtml(l, kind, target.id)).join('') + '</td>';
    }
    h += '</tr>';
  }
  return h + '</table></section>';
}

function printPersonal(kind, targetIds) {
  const pool = kind === 'class' ? state.classes : orderedTeachers();
  const targets = pool.filter(x => targetIds.includes(x.id));
  if (!targets.length) { toast('לא נבחרו מערכות להדפסה'); return; }
  document.getElementById('print-sheets').innerHTML = targets.map(t => personalPageHtml(kind, t)).join('');
  fitSheetsToPage();
  document.body.classList.add('printing-board');
  const cleanup = () => { document.body.classList.remove('printing-board'); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 3000);
}

/* ===== פאנל בחירת מערכות להדפסה ===== */
function renderPrintPicker() {
  const kind = document.getElementById('personal-kind').value;
  const pool = kind === 'class' ? state.classes : orderedTeachers();
  document.getElementById('picker-list').innerHTML = pool.map(x =>
    '<label><input type="checkbox" value="' + x.id + '" checked> ' + esc(x.name) + '</label>').join('');
  updatePickerCount();
}
function updatePickerCount() {
  document.getElementById('picker-count').textContent =
    document.querySelectorAll('#picker-list input:checked').length;
}

/* ===== טאבים ורינדור כללי ===== */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'quotas') renderQuotas();
  if (name === 'personal') renderPersonal();
  if (name === 'setup') renderSetup();
}

function renderHeader() {
  document.getElementById('school-title').textContent =
    (state.settings.schoolName ? state.settings.schoolName + ' — ' : '') + 'מתכנן מערכת השעות';
  document.getElementById('year-subtitle').textContent = 'שנה"ל ' + (state.settings.year || '');
}

function renderAllBoards() {
  renderHeader();
  renderClassesBoard();
  renderTeachersBoard();
  renderConflictBar();
  const active = document.querySelector('.tab.active');
  if (active && active.dataset.tab === 'quotas') renderQuotas();
  if (active && active.dataset.tab === 'personal') renderPersonal();
}

function renderAll() {
  renderAllBoards();
  renderSetup();
  renderPersonalTargets();
}

/* ===== מסך פתיחה — הסבר על המערכת והסרת אחריות ===== */
function initWelcome() {
  const screen = document.getElementById('welcome-screen');
  screen.hidden = localStorage.getItem(WELCOME_KEY) === '1';
  document.getElementById('welcome-close').addEventListener('click', () => {
    localStorage.setItem(WELCOME_KEY, '1');
    screen.hidden = true;
  });
  document.getElementById('btn-about').addEventListener('click', () => { screen.hidden = false; });
}

/* ===== אתחול ===== */
function init() {
  initWelcome();
  loadState();
  renderAll();

  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  document.getElementById('conflict-toggle').addEventListener('click', () => {
    const l = document.getElementById('conflict-list');
    l.hidden = !l.hidden;
  });

  // הגדרות כלליות
  const bindSetting = (elId, key, isNum) => {
    document.getElementById(elId).addEventListener('change', e => {
      state.settings[key] = isNum ? (+e.target.value || 0) : e.target.value.trim();
      save(); renderAllBoards();
    });
  };
  bindSetting('set-school-name', 'schoolName');
  bindSetting('set-year', 'year');
  bindSetting('set-hours-default', 'hoursDefault', true);
  bindSetting('set-hours-friday', 'hoursFriday', true);

  // הוספות
  document.getElementById('btn-add-teacher').addEventListener('click', () => {
    state.teachers.push({ id: uid(), name: 'מורה חדש/ה', role: 'מקצועי', quota: { frontal: 0, prati: 0, shehut: 0 } });
    save(); renderSetup(); renderAllBoards();
  });
  document.getElementById('btn-add-class').addEventListener('click', () => {
    state.classes.push({ id: uid(), name: 'כיתה חדשה', homeroomTeacherId: null, subjectQuotas: [] });
    save(); renderSetup(); renderAllBoards();
  });
  document.getElementById('btn-add-subject').addEventListener('click', () => {
    state.subjects.push({ id: uid(), name: 'מקצוע חדש', color: nextColor() });
    save(); renderSetup(); renderAllBoards();
  });

  // נתונים
  document.getElementById('btn-load-sample').addEventListener('click', loadSampleData);

  // תלמידים
  document.getElementById('students-class-select').addEventListener('change', renderStudentsCard);
  document.getElementById('btn-add-students').addEventListener('click', addStudentsFromPaste);
  document.getElementById('students-toggle').addEventListener('click', () => {
    const box = document.getElementById('students-box');
    box.hidden = !box.hidden;
    if (!box.hidden) studentsTouched = true;
  });
  document.getElementById('btn-new-student').addEventListener('click', () => { studentsTouched = true; addInlineStudent(); });
  document.getElementById('new-student-name').addEventListener('keydown', e => { if (e.key === 'Enter') { studentsTouched = true; addInlineStudent(); } });
  document.getElementById('lesson-students').addEventListener('change', () => { studentsTouched = true; updateStudentsCount(); });
  document.getElementById('btn-clear-lessons').addEventListener('click', () => {
    if (!confirm('למחוק את כל השיבוצים? המורים, הכיתות והמקצועות יישארו.')) return;
    state.lessons = []; save(); renderAll(); toast('כל השיבוצים נמחקו');
  });
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    if (!confirm('איפוס מלא ימחק את כל הנתונים: מורים, כיתות, מקצועות ושיבוצים. האם להמשיך?')) return;
    if (!confirm('בטוחה? מומלץ להוריד קודם קובץ גיבוי (⬇ בכותרת). ללחוץ אישור למחיקה סופית.')) return;
    state = emptyState(); save(); renderAll(); toast('כל הנתונים אופסו');
  });

  // ייצוא/ייבוא
  document.getElementById('btn-export').addEventListener('click', exportJson);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', e => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  // מערכת אישית
  document.getElementById('personal-kind').addEventListener('change', renderPersonal);
  document.getElementById('personal-target').addEventListener('change', renderPersonal);
  document.getElementById('btn-print').addEventListener('click', () => {
    const kind = document.getElementById('personal-kind').value;
    if (kind === 'splits') { window.print(); return; } // דוח פיצולים — הדפסה רגילה (רב-עמודים)
    printPersonal(kind, [document.getElementById('personal-target').value]);
  });
  document.getElementById('btn-print-multi').addEventListener('click', () => {
    const picker = document.getElementById('print-picker');
    picker.hidden = !picker.hidden;
    if (!picker.hidden) renderPrintPicker();
  });
  document.getElementById('picker-all').addEventListener('click', () => {
    document.querySelectorAll('#picker-list input').forEach(cb => cb.checked = true); updatePickerCount();
  });
  document.getElementById('picker-none').addEventListener('click', () => {
    document.querySelectorAll('#picker-list input').forEach(cb => cb.checked = false); updatePickerCount();
  });
  document.getElementById('picker-list').addEventListener('change', updatePickerCount);
  document.getElementById('picker-print').addEventListener('click', () => {
    const ids = [...document.querySelectorAll('#picker-list input:checked')].map(i => i.value);
    printPersonal(document.getElementById('personal-kind').value, ids);
  });
  document.getElementById('btn-print-classes').addEventListener('click', () => printBoard('class'));
  document.getElementById('btn-print-teachers').addEventListener('click', () => printBoard('teacher'));

  // חלונית
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('lesson-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', e => { if (e.target.id === 'modal-backdrop') closeModal(); });
  document.getElementById('lesson-save').addEventListener('click', saveLessonFromModal);
  document.getElementById('lesson-delete').addEventListener('click', () => {
    if (!modalCtx || !modalCtx.editingId) return;
    if (!confirm('למחוק את השיבוץ הזה מכל הכיתות והמורים שבו?')) return;
    state.lessons = state.lessons.filter(l => l.id !== modalCtx.editingId);
    save(); closeModal(); renderAllBoards();
    toast('השיבוץ נמחק');
  });
  document.getElementById('copy-bar-end').addEventListener('click', endCopyMode);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); endCopyMode(); } });
}

init();
