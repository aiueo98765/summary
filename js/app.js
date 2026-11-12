'use strict';
/* 画面。状態は S（保存される）と ui（表示だけの一時状態）。変更したら commit() で保存→描き直し。 */

const S = Store.load();
const ui = {
  view: 'home', weekOff: 0, planTab: 'tasks', range: '30', histLimit: 14, histSub: '',
  chartTable: false, taskSubject: '', lastBlockSubject: '', draft: null, ttScroll: null,
};
const SLOT = 20; // 時間割の30分あたりの高さ(px)

const $ = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => [...r.querySelectorAll(q)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ic = p => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  edit: ic('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  x: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: ic('<path d="M5 12.5 10 17l9-10"/>'),
  left: ic('<path d="M15 5l-7 7 7 7"/>'),
  right: ic('<path d="M9 5l7 7-7 7"/>'),
  alert: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>'),
  play: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4.8v14.4L19 12z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
};

/* ---------- 共通 ---------- */

function activeSubs() { return SUBJECTS.filter(s => S.settings.subjects.includes(s.id)); }
/** 有効な科目＋データに出てくる科目（並びは国数英理社の固定） */
function subsWith(ids) { return SUBJECTS.filter(s => S.settings.subjects.includes(s.id) || ids.has(s.id)); }
function firstSubject() { return (activeSubs()[0] || SUBJECTS[0]).id; }

function freshDraft() {
  const last = [...S.logs].sort((a, b) => b.at - a.at)[0];
  const subject = last && S.settings.subjects.includes(last.subject) ? last.subject : firstSubject();
  return { date: D.today(), subject, h: '', m: '', memo: '' };
}

function commit() { Store.save(); render(); }

let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  t.replaceChildren();
  const sp = document.createElement('span'); sp.textContent = msg; t.append(sp);
  if (undo) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '元に戻す';
    b.onclick = () => { t.hidden = true; undo(); };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 2800);
}
window.toast = toast;

/** 今の状態を控えておき、戻す関数を返す（タイマーは戻さない） */
function snapshot() {
  const snap = JSON.stringify(S);
  return () => {
    const o = JSON.parse(snap);
    for (const k of Object.keys(o)) if (k !== 'timer') S[k] = o[k];
    commit();
    toast('元に戻しました');
  };
}

function openDlg(html) {
  const d = $('#dlg');
  d.innerHTML = html;
  if (!d.open) d.showModal();
}
function closeDlg() { const d = $('#dlg'); if (d.open) d.close(); }
function formErr(form, msg) { const p = form.querySelector('.err'); p.textContent = msg; p.hidden = false; }

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function subjChips(name, sel) {
  const list = activeSubs();
  if (sel && !list.some(s => s.id === sel)) list.push(SUBJ[sel]);
  return `<div class="chips" role="radiogroup" aria-label="科目">${list.map(s => `
    <label class="chip"><input type="radio" name="${name}" value="${s.id}" ${s.id === sel ? 'checked' : ''}><span><i class="sw" style="background:var(--c-${s.id})"></i>${s.name}</span></label>`).join('')}</div>`;
}

/* ---------- 計算 ---------- */

function upcoming(t) { return S.schools.filter(s => s.date >= t).sort((a, b) => a.date.localeCompare(b.date)); }
function mainSchool(t) { const up = upcoming(t); return up.find(s => s.role === '第一志望') || up[0] || null; }
function weeksText(n) {
  const w = Math.floor(n / 7), r = n % 7;
  if (!w) return `${r}日`;
  return r ? `${w}週と${r}日` : `ちょうど${w}週`;
}
/** from から n 日のうち土日の数 */
function weekendCount(from, n) {
  const d = D.parse(from); let c = 0;
  for (let i = 0; i < n; i++) { const w = d.getDay(); if (w === 0 || w === 6) c++; d.setDate(d.getDate() + 1); }
  return c;
}
function firstLogDate(t) { return S.logs.reduce((a, l) => (l.date < a ? l.date : a), t); }
/** 直近7日（記録を始めて7日未満ならその日数）の1日平均 */
function pace(t) {
  if (!S.logs.length) return null;
  let start = D.add(t, -6);
  const first = firstLogDate(t);
  if (first > start) start = first;
  const days = D.diff(start, t) + 1;
  const tot = S.logs.reduce((a, l) => (l.date >= start && l.date <= t ? a + l.min : a), 0);
  return { avg: tot / days, days };
}
function dayTotals(date) {
  const v = {}; let tot = 0;
  for (const l of S.logs) if (l.date === date) { v[l.subject] = (v[l.subject] || 0) + l.min; tot += l.min; }
  return { v, tot };
}
function streak() {
  const set = new Set(S.logs.map(l => l.date));
  let d = D.today();
  if (!set.has(d)) d = D.add(d, -1);
  let n = 0;
  while (set.has(d)) { n++; d = D.add(d, -1); }
  return n;
}
function isLogged(b) { return !!b.logId && S.logs.some(l => l.id === b.logId); }
function weekOf() { return D.add(D.weekStart(D.today()), ui.weekOff * 7); }

function balance(ws) {
  const we = D.add(ws, 6), plan = {}, act = {};
  for (const b of S.blocks) if (b.date >= ws && b.date <= we) plan[b.subject] = (plan[b.subject] || 0) + (b.end - b.start);
  for (const l of S.logs) if (l.date >= ws && l.date <= we) act[l.subject] = (act[l.subject] || 0) + l.min;
  const rows = subsWith(new Set([...Object.keys(plan), ...Object.keys(act)]))
    .map(s => ({ id: s.id, name: s.name, plan: plan[s.id] || 0, act: act[s.id] || 0 }));
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  return { rows, planTot: sum(plan), actTot: sum(act) };
}
/** 受験科目（その他を除く）の中で、少ない・偏っている科目を言葉にする */
function balanceHints(bal) {
  const core = bal.rows.filter(r => r.id !== 'ot' && S.settings.subjects.includes(r.id));
  const key = bal.planTot > 0 ? 'plan' : 'act';
  const word = key === 'plan' ? '予定' : '実績';
  const tot = core.reduce((a, r) => a + r[key], 0);
  const out = [];
  if (!tot || core.length < 2) return out;
  const fair = 1 / core.length;
  const pct = r => Math.round(r[key] / tot * 100);
  const zero = core.filter(r => !r[key]);
  const low = core.filter(r => r[key] && r[key] / tot < fair * 0.5);
  const high = core.filter(r => r[key] / tot > fair * 1.8);
  if (zero.length) out.push(`${word}に <b>${zero.map(r => r.name).join('・')}</b> が入っていません`);
  if (low.length) out.push(`${word}では <b>${low.map(r => r.name).join('・')}</b> が少なめです（${low.map(r => `${r.name} ${pct(r)}%`).join('、')}）`);
  if (high.length) out.push(`${word}が <b>${high.map(r => r.name).join('・')}</b> に偏っています（全体の${high.map(pct).join('%・')}%）`);
  return out;
}

/* ---------- タイマー ---------- */

function elapsed() { const t = S.timer; return t ? t.acc + (t.since ? Date.now() - t.since : 0) : 0; }
function clockOf(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function timerButtons() {
  const t = S.timer;
  if (!t) return `<button type="button" class="btn primary sm" data-act="timer-start">${ICON.play}開始</button>`;
  return `${t.since
    ? `<button type="button" class="btn sm" data-act="timer-pause">${ICON.pause}一時停止</button>`
    : `<button type="button" class="btn sm" data-act="timer-resume">${ICON.play}再開</button>
       <button type="button" class="btn sm ghost" data-act="timer-discard">破棄</button>`}
    <button type="button" class="btn primary sm" data-act="timer-finish">${ICON.stop}終了して記録</button>`;
}
function finishTimer() {
  const t = S.timer; if (!t) return;
  const min = Math.round(elapsed() / 60000);
  S.timer = null;
  if (min < 1) { commit(); toast('1分未満だったので記録しませんでした'); return; }
  const memoEl = $('form[data-form="log"] textarea[name="memo"]');
  const memo = String(memoEl ? memoEl.value : (ui.draft && ui.draft.memo) || '').trim();
  const undo = snapshot();
  S.logs.push({ id: uid(), date: t.date, subject: t.subject, min: Math.min(min, 1440), memo, at: Date.now() });
  if (ui.draft) { ui.draft.memo = ''; ui.draft.subject = t.subject; }
  commit();
  toast(`${SUBJ[t.subject].name} ${fmtDur(min)} を記録しました`, undo);
}
function renderTimerPill() {
  const p = $('#timerPill'), t = S.timer;
  if (!t || ui.view === 'log') { p.hidden = true; return; }
  p.hidden = false;
  p.innerHTML = `<a href="#log" class="tp-main"><i class="tp-dot ${t.since ? 'on' : ''}"></i><span>${SUBJ[t.subject].name}</span><b class="js-timer">${clockOf(elapsed())}</b></a>
    ${t.since
      ? `<button class="icon-btn" data-act="timer-pause" aria-label="一時停止">${ICON.pause}</button>`
      : `<button class="icon-btn" data-act="timer-resume" aria-label="再開">${ICON.play}</button>`}
    <button class="icon-btn" data-act="timer-finish" aria-label="終了して記録">${ICON.stop}</button>`;
}

/* ---------- ヘッダー（カウントダウンを常に出す） ---------- */

function renderTop() {
  const t = D.today(), sc = mainSchool(t), el = $('#topCount');
  if (!sc) { el.innerHTML = `<span class="tc-date">${D.jp(t)}</span>`; return; }
  const n = D.diff(t, sc.date);
  el.innerHTML = `<a href="#home" class="tc" title="${esc(sc.name)}（${D.jpY(sc.date)}）まで">
    <span class="tc-name">${esc(sc.name)}</span>
    ${n === 0 ? '<b class="tc-n">本番</b>' : `<span class="tc-pre">あと</span><b class="tc-n">${n}</b><span class="tc-u">日</span><span class="tc-w">${weeksText(n)}</span>`}
  </a>`;
}

/* ---------- ホーム ---------- */

function viewHome() {
  const t = D.today();
  return `<div class="grid home">
    ${heroCard(t)}
    ${schoolsCard(t)}
    ${todayCard(t)}
    ${todayTasksCard(t)}
    ${todayPlanCard(t)}
    ${balanceCard(D.weekStart(t), '今週の科目バランス')}
  </div>`;
}

function heroCard(t) {
  const sc = mainSchool(t);
  if (!sc) {
    const any = S.schools.length > 0;
    return `<section class="card hero is-empty">
      <p class="hero-pre">カウントダウン</p>
      <h2 class="hero-empty-t">${any ? '登録した入試はすべて終わりました' : 'まず志望校を登録しましょう'}</h2>
      <p class="hero-note">${any ? 'おつかれさまでした。次の目標があれば追加できます。' : '入試日を入れると、残りの日数と週数がすべての画面の上に出続けます。第一志望も併願校も、いくつでも登録できます。'}</p>
      <button class="btn on-dark" data-act="add-school">＋ 志望校を登録</button>
    </section>`;
  }
  const n = D.diff(t, sc.date);
  const we = weekendCount(t, n);
  const p = pace(t);
  let paceHtml = '';
  if (n > 0) {
    if (!p) paceHtml = '勉強時間を記録すると、このペースで入試までに何時間積めるかがここに出ます。';
    else if (p.avg < 1) paceHtml = `直近${p.days}日は記録がありません。`;
    else paceHtml = `直近${p.days}日の平均 <b>${fmtDur(Math.round(p.avg))}</b>／日。このペースなら入試までに あと約 <b>${Math.round(p.avg * n / 60).toLocaleString()}時間</b>`;
  }
  return `<section class="card hero">
    <div class="hero-top">
      <span class="badge role" data-role="${esc(sc.role)}">${esc(sc.role)}</span>
      ${sc.kind ? `<span class="hero-kind">${esc(sc.kind)}</span>` : ''}
      <button class="icon-btn" data-act="edit-school" data-id="${sc.id}" aria-label="${esc(sc.name)}を編集">${ICON.edit}</button>
    </div>
    <h2 class="hero-school">${esc(sc.name)}</h2>
    <div class="hero-count">
      ${n === 0
        ? '<span class="hero-pre">今日が</span><span class="hero-num">入試本番</span>'
        : `<span class="hero-pre">入試まで あと</span><span class="hero-num">${n}</span><span class="hero-unit">日</span>`}
    </div>
    <div class="hero-date">${D.jpY(sc.date)}${sc.memo ? `<span class="hero-memo">${esc(sc.memo)}</span>` : ''}</div>
    ${n > 0 ? `<div class="hero-stats">
      <div><span>週にすると</span><b>${weeksText(n)}</b></div>
      <div><span>そのうち土日</span><b>${we}日</b></div>
      <div><span>平日</span><b>${n - we}日</b></div>
    </div>
    <p class="hero-pace">${paceHtml}</p>` : ''}
  </section>`;
}

function schoolRows(t) {
  const list = [...S.schools].sort((a, b) => {
    const pa = a.date < t, pb = b.date < t;
    if (pa !== pb) return pa ? 1 : -1;
    return pa ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  });
  return list.map(s => {
    const n = D.diff(t, s.date);
    let right;
    if (n > 0) right = `<span class="sch-big"><b class="sch-n">${n}</b><span class="sch-u">日</span></span><small>${weeksText(n)}</small>`;
    else if (n === 0) right = `<span class="sch-big"><b class="sch-n sm">今日</b></span><small>入試本番</small>`;
    else {
      const an = s.announce ? D.diff(t, s.announce) : null;
      if (an > 0) right = `<span class="sch-big"><b class="sch-n sm">${an}</b><span class="sch-u">日</span></span><small>合格発表まで</small>`;
      else if (an === 0) right = `<span class="sch-big"><b class="sch-n sm">今日</b></span><small>合格発表</small>`;
      else right = `<small>終了</small>`;
    }
    return `<li class="school ${n < 0 ? 'is-past' : ''}">
      <div class="sch-l">
        <div class="sch-name"><span class="badge role" data-role="${esc(s.role)}">${esc(s.role)}</span><b>${esc(s.name)}</b>${s.kind ? `<span class="muted sm">${esc(s.kind)}</span>` : ''}</div>
        <div class="sch-date">${D.jp(s.date)} 試験${s.announce ? `・${D.jp(s.announce)} 発表` : ''}${s.memo ? `・${esc(s.memo)}` : ''}</div>
      </div>
      <div class="sch-r">${right}</div>
      <button class="icon-btn" data-act="edit-school" data-id="${s.id}" aria-label="${esc(s.name)}を編集">${ICON.edit}</button>
    </li>`;
  }).join('');
}

function schoolsCard(t) {
  return `<section class="card schools-card">
    <header class="card-h"><h3>志望校</h3><button class="btn sm" data-act="add-school">＋ 追加</button></header>
    ${S.schools.length ? `<ul class="schools">${schoolRows(t)}</ul>`
      : '<p class="empty-note">第一志望・併願校をそれぞれ登録すると、入試日の近い順に並び、学校ごとの残り日数が出ます。</p>'}
  </section>`;
}

function todayCard(t) {
  const { v, tot } = dayTotals(t);
  const goal = S.settings.dailyGoal;
  const rows = subsWith(new Set(Object.keys(v))).map(s => ({ id: s.id, name: s.name, min: v[s.id] || 0 }));
  const used = rows.filter(r => r.min > 0);
  return `<section class="card today-card">
    <header class="card-h"><h3>今日の勉強</h3><a class="btn sm" href="#log">＋ 記録</a></header>
    <div class="today-num"><b>${fmtDur(tot)}</b><span>／目標 ${fmtDur(goal)}</span></div>
    <div class="meter" role="meter" aria-label="今日の目標の達成度" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(tot, goal)}"><span style="width:${Math.min(100, tot / goal * 100)}%"></span></div>
    <div class="meter-cap"><span>${tot >= goal ? `${ICON.check} 目標達成` : `あと ${fmtDur(goal - tot)}`}</span><span>${Math.round(tot / goal * 100)}%</span></div>
    ${used.length
      ? `${Charts.segbar(rows, '今日の科目の割合')}<ul class="legend">${used.map(r => `<li><i class="sw" style="background:var(--c-${r.id})"></i>${r.name}<b>${fmtDur(r.min)}</b></li>`).join('')}</ul>`
      : '<p class="empty-note">まだ記録がありません。</p>'}
  </section>`;
}

function taskItem(k, t, opts = {}) {
  const s = SUBJ[k.subject];
  return `<li class="task ${k.done ? 'done' : ''}">
    <label class="chk"><input type="checkbox" data-act="toggle-task" data-id="${k.id}" ${k.done ? 'checked' : ''}><span class="box"></span>
      <span class="task-text">${opts.showDate ? `<span class="task-date">${D.md(k.date)}</span>` : ''}${s ? `<span class="tag" style="--c:var(--c-${s.id})">${s.short}</span>` : ''}${esc(k.text)}</span></label>
    ${opts.overdue ? `<button class="mini" data-act="task-today" data-id="${k.id}">今日へ</button>` : ''}
    <button class="icon-btn del" data-act="del-task" data-id="${k.id}" aria-label="「${esc(k.text)}」を削除">${ICON.x}</button>
  </li>`;
}

function addTaskForm(date) {
  const ids = ['', ...activeSubs().map(s => s.id)];
  return `<form class="add-task" data-form="add-task" data-date="${date}">
    <select name="subject" aria-label="科目">${ids.map(id => `<option value="${id}" ${id === ui.taskSubject ? 'selected' : ''}>${id ? SUBJ[id].name : '科目'}</option>`).join('')}</select>
    <input name="text" placeholder="やることを追加" maxlength="120" autocomplete="off" enterkeyhint="done" data-fk="task-${date}" aria-label="${D.jp(date)}のやること">
    <button class="btn sm">追加</button>
  </form>`;
}

function todayTasksCard(t) {
  const list = S.tasks.filter(k => k.date === t);
  const over = S.tasks.filter(k => k.date < t && !k.done).length;
  const done = list.filter(k => k.done).length;
  return `<section class="card tasks-card">
    <header class="card-h"><h3>今日やること</h3>${list.length ? `<span class="count">${done}/${list.length}</span>` : ''}</header>
    ${list.length ? `<ul class="tasks">${list.map(k => taskItem(k, t)).join('')}</ul>`
      : '<p class="empty-note">今日の分をチェックリストにしておきましょう。</p>'}
    ${addTaskForm(t)}
    ${over ? `<a class="link" href="#plan" data-act="goto-plan" data-tab="tasks">やり残し ${over}件 →</a>` : ''}
  </section>`;
}

function todayPlanCard(t) {
  const bl = S.blocks.filter(b => b.date === t).sort((a, b) => a.start - b.start);
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  return `<section class="card agenda-card">
    <header class="card-h"><h3>今日の時間割</h3><a class="btn sm ghost" href="#plan" data-act="goto-plan" data-tab="timetable">時間割へ</a></header>
    ${bl.length ? `<ul class="agenda">${bl.map(b => {
      const logged = isLogged(b);
      return `<li class="${b.start <= nowMin && nowMin < b.end ? 'now' : ''}">
        <span class="ag-time">${D.clock(b.start)}–${D.clock(b.end)}</span>
        <i class="sw" style="background:var(--c-${b.subject})"></i>
        <span class="ag-t"><b>${SUBJ[b.subject].name}</b>${b.note ? ` <span class="muted">${esc(b.note)}</span>` : ''}</span>
        ${logged ? `<span class="done-mark">${ICON.check}記録済</span>` : `<button class="mini" data-act="block-log" data-id="${b.id}">記録</button>`}
      </li>`;
    }).join('')}</ul>` : '<p class="empty-note">今日の予定はまだありません。「時間割へ」から入れられます。</p>'}
  </section>`;
}

function balanceCard(ws, title) {
  const bal = balance(ws);
  const hints = balanceHints(bal);
  const has = bal.planTot || bal.actTot;
  return `<section class="card balance">
    <header class="card-h"><h3>${title}</h3>
      <div class="bal-key"><span><i class="key plan"></i>予定 ${fmtH(bal.planTot)}</span><span><i class="key act"></i>実績 ${fmtH(bal.actTot)}</span>${bal.planTot ? `<span class="muted">予定の ${Math.round(bal.actTot / bal.planTot * 100)}%</span>` : ''}</div>
    </header>
    ${has ? Charts.pairBars(bal.rows) : '<p class="empty-note">時間割に予定を入れるか勉強を記録すると、科目ごとの予定と実績がここに並びます。</p>'}
    ${hints.length ? `<ul class="hints">${hints.map(h => `<li>${ICON.alert}<span>${h}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}

/* ---------- 計画（タスク・時間割） ---------- */

function viewPlan() {
  const ws = weekOf(), we = D.add(ws, 6);
  const tab = ui.planTab;
  return `<div class="plan">
    <div class="toolbar">
      <div class="seg" role="tablist" aria-label="計画の表示">
        <button role="tab" aria-selected="${tab === 'tasks'}" class="${tab === 'tasks' ? 'on' : ''}" data-act="plan-tab" data-tab="tasks">タスク</button>
        <button role="tab" aria-selected="${tab === 'timetable'}" class="${tab === 'timetable' ? 'on' : ''}" data-act="plan-tab" data-tab="timetable">時間割</button>
      </div>
      <div class="weeknav">
        <button class="icon-btn" data-act="week" data-d="-1" aria-label="前の週">${ICON.left}</button>
        <span class="wk-label">${D.md(ws)}(月) – ${D.md(we)}(日)${ui.weekOff === 0 ? '<em>今週</em>' : ''}</span>
        <button class="icon-btn" data-act="week" data-d="1" aria-label="次の週">${ICON.right}</button>
        ${ui.weekOff !== 0 ? '<button class="btn sm ghost" data-act="week" data-d="0">今週へ</button>' : ''}
      </div>
    </div>
    ${tab === 'tasks' ? planTasks(ws) : planTimetable(ws)}
  </div>`;
}

function planTasks(ws) {
  const t = D.today();
  const over = S.tasks.filter(k => k.date < t && !k.done).sort((a, b) => a.date.localeCompare(b.date));
  let h = '';
  if (over.length) {
    h += `<section class="card overdue">
      <header class="card-h"><h3>やり残し</h3><span class="count">${over.length}件</span><button class="btn sm" data-act="all-today">すべて今日へ</button></header>
      <ul class="tasks">${over.map(k => taskItem(k, t, { overdue: true, showDate: true })).join('')}</ul>
    </section>`;
  }
  h += '<div class="days">';
  for (let i = 0; i < 7; i++) {
    const d = D.add(ws, i);
    const list = S.tasks.filter(k => k.date === d);
    const done = list.filter(k => k.done).length;
    const dw = D.dow(d);
    h += `<section class="card day ${d === t ? 'is-today' : ''} ${d < t ? 'is-past' : ''}">
      <header class="day-h">
        <span class="day-d">${D.parse(d).getDate()}</span><span class="day-w ${dw === 0 ? 'sun' : dw === 6 ? 'sat' : ''}">${D.wd(d)}</span>
        ${d === t ? '<span class="badge today">今日</span>' : ''}
        <span class="count">${list.length ? `${done}/${list.length}` : ''}</span>
      </header>
      ${list.length ? `<ul class="tasks">${list.map(k => taskItem(k, t)).join('')}</ul>` : ''}
      ${addTaskForm(d)}
    </section>`;
  }
  return h + '</div>';
}

function planTimetable(ws) {
  const t = D.today();
  const hs = S.settings.hourStart, he = S.settings.hourEnd;
  const H = (he - hs) * 2 * SLOT;
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  let head = '<div class="tt-corner"></div>', cols = '';
  for (let i = 0; i < 7; i++) {
    const d = D.add(ws, i);
    const bl = S.blocks.filter(b => b.date === d).sort((a, b) => a.start - b.start);
    const tot = bl.reduce((a, b) => a + b.end - b.start, 0);
    const dw = D.dow(d);
    head += `<div class="tt-dh ${d === t ? 'is-today' : ''}"><span class="day-w ${dw === 0 ? 'sun' : dw === 6 ? 'sat' : ''}">${D.wd(d)}</span><b>${D.parse(d).getDate()}</b><small>${tot ? fmtH(tot) : ''}</small></div>`;
    const nowLine = d === t && nowMin >= hs * 60 && nowMin < he * 60
      ? `<div class="tt-now" style="top:${(nowMin - hs * 60) / 30 * SLOT}px"></div>` : '';
    cols += `<div class="tt-col ${d === t ? 'is-today' : ''}" data-act="tt-col" data-date="${d}">${bl.map(b => blockEl(b, hs, he)).join('')}${nowLine}</div>`;
  }
  let axis = '';
  for (let h = hs; h < he; h++) axis += `<span style="top:${(h - hs) * 2 * SLOT}px">${h}:00</span>`;
  return `<div class="tt-tools">
      <button class="btn sm primary" data-act="add-block">＋ 予定を追加</button>
      <button class="btn sm" data-act="copy-week">前の週をコピー</button>
      <button class="btn sm ghost" data-act="clear-week">この週を空にする</button>
      <span class="muted sm hide-sm">空いているマスをクリックしても追加できます</span>
    </div>
    <section class="card tt-card">
      <div class="tt-scroll" id="ttScroll">
        <div class="tt-head">${head}</div>
        <div class="tt-body" style="height:${H}px"><div class="tt-axis">${axis}</div>${cols}</div>
      </div>
    </section>
    ${balanceCard(ws, 'この週の科目バランス')}`;
}

function blockEl(b, hs, he) {
  const lo = hs * 60, hi = he * 60;
  const s = Math.max(b.start, lo), e = Math.min(b.end, hi);
  if (e <= s) return '';
  const top = (s - lo) / 30 * SLOT, h = (e - s) / 30 * SLOT;
  const sb = SUBJ[b.subject], logged = isLogged(b);
  const size = h < SLOT * 1.5 ? 'xs' : h < SLOT * 2.8 ? 'sm' : '';
  return `<button class="blk ${size} ${logged ? 'logged' : ''}" data-act="edit-block" data-id="${b.id}"
      style="top:${top + 1}px;height:${h - 2}px;--c:var(--c-${b.subject});--on:var(--on-${b.subject})"
      aria-label="${sb.name} ${D.clock(b.start)}から${D.clock(b.end)}${b.note ? ' ' + esc(b.note) : ''}${logged ? '（記録済）' : ''}">
    <span class="blk-n"><span class="full">${sb.name}</span><span class="short">${sb.short}</span>${logged ? ICON.check : ''}</span>
    <span class="blk-t">${D.clock(b.start)}–${D.clock(b.end)}</span>
    ${b.note ? `<span class="blk-m">${esc(b.note)}</span>` : ''}
  </button>`;
}

function timeOpts(from, to, sel) {
  let o = '';
  for (let m = from; m <= to; m += 30) o += `<option value="${m}" ${m === sel ? 'selected' : ''}>${D.clock(m)}</option>`;
  return o;
}

function openBlock(id, preset) {
  const b = id ? S.blocks.find(x => x.id === id) : null;
  if (id && !b) return;
  const v = b || preset;
  const ws = D.weekStart(v.date);
  const lo = Math.min(S.settings.hourStart * 60, v.start), hi = Math.max(S.settings.hourEnd * 60, v.end);
  let dates = '';
  for (let i = 0; i < 7; i++) { const d = D.add(ws, i); dates += `<option value="${d}" ${d === v.date ? 'selected' : ''}>${D.jp(d)}</option>`; }
  const canLog = b && !isLogged(b) && b.date <= D.today();
  openDlg(`<form class="dlg-form" data-form="block" data-id="${b ? b.id : ''}">
    <h3>${b ? '予定を編集' : '予定を追加'}</h3>
    <label class="f"><span>日付</span><select name="date">${dates}</select></label>
    <div class="f-row">
      <label class="f"><span>開始</span><select name="start">${timeOpts(lo, hi - 30, v.start)}</select></label>
      <label class="f"><span>終了</span><select name="end">${timeOpts(lo + 30, hi, v.end)}</select></label>
    </div>
    <div class="f"><span>科目</span>${subjChips('subject', v.subject)}</div>
    <label class="f"><span>メモ <small>任意</small></span><input name="note" maxlength="60" value="${esc(v.note || '')}" placeholder="例：塾／関数の演習"></label>
    ${b && isLogged(b) ? `<p class="hint">${ICON.check} この予定は勉強の記録に入れてあります。</p>` : ''}
    <p class="err" hidden></p>
    <div class="dlg-actions">
      ${b ? `<button type="button" class="btn ghost danger" data-act="del-block" data-id="${b.id}">削除</button>` : ''}
      ${canLog ? `<button type="button" class="btn ghost" data-act="block-log" data-id="${b.id}">${ICON.check}実績として記録</button>` : ''}
      <span class="sp"></span>
      <button type="button" class="btn ghost" data-act="dlg-close">やめる</button>
      <button class="btn primary">保存</button>
    </div>
  </form>`);
}

function newBlockAt(date, start) {
  const hs = S.settings.hourStart * 60, he = S.settings.hourEnd * 60;
  start = Math.max(hs, Math.min(start, he - 30));
  let end = Math.min(start + 60, he);
  const next = S.blocks.filter(b => b.date === date && b.start >= start).sort((x, y) => x.start - y.start)[0];
  if (next && next.start < end) end = Math.max(start + 30, next.start);
  const subject = ui.lastBlockSubject && S.settings.subjects.includes(ui.lastBlockSubject) ? ui.lastBlockSubject : firstSubject();
  openBlock(null, { date, start, end, subject, note: '' });
}

function logBlock(id) {
  const b = S.blocks.find(x => x.id === id);
  if (!b) return;
  if (isLogged(b)) { toast('この予定は記録済みです'); return; }
  if (b.date > D.today()) { toast('先の日付の予定は、その日になってから記録できます'); return; }
  const undo = snapshot();
  const l = { id: uid(), date: b.date, subject: b.subject, min: b.end - b.start, memo: b.note || '時間割から', at: Date.now() };
  S.logs.push(l);
  b.logId = l.id;
  closeDlg();
  commit();
  toast(`${SUBJ[b.subject].name} ${fmtDur(l.min)} を記録しました`, undo);
}

/* ---------- 記録 ---------- */

function viewLog() {
  if (!ui.draft) ui.draft = freshDraft();
  return `<div class="grid logv">
    ${logFormCard()}
    ${statsCard()}
    ${historyCard()}
  </div>`;
}

function logFormCard() {
  const d = ui.draft, t = S.timer;
  return `<section class="card log-form">
    <header class="card-h"><h3>勉強を記録</h3></header>
    <form data-form="log" autocomplete="off">
      <div class="f"><span>科目</span>${subjChips('subject', d.subject)}</div>
      <div class="timer ${t ? (t.since ? 'running' : 'paused') : ''}">
        <div class="timer-l">
          <span class="timer-lbl">${t ? `${t.since ? '計測中' : '一時停止中'}・${SUBJ[t.subject].name}` : 'タイマーで計る'}</span>
          <span class="timer-time js-timer">${clockOf(elapsed())}</span>
        </div>
        <div class="timer-btns">${timerButtons()}</div>
      </div>
      <div class="or"><span>または 手で入力</span></div>
      <div class="f-row">
        <label class="f"><span>日付</span><input type="date" name="date" value="${d.date}" max="${D.today()}" required></label>
        <div class="f"><span>時間</span><div class="dur">
          <input type="number" name="h" inputmode="numeric" min="0" max="16" value="${esc(d.h)}" placeholder="0" aria-label="時間"><em>時間</em>
          <input type="number" name="m" inputmode="numeric" min="0" max="59" value="${esc(d.m)}" placeholder="0" aria-label="分"><em>分</em>
        </div></div>
      </div>
      <div class="quick">${[15, 30, 45, 60, 90, 120, 180].map(m => `<button type="button" class="mini" data-act="quick" data-min="${m}">${m < 60 ? m + '分' : m / 60 + '時間'}</button>`).join('')}</div>
      <label class="f"><span>内容メモ <small>任意</small></span><textarea name="memo" rows="2" maxlength="300" placeholder="例：関数の過去問 大問3まで／英単語 Section 5" data-fk="log-memo">${esc(d.memo)}</textarea></label>
      <p class="err" hidden></p>
      <button class="btn primary wide">記録する</button>
    </form>
  </section>`;
}

/** 集計タイル用：単位を小さく。100時間を超えたら時間だけ */
function tileDur(min) {
  if (min < 60) return `${min}<small>分</small>`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h >= 100) return `${h}<small>時間</small>`;
  return `${h}<small>時間</small>${m ? `${m}<small>分</small>` : ''}`;
}

function rangeStart(t) { return ui.range === 'all' ? firstLogDate(t) : D.add(t, -(+ui.range - 1)); }
function isDaily() { return ui.range === '7' || ui.range === '30'; }

function colData() {
  const t = D.today(), from = rangeStart(t);
  const cols = [], idx = new Map();
  if (isDaily()) {
    for (let d = from; d <= t; d = D.add(d, 1)) {
      idx.set(d, cols.length);
      cols.push({ label: D.md(d), title: D.jp(d), values: {}, total: 0 });
    }
  } else {
    for (let w = D.weekStart(from); w <= t; w = D.add(w, 7)) {
      idx.set(w, cols.length);
      cols.push({ label: D.md(w), title: `${D.md(w)}(月)〜${D.md(D.add(w, 6))}(日)の週`, values: {}, total: 0 });
    }
  }
  const ids = new Set();
  for (const l of S.logs) {
    if (l.date < from || l.date > t) continue;
    const c = cols[idx.get(isDaily() ? l.date : D.weekStart(l.date))];
    if (!c) continue;
    c.values[l.subject] = (c.values[l.subject] || 0) + l.min;
    c.total += l.min;
    ids.add(l.subject);
  }
  return { cols, subs: subsWith(ids) };
}

function statsCard() {
  const t = D.today(), from = rangeStart(t), days = D.diff(from, t) + 1;
  const per = {}, dates = new Set();
  let tot = 0;
  for (const l of S.logs) {
    if (l.date < from || l.date > t) continue;
    per[l.subject] = (per[l.subject] || 0) + l.min; dates.add(l.date); tot += l.min;
  }
  const subs = subsWith(new Set(Object.keys(per)));
  const rows = subs.map(s => ({ id: s.id, name: s.name, min: per[s.id] || 0 }));
  const ranges = [['7', '7日'], ['30', '30日'], ['90', '90日'], ['all', '全期間']];
  return `<section class="card stats">
    <header class="card-h"><h3>集計</h3>
      <div class="seg sm" role="group" aria-label="集計の期間">${ranges.map(([k, l]) => `<button class="${ui.range === k ? 'on' : ''}" aria-pressed="${ui.range === k}" data-act="range" data-r="${k}">${l}</button>`).join('')}</div>
    </header>
    <div class="tiles">
      <div class="tile"><span>合計</span><b>${tileDur(tot)}</b></div>
      <div class="tile"><span>1日平均</span><b>${tileDur(Math.round(tot / days))}</b></div>
      <div class="tile"><span>勉強した日</span><b>${dates.size}<small>／${days}日</small></b></div>
      <div class="tile"><span>連続</span><b>${streak()}<small>日</small></b></div>
    </div>
    <h4 class="sub-h">科目別の時間</h4>
    ${Charts.segbar(rows, '科目別の割合')}
    ${Charts.hbars(rows)}
    <div class="sub-h-row">
      <h4 class="sub-h">${isDaily() ? '日ごとの勉強時間' : '週ごとの勉強時間'}</h4>
      <button class="btn sm ghost" data-act="chart-table">${ui.chartTable ? 'グラフで見る' : '表で見る'}</button>
    </div>
    ${ui.chartTable ? colTable() : `<ul class="legend">${subs.map(s => `<li><i class="sw" style="background:var(--c-${s.id})"></i>${s.name}</li>`).join('')}<li class="legend-goal"><i class="goal-key"></i>目標</li></ul>
    <div id="colChart" class="col-chart"></div>`}
  </section>`;
}

function colTable() {
  const { cols, subs } = colData();
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>${isDaily() ? '日付' : '週'}</th>${subs.map(s => `<th>${s.name}</th>`).join('')}<th>合計</th></tr></thead>
    <tbody>${[...cols].reverse().map(c => `<tr><td>${c.title}</td>${subs.map(s => `<td>${c.values[s.id] ? fmtH(c.values[s.id]) : '–'}</td>`).join('')}<td><b>${fmtH(c.total)}</b></td></tr>`).join('')}</tbody>
  </table></div>`;
}

function drawColChart() {
  const el = $('#colChart');
  if (!el) return;
  const { cols, subs } = colData();
  const goal = isDaily() ? S.settings.dailyGoal : S.settings.dailyGoal * 7;
  Charts.stacked(el, cols, { subjects: subs, goal, aria: isDaily() ? '日ごとの勉強時間（科目別の積み上げ）' : '週ごとの勉強時間（科目別の積み上げ）' });
}

function historyCard() {
  const list = S.logs.filter(l => !ui.histSub || l.subject === ui.histSub);
  const byDate = new Map();
  for (const l of list) { if (!byDate.has(l.date)) byDate.set(l.date, []); byDate.get(l.date).push(l); }
  const dates = [...byDate.keys()].sort().reverse();
  const shown = dates.slice(0, ui.histLimit);
  const present = new Set(S.logs.map(l => l.subject));
  return `<section class="card history">
    <header class="card-h"><h3>記録の一覧</h3></header>
    ${S.logs.length ? `<div class="filter" role="group" aria-label="科目で絞り込む">
      <button class="mini ${!ui.histSub ? 'on' : ''}" data-act="hist-sub" data-s="" aria-pressed="${!ui.histSub}">すべて</button>
      ${SUBJECTS.filter(s => present.has(s.id)).map(s => `<button class="mini ${ui.histSub === s.id ? 'on' : ''}" data-act="hist-sub" data-s="${s.id}" aria-pressed="${ui.histSub === s.id}"><i class="sw" style="background:var(--c-${s.id})"></i>${s.name}</button>`).join('')}
    </div>` : ''}
    ${shown.length ? shown.map(d => {
      const ls = byDate.get(d).sort((a, b) => a.at - b.at);
      const tot = ls.reduce((a, l) => a + l.min, 0);
      return `<div class="h-day">
        <div class="h-dh"><b>${D.jp(d)}</b><span>${fmtDur(tot)}</span></div>
        <ul class="h-list">${ls.map(l => `<li><button class="h-item" data-act="edit-log" data-id="${l.id}" aria-label="${SUBJ[l.subject].name} ${fmtDur(l.min)} を編集">
          <i class="sw" style="background:var(--c-${l.subject})"></i><span class="h-sub">${SUBJ[l.subject].name}</span><span class="h-min">${fmtDur(l.min)}</span><span class="h-memo">${esc(l.memo)}</span>${ICON.edit}
        </button></li>`).join('')}</ul>
      </div>`;
    }).join('') : `<p class="empty-note">${ui.histSub ? 'この科目の記録はまだありません。' : 'まだ記録がありません。タイマーか手入力で記録すると、ここに日ごとに並びます。'}</p>`}
    ${dates.length > shown.length ? `<button class="btn ghost wide" data-act="hist-more">さらに表示（残り${dates.length - shown.length}日分）</button>` : ''}
  </section>`;
}

function openLog(id) {
  const l = S.logs.find(x => x.id === id);
  if (!l) return;
  openDlg(`<form class="dlg-form" data-form="edit-log" data-id="${l.id}">
    <h3>記録を編集</h3>
    <div class="f"><span>科目</span>${subjChips('subject', l.subject)}</div>
    <div class="f-row">
      <label class="f"><span>日付</span><input type="date" name="date" value="${l.date}" max="${D.today()}" required></label>
      <div class="f"><span>時間</span><div class="dur">
        <input type="number" name="h" inputmode="numeric" min="0" max="24" value="${Math.floor(l.min / 60)}" aria-label="時間"><em>時間</em>
        <input type="number" name="m" inputmode="numeric" min="0" max="59" value="${l.min % 60}" aria-label="分"><em>分</em>
      </div></div>
    </div>
    <label class="f"><span>内容メモ</span><textarea name="memo" rows="3" maxlength="300">${esc(l.memo)}</textarea></label>
    <p class="err" hidden></p>
    <div class="dlg-actions">
      <button type="button" class="btn ghost danger" data-act="del-log" data-id="${l.id}">削除</button>
      <span class="sp"></span>
      <button type="button" class="btn ghost" data-act="dlg-close">やめる</button>
      <button class="btn primary">保存</button>
    </div>
  </form>`);
}

/** 記録フォームの値を読む（新規・編集共通） */
function readLogForm(form) {
  const fd = new FormData(form);
  const date = fd.get('date'), subject = fd.get('subject');
  const min = Math.round((Number(fd.get('h')) || 0) * 60 + (Number(fd.get('m')) || 0));
  const memo = String(fd.get('memo') || '').trim();
  let err = '';
  if (!D.valid(date)) err = '日付を入れてください';
  else if (date > D.today()) err = '先の日付には記録できません';
  else if (!SUBJ[subject]) err = '科目を選んでください';
  else if (min <= 0) err = '時間を入れてください';
  else if (min > 1440) err = '1回の記録は24時間までです';
  return { date, subject, min, memo, err };
}

/* ---------- 設定 ---------- */

function viewSettings() {
  const st = S.settings, t = D.today();
  let goalOpts = '';
  for (let m = 30; m <= 720; m += 30) goalOpts += `<option value="${m}" ${m === st.dailyGoal ? 'selected' : ''}>${fmtDur(m)}</option>`;
  let hsOpts = '', heOpts = '';
  for (let h = 0; h <= 12; h++) hsOpts += `<option value="${h}" ${h === st.hourStart ? 'selected' : ''}>${h}:00</option>`;
  for (let h = 13; h <= 24; h++) heOpts += `<option value="${h}" ${h === st.hourEnd ? 'selected' : ''}>${h}:00</option>`;
  const themes = [['auto', '端末に合わせる'], ['light', 'ライト'], ['dark', 'ダーク']];
  return `<div class="grid settings">
    <section class="card">
      <header class="card-h"><h3>志望校</h3><button class="btn sm" data-act="add-school">＋ 追加</button></header>
      ${S.schools.length ? `<ul class="schools">${schoolRows(t)}</ul>` : '<p class="empty-note">まだ登録がありません。</p>'}
      <p class="hint">ホームと画面上部のカウントダウンは、まだ終わっていない「第一志望」を優先し、なければいちばん近い入試を出します。</p>
    </section>
    <section class="card">
      <header class="card-h"><h3>目標と科目</h3></header>
      <label class="f"><span>1日の目標勉強時間</span><select data-set="dailyGoal">${goalOpts}</select></label>
      <div class="f"><span>受験に使う科目</span>
        <div class="chips">${SUBJECTS.map(s => `<label class="chip"><input type="checkbox" data-act="set-subject" value="${s.id}" ${st.subjects.includes(s.id) ? 'checked' : ''}><span><i class="sw" style="background:var(--c-${s.id})"></i>${s.name}</span></label>`).join('')}</div>
      </div>
      <p class="hint">外した科目は選択肢から消えます（記録は残ります）。私立の3教科受験なら理科・社会を外すと、科目バランスの判定も3教科で行います。</p>
    </section>
    <section class="card">
      <header class="card-h"><h3>表示</h3></header>
      <div class="f-row">
        <label class="f"><span>時間割の始まり</span><select data-set="hourStart">${hsOpts}</select></label>
        <label class="f"><span>時間割の終わり</span><select data-set="hourEnd">${heOpts}</select></label>
      </div>
      <div class="f"><span>テーマ</span>
        <div class="seg" role="group" aria-label="テーマ">${themes.map(([k, l]) => `<button class="${st.theme === k ? 'on' : ''}" aria-pressed="${st.theme === k}" data-act="theme" data-v="${k}">${l}</button>`).join('')}</div>
      </div>
    </section>
    <section class="card">
      <header class="card-h"><h3>データ</h3></header>
      <p class="hint">記録はこのブラウザの中だけに保存されています。機種変更やブラウザのデータ消去の前に「書き出す」でファイルにしておくと、「読み込む」で戻せます。</p>
      <div class="btn-row">
        <button class="btn" data-act="export">書き出す</button>
        <button class="btn" data-act="import">読み込む</button>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </div>
      <p class="muted sm">志望校 ${S.schools.length}校・タスク ${S.tasks.length}件・時間割 ${S.blocks.length}件・記録 ${S.logs.length}件</p>
      <button class="btn ghost danger" data-act="reset">すべてのデータを消す</button>
    </section>
  </div>`;
}

function openSchool(id) {
  const s = id ? S.schools.find(x => x.id === id)
    : { name: '', role: S.schools.some(x => x.role === '第一志望') ? '併願' : '第一志望', kind: '', date: '', announce: '', memo: '' };
  if (!s) return;
  openDlg(`<form class="dlg-form" data-form="school" data-id="${id || ''}">
    <h3>${id ? '志望校を編集' : '志望校を登録'}</h3>
    <label class="f"><span>学校名</span><input name="name" maxlength="40" value="${esc(s.name)}" placeholder="例：〇〇高校" autofocus></label>
    <div class="f-row">
      <label class="f"><span>区分</span><select name="role">${ROLES.map(r => `<option ${r === s.role ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label class="f"><span>種別 <small>任意</small></span><select name="kind"><option value="">—</option>${KINDS.map(k => `<option ${k === s.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    </div>
    <div class="f-row">
      <label class="f"><span>試験日</span><input type="date" name="date" value="${s.date}"></label>
      <label class="f"><span>合格発表日 <small>任意</small></span><input type="date" name="announce" value="${s.announce}"></label>
    </div>
    <label class="f"><span>メモ <small>任意</small></span><input name="memo" maxlength="80" value="${esc(s.memo)}" placeholder="例：英数国 各50分・面接あり"></label>
    <p class="err" hidden></p>
    <div class="dlg-actions">
      ${id ? `<button type="button" class="btn ghost danger" data-act="del-school" data-id="${id}">削除</button>` : ''}
      <span class="sp"></span>
      <button type="button" class="btn ghost" data-act="dlg-close">やめる</button>
      <button class="btn primary">保存</button>
    </div>
  </form>`);
}

function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gokaku-techo-${D.today().replace(/-/g, '')}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('書き出しました');
}

let pendingImport = null;
async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast('読み込めませんでした（JSON ではありません）'); return; }
  if (!data || data.v !== 1) { toast('このサイトの書き出しファイルではないようです'); return; }
  pendingImport = Store.normalize(data);
  const p = pendingImport;
  openDlg(`<div class="dlg-form">
    <h3>データを読み込む</h3>
    <p>志望校 ${p.schools.length}校・タスク ${p.tasks.length}件・時間割 ${p.blocks.length}件・記録 ${p.logs.length}件</p>
    <p class="hint">今このブラウザにあるデータは、読み込んだ内容で置き換わります。</p>
    <div class="dlg-actions"><span class="sp"></span>
      <button type="button" class="btn ghost" data-act="dlg-close">やめる</button>
      <button type="button" class="btn primary" data-act="import-ok">置き換える</button>
    </div>
  </div>`);
}

/* ---------- 描画 ---------- */

const VIEWS = { home: viewHome, plan: viewPlan, log: viewLog, settings: viewSettings };
const AFTER = {
  log() { if (!ui.chartTable) drawColChart(); },
  plan() {
    const sc = $('#ttScroll');
    if (!sc) return;
    if (ui.ttScroll == null) {
      const ws = weekOf(), we = D.add(ws, 6);
      const first = S.blocks.filter(b => b.date >= ws && b.date <= we).reduce((a, b) => Math.min(a, b.start), 16 * 60);
      ui.ttScroll = Math.max(0, (first - 30 - S.settings.hourStart * 60) / 30 * SLOT);
    }
    sc.scrollTop = ui.ttScroll;
    sc.addEventListener('scroll', () => { ui.ttScroll = sc.scrollTop; }, { passive: true });
  },
};

function render() {
  const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  const v = ui.view;
  $$('#tabs a').forEach(a => {
    const on = a.dataset.view === v;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  renderTop();
  Charts.hideTip();
  const main = $('#main');
  main.dataset.view = v;
  main.innerHTML = VIEWS[v]();
  if (AFTER[v]) AFTER[v]();
  renderTimerPill();
  if (fk) { const el = $(`[data-fk="${CSS.escape(fk)}"]`); if (el) el.focus(); }
}

function setViewFromHash() {
  const h = location.hash.slice(1);
  ui.view = VIEWS[h] ? h : 'home';
}

/* ---------- 操作 ---------- */

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a || a.tagName === 'INPUT') return;
  const id = a.dataset.id;
  switch (a.dataset.act) {
    case 'dlg-close': closeDlg(); break;

    case 'add-school': openSchool(null); break;
    case 'edit-school': openSchool(id); break;
    case 'del-school': {
      const undo = snapshot();
      const s = S.schools.find(x => x.id === id);
      S.schools = S.schools.filter(x => x.id !== id);
      closeDlg(); commit(); toast(`${s ? s.name : '学校'} を削除しました`, undo);
      break;
    }

    case 'del-task': {
      const undo = snapshot();
      S.tasks = S.tasks.filter(k => k.id !== id);
      commit(); toast('タスクを削除しました', undo);
      break;
    }
    case 'task-today': { const k = S.tasks.find(x => x.id === id); if (k) { k.date = D.today(); commit(); } break; }
    case 'all-today': {
      const t = D.today(), undo = snapshot();
      let n = 0;
      for (const k of S.tasks) if (k.date < t && !k.done) { k.date = t; n++; }
      commit(); toast(`${n}件を今日に移しました`, undo);
      break;
    }
    case 'goto-plan':
      ui.planTab = a.dataset.tab; ui.weekOff = 0; ui.ttScroll = null;
      if (location.hash === '#plan') { e.preventDefault(); render(); }
      break;

    case 'plan-tab': ui.planTab = a.dataset.tab; ui.ttScroll = null; render(); break;
    case 'week': {
      const d = +a.dataset.d;
      ui.weekOff = d === 0 ? 0 : ui.weekOff + d; ui.ttScroll = null; render();
      break;
    }
    case 'tt-col': {
      if (e.target.closest('.blk')) break;
      const r = a.getBoundingClientRect();
      newBlockAt(a.dataset.date, S.settings.hourStart * 60 + Math.floor((e.clientY - r.top) / SLOT) * 30);
      break;
    }
    case 'add-block': {
      const ws = weekOf(), t = D.today();
      const inWeek = t >= ws && t <= D.add(ws, 6);
      const now = new Date();
      const start = inWeek ? Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30 : 19 * 60;
      newBlockAt(inWeek ? t : ws, start);
      break;
    }
    case 'edit-block': openBlock(id); break;
    case 'del-block': {
      const undo = snapshot();
      S.blocks = S.blocks.filter(b => b.id !== id);
      closeDlg(); commit(); toast('予定を削除しました', undo);
      break;
    }
    case 'block-log': logBlock(id); break;
    case 'copy-week': {
      const ws = weekOf(), we = D.add(ws, 6), pws = D.add(ws, -7);
      const prev = S.blocks.filter(b => b.date >= pws && b.date < ws);
      if (!prev.length) { toast('前の週に予定がありません'); break; }
      const undo = snapshot();
      S.blocks = S.blocks.filter(b => !(b.date >= ws && b.date <= we))
        .concat(prev.map(b => ({ ...b, id: uid(), date: D.add(b.date, 7), logId: '' })));
      ui.ttScroll = null;
      commit(); toast(`前の週の予定 ${prev.length}件 をこの週に写しました`, undo);
      break;
    }
    case 'clear-week': {
      const ws = weekOf(), we = D.add(ws, 6);
      const n = S.blocks.filter(b => b.date >= ws && b.date <= we).length;
      if (!n) { toast('この週に予定はありません'); break; }
      const undo = snapshot();
      S.blocks = S.blocks.filter(b => !(b.date >= ws && b.date <= we));
      commit(); toast(`この週の予定 ${n}件 を消しました`, undo);
      break;
    }

    case 'quick': {
      const m = +a.dataset.min, form = a.closest('form');
      form.elements.h.value = Math.floor(m / 60) || '';
      form.elements.m.value = m % 60 || '';
      ui.draft.h = form.elements.h.value; ui.draft.m = form.elements.m.value;
      break;
    }
    case 'timer-start': {
      const checked = $('form[data-form="log"] input[name="subject"]:checked');
      const subject = checked ? checked.value : (ui.draft && ui.draft.subject) || firstSubject();
      S.timer = { subject, date: D.today(), acc: 0, since: Date.now() };
      commit();
      break;
    }
    case 'timer-pause': if (S.timer && S.timer.since) { S.timer.acc += Date.now() - S.timer.since; S.timer.since = 0; commit(); } break;
    case 'timer-resume': if (S.timer && !S.timer.since) { S.timer.since = Date.now(); commit(); } break;
    case 'timer-finish': finishTimer(); break;
    case 'timer-discard': S.timer = null; commit(); toast('タイマーを破棄しました'); break;

    case 'range': ui.range = a.dataset.r; render(); break;
    case 'chart-table': ui.chartTable = !ui.chartTable; render(); break;
    case 'hist-sub': ui.histSub = a.dataset.s; ui.histLimit = 14; render(); break;
    case 'hist-more': ui.histLimit += 14; render(); break;
    case 'edit-log': openLog(id); break;
    case 'del-log': {
      const undo = snapshot();
      S.logs = S.logs.filter(l => l.id !== id);
      closeDlg(); commit(); toast('記録を削除しました', undo);
      break;
    }

    case 'theme': S.settings.theme = a.dataset.v; applyTheme(); commit(); break;
    case 'export': exportData(); break;
    case 'import': $('#importFile').click(); break;
    case 'import-ok': {
      if (!pendingImport) break;
      const undo = snapshot();
      const p = pendingImport; pendingImport = null;
      for (const k of Object.keys(p)) S[k] = p[k];
      applyTheme(); closeDlg(); commit(); toast('読み込みました', undo);
      break;
    }
    case 'reset':
      openDlg(`<div class="dlg-form">
        <h3>すべてのデータを消す</h3>
        <p>志望校・タスク・時間割・勉強の記録・設定を、このブラウザから消します。</p>
        <p class="hint">消す前に「書き出す」で保存しておくと、あとで戻せます。</p>
        <div class="dlg-actions"><span class="sp"></span>
          <button type="button" class="btn ghost" data-act="dlg-close">やめる</button>
          <button type="button" class="btn danger-fill" data-act="reset-ok">消す</button>
        </div>
      </div>`);
      break;
    case 'reset-ok': {
      const undo = snapshot();
      const f = Store.fresh();
      for (const k of Object.keys(f)) S[k] = f[k];
      ui.draft = null;
      applyTheme(); closeDlg(); commit(); toast('すべて消しました', undo);
      break;
    }
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'toggle-task') {
    const k = S.tasks.find(x => x.id === el.dataset.id);
    if (k) { k.done = el.checked; commit(); }
    return;
  }
  if (el.dataset.set) {
    S.settings[el.dataset.set] = Number(el.value);
    ui.ttScroll = null;
    commit();
    return;
  }
  if (el.dataset.act === 'set-subject') {
    const on = new Set(S.settings.subjects);
    if (el.checked) on.add(el.value); else on.delete(el.value);
    if (!on.size) { el.checked = true; toast('科目は1つ以上必要です'); return; }
    S.settings.subjects = SUBJECTS.map(s => s.id).filter(i => on.has(i));
    commit();
    return;
  }
  if (el.id === 'importFile') {
    const f = el.files && el.files[0];
    el.value = '';
    if (f) importFile(f);
    return;
  }
  const form = el.closest('form');
  if (form && form.dataset.form === 'add-task' && el.name === 'subject') ui.taskSubject = el.value;
});

document.addEventListener('input', e => {
  const form = e.target.closest('form[data-form="log"]');
  if (!form || !ui.draft) return;
  const fd = new FormData(form);
  ui.draft = { date: fd.get('date') || ui.draft.date, subject: fd.get('subject') || ui.draft.subject, h: fd.get('h'), m: fd.get('m'), memo: fd.get('memo') };
});

document.addEventListener('submit', e => {
  const form = e.target;
  e.preventDefault();
  switch (form.dataset.form) {
    case 'add-task': {
      const text = form.elements.text.value.trim();
      if (!text) return;
      ui.taskSubject = form.elements.subject.value;
      S.tasks.push({ id: uid(), date: form.dataset.date, text: text.slice(0, 120), subject: ui.taskSubject, done: false });
      commit();
      break;
    }
    case 'school': {
      const fd = new FormData(form);
      const v = {
        name: String(fd.get('name') || '').trim(), role: fd.get('role'), kind: fd.get('kind') || '',
        date: fd.get('date'), announce: fd.get('announce') || '', memo: String(fd.get('memo') || '').trim(),
      };
      if (!v.name) return formErr(form, '学校名を入れてください');
      if (!D.valid(v.date)) return formErr(form, '試験日を入れてください');
      if (v.announce && !D.valid(v.announce)) v.announce = '';
      if (v.announce && v.announce < v.date) return formErr(form, '合格発表日が試験日より前になっています');
      const id = form.dataset.id;
      if (id) Object.assign(S.schools.find(x => x.id === id), v);
      else S.schools.push({ id: uid(), ...v });
      closeDlg(); commit();
      toast(id ? '保存しました' : `${v.name} を登録しました`);
      break;
    }
    case 'block': {
      const fd = new FormData(form);
      const date = fd.get('date'), start = +fd.get('start'), end = +fd.get('end'), subject = fd.get('subject');
      const note = String(fd.get('note') || '').trim();
      if (!SUBJ[subject]) return formErr(form, '科目を選んでください');
      if (end <= start) return formErr(form, '終了は開始より後にしてください');
      const id = form.dataset.id;
      const clash = S.blocks.find(b => b.id !== id && b.date === date && b.start < end && start < b.end);
      if (clash) return formErr(form, `${SUBJ[clash.subject].name} ${D.clock(clash.start)}–${D.clock(clash.end)} と重なっています`);
      if (id) Object.assign(S.blocks.find(b => b.id === id), { date, start, end, subject, note });
      else S.blocks.push({ id: uid(), date, start, end, subject, note, logId: '' });
      ui.lastBlockSubject = subject;
      closeDlg(); commit();
      break;
    }
    case 'log': {
      const r = readLogForm(form);
      if (r.err) return formErr(form, r.err);
      const undo = snapshot();
      S.logs.push({ id: uid(), date: r.date, subject: r.subject, min: r.min, memo: r.memo, at: Date.now() });
      ui.draft = { date: r.date, subject: r.subject, h: '', m: '', memo: '' };
      commit();
      toast(`${SUBJ[r.subject].name} ${fmtDur(r.min)} を記録しました`, undo);
      break;
    }
    case 'edit-log': {
      const r = readLogForm(form);
      if (r.err) return formErr(form, r.err);
      const l = S.logs.find(x => x.id === form.dataset.id);
      if (l) Object.assign(l, { date: r.date, subject: r.subject, min: r.min, memo: r.memo });
      closeDlg(); commit(); toast('保存しました');
      break;
    }
  }
});

$('#dlg').addEventListener('click', e => { if (e.target.id === 'dlg') closeDlg(); });
window.addEventListener('hashchange', () => { setViewFromHash(); render(); window.scrollTo(0, 0); });

let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (ui.view === 'log' && !ui.chartTable) drawColChart(); }, 150);
});

// 1秒ごと：タイマーの表示だけ書き換える
setInterval(() => {
  if (!S.timer) return;
  const txt = clockOf(elapsed());
  $$('.js-timer').forEach(el => { el.textContent = txt; });
}, 1000);

// 30秒ごと：日付が変わったら描き直す。時間割の「今」の線を動かす。
let lastDay = D.today();
setInterval(() => {
  const t = D.today();
  if (t !== lastDay) {
    lastDay = t;
    if (ui.draft && !ui.draft.h && !ui.draft.m) ui.draft.date = t;
    if (!$('#dlg').open && !(document.activeElement && document.activeElement.matches('input,textarea'))) render();
    return;
  }
  const line = $('.tt-now');
  if (line) {
    const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
    line.style.top = `${(m - S.settings.hourStart * 60) / 30 * SLOT}px`;
  }
}, 30000);

// 別のタブで書き換えられたら読み直す
window.addEventListener('storage', e => {
  if (e.key !== Store.KEY) return;
  let raw = null;
  try { raw = JSON.parse(e.newValue || 'null'); } catch (err) { return; }
  const fresh = Store.normalize(raw);
  for (const k of Object.keys(fresh)) S[k] = fresh[k];
  applyTheme();
  if (!$('#dlg').open) render();
});

applyTheme();
setViewFromHash();
render();
