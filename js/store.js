'use strict';
/* データの形と保存。localStorage のキー 'gokaku:v1' に1つの JSON で持つ。 */

const SUBJECTS = [
  { id: 'ja', name: '国語', short: '国' },
  { id: 'ma', name: '数学', short: '数' },
  { id: 'en', name: '英語', short: '英' },
  { id: 'sc', name: '理科', short: '理' },
  { id: 'so', name: '社会', short: '社' },
  { id: 'ot', name: 'その他', short: '他' },
];
const SUBJ = Object.fromEntries(SUBJECTS.map(s => [s.id, s]));
const ROLES = ['第一志望', '第二志望', '併願', '滑り止め', 'その他'];
const KINDS = ['公立', '私立', '国立', '高専'];

const D = {
  WD: ['日', '月', '火', '水', '木', '金', '土'],
  ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
  today() { return D.ymd(new Date()); },
  add(s, n) { const d = D.parse(s); d.setDate(d.getDate() + n); return D.ymd(d); },
  /** b − a（日数） */
  diff(a, b) { return Math.round((D.parse(b) - D.parse(a)) / 86400000); },
  /** 月曜はじまりの週の初日 */
  weekStart(s) { const d = D.parse(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return D.ymd(d); },
  dow(s) { return D.parse(s).getDay(); },
  wd(s) { return D.WD[D.parse(s).getDay()]; },
  md(s) { const d = D.parse(s); return `${d.getMonth() + 1}/${d.getDate()}`; },
  jp(s) { const d = D.parse(s); return `${d.getMonth() + 1}月${d.getDate()}日(${D.WD[d.getDay()]})`; },
  jpY(s) { const d = D.parse(s); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${D.WD[d.getDay()]})`; },
  clock(min) { return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; },
  valid(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(D.parse(s)); },
};

/** 120 → 2時間 / 95 → 1時間35分 / 40 → 40分 */
function fmtDur(min) {
  min = Math.round(min || 0);
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}
/** 150 → 2.5h */
function fmtH(min) {
  const h = Math.round((min || 0) / 6) / 10;
  return (Number.isInteger(h) ? String(h) : h.toFixed(1)) + 'h';
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

const Store = {
  KEY: 'gokaku:v1',
  state: null,
  fresh() {
    return {
      v: 1, schools: [], tasks: [], blocks: [], logs: [], timer: null,
      settings: { dailyGoal: 240, subjects: SUBJECTS.map(s => s.id), hourStart: 6, hourEnd: 24, theme: 'auto' },
    };
  },
  load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { s = null; }
    this.state = this.normalize(s);
    return this.state;
  },
  /** 読み込んだデータの形を整える（壊れた行は落とす）。読み込み・復元でも使う。 */
  normalize(s) {
    const f = this.fresh();
    if (!s || typeof s !== 'object' || s.v !== 1) return f;
    const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);
    const subj = v => (SUBJ[v] ? v : 'ot');
    const int = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
    const arr = v => (Array.isArray(v) ? v : []);
    const out = { v: 1, timer: null };
    out.schools = arr(s.schools).filter(x => x && D.valid(x.date) && x.name).map(x => ({
      id: str(x.id, 40) || uid(), name: str(x.name, 40),
      role: ROLES.includes(x.role) ? x.role : 'その他', kind: KINDS.includes(x.kind) ? x.kind : '',
      date: x.date, announce: D.valid(x.announce) ? x.announce : '', memo: str(x.memo, 80),
    }));
    out.tasks = arr(s.tasks).filter(x => x && D.valid(x.date) && x.text).map(x => ({
      id: str(x.id, 40) || uid(), date: x.date, text: str(x.text, 120),
      subject: SUBJ[x.subject] ? x.subject : '', done: !!x.done,
    }));
    out.blocks = arr(s.blocks).filter(x => x && D.valid(x.date)).map(x => ({
      id: str(x.id, 40) || uid(), date: x.date, subject: subj(x.subject),
      start: int(x.start, 0, 1440), end: int(x.end, 0, 1440), note: str(x.note, 60),
      logId: str(x.logId, 40),
    })).filter(b => b.end > b.start);
    out.logs = arr(s.logs).filter(x => x && D.valid(x.date)).map(x => ({
      id: str(x.id, 40) || uid(), date: x.date, subject: subj(x.subject),
      min: int(x.min, 0, 1440), memo: str(x.memo, 300), at: Number(x.at) || 0,
    })).filter(l => l.min > 0);
    const t = s.timer;
    if (t && typeof t === 'object' && SUBJ[t.subject]) {
      out.timer = { subject: t.subject, date: D.valid(t.date) ? t.date : D.today(), acc: Math.max(0, Number(t.acc) || 0), since: Number(t.since) || 0 };
    }
    const st = Object.assign({}, f.settings, s.settings || {});
    st.dailyGoal = int(st.dailyGoal, 30, 960);
    st.subjects = arr(st.subjects).filter(id => SUBJ[id]);
    if (!st.subjects.length) st.subjects = f.settings.subjects;
    st.hourStart = int(st.hourStart, 0, 12);
    st.hourEnd = int(st.hourEnd, 13, 24);
    if (!['auto', 'light', 'dark'].includes(st.theme)) st.theme = 'auto';
    out.settings = st;
    return out;
  },
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.state)); return true; }
    catch (e) { if (window.toast) toast('保存できませんでした（ブラウザの保存領域がいっぱいか、使えない設定です）'); return false; }
  },
};
