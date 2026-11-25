/* Life Quest — app logic */
(() => {
'use strict';
const C = window.LQ;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 9);
const pad = n => String(n).padStart(2, '0');

/* ---------- dates ---------- */
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const wdOf = s => (parse(s).getDay() + 6) % 7;
const weekStart = s => addDays(s, -wdOf(s));
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
const addMin = (t, n) => fromMin(Math.min(toMin(t) + n, 23 * 60 + 59));
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const dateTime = (d, t) => { const x = parse(d); const [h, m] = t.split(':').map(Number); x.setHours(h, m, 0, 0); return x.getTime(); };
const fmtDur = m => m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' m' : '') : m + ' m';
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtDay = (s, o = { weekday: 'long', day: 'numeric', month: 'long' }) => parse(s).toLocaleDateString('en-GB', o);
let TODAY = iso(new Date());

/* ---------- state ---------- */
const KEY = 'lifequest';
function fresh() {
  return { v: 2, created: TODAY, updated: 0,
    settings: { name: 'Anastasiia', water: 8, protein: 115, topic: '', remind: { routine: true, events: true, morning: true, eat: true, mom: true } },
    routine: clone(C.routine), events: clone(C.events), activities: clone(C.activities), todos: [],
    logs: {}, gym: {}, last: {}, ladder: 1, periods: [], cycleLen: 28, periodLen: 5, apps: [],
    seen: {}, ach: {}, sent: {}, lowOff: {}, draft: null, rv: C.routineVersion, med: { sessions: [], course: 0, voice: false, last: '' },
    ovr: {}, freezes: 0, frozen: [], freezeMark: 0, lastLevel: 1, bossDone: {}, look: { theme: 'sage', flower: 'rose' },
    habits: C.habits.map(h => Object.assign({ created: TODAY }, h)) };
}
let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
if (!S || S.v !== 2) S = fresh();
const RV0 = S.rv || 0;
S = Object.assign(fresh(), S);
if (RV0 < C.routineVersion) {
  /* update untouched default routine items, add new ones, keep anything you edited or added */
  const ids = C.routine.map(r => r.id);
  S.routine = S.routine.filter(r => r.edited || ids.includes(r.id) || !['premeal'].includes(r.id));
  for (const d of C.routine) {
    const i = S.routine.findIndex(r => r.id === d.id);
    if (i < 0) S.routine.push(clone(d));
    else if (!S.routine[i].edited) S.routine[i] = Object.assign(clone(d), S.routine[i].skip ? { skip: S.routine[i].skip } : {});
  }
  for (const e of C.events) { const x = S.events.find(y => y.id === e.id); if (x && x.travel == null) x.travel = e.travel; }
  S.rv = C.routineVersion;
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
let saveT = null;
let pendingLevel = 0;
function save() {
  S.updated = Date.now();
  gameTick();
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  checkAch();
  clearTimeout(saveT); saveT = setTimeout(syncReminders, 4000);
}
const log = d => (S.logs[d] = S.logs[d] || { q: {}, water: 0, protein: 0, sleep: null, vit: 0 });
const peek = d => S.logs[d] || { q: {}, water: 0, protein: 0, sleep: null, vit: 0 };

/* ---------- cycle ---------- */
function cycleLen() {
  const s = [...S.periods].sort(); const d = [];
  for (let i = 1; i < s.length; i++) { const x = diffDays(s[i - 1], s[i]); if (x >= 18 && x <= 45) d.push(x); }
  const r = d.slice(-6);
  return r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : S.cycleLen;
}
function cycle(date) {
  if (!S.periods.length) return null;
  const s = [...S.periods].sort(); let last = null;
  for (const x of s) if (x <= date) last = x;
  if (!last) return null;
  const len = cycleLen(), raw = diffDays(last, date) + 1, cd = ((raw - 1) % len) + 1;
  const ov = len - 14, pl = S.periodLen;
  let ph = cd <= 2 ? 'rest' : cd <= pl ? 'period' : cd < ov - 1 ? 'follicular' : cd <= ov + 1 ? 'ovulation' : cd > len - 6 ? 'late' : 'luteal';
  const predicted = raw > len;
  return { cd, len, ph, last, predicted, next: addDays(last, len * Math.ceil(raw / len)) };
}
const isLow = d => { const c = cycle(d); return !!(c && c.ph === 'rest' && !S.lowOff[d]); };
function gymMode(d) {
  for (const [a, b] of C.deload) if (d >= a && d <= b) return 'deload';
  const c = cycle(d); if (!c) return 'normal';
  if (c.ph === 'rest' && S.lowOff[d]) return 'steady';
  return C.phases[c.ph].gym;
}

/* ---------- schedule engine ---------- */
function lowAdjust(it) {
  const m = { gym: ['Gentle: walk + stretch', 30], job: ['Job: one small step (15 min)', 20], clean: ['10-minute tidy (big clean moves)', 15],
    mealprep: ['Easy meal, no prep', 10], mit: ['Power hour — optional', 10], tennis: ['Tennis — only if you feel like it', 40], groceries: ['Groceries — or order in', 10] };
  const x = m[it.tag]; if (!x) return it;
  return Object.assign({}, it, { title: x[0], xp: x[1], gentle: it.tag === 'gym', travel: it.tag === 'gym' ? 0 : it.travel, note: it.tag === 'gym' ? C.gentle.items.join(' · ') : it.note });
}
function itemsFor(d) {
  const wd = wdOf(d), low = isLow(d), out = [];
  for (const r of S.routine) {
    if (!r.days.includes(wd) || (r.skip || []).includes(d) || (r.from && d < r.from)) continue;
    let it = { key: 'r:' + r.id, src: 'routine', ref: r, title: r.title, cat: r.cat, start: r.start, end: r.end, xp: r.xp || 0, tag: r.tag,
      kind: r.kind || 'quest', note: r.note, session: r.session, remind: r.remind, travel: r.travel || 0 };
    if (r.kind === 'gym') it.kind = 'quest';
    const ov = (S.ovr[d] || {})[it.key]; if (ov) { it.start = ov.start; it.end = ov.end; it.moved = true; }
    if (low) it = lowAdjust(it);
    out.push(it);
  }
  for (const e of S.events) if (e.date === d) {
    const a = e.act && S.activities.find(x => x.id === e.act);
    out.push({ key: 'e:' + e.id, src: 'event', ref: e, title: e.title, cat: e.cat, start: e.start, end: e.end, xp: e.xp || 0,
      tag: a && a.weekly ? 'w:' + a.id : (e.act || 'event'), kind: e.xp ? 'quest' : 'fixed', note: e.note, remind: e.remind, travel: e.travel || 0 });
  }
  for (const t of S.todos) if (t.plan && t.plan.date === d)
    out.push({ key: 't:' + t.id, src: 'todo', ref: t, title: t.title, cat: t.cat, start: t.plan.start, end: addMin(t.plan.start, t.mins), xp: todoXP(t), tag: 'todo', kind: 'quest' });
  return addCommutes(out).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}
/* Commute blocks: travel minutes before and after an item, clipped where they hit other plans, merged when they touch. */
function addCommutes(list) {
  const busy = list.filter(i => i.kind !== 'open'), occ = busy.map(i => [toMin(i.start), toMin(i.end)]), segs = [];
  for (const i of busy) if (i.travel) { segs.push([toMin(i.start) - i.travel, toMin(i.start)]); segs.push([toMin(i.end), toMin(i.end) + i.travel]); }
  if (!segs.length) return list;
  let pieces = [];
  for (const s of segs) {
    let parts = [s];
    for (const [x, y] of occ) parts = parts.flatMap(([p, q]) => (y <= p || x >= q) ? [[p, q]] : [[p, Math.min(q, x)], [Math.max(p, y), q]].filter(([u, v]) => v - u >= 5));
    pieces.push(...parts);
  }
  pieces.sort((u, v) => u[0] - v[0]);
  const merged = [];
  for (const s of pieces) { const l = merged[merged.length - 1]; if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else merged.push([s[0], s[1]]); }
  return list.concat(merged.map(([p, q]) => ({ key: 'c:' + p, src: 'commute', title: 'Commute', cat: 'travel', start: fromMin(Math.max(0, p)), end: fromMin(Math.min(q, 1439)),
    xp: 0, tag: 'commute', kind: 'fixed', note: 'Turn the ride into a bonus: an audiobook, a language podcast, or calling Mom.' })));
}
const todoXP = t => 10 + (t.prio || 1) * 5;
function freeSlots(d, items) {
  const busy = items.filter(i => i.kind !== 'open').map(i => [toMin(i.start), toMin(i.end)]).sort((a, b) => a[0] - b[0]);
  const opens = items.filter(i => i.kind === 'open').map(i => [toMin(i.start), toMin(i.end)]);
  let cur = toMin('07:30'); const endW = toMin('22:00'), out = [];
  if (d === TODAY) cur = Math.max(cur, Math.ceil(nowMin() / 5) * 5);
  for (const [a, b] of busy) { if (a - cur >= 30 && cur < endW) out.push([cur, Math.min(a, endW)]); cur = Math.max(cur, b); }
  if (endW - cur >= 30) out.push([cur, endW]);
  return out.filter(([a, b]) => b - a >= 30).map(([a, b]) => {
    const ov = opens.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
    return { start: fromMin(a), end: fromMin(b), mins: b - a, social: ov >= (b - a) / 2 };
  });
}
function weekCount(d, tag) {
  const ws = weekStart(d); let n = 0;
  for (let i = 0; i < 7; i++) for (const q of Object.values(peek(addDays(ws, i)).q)) if (q.tag === tag) n++;
  return n;
}
function suggest(d, mins, social) {
  const low = isLow(d), out = [];
  for (const a of S.activities) if (a.weekly && weekCount(d, 'w:' + a.id) < a.weekly && a.mins <= mins) out.push({ type: 'act', a, why: 'This week' });
  S.todos.filter(t => !t.done && !t.plan && t.mins <= mins)
    .sort((x, y) => (y.prio || 1) - (x.prio || 1) || (x.due || '9').localeCompare(y.due || '9')).slice(0, 3)
    .forEach(t => out.push({ type: 'todo', t, why: t.due ? 'Due ' + fmtDay(t.due, { day: 'numeric', month: 'short' }) : 'To-do' }));
  const calm = ['mom', 'movie', 'bath', 'nap', 'walk', 'readact', 'journal', 'yoga', 'sis'];
  let acts = S.activities.filter(a => !a.weekly && a.mins <= mins && (!low || calm.includes(a.id)));
  if (social) acts.sort((a, b) => (b.cat === 'social') - (a.cat === 'social'));
  acts.slice(0, 5).forEach(a => out.push({ type: 'act', a, why: '' }));
  return out.slice(0, 7);
}

/* ---------- XP ---------- */
const hx = (L, id) => ((L.h || {})[id]) || { n: 0, r: 0, t: [] };
function habitWeek(d, id) { const ws = weekStart(d); let n = 0; for (let i = 0; i < 7; i++) n += hx(peek(addDays(ws, i)), id).n; return n; }
function clearStreak(h) {
  let n = 0, d = TODAY, i = 0;
  while (i++ < 400 && d >= (h.created || TODAY) && hx(peek(d), h.id).n === 0) { n++; d = addDays(d, -1); }
  return n;
}
function habitBonus(d) {
  if (wdOf(d) !== 6 || d > TODAY) return 0;
  const ws = weekStart(d); let days = 0; for (let i = 0; i < 7; i++) if (S.logs[addDays(ws, i)]) days++;
  if (days < 4) return 0;
  return S.habits.filter(h => h.on && (h.created || TODAY) <= ws && habitWeek(d, h.id) <= h.limit).length * 20;
}
function dayXP(d) {
  const L = peek(d); let x = 0;
  for (const h of Object.values(L.h || {})) x += Math.min(h.r || 0, 3) * 5;
  x += habitBonus(d);
  for (const q of Object.values(L.q)) x += q.xp || 0;
  if (L.water >= S.settings.water) x += 15;
  if (L.protein >= S.settings.protein) x += 15;
  if (L.sleep >= 7.5) x += 15;
  if (L.vit) x += 5;
  if (L.energy) x += 5;
  if (L.j && (L.j.win || L.j.note || L.j.mood)) x += 20;
  x += Math.min(medMinutes(d), 20);
  if (L.side) x += 25;
  if (isPerfect(d)) x += 50;
  return x;
}
const totalXP = () => Object.keys(S.logs).reduce((a, d) => a + dayXP(d), 0) + Object.keys(S.bossDone || {}).length * 100;
function isPerfect(d) {
  if (d > TODAY || !S.logs[d]) return false;
  const q = itemsFor(d).filter(i => i.kind === 'quest');
  return q.length > 0 && q.every(i => S.logs[d].q[i.key]);
}
/* ---------- game layer ---------- */
const hashD = s => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const bossOf = ws => C.bosses[Math.floor(diffDays('2026-11-23', ws) / 7 + 800) % C.bosses.length];
function bossDamage(ws) { let x = 0; for (let i = 0; i < 7; i++) x += dayXP(addDays(ws, i)); return x; }
function sideOf(d) { const L = peek(d); return L.sideIdx != null ? L.sideIdx : hashD(d) % C.sideQuests.length; }
const phraseOf = d => { const g = C.insights.filter(i => i.c === 'german'); return g[hashD(d + 'de') % g.length]; };
function unlocked(o) { return o.boss ? Object.keys(S.bossDone || {}).length >= o.boss : levelOf(totalXP()) >= (o.level || 1); }
function applyLook() {
  const t = C.themes.find(x => x.id === S.look.theme) || C.themes[0], f = C.flowers.find(x => x.id === S.look.flower) || C.flowers[0];
  const r = document.documentElement.style;
  r.setProperty('--acc', `light-dark(${t.light}, ${t.dark})`); r.setProperty('--petal', f.petal); r.setProperty('--pollen', f.pollen);
}
function gameTick() {
  const ws = weekStart(TODAY);
  if (!S.bossDone[ws] && bossDamage(ws) >= C.bossHP) { S.bossDone[ws] = TODAY; toast(bossOf(ws) + ' defeated · +100 XP'); }
  const s = streak();
  if (s < S.freezeMark) S.freezeMark = Math.floor(s / 7) * 7;
  if (s >= S.freezeMark + 7) { S.freezeMark += 7; if (S.freezes < 3) { S.freezes++; toast('Streak freeze earned — protects one missed day'); } }
  const L = levelOf(totalXP());
  if (L > (S.lastLevel || 1)) { S.lastLevel = L; pendingLevel = L; setTimeout(maybeLevel, 900); }
}
function runDaily() {
  const y = addDays(TODAY, -1), d2 = addDays(TODAY, -2);
  if (S.freezes > 0 && !peek(y).q['r:stretch'] && !isLow(y) && !S.frozen.includes(y) && (peek(d2).q['r:stretch'] || S.frozen.includes(d2))) {
    S.frozen.push(y); S.freezes--; save(); setTimeout(() => toast('Streak freeze used for yesterday — your streak is safe'), 1200);
  }
}
function maybeLevel() {
  if (!pendingLevel) return;
  if ($('#sheet').classList.contains('on') || $('#gm').classList.contains('on') || $('#md').classList.contains('on')) return;
  const L = pendingLevel; pendingLevel = 0;
  const news = [...C.themes.filter(t => t.level === L).map(t => t.name + ' colour theme'), ...C.flowers.filter(f => f.level === L).map(f => f.name + ' flowers')];
  openSheet(`<div class="levelup"><div class="plant">${plant(L, 200)}</div><p class="xpbig">Level ${L}</p><h2>Your garden grew.</h2>
    ${news.length ? `<p class="lead">Unlocked: <b>${esc(news.join(', '))}</b>. Switch it on in Garden → Settings → Look.</p>` : `<p class="lead">${esc(C.cheers[L % C.cheers.length])}</p>`}
    <button class="btn primary wide" data-act="closeSheet">Keep going</button></div>`);
}
const levelOf = xp => { let L = 1; while (xp >= 50 * (L + 1) * L) L++; return L; };
const need = L => 50 * L * (L - 1);
const countTag = tag => Object.values(S.logs).reduce((n, l) => n + Object.values(l.q).filter(q => q.tag === tag).length, 0);
function streak() {
  let n = 0, d = TODAY, i = 0;
  if (!peek(d).q['r:stretch']) d = addDays(d, -1);
  while (i++ < 500) { if (peek(d).q['r:stretch']) n++; else if (!isLow(d) && !(S.frozen || []).includes(d)) break; d = addDays(d, -1); }
  return n;
}
function bestStreak() {
  const ds = Object.keys(S.logs).filter(d => S.logs[d].q['r:stretch']).sort(); let best = 0, cur = 0, prev = null;
  for (const d of ds) { cur = prev && diffDays(prev, d) === 1 ? cur + 1 : 1; prev = d; best = Math.max(best, cur); }
  return best;
}

/* ---------- achievements ---------- */
const ACHK = {
  'first-gym': () => countTag('gym') >= 1,
  'gym-week': () => Object.keys(S.logs).some(d => weekCount(d, 'gym') >= 4),
  'stretch7': () => bestStreak() >= 7 || streak() >= 7,
  'stretch30': () => bestStreak() >= 30 || streak() >= 30,
  'job10': () => countTag('job') >= 10, 'job30': () => countTag('job') >= 30,
  'mom4': () => new Set(Object.keys(S.logs).filter(d => Object.values(S.logs[d].q).some(q => q.tag === 'w:mom')).map(weekStart)).size >= 4,
  'water7': () => Object.values(S.logs).filter(l => l.water >= S.settings.water).length >= 7,
  'sleep7': () => Object.values(S.logs).filter(l => l.sleep >= 7.5).length >= 7,
  'protein7': () => Object.values(S.logs).filter(l => l.protein >= S.settings.protein).length >= 7,
  'pushup': () => S.ladder >= 6,
  'resist10': () => Object.values(S.logs).reduce((n, l) => n + Object.values(l.h || {}).reduce((m, h) => m + (h.r || 0), 0), 0) >= 10,
  'clear7': () => S.habits.some(h => h.on && clearStreak(h) >= 7),
  'med10': () => S.med.sessions.length >= 10,
  'boss1': () => Object.keys(S.bossDone || {}).length >= 1,
  'perfect': () => Object.keys(S.logs).some(isPerfect),
  'side10': () => Object.values(S.logs).filter(l => l.side).length >= 10,
  'med300': () => S.med.sessions.reduce((n, s) => n + s.mins, 0) >= 300,
  'course': () => S.med.course >= C.course.length,
  'legpress80': () => ((S.last.legpress || {}).w || 0) >= 80,
  'journal14': () => Object.values(S.logs).filter(l => l.j && (l.j.win || l.j.note)).length >= 14,
  'insights30': () => Object.keys(S.seen).length >= 30,
  'lvl10': () => levelOf(totalXP()) >= 10
};
function checkAch() {
  for (const [id, name] of C.achievements) if (!S.ach[id] && ACHK[id] && ACHK[id]()) { S.ach[id] = TODAY; toast('Trophy unlocked · ' + name); }
}

/* ---------- motto ---------- */
function motto(d) {
  const L = peek(d); if (L.motto) return L.motto;
  const c = cycle(d), ph = c && c.ph;
  const pool = C.mottos.filter(m => !m.phase || m.phase === ph);
  const phased = pool.filter(m => m.phase === ph);
  const n = parseInt(d.replace(/-/g, ''), 10);
  const src = phased.length && n % 2 ? phased : pool;
  return src[n % src.length].t;
}

/* ---------- rewards ---------- */
function pickInsight(tag) {
  const cats = C.insightMap[tag] || C.insightMap[(tag || '').replace('w:', '')] || C.insightMap.any;
  let pool = C.insights.filter(i => cats.includes(i.c) && !S.seen[i.id]);
  if (!pool.length) pool = C.insights.filter(i => !S.seen[i.id]);
  if (!pool.length) return null;
  const i = pool[Math.floor(Math.random() * pool.length)]; S.seen[i.id] = TODAY; return i;
}
function reward(item, xp) {
  const big = xp >= 20;
  const cheer = C.cheers[Math.floor(Math.random() * C.cheers.length)];
  if (!big) { toast('+' + xp + ' XP' + (item.ontime ? ' (on time)' : '') + ' · ' + cheer); return; }
  const ins = Math.random() < 0.72 ? pickInsight(item.tag) : null;
  const job = item.tag === 'job';
  openSheet(`<div class="reward"><p class="xpbig">+${xp} XP${item.ontime ? ' · on time +5' : ''}</p>
    ${ins ? `<p class="eyebrow">${esc(catLabel(ins.c))}</p><h2>${esc(ins.t)}</h2><p class="lead">${esc(ins.b)}</p><p class="src">${esc(ins.src)}</p>`
          : `<h2 class="cheer">${esc(cheer)}</h2>`}
    ${job ? `<div class="card soft"><p class="label">Log it (optional)</p><input id="appCo" placeholder="Organisation" autocomplete="off"><input id="appRole" placeholder="Role" autocomplete="off"></div>` : ''}
    <button class="btn primary wide" data-act="rewardDone">${job ? 'Save' : 'Nice'}</button></div>`);
  save();
}
const catLabel = c => ({ german: 'Deutsch B2', calm: 'Calm', habit: 'Habits', train: 'Training', sleep: 'Sleep', food: 'Food', mind: 'Mind', career: 'Career', social: 'People', home: 'Home', read: 'Learning', cycle: 'Cycle' }[c] || 'Insight');

function toggle(d, item) {
  const L = log(d);
  if (L.q[item.key]) {
    delete L.q[item.key];
    if (item.src === 'todo') { item.ref.done = false; delete item.ref.doneAt; }
    save(); render(); return;
  }
  let xp = item.xp, ontime = false;
  if (d === TODAY && xp > 0 && item.start) { const nm = nowMin(); if (nm >= toMin(item.start) - 15 && nm <= toMin(item.end) + 60) { xp += 5; ontime = true; } }
  L.q[item.key] = { xp, cat: item.cat, tag: item.tag, ontime };
  if (item.src === 'todo') { item.ref.done = true; item.ref.doneAt = d; }
  save(); render(); reward(Object.assign({}, item, { ontime }), xp);
  if (isPerfect(d) && !L.perfect) { L.perfect = 1; save(); setTimeout(() => toast('Perfect day — every quest done · +50 XP'), 600); }
}

/* ---------- plant ---------- */
function plant(level, size = 220) {
  const lv = Math.min(level, 24), h = 96 + lv * 7.5, base = 262, top = base - h;
  const n = Math.min(6 + Math.floor(lv * 1.3), 30);
  let leaves = '';
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1), y = base - h * t, side = i % 2 ? 1 : -1;
    const x = 160 + Math.sin(t * 3.2) * 10, len = 32 + (1 - t) * 28 + Math.min(lv, 12), rot = side * (38 + t * 22);
    const fill = i % 3 === 0 ? 'var(--leaf2)' : 'var(--leaf)';
    leaves += `<path d="M0 0 C ${len * .35} ${-len * .32} ${len * .8} ${-len * .28} ${len} 0 C ${len * .8} ${len * .28} ${len * .35} ${len * .32} 0 0Z" fill="${fill}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${side > 0 ? -rot : 180 - rot}) "/>`;
  }
  let flowers = '';
  const nf = level >= 6 ? Math.min(level - 5, 7) : 0;
  for (let i = 0; i < nf; i++) {
    const t = 0.62 + (i / Math.max(nf, 1)) * 0.38, y = base - h * t, x = 160 + Math.sin(t * 3.2) * 10 + (i % 2 ? 22 : -22);
    let p = ''; for (let k = 0; k < 5; k++) p += `<circle cx="${(x + Math.cos(k * 1.2566) * 6).toFixed(1)}" cy="${(y + Math.sin(k * 1.2566) * 6).toFixed(1)}" r="5.5" fill="var(--petal)"/>`;
    flowers += p + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="var(--pollen)"/>`;
  }
  const stem = `<path d="M160 ${base} C 150 ${base - h * .35} 172 ${base - h * .65} ${160 + Math.sin(3.2) * 10} ${top}" stroke="var(--stem)" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 320 320" width="${size}" height="${size}" role="img" aria-label="Your plant at level ${level}">
    <circle cx="160" cy="170" r="138" fill="var(--halo)"/>
    ${stem}${leaves}${flowers}
    <path d="M112 262 h96 l-10 46 h-76z" fill="var(--pot)"/><rect x="106" y="252" width="108" height="16" rx="6" fill="var(--potrim)"/>
  </svg>`;
}

/* ---------- toast + sheet ---------- */
let tq = [], tbusy = false;
function toast(t) { tq.push(t); if (!tbusy) nextToast(); }
function nextToast() {
  const t = tq.shift(); const el = $('#toast');
  if (!t) { tbusy = false; return; }
  tbusy = true; el.textContent = t; el.classList.add('on');
  setTimeout(() => { el.classList.remove('on'); setTimeout(nextToast, 300); }, 2400);
}
function openSheet(html) { $('#sheetBody').innerHTML = html; $('#sheet').classList.add('on'); $('#sheet').setAttribute('aria-hidden', 'false'); }
function closeSheet() { $('#sheet').classList.remove('on'); $('#sheet').setAttribute('aria-hidden', 'true'); if (pendingLevel) setTimeout(maybeLevel, 350); }

/* ---------- views ---------- */
let VIEW = 'today', DAY = TODAY, PLAN_DAY = TODAY, PLAN_TAB = 'cal', JQ = '', PICK = null, MIND_TAB = 'med';
const ICON = {
  today: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  gym: '<path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11"/>',
  mind: '<circle cx="12" cy="7" r="2.6"/><path d="M12 11.5c-2.2 0-3.6 1.4-4.4 3.2M12 11.5c2.2 0 3.6 1.4 4.4 3.2M4 17.5c2.5-.6 5-.2 8 1.4 3-1.6 5.5-2 8-1.4"/>',
  garden: '<path d="M12 21v-8"/><path d="M12 13c0-4 3-7 8-7 0 5-3 7-8 7zM12 15c0-3.2-2.4-5.5-6.5-5.5 0 4 2.4 5.5 6.5 5.5z"/>'
};
function tabbar() {
  $('#tabs').innerHTML = [['today', 'Today'], ['plan', 'Plan'], ['gym', 'Gym'], ['mind', 'Mind'], ['garden', 'Garden']]
    .map(([k, n]) => `<a href="#${k}" class="${VIEW === k ? 'on' : ''}" aria-current="${VIEW === k ? 'page' : 'false'}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg><span>${n}</span></a>`).join('');
}
function render() {
  TODAY = iso(new Date());
  tabbar();
  const v = $('#view');
  v.innerHTML = VIEW === 'today' ? viewToday() : VIEW === 'plan' ? viewPlan() : VIEW === 'gym' ? viewGym() : VIEW === 'mind' ? viewMind() : viewGarden();
  if (S.draft && VIEW === 'gym' && !$('#gm').classList.contains('on')) {/* resume handled by button */}
}

/* --- shared timeline --- */
const CHEV = { up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>', down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' };
let ARR_MODE = 'one';
function timeline(d, opts = {}) {
  const items = itemsFor(d), L = peek(d), slots = freeSlots(d, items), arr = !!S.arrange;
  const rows = [];
  items.filter(i => i.kind !== 'open').forEach(i => rows.push({ t: i.start, i }));
  slots.forEach(s => rows.push({ t: s.start, s }));
  rows.sort((a, b) => a.t.localeCompare(b.t) || (a.s ? 1 : -1));
  const nowM = d === TODAY ? nowMin() : -1;
  const ins = t => arr ? `<div class="ins"><button data-act="ins" data-d="${d}" data-t="${t}" aria-label="Add something at ${t}"><span>+</span></button></div>` : '';
  const bar = `<div class="arrbar${arr ? ' on' : ''}">${arr
    ? `<div class="seg mini2">${[['one', 'Move one'], ['rest', 'Move + all after']].map(([k, n]) => `<button class="${ARR_MODE === k ? 'on' : ''}" data-act="arrMode" data-m="${k}">${n}</button>`).join('')}</div><button class="btn small primary" data-act="arrange">Done</button>`
    : `<span class="hint">Tap a plan to open it</span><button class="btn small" data-act="arrange">↕ Arrange · +</button>`}</div>`;
  let prevEnd = rows.length ? fromMin(Math.max(0, toMin(rows[0].t) - 60)) : '09:00';
  return `${bar}<div class="tl${arr ? ' arr' : ''}">${rows.map(r => {
    const before = ins(prevEnd);
    if (r.s) {
      prevEnd = r.s.end;
      const sug = suggest(d, r.s.mins, r.s.social).slice(0, 3);
      return before + `<div class="slot"><div class="time">${r.s.start}</div><button class="slotbox" data-act="slot" data-d="${d}" data-s="${r.s.start}" data-e="${r.s.end}" data-soc="${r.s.social ? 1 : ''}">
        <span class="slothead">${r.s.social ? 'Open · social time' : 'Free'} · ${fmtDur(r.s.mins)}</span>
        ${sug.length ? `<span class="fits">${sug.map(x => esc(x.type === 'todo' ? x.t.title : x.a.title)).join(' · ')}</span>` : '<span class="fits">Tap to plan something</span>'}
      </button></div>`;
    }
    const i = r.i, c = C.cats[i.cat] || C.cats.mind, done = !!L.q[i.key];
    prevEnd = i.end;
    const live = nowM >= toMin(i.start) && nowM < toMin(i.end);
    const right = arr
      ? (i.src === 'commute' ? '<span class="fixed"></span>' : `<div class="nudge"><button data-act="nudge" data-d="${d}" data-k="${esc(i.key)}" data-n="-15" aria-label="15 min earlier">${CHEV.up}</button><button data-act="nudge" data-d="${d}" data-k="${esc(i.key)}" data-n="15" aria-label="15 min later">${CHEV.down}</button></div>`)
      : i.kind === 'quest' ? `<button class="check" data-act="tick" data-d="${d}" data-k="${esc(i.key)}" aria-label="${done ? 'Undo' : 'Done'}: ${esc(i.title)}" aria-pressed="${done}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>` : (i.tag === 'commute' ? '<span class="fixed"></span>' : '<span class="fixed">fixed</span>');
    return before + `<div class="item${done ? ' done' : ''}${live ? ' live' : ''}${i.moved ? ' moved' : ''}" style="--c:${c.color};--cs:${c.soft}">
      <div class="time">${i.start}<small>${i.end}</small></div>
      <button class="body" data-act="item" data-d="${d}" data-k="${esc(i.key)}"><span class="title">${esc(i.title)}</span>
        <span class="meta">${esc(c.name)}${i.xp ? ' · +' + i.xp + ' XP' : ''}${i.tag === 'gym' && !i.gentle ? ' · ' + esc(C.gymModes[gymMode(d)].label) : ''}${i.moved ? ' · moved' : ''}</span></button>
      ${right}
    </div>`;
  }).join('')}${ins(prevEnd)}</div>${arr && Object.keys(S.ovr[d] || {}).length ? `<button class="link" data-act="resetDay" data-d="${d}">Reset this day's times</button>` : ''}`;
}
function sheetInsert(d, t) {
  const sug = suggest(d, 240, false);
  openSheet(`<p class="eyebrow">${esc(fmtDay(d))} · at ${t}</p><h2>Add something here</h2>
    <p class="hint">Later plans move back to make room.</p>
    <div class="list">${sug.map(x => x.type === 'todo'
      ? `<button class="li tap row between" data-act="slotTodo" data-room="1" data-id="${x.t.id}" data-d="${d}" data-s="${t}"><span><i class="dot" style="background:${C.cats[x.t.cat].color}"></i>${esc(x.t.title)}</span><span class="hint">${fmtDur(x.t.mins)}</span></button>`
      : `<button class="li tap row between" data-act="slotAct" data-room="1" data-id="${x.a.id}" data-d="${d}" data-s="${t}"><span><i class="dot" style="background:${C.cats[x.a.cat].color}"></i>${esc(x.a.title)}</span><span class="hint">${fmtDur(x.a.mins)}</span></button>`).join('')}</div>
    <details class="li" open><summary>Appointment, meet-up or anything else</summary>${eventForm({ date: d, start: t, end: addMin(t, 60), cat: 'social', xp: 15, remind: 15, room: true })}</details>`);
}
function itemByKey(d, k) { return itemsFor(d).find(i => i.key === k); }

/* --- Today --- */
function viewToday() {
  const d = DAY, L = peek(d), c = cycle(d), items = itemsFor(d).filter(i => i.kind === 'quest');
  const done = items.filter(i => L.q[i.key]).length, low = isLow(d);
  const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const ph = c && C.phases[c.ph];
  const weekly = S.activities.filter(a => a.weekly);
  const evening = d === TODAY && hr >= 20 && !(L.j && L.j.savedAt);
  return `<header class="head">
    <div class="daynav"><button class="icon" data-act="day" data-n="-1" aria-label="Previous day">‹</button>
      <p class="date">${esc(d === TODAY ? fmtDay(d) : fmtDay(d))}</p>
      <button class="icon" data-act="day" data-n="1" aria-label="Next day">›</button></div>
    <h1>${d === TODAY ? greet + ', ' + esc(S.settings.name.split(' ')[0]) : esc(fmtDay(d, { weekday: 'long' }))}</h1>
  </header>
  <button class="motto" data-act="motto" data-d="${d}"><span class="eyebrow">Motto of the day</span><span class="mtext">${esc(motto(d))}</span></button>
  ${(() => { const p = phraseOf(d); return `<details class="card de"><summary><span class="eyebrow">Deutsch B2 · phrase of the day</span><b>${esc(p.t)}</b></summary><p>${esc(p.b)}</p></details>`; })()}
  ${ph ? `<div class="phase" style="--p:${ph.color}"><div><b>${esc(ph.name)}</b> · day ${c.cd}${c.predicted ? ' (predicted)' : ''}</div><p>${esc(ph.text)}</p>
      ${c.ph === 'rest' ? `<button class="link" data-act="lowoff" data-d="${d}">${S.lowOff[d] ? 'Switch rest mode back on' : 'I feel fine — plan normally'}</button>` : ''}</div>` : ''}
  ${!L.energy ? `<div class="card energy"><p class="label">How's your energy right now?</p><div class="seg5">${[1, 2, 3, 4, 5].map(n => `<button data-act="energy" data-d="${d}" data-n="${n}">${n}</button>`).join('')}</div><p class="hint">1 = empty · 5 = full</p></div>`
    : L.energy <= 2 && !low ? `<div class="card soft"><p><b>Low battery day.</b> Do the minimum version: Daily 10, one job step, water, early night. Everything else is a bonus.</p></div>` : ''}
  <div class="progress"><div class="bar"><i style="width:${items.length ? Math.round(done / items.length * 100) : 0}%"></i></div><span>${done}/${items.length} · ${dayXP(d)} XP</span></div>
  ${timeline(d)}
  ${gameCards(d)}
  <h2 class="sec">Trackers</h2>
  <div class="trackers">
    <div class="card"><div class="row between"><p class="label">Water</p><p class="val">${(L.water * .25).toFixed(2).replace(/\.?0+$/, '')} / ${S.settings.water * .25} L</p></div>
      <div class="drops">${Array.from({ length: Math.max(S.settings.water, L.water) + 2 }, (_, i) => `<button class="drop${i < L.water ? ' f' : ''}" data-act="water" data-d="${d}" data-n="${i + 1}" aria-label="${i + 1} glasses"></button>`).join('')}</div></div>
    <div class="card"><div class="row between"><p class="label">Protein</p><p class="val">${L.protein} / ${S.settings.protein} g</p></div>
      <div class="meter"><i style="width:${Math.min(100, L.protein / S.settings.protein * 100)}%"></i></div>
      <div class="chips">${C.protein.map(([n, g]) => `<button class="chip" data-act="protein" data-d="${d}" data-g="${g}">${esc(n)} <b>+${g}</b></button>`).join('')}<button class="chip ghost" data-act="protein" data-d="${d}" data-g="-5">−5</button></div></div>
    <div class="card row between"><div><p class="label">Sleep last night</p><p class="hint">7.5 h+ = +15 XP</p></div>
      <div class="stepper"><button data-act="sleep" data-d="${d}" data-n="-0.5" aria-label="Less sleep">−</button><b>${L.sleep ?? '–'} h</b><button data-act="sleep" data-d="${d}" data-n="0.5" aria-label="More sleep">+</button></div></div>
    <div class="card row between"><div><p class="label">Vitamins</p><p class="hint">D + omega-3 + creatine · magnesium tonight</p></div>
      <button class="check big${L.vit ? ' on' : ''}" data-act="vit" data-d="${d}" aria-pressed="${!!L.vit}" aria-label="Vitamins taken"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button></div>
  </div>
  ${habitCard(d)}
  <h2 class="sec">This week</h2>
  <div class="card list">
    ${weekly.map(a => { const n = weekCount(d, 'w:' + a.id); return `<div class="row between li"><span>${esc(a.title)}</span><span class="row"><span class="count${n >= a.weekly ? ' ok' : ''}">${n}/${a.weekly}</span><button class="btn small" data-act="weeklyDone" data-d="${d}" data-id="${a.id}">Done</button></span></div>`; }).join('')}
    <div class="row between li"><span>Gym sessions</span><span class="count${weekCount(d, 'gym') >= 4 ? ' ok' : ''}">${weekCount(d, 'gym')}/4</span></div>
    <div class="row between li"><span>Job quests</span><span class="count${weekCount(d, 'job') >= 5 ? ' ok' : ''}">${weekCount(d, 'job')}/5</span></div>
  </div>
  ${evening ? `<button class="card cta" data-act="go" data-v="journal">Close the day → write your evening note</button>` : ''}
  ${installHint()}`;
}
function gameCards(d) {
  const L = peek(d), ws = weekStart(d), dmg = bossDamage(ws), hp = C.bossHP, dead = !!S.bossDone[ws] || dmg >= hp;
  const sq = C.sideQuests[sideOf(d)];
  return `<h2 class="sec">Quests</h2>
  <div class="card side${L.side ? ' done' : ''}"><div class="row between"><div class="grow"><p class="eyebrow">Side quest · +25 XP</p><p class="sq">${esc(sq)}</p></div>
    <button class="check${L.side ? ' on' : ''}" data-act="side" data-d="${d}" aria-pressed="${!!L.side}" aria-label="Side quest done"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button></div>
    ${!L.side && !L.sideSwapped ? `<button class="link" data-act="sideSwap" data-d="${d}">Swap for another (once a day)</button>` : ''}</div>
  <div class="card boss"><div class="row between"><div><p class="eyebrow">Weekly boss</p><b>${esc(bossOf(ws))}</b></div><span class="hint">${dead ? 'Defeated · +100 XP' : Math.max(0, hp - dmg) + ' HP left'}</span></div>
    <div class="hp"><i style="width:${Math.max(0, 100 - dmg / hp * 100)}%"></i></div>
    <p class="hint">${dead ? 'Beaten this week. A new boss arrives on Monday.' : 'Every XP you earn this week is damage. Defeat it by Sunday.'}${S.freezes ? ' · Streak freezes: ' + S.freezes : ''}</p></div>`;
}
function habitCard(d) {
  const hs = S.habits.filter(h => h.on); if (!hs.length) return '';
  const L = peek(d);
  return `<h2 class="sec">Habits</h2><div class="card list">${hs.map(h => {
    const x = hx(L, h.id), w = habitWeek(d, h.id), over = w > h.limit;
    return `<div class="li"><div class="row between"><div class="grow"><b>${esc(h.name)}</b>
      <p class="hint">Today ${x.n} · this week <span class="${over ? 'warn' : 'okc'}">${w}/${h.limit}</span> ${esc(h.unit)}${x.r ? ' · resisted ' + x.r : ''}</p></div>
      <div class="row hbtns"><button class="btn small soft" data-act="hres" data-d="${d}" data-id="${h.id}">Resisted</button><button class="btn small" data-act="hadd" data-d="${d}" data-id="${h.id}" aria-label="Log one ${esc(h.unit)}">+1</button></div></div>
      ${x.n ? `<button class="link" data-act="hsub" data-d="${d}" data-id="${h.id}">Undo one</button>` : ''}</div>`;
  }).join('')}</div><p class="hint pad">No judgement here: honest numbers are what make change possible. Resisting an urge = +5 XP. Staying under your weekly limit = +20 XP on Sunday.</p>`;
}
function installHint() {
  const ios = /iphone|ipad/i.test(navigator.userAgent), standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!ios || standalone || S.hideInstall) return '';
  return `<div class="card soft"><p><b>Put Life Quest on your Home Screen:</b> in Safari tap Share → “Add to Home Screen”. It then opens full-screen like an app.</p><button class="link" data-act="hideInstall">Hide</button></div>`;
}

/* --- Plan --- */
function viewPlan() {
  const ws = weekStart(PLAN_DAY);
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i), c = cycle(d), ph = c && C.phases[c.ph];
    return `<button class="dpill${d === PLAN_DAY ? ' on' : ''}${d === TODAY ? ' today' : ''}" data-act="pday" data-d="${d}"><span>${WD[i]}</span><b>${parse(d).getDate()}</b><i style="background:${ph ? ph.color : 'transparent'}"></i></button>`;
  }).join('');
  let body = '';
  if (PLAN_TAB === 'cal') {
    body = `<div class="weekbar"><button class="icon" data-act="pweek" data-n="-7" aria-label="Previous week">‹</button><p>${esc(fmtDay(ws, { day: 'numeric', month: 'short' }))} – ${esc(fmtDay(addDays(ws, 6), { day: 'numeric', month: 'short' }))}</p><button class="icon" data-act="pweek" data-n="7" aria-label="Next week">›</button></div>
      <div class="strip">${strip}</div>
      <div class="row between"><h2 class="sec">${esc(fmtDay(PLAN_DAY))}</h2>${isLow(PLAN_DAY) ? '<span class="tag">rest mode</span>' : ''}</div>
      ${timeline(PLAN_DAY)}`;
  } else if (PLAN_TAB === 'todo') {
    const open = S.todos.filter(t => !t.done), done = S.todos.filter(t => t.done).slice(-8).reverse();
    body = `<form class="addrow" data-form="todo"><input id="todoIn" placeholder="Add a to-do…" autocomplete="off" enterkeyhint="done"><button class="btn primary" type="submit">Add</button></form>
      <p class="hint">Give each to-do a duration — free slots will suggest the ones that fit.</p>
      <div class="card list">${open.length ? open.map(todoRow).join('') : '<p class="empty">Nothing here. Add what’s on your mind.</p>'}</div>
      ${done.length ? `<h2 class="sec">Done</h2><div class="card list muted">${done.map(todoRow).join('')}</div>` : ''}`;
  } else {
    body = `<p class="hint">Your menu for free time. Tap a free slot anywhere in the app to drop one in.</p>
      <div class="card list">${S.activities.map(a => `<button class="row between li tap" data-act="editAct" data-id="${a.id}"><span><i class="dot" style="background:${C.cats[a.cat].color}"></i>${esc(a.title)}</span><span class="hint">${fmtDur(a.mins)}${a.weekly ? ' · ' + a.weekly + '×/week' : ''}</span></button>`).join('')}</div>
      <button class="btn wide" data-act="editAct" data-id="">+ New activity</button>`;
  }
  return `<header class="head"><h1>Plan</h1></header>
    <div class="seg">${[['cal', 'Calendar'], ['todo', 'To-do'], ['act', 'Activities']].map(([k, n]) => `<button class="${PLAN_TAB === k ? 'on' : ''}" data-act="ptab" data-t="${k}">${n}</button>`).join('')}</div>
    ${body}
    ${S.arrange ? '' : `<button class="fab" data-act="add" data-d="${PLAN_DAY}" aria-label="Add">+</button>`}`;
}
function todoRow(t) {
  const c = C.cats[t.cat] || C.cats.mind;
  return `<div class="row li todo${t.done ? ' done' : ''}">
    <button class="check sm${t.done ? ' on' : ''}" data-act="todoDone" data-id="${t.id}" aria-label="Done: ${esc(t.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
    <button class="grow tap" data-act="editTodo" data-id="${t.id}"><span class="title">${'!'.repeat(Math.max(0, (t.prio || 1) - 1))}${(t.prio || 1) > 1 ? ' ' : ''}${esc(t.title)}</span>
      <span class="meta"><i class="dot" style="background:${c.color}"></i>${fmtDur(t.mins)}${t.due ? ' · due ' + esc(fmtDay(t.due, { day: 'numeric', month: 'short' })) : ''}${t.plan ? ' · planned ' + esc(fmtDay(t.plan.date, { weekday: 'short' })) + ' ' + t.plan.start : ''}</span></button>
    ${!t.done && !t.plan ? `<button class="btn small" data-act="planTodo" data-id="${t.id}">Plan</button>` : ''}
  </div>`;
}

/* --- Gym --- */
function gymPlan(d) {
  const it = itemsFor(d).find(i => i.tag === 'gym');
  return it ? { item: it, session: it.ref.session, gentle: !!it.gentle } : null;
}
function suggestion(ex, mode) {
  const u = ex.unit || 'kg';
  if (u === 'level') {
    const last = S.last.pushup, lv = S.ladder;
    const ready = last && last.lv === lv && last.reps.length && last.reps.every(r => r >= 12) && lv < 7 && (mode === 'push' || mode === 'normal');
    return { w: 0, text: ready ? 'Ready: move to level ' + (lv + 1) : 'Level ' + lv + ' · ' + C.ladder[lv - 1], up: ready };
  }
  const last = S.last[ex.id];
  if (u === 'bw' || u === 'sec') return { w: 0, text: last ? 'Last: ' + last.reps.join(' / ') + (u === 'sec' ? ' s' : '') + ' — beat one' : 'Find your number today' };
  let w = last ? last.w : (ex.start || 0), text, up = false;
  if (mode === 'deload') { w = Math.round(w * 0.8 * 2) / 2; text = 'Deload · ' + w + ' kg, easy sets'; }
  else if (!last) text = 'Start · ' + w + ' kg';
  else if (last.reps.length && last.reps.every(r => r >= ex.hi) && ex.inc && (mode === 'push' || mode === 'normal')) {
    w = Math.max(0, +(w + ex.inc).toFixed(1)); up = true; text = (ex.inc < 0 ? 'Less assist · ' : 'Level up · ') + w + ' kg';
  } else if (last.reps.some(r => r < ex.lo)) text = 'Hold ' + w + ' kg · own the reps';
  else if (mode === 'steady' || mode === 'hold') text = 'Same ' + w + ' kg · ' + C.gymModes[mode].label.toLowerCase() + ' phase';
  else text = 'Same ' + w + ' kg · beat ' + last.reps.join('/');
  return { w, text, up };
}
const yt = q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q.trim() + ' exercise how to');
const setsFor = (ex, mode) => mode === 'deload' ? Math.min(2, ex.sets) : ex.sets;
function viewGym() {
  const d = TODAY, plan = gymPlan(d), mode = gymMode(d), m = C.gymModes[mode];
  const active = S.draft && S.draft.date === d && Object.keys(S.draft.sets).length ? S.draft.session : null;
  const key = active || PICK || (plan && !plan.gentle && plan.session) || 'LA';
  const ses = C.sessions[key], done = (plan && peek(d).q[plan.item.key]) || S.gym[d];
  const hist = Object.keys(S.gym).sort().reverse().slice(0, 5);
  let top;
  if (plan && plan.gentle) {
    top = `<div class="card hero gentle"><p class="eyebrow">Today · rest days</p><h2>${esc(C.gentle.name)}</h2><ul class="clean">${C.gentle.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <button class="btn primary wide" data-act="tick" data-d="${d}" data-k="${esc(plan.item.key)}">${done ? 'Done ✓' : 'Mark gentle session done'}</button>
      <p class="hint">Want to lift anyway? Pick a session below — it'll run in steady mode.</p></div>`;
  } else {
    top = `<div class="card hero"><p class="eyebrow">${plan ? 'Today' : 'No gym planned today'} · ${esc(m.label)}</p>
      <h2>${esc(ses.name)} <span class="muted">· ${esc(ses.focus)}</span></h2><p class="hint">${esc(m.text)}</p>
      <button class="btn primary wide big" data-act="gymStart" data-s="${key}">${active === key ? 'Resume workout' : done ? 'Done today ✓ · log another' : 'Start workout'}</button></div>`;
  }
  return `<header class="head"><h1>Gym</h1></header>
    ${top}
    <div class="seg">${Object.entries(C.sessions).map(([k, s]) => `<button class="${k === key ? 'on' : ''}" data-act="gymPick" data-s="${k}">${esc(s.name)}</button>`).join('')}</div>
    <div class="card list">${ses.ex.map(ex => { const sg = suggestion(ex, mode); return `<div class="li"><div class="row between"><b>${esc(ex.name)} <a class="link" href="${yt(ex.name)}" target="_blank" rel="noopener">Demo</a></b><span class="hint">${setsFor(ex, mode)} × ${ex.unit === 'carry' ? '1' : ex.lo + '–' + ex.hi}${ex.unit === 'sec' ? ' s' : ''}</span></div><span class="sug${sg.up ? ' up' : ''}">${esc(sg.text)}</span></div>`; }).join('')}
      <div class="li"><b>Cardio</b><p class="hint">${esc(ses.cardio)}</p></div></div>
    <h2 class="sec">Program</h2>
    <div class="card list">
      <details class="li"><summary>How progression works</summary><p>Stay at a weight until every set reaches the top of the rep range, then the app adds weight (dumbbells +1 kg, machines +2.5 kg, leg press and hip thrust +5 kg). Stop each set with 1–2 good reps left.</p>
        <p><b>Cycle sync:</b> days 1–2 → gentle walk + stretching. Days 3–5 → same weights, 2–3 reps in reserve. Rising-energy and peak phases → progression on. Pre-period → hold weights. Research says cycle effects on performance are small and individual, so your energy check-in can always override.</p>
        <p><b>Deload 21–27 Dec:</b> 2 sets at ~80 %.</p></details>
      <details class="li"><summary>Realistic targets by end of January</summary><table>${C.targets.map(t => `<tr><td>${esc(t[0])}</td><td>${esc(t[1])}</td><td><b>${esc(t[2])}</b></td></tr>`).join('')}</table></details>
      <details class="li"><summary>Push-up ladder · you're on level ${S.ladder}</summary><ol>${C.ladder.map((l, i) => `<li${i + 1 === S.ladder ? ' class="cur"' : ''}>${esc(l)}</li>`).join('')}</ol>
        <div class="row"><button class="btn small" data-act="ladder" data-n="-1">Easier</button><button class="btn small" data-act="ladder" data-n="1">Harder</button></div></details>
      <details class="li"><summary>Daily 10 at home</summary><ul>${C.home.map(h => `<li>${esc(h)}</li>`).join('')}</ul><p class="hint">${esc(C.homeMin)}</p></details>
      <details class="li"><summary>Pain rule</summary><p>Mild discomfort (up to 3/10) that's gone by the next morning is fine. Sharp, pinching or worsening knee or back pain → tap “Swap” on that exercise. If back pain shoots down a leg or a knee swells, see a physio before training through it.</p></details>
    </div>
    ${hist.length ? `<h2 class="sec">Recent sessions</h2><div class="card list">${hist.map(h => `<div class="row between li"><span>${esc(fmtDay(h, { weekday: 'short', day: 'numeric', month: 'short' }))}</span><span class="hint">${esc(C.sessions[S.gym[h].session].name)}</span></div>`).join('')}</div>` : ''}`;
}

/* --- Gym mode (full screen) --- */
let restT = null, restEnd = 0, wake = null, audioCtx = null;
function gymStart(key) {
  const d = TODAY;
  if (!S.draft || S.draft.date !== d || S.draft.session !== key) S.draft = { date: d, session: key, step: 0, sets: {}, swaps: {}, warm: {}, start: Date.now() };
  save(); openGym();
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then(w => wake = w).catch(() => {}); } catch (e) {}
}
function gymSteps() { const s = C.sessions[S.draft.session]; return ['warm', ...s.ex.map(e => e.id), 'cardio']; }
function openGym() { $('#gm').classList.add('on'); renderGym(); }
function closeGym() { $('#gm').classList.remove('on'); clearInterval(restT); restEnd = 0; try { wake && wake.release(); } catch (e) {} wake = null; render(); }
function renderGym() {
  const D = S.draft; if (!D) return closeGym();
  const ses = C.sessions[D.session], steps = gymSteps(), st = steps[D.step], mode = gymMode(D.date);
  const dots = steps.map((s, i) => `<i class="${i < D.step ? 'past' : i === D.step ? 'cur' : ''}"></i>`).join('');
  let body = '';
  if (st === 'warm') {
    const w = C.warmups[ses.warm];
    body = `<p class="eyebrow">Step 1 · Physio warm-up · 20 min</p><h2>Switch your core and hips on</h2>
      <div class="list">${w.map((x, i) => `<div class="row li${D.warm[i] ? ' done' : ''}"><button class="check sm${D.warm[i] ? ' on' : ''}" data-act="warm" data-i="${i}" aria-label="Done: ${esc(x)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button><span class="grow">${esc(x)}</span><a class="link" href="${yt(x.replace(/[0-9×/s,].*$/, ''))}" target="_blank" rel="noopener">Demo</a></div>`).join('')}</div>
      <button class="btn primary wide big" data-act="gnext">Start lifting</button>`;
  } else if (st === 'cardio') {
    body = `<p class="eyebrow">Last step · Cardio · 20 min</p><h2>${esc(ses.cardio)}</h2>
      <p class="lead">Easy enough to talk. Then you're done — and the next thing is food.</p>
      <button class="btn primary wide big" data-act="gfinish">Finish workout</button>`;
  } else {
    const ex = ses.ex.find(e => e.id === st), sg = suggestion(ex, mode), sets = D.sets[ex.id] || [], n = setsFor(ex, mode);
    const u = ex.unit || 'kg', cur = D.cur && D.cur.id === ex.id ? D.cur : (D.cur = { id: ex.id, w: sets.length ? sets[sets.length - 1].w : sg.w, r: sets.length ? sets[sets.length - 1].r : (u === 'sec' ? ex.lo : u === 'carry' ? 1 : ex.hi) });
    const swapped = D.swaps[ex.id];
    const allDone = sets.length >= n;
    body = `<p class="eyebrow">Exercise ${D.step} of ${ses.ex.length}${mode === 'hold' ? ' · last set optional' : ''}</p>
      <h2>${esc(swapped ? ex.alt : ex.name)}</h2>
      <p class="cue">${esc(swapped ? 'Swap for pain or a busy machine. Same sets and reps.' : ex.cue)}</p>
      <details class="how"><summary>How to do it</summary>${swapped ? '' : `<ol>${ex.how.map(h => `<li>${esc(h)}</li>`).join('')}</ol>`}<a class="link" href="${yt(swapped ? ex.alt : ex.name)}" target="_blank" rel="noopener">Watch a demo on YouTube ↗</a></details>
      <div class="row gap"><span class="sug${sg.up ? ' up' : ''}">${esc(sg.text)}</span><button class="link" data-act="swap" data-id="${ex.id}">${swapped ? 'Back to original' : 'Swap'}</button></div>
      <p class="setno">${allDone ? 'All sets done' : 'Set ' + (sets.length + 1) + ' of ' + n} · target ${u === 'carry' ? '1 carry' : ex.lo + '–' + ex.hi + (u === 'sec' ? ' s' : ' reps')}${ex.per ? ' · kg per hand' : ''}</p>
      ${u === 'level' ? `<div class="big-step"><button data-act="ladder" data-n="-1" aria-label="Easier level">−</button><div><b>L${S.ladder}</b><small>${esc(C.ladder[S.ladder - 1])}</small></div><button data-act="ladder" data-n="1" aria-label="Harder level">+</button></div>` : ''}
      ${['kg', 'carry'].includes(u) ? `<div class="big-step"><button data-act="gw" data-n="${-Math.abs(ex.inc || 1)}" aria-label="Less weight">−</button><div><b>${cur.w}</b><small>kg</small></div><button data-act="gw" data-n="${Math.abs(ex.inc || 1)}" aria-label="More weight">+</button></div>` : ''}
      ${u !== 'carry' ? `<div class="big-step"><button data-act="gr" data-n="-1" aria-label="Fewer">−</button><div><b>${cur.r}</b><small>${u === 'sec' ? 'seconds' : 'reps'}</small></div><button data-act="gr" data-n="1" aria-label="More">+</button></div>` : ''}
      <div class="done-sets">${sets.map((s, i) => `<span>${i + 1}: ${u === 'kg' || u === 'carry' ? s.w + ' kg' + (u === 'kg' ? ' × ' : '') : ''}${u === 'carry' ? '' : s.r}${u === 'level' ? ' reps' : ''}</span>`).join('')}${sets.length ? '<button class="link" data-act="undoSet">Undo</button>' : ''}</div>
      <div id="rest" class="rest${restEnd > Date.now() ? ' on' : ''}"></div>
      ${allDone ? `<button class="btn primary wide big" data-act="gnext">Next exercise</button>` : `<button class="btn primary wide big" data-act="logSet" data-rest="${ex.rest}">Log set</button>`}`;
  }
  $('#gmBody').innerHTML = `<div class="gmtop"><button class="icon" data-act="gclose" aria-label="Minimise workout">⌄</button><div class="dots">${dots}</div><button class="link" data-act="gprev"${D.step ? '' : ' disabled'}>Back</button></div>${body}`;
  tickRest();
}
function tickRest() {
  const el = $('#rest'); if (!el) return;
  clearInterval(restT);
  const f = () => {
    const left = Math.ceil((restEnd - Date.now()) / 1000);
    if (left <= 0) { el.classList.remove('on'); el.innerHTML = ''; clearInterval(restT); if (restEnd) { beep(); restEnd = 0; } return; }
    el.classList.add('on');
    el.innerHTML = `<span>Rest</span><b>${Math.floor(left / 60)}:${pad(left % 60)}</b><button class="link" data-act="skipRest">Skip</button>`;
  };
  f(); restT = setInterval(f, 500);
}
function beep() {
  try { if (!audioCtx) return; const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; g.gain.value = .15; o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + .25); } catch (e) {}
}
function finishGym() {
  const D = S.draft, ses = C.sessions[D.session], sets = {};
  for (const ex of ses.ex) {
    const s = D.sets[ex.id]; if (!s || !s.length) continue;
    const reps = s.map(x => x.r), w = s[s.length - 1].w;
    sets[ex.id] = { w, reps, swap: !!D.swaps[ex.id] };
    if (!D.swaps[ex.id]) S.last[ex.id] = ex.unit === 'level' ? { w: 0, reps, lv: S.ladder, date: D.date } : { w, reps, date: D.date };
  }
  S.gym[D.date] = { session: D.session, sets, mins: Math.round((Date.now() - D.start) / 60000) };
  const plan = gymPlan(D.date);
  const item = plan ? plan.item : { key: 'g:' + D.date, xp: 60, cat: 'train', tag: 'gym' };
  const L = log(D.date);
  const first = !L.q[item.key];
  L.q[item.key] = { xp: plan && plan.gentle ? 60 : item.xp || 60, cat: 'train', tag: 'gym' };
  S.draft = null; save();
  if (S.settings.remind.eat) ntfyPost('eat-' + D.date, Date.now() + 30 * 60000, 'Eat something', '25–40 g protein + some carbs within the next hour or two. Quark, skyr, eggs or a proper meal.');
  closeGym();
  const ins = pickInsight('gym'); save();
  openSheet(`<div class="reward"><p class="xpbig">${first ? '+60 XP' : 'Session updated'}</p><h2>Workout done. Now eat.</h2>
    <p class="lead">Within the next 1–2 hours: 25–40 g protein + some carbs. ${S.settings.topic ? 'I’ll remind you in 30 minutes.' : ''}</p>
    <div class="chips">${C.protein.slice(0, 8).map(([n, g]) => `<button class="chip" data-act="protein" data-d="${D.date}" data-g="${g}">${esc(n)} <b>+${g}</b></button>`).join('')}</div>
    ${ins ? `<div class="card soft"><p class="eyebrow">${esc(catLabel(ins.c))}</p><h3>${esc(ins.t)}</h3><p>${esc(ins.b)}</p><p class="src">${esc(ins.src)}</p></div>` : ''}
    <button class="btn primary wide" data-act="closeSheet">Done</button></div>`);
}

/* --- Mind: meditation --- */
const medById = id => C.meditations.find(m => m.id === id);
function medMinutes(d) { return ((S.med && S.med.sessions) || []).filter(s => s.d === d).reduce((n, s) => n + s.mins, 0); }
function medStreak() {
  const days = new Set(S.med.sessions.map(s => s.d)); let n = 0, d = TODAY;
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
function viewMind() {
  return `<header class="head"><h1>Mind</h1></header>
  <div class="seg">${[['med', 'Meditate'], ['journal', 'Journal']].map(([k, n]) => `<button class="${MIND_TAB === k ? 'on' : ''}" data-act="mtab" data-t="${k}">${n}</button>`).join('')}</div>
  ${MIND_TAB === 'journal' ? viewJournal() : viewMeditate()}`;
}
function viewMeditate() {
  const M = S.med, n = M.course, total = C.course.length, mins = M.sessions.reduce((s, x) => s + x.mins, 0);
  const rated = M.sessions.filter(s => s.before && s.after), delta = rated.length ? rated.reduce((s, x) => s + (x.after - x.before), 0) / rated.length : null;
  const doneToday = M.last === TODAY;
  let hero;
  if (n >= total) hero = `<div class="card hero"><p class="eyebrow">Training complete</p><h2>You finished all ${total} lessons.</h2><p class="hint">Keep going with any practice below — 10 minutes a day keeps the effect.</p></div>`;
  else {
    const [id, m] = C.course[n], med = medById(id);
    hero = `<div class="card hero"><p class="eyebrow">${esc(C.courseWeeks[Math.floor(n / 7)])} · lesson ${n + 1} of ${total}</p>
      <h2>${esc(med.name)} <span class="muted">· ${m} min</span></h2><p class="hint">${esc(med.short)}</p>
      <div class="meter"><i style="width:${n / total * 100}%"></i></div>
      ${doneToday ? `<p class="hint">Today's lesson is done ✓ — the next one unlocks tomorrow.</p><button class="btn wide" data-act="medOpen" data-id="${id}" data-m="${m}">Practise it anyway</button>`
        : `<button class="btn primary wide big" data-act="medOpen" data-id="${id}" data-m="${m}" data-lesson="1">Start lesson</button>`}</div>`;
  }
  return `${hero}
  <div class="stats3 card"><div><b>${mins}</b><span>minutes total</span></div><div><b>${medStreak()}</b><span>day streak</span></div><div><b>${delta == null ? '–' : (delta > 0 ? '+' : '') + delta.toFixed(1)}</b><span>calmer after (avg)</span></div></div>
  <label class="toggle card"><input type="checkbox" data-act-change="medVoice"${M.voice ? ' checked' : ''}><span>Voice guidance (reads the steps aloud)</span></label>
  <h2 class="sec">Practices</h2>
  <div class="card list">${C.meditations.map(m => `<div class="li"><b>${esc(m.name)}</b><p class="hint">${esc(m.short)}</p>
    <div class="row gap wrap">${m.mins.map(x => `<button class="btn small" data-act="medOpen" data-id="${m.id}" data-m="${x}">${x} min</button>`).join('')}</div></div>`).join('')}</div>`;
}
let MS = null, mT = null, mWake = null;
function medOpen(id, mins, lesson) {
  const m = medById(id);
  MS = { id, mins, lesson, total: mins * 60, before: null, started: false };
  $('#md').classList.add('on');
  $('#mdBody').innerHTML = `<div class="gmtop"><button class="icon" data-act="medClose" aria-label="Close">⌄</button><span></span><span></span></div>
    <p class="eyebrow">${lesson ? 'Training lesson' : 'Practice'} · ${mins} min</p><h2>${esc(m.name)}</h2><p class="lead">${esc(m.short)}</p>
    <p class="label">How calm do you feel right now? <span class="hint">(optional)</span></p>
    <div class="seg5" id="mdBefore">${[1, 2, 3, 4, 5].map(n => `<button data-act="medBefore" data-n="${n}">${n}</button>`).join('')}</div><p class="hint">1 = wired · 5 = very calm</p>
    <button class="btn primary wide big" data-act="medBegin">Begin</button>`;
}
function say(t) {
  if (!S.med.voice || !window.speechSynthesis) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.rate = 0.88; u.lang = 'en-GB'; speechSynthesis.speak(u); } catch (e) {}
}
function bell() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    [[432, .18], [648, .08], [864, .05]].forEach(([f, v]) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 4); o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 4.1); });
  } catch (e) {}
}
function medBegin() {
  const m = medById(MS.id);
  Object.assign(MS, { started: true, start: Date.now(), pausedAt: null, pausedMs: 0, step: -1, phase: -1 });
  const circ = 2 * Math.PI * 110;
  $('#mdBody').innerHTML = `<div class="gmtop"><button class="link" data-act="medEnd">End</button><span class="hint">${esc(m.name)}</span><button class="link" data-act="medPause" id="mdPause">Pause</button></div>
    <div class="mdring"><svg viewBox="0 0 260 260" aria-hidden="true"><circle cx="130" cy="130" r="110" class="trk"/><circle id="mdArc" cx="130" cy="130" r="110" class="arc" stroke-dasharray="${circ}" stroke-dashoffset="0" transform="rotate(-90 130 130)"/></svg>
      <div class="pacer${m.kind === 'pace' ? '' : ' drift'}" id="mdPacer"></div><div class="mdtime" id="mdTime"></div></div>
    <p class="mdtext" id="mdText" aria-live="polite">${m.kind === 'pace' ? '' : esc(m.steps[0][1])}</p>`;
  bell();
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then(w => mWake = w).catch(() => {}); } catch (e) {}
  clearInterval(mT); mT = setInterval(medTick, 200); medTick();
}
const medElapsed = () => ((MS.pausedAt || Date.now()) - MS.start - MS.pausedMs) / 1000;
function medTick() {
  if (!MS || !MS.started) return;
  const m = medById(MS.id), e = medElapsed(), left = Math.max(0, MS.total - e);
  if (e >= MS.total) return medEnd(true);
  const circ = 2 * Math.PI * 110, arc = $('#mdArc'); if (!arc) return;
  arc.setAttribute('stroke-dashoffset', (circ * (e / MS.total)).toFixed(1));
  $('#mdTime').textContent = Math.floor(left / 60) + ':' + pad(Math.floor(left % 60));
  if (m.kind === 'guided') {
    let i = 0; m.steps.forEach(([at], k) => { if (e >= at * MS.total) i = k; });
    if (i !== MS.step) { MS.step = i; $('#mdText').textContent = m.steps[i][1]; say(m.steps[i][1]); }
  } else {
    const cyc = m.pattern.reduce((s, p) => s + p[1], 0); let t = e % cyc, i = 0;
    while (t >= m.pattern[i][1]) { t -= m.pattern[i][1]; i++; }
    const cycleNo = Math.floor(e / cyc);
    if (i !== MS.phase || cycleNo !== MS.cycle) {
      MS.phase = i; MS.cycle = cycleNo;
      const [label, dur] = m.pattern[i], p = $('#mdPacer');
      const scale = /in|Top/.test(label) ? (label === 'Top up' ? 1.06 : 1) : /out/.test(label) ? 0.5 : null;
      if (scale != null) { p.style.transition = `transform ${dur}s ease-in-out`; p.style.transform = `translate(-50%,-50%) scale(${scale})`; }
      $('#mdText').textContent = label + ' · ' + dur;
      if (cycleNo < 2 || i === 0) say(label.replace(' · ', ''));
    }
  }
}
function medPause() {
  if (!MS) return;
  if (MS.pausedAt) { MS.pausedMs += Date.now() - MS.pausedAt; MS.pausedAt = null; $('#mdPause').textContent = 'Pause'; }
  else { MS.pausedAt = Date.now(); $('#mdPause').textContent = 'Resume'; try { speechSynthesis.cancel(); } catch (e) {} }
}
function medEnd(complete) {
  clearInterval(mT);
  const m = medById(MS.id), e = Math.min(medElapsed(), MS.total), mins = Math.round(e / 60);
  try { speechSynthesis.cancel(); } catch (e2) {}
  try { mWake && mWake.release(); } catch (e2) {} mWake = null;
  if (!m.quietEnd) bell();
  if (mins < 1) { medClose(); toast('Too short to log — even 1 minute counts next time'); return; }
  const sess = { d: TODAY, id: MS.id, mins, full: complete };
  if (MS.before) sess.before = MS.before;
  S.med.sessions.push(sess); if (S.med.sessions.length > 1500) S.med.sessions.shift();
  let lessonDone = false;
  if (MS.lesson && e >= MS.total * 0.8 && S.med.last !== TODAY) { S.med.course++; S.med.last = TODAY; lessonDone = true; }
  const it = itemsFor(TODAY).find(i => i.tag === 'meditate'), L = log(TODAY);
  let xp = Math.min(mins, 20);
  if (it && !L.q[it.key]) { L.q[it.key] = { xp: it.xp, cat: 'mind', tag: 'meditate' }; xp += it.xp; }
  save();
  MS.sess = sess; MS.xp = xp;
  if (m.quietEnd && complete) { $('#mdText').textContent = 'Sleep well.'; setTimeout(() => { medClose(); }, 4000); return; }
  $('#mdBody').innerHTML = `<div class="gmtop"><span></span><span></span><span></span></div>
    <p class="eyebrow">${mins} min · ${esc(m.name)}${lessonDone ? ' · lesson ' + S.med.course + ' done' : ''}</p><h2>${complete ? 'Well sat.' : 'Every minute counts.'}</h2>
    <p class="label">How calm do you feel now?</p><div class="seg5">${[1, 2, 3, 4, 5].map(n => `<button data-act="medAfter" data-n="${n}">${n}</button>`).join('')}</div>
    <button class="btn wide" data-act="medAfter" data-n="0">Skip</button>`;
}
function medClose() {
  clearInterval(mT); try { speechSynthesis.cancel(); } catch (e) {} try { mWake && mWake.release(); } catch (e) {} mWake = null;
  $('#md').classList.remove('on'); MS = null; render();
}

/* --- Journal --- */
function daySummary(d) {
  const L = peek(d), items = itemsFor(d).filter(i => i.kind === 'quest'), done = items.filter(i => L.q[i.key]).length, g = S.gym[d];
  const parts = [done + '/' + items.length + ' quests', dayXP(d) + ' XP'];
  if (g) parts.push('Gym: ' + C.sessions[g.session].name);
  if (L.water) parts.push((L.water * .25).toFixed(2).replace(/\.?0+$/, '') + ' L water');
  if (L.protein) parts.push(L.protein + ' g protein');
  if (L.sleep != null) parts.push('slept ' + L.sleep + ' h');
  if (medMinutes(d)) parts.push('meditated ' + medMinutes(d) + ' min');
  for (const h of S.habits) { const x = hx(L, h.id); if (x.n || x.r) parts.push(h.name + ' ' + x.n + (x.r ? ' (resisted ' + x.r + ')' : '')); }
  return parts.join(' · ');
}
function viewJournal() {
  const d = DAY, L = peek(d), j = L.j || {}, c = cycle(d);
  const entries = Object.keys(S.logs).filter(x => S.logs[x].j && (S.logs[x].j.win || S.logs[x].j.note || S.logs[x].j.mood)).sort().reverse()
    .filter(x => !JQ || JSON.stringify(S.logs[x].j).toLowerCase().includes(JQ.toLowerCase()));
  const sym = (j.sym || []);
  return `<header class="head"><div class="daynav"><button class="icon" data-act="day" data-n="-1" aria-label="Previous day">‹</button><p class="date">${esc(fmtDay(d))}</p><button class="icon" data-act="day" data-n="1" aria-label="Next day">›</button></div></header>
  <div class="card summary"><p class="eyebrow">The day in numbers</p><p>${esc(daySummary(d))}</p>${c ? `<p class="hint">Cycle day ${c.cd} · ${esc(C.phases[c.ph].name)}</p>` : ''}</div>
  <div class="card"><p class="label">Mood</p><div class="seg5 words">${C.moods.map((m, i) => `<button class="${j.mood === i + 1 ? 'on' : ''}" data-act="jmood" data-n="${i + 1}">${m}</button>`).join('')}</div>
    <p class="label">Energy</p><div class="seg5">${[1, 2, 3, 4, 5].map(n => `<button class="${L.energy === n ? 'on' : ''}" data-act="energy" data-d="${d}" data-n="${n}">${n}</button>`).join('')}</div>
    <p class="label">Body</p><div class="chips">${C.symptoms.map(s => `<button class="chip${sym.includes(s) ? ' on' : ''}" data-act="jsym" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>
  <div class="card"><label class="label" for="jwin">One win today</label><textarea id="jwin" rows="2" data-j="win" placeholder="Small counts.">${esc(j.win)}</textarea>
    <label class="label" for="jnote">Thoughts & impressions</label><textarea id="jnote" rows="6" data-j="note" placeholder="What happened, what you noticed, what's on your mind.">${esc(j.note)}</textarea>
    <label class="label" for="jgr">Grateful for</label><textarea id="jgr" rows="2" data-j="grateful">${esc(j.grateful)}</textarea>
    <label class="label" for="jtom">Tomorrow's most important task</label><input id="jtom" data-j="tomorrow" value="${esc(j.tomorrow)}" autocomplete="off">
    <p class="hint">${j.savedAt ? 'Saved · ' + new Date(j.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Saves as you type · +20 XP'}</p></div>
  <h2 class="sec">Past entries</h2>
  <input class="search" id="jq" placeholder="Search your journal" value="${esc(JQ)}" autocomplete="off">
  <div class="card list">${entries.length ? entries.slice(0, 60).map(x => { const e = S.logs[x].j; return `<button class="li tap col" data-act="jopen" data-d="${x}"><span class="row between"><b>${esc(fmtDay(x, { weekday: 'short', day: 'numeric', month: 'short' }))}</b><span class="hint">${e.mood ? esc(C.moods[e.mood - 1]) : ''}</span></span><span class="hint clamp">${esc(e.win || e.note || '')}</span></button>`; }).join('') : '<p class="empty">Your entries will collect here.</p>'}</div>`;
}

/* --- Garden --- */
function habitGarden() {
  const hs = S.habits.filter(h => h.on); if (!hs.length) return '';
  return `<h2 class="sec">Habits</h2>${hs.map(h => {
    const weeks = []; let w0 = weekStart(TODAY);
    for (let i = 0; i < 6; i++) { weeks.unshift([w0, habitWeek(w0, h.id)]); w0 = addDays(w0, -7); }
    const mx = Math.max(h.limit, 1, ...weeks.map(w => w[1]));
    const trig = {}; Object.values(S.logs).forEach(l => (hx(l, h.id).t || []).forEach(t => trig[t] = (trig[t] || 0) + 1));
    const top = Object.entries(trig).sort((p, q) => q[1] - p[1]).slice(0, 3);
    return `<div class="card"><div class="row between"><b>${esc(h.name)}</b><span class="hint">limit ${h.limit}/week</span></div>
      <p class="hint">${clearStreak(h)} clear day${clearStreak(h) === 1 ? '' : 's'} in a row${top.length ? ' · usually when: ' + top.map(t => esc(t[0].toLowerCase())).join(', ') : ''}</p>
      <div class="bars small">${weeks.map(([w, n]) => `<div><span>${esc(fmtDay(w, { day: 'numeric', month: 'short' }))}</span><i style="width:${n / mx * 100}%;background:${n > h.limit ? 'var(--danger)' : 'var(--acc)'}"></i><b>${n}</b></div>`).join('')}</div></div>`;
  }).join('')}`;
}
function viewGarden() {
  const xp = totalXP(), L = levelOf(xp), a = need(L), b = need(L + 1), c = cycle(TODAY);
  const ws = weekStart(TODAY); let wk = 0; for (let i = 0; i < 7; i++) wk += dayXP(addDays(ws, i));
  const weeks = []; let w0 = ws; for (let i = 0; i < 8; i++) { let x = 0; for (let k = 0; k < 7; k++) x += dayXP(addDays(w0, k)); weeks.unshift([w0, x]); w0 = addDays(w0, -7); }
  const mx = Math.max(100, ...weeks.map(w => w[1]));
  const seen = Object.entries(S.seen).sort((x, y) => y[1].localeCompare(x[1])).map(([id]) => C.insights.find(i => i.id === id)).filter(Boolean);
  const energyBy = {};
  Object.entries(S.logs).forEach(([d, l]) => { const cc = cycle(d); if (cc && l.energy) { (energyBy[cc.ph] = energyBy[cc.ph] || []).push(l.energy); } });
  return `<header class="head row between"><h1>Garden</h1><button class="icon" data-act="settings" aria-label="Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button></header>
  <div class="garden"><div class="plant">${plant(L)}</div>
    <div><p class="eyebrow">Level ${L}</p><h2>${esc(['Seedling', 'Sprout', 'Sprout', 'Young plant', 'Young plant', 'Budding', 'First bloom', 'Blooming', 'Blooming', 'Flourishing'][Math.min(L - 1, 9)] || 'Flourishing')}</h2>
      <div class="meter big"><i style="width:${Math.round((xp - a) / (b - a) * 100)}%"></i></div><p class="hint">${xp} XP · ${b - xp} to level ${L + 1}</p>
      <div class="stats3"><div><b>${streak()}</b><span>day Daily 10 streak</span></div><div><b>${wk}</b><span>XP this week</span></div><div><b>${countTag('job')}</b><span>job quests</span></div></div></div></div>
  <h2 class="sec">Attributes</h2>
  <div class="card attrs">${[['Strength', ['train']], ['Vitality', ['body']], ['Mind', ['mind']], ['Career', ['career']], ['Home', ['home']], ['Charisma', ['social']]].map(([n, cs]) => {
    const v = Object.values(S.logs).reduce((s, l) => s + Object.values(l.q).filter(q => cs.includes(q.cat)).length, 0), lv = Math.floor(Math.sqrt(v / 2)) + 1, lo = 2 * (lv - 1) ** 2, hi = 2 * lv ** 2;
    return `<div><span>${n}</span><b>Lv ${lv}</b><div class="meter"><i style="width:${(v - lo) / (hi - lo) * 100}%;background:${C.cats[cs[0]].color}"></i></div></div>`; }).join('')}</div>
  <p class="hint pad">Bosses defeated: ${Object.keys(S.bossDone).length} · streak freezes: ${S.freezes}/3 (earn one every 7-day Daily 10 streak)</p>
  <h2 class="sec">Last 8 weeks</h2>
  <div class="card bars">${weeks.map(([w, x]) => `<div><span>${esc(fmtDay(w, { day: 'numeric', month: 'short' }))}</span><i style="width:${x / mx * 100}%"></i><b>${x}</b></div>`).join('')}</div>
  <h2 class="sec">Cycle</h2>
  <div class="card">${c ? `<p><b>Day ${c.cd}</b> · ${esc(C.phases[c.ph].name)} · next period around <b>${esc(fmtDay(c.next, { day: 'numeric', month: 'short' }))}</b></p><p class="hint">Average cycle ${c.len} days${S.periods.length < 3 ? ' (log 3+ periods to personalise)' : ''}</p>`
    : '<p>Log the first day of your last period and the plan adapts: rest days, training mode and mottos follow your cycle.</p>'}
    <div class="cyc">${Array.from({ length: 35 }, (_, i) => { const d = addDays(TODAY, i - 7), cc = cycle(d); return `<i title="${d}" class="${d === TODAY ? 'now' : ''}" style="background:${cc ? C.phases[cc.ph].color : 'var(--line)'}"></i>`; }).join('')}</div>
    <div class="row gap wrap"><button class="btn primary" data-act="periodToday">Period started today</button><label class="btn">Other date<input type="date" class="hide" data-act-change="periodDate" max="${TODAY}"></label></div>
    ${S.periods.length ? `<p class="hint">Logged: ${[...S.periods].sort().reverse().slice(0, 6).map(p => `<button class="link" data-act="periodDel" data-d="${p}">${esc(fmtDay(p, { day: 'numeric', month: 'short' }))} ×</button>`).join(' ')}</p>` : ''}
    ${Object.keys(energyBy).length ? `<p class="label">Your energy by phase</p><div class="bars small">${Object.keys(C.phases).filter(k => energyBy[k]).map(k => { const v = energyBy[k].reduce((s, x) => s + x, 0) / energyBy[k].length; return `<div><span>${esc(C.phases[k].name)}</span><i style="width:${v / 5 * 100}%;background:${C.phases[k].color}"></i><b>${v.toFixed(1)}</b></div>`; }).join('')}</div>` : ''}
    <p class="hint">Private: cycle data stays on this phone and is never put in notifications.</p></div>
  ${habitGarden()}
  <h2 class="sec">Trophies · ${Object.keys(S.ach).length}/${C.achievements.length}</h2>
  <div class="trophies">${C.achievements.map(([id, n, dsc]) => `<div class="tro${S.ach[id] ? ' got' : ''}"><b>${esc(n)}</b><span>${esc(dsc)}</span></div>`).join('')}</div>
  <h2 class="sec">Collected insights · ${seen.length}</h2>
  <div class="card list">${seen.length ? seen.slice(0, 40).map(i => `<details class="li"><summary>${esc(i.t)}</summary><p>${esc(i.b)}</p><p class="src">${esc(i.src)}</p></details>`).join('') : '<p class="empty">Finish quests to collect insights.</p>'}</div>
  ${S.apps.length ? `<h2 class="sec">Applications · ${S.apps.length}</h2><div class="card list">${S.apps.slice().reverse().slice(0, 30).map(x => `<div class="row between li"><span><b>${esc(x.co)}</b>${x.role ? ' · ' + esc(x.role) : ''}</span><span class="hint">${esc(fmtDay(x.d, { day: 'numeric', month: 'short' }))}</span></div>`).join('')}</div>` : ''}`;
}

/* --- Sheets --- */
function catChips(sel, name = 'cat') {
  return `<div class="chips">${Object.entries(C.cats).map(([k, c]) => `<label class="chip radio" style="--c:${c.color}"><input type="radio" name="${name}" value="${k}"${k === sel ? ' checked' : ''}><span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span></label>`).join('')}</div>`;
}
function dayChips(sel) { return `<div class="chips">${WD.map((w, i) => `<label class="chip radio"><input type="checkbox" name="days" value="${i}"${sel.includes(i) ? ' checked' : ''}><span>${w}</span></label>`).join('')}</div>`; }
function eventForm(o) {
  return `<form data-form="event" class="form">
    <input type="hidden" name="src" value="${o.src || ''}"><input type="hidden" name="id" value="${esc(o.id || '')}"><input type="hidden" name="act" value="${esc(o.act || '')}">
    <input name="title" placeholder="What?" value="${esc(o.title || '')}" required autocomplete="off">
    ${catChips(o.cat || 'social')}
    <div class="grid3"><label>Date<input type="date" name="date" value="${o.date}"></label><label>Start<input type="time" name="start" value="${o.start}"></label><label>End<input type="time" name="end" value="${o.end}"></label></div>
    <label class="label">Repeat</label><div class="seg mini">${['once', 'weekly'].map(r => `<label><input type="radio" name="rep" value="${r}"${(o.rep || 'once') === r ? ' checked' : ''}><span>${r === 'once' ? 'Once' : 'Every week'}</span></label>`).join('')}</div>
    ${dayChips(o.days || [wdOf(o.date)])}
    <label class="toggle"><input type="checkbox" name="quest"${o.xp !== 0 ? ' checked' : ''}><span>Counts as a quest (tick for XP)</span></label>
    ${!o.id ? `<label class="toggle"><input type="checkbox" name="room"${o.room ? ' checked' : ''}><span>Make room: push later plans back</span></label>` : ''}
    <label class="label">Travel time (each way)</label><div class="seg mini">${[0, 15, 30, 45, 60].map(m => `<label><input type="radio" name="travel" value="${m}"${(o.travel || 0) === m ? ' checked' : ''}><span>${m ? m + ' m' : 'None'}</span></label>`).join('')}</div>
    <label class="toggle"><input type="checkbox" name="remind"${o.remind != null ? ' checked' : ''}><span>Remind me before (and before leaving)</span></label>
    <textarea name="note" rows="2" placeholder="Notes">${esc(o.note || '')}</textarea>
    <button class="btn primary wide" type="submit">Save</button>
    ${o.id ? `<div class="row gap wrap">${o.src === 'routine' ? `<button class="btn" type="button" data-act="skipDay" data-id="${esc(o.id)}" data-d="${o.date}">Skip only this day</button>` : ''}<button class="btn danger" type="button" data-act="delItem" data-src="${o.src}" data-id="${esc(o.id)}">Delete${o.src === 'routine' ? ' for good' : ''}</button></div>` : ''}
  </form>`;
}
function sheetItem(d, k) {
  const i = itemByKey(d, k); if (!i) return;
  if (i.src === 'todo') return sheetTodo(i.ref.id);
  if (i.src === 'commute') return openSheet(`<p class="eyebrow">${esc(fmtDay(d))} · ${i.start}–${i.end}</p><h2>Commute</h2><p class="lead">${esc(i.note)}</p><p class="hint">Travel time comes from the plans around it. Change it by editing that plan → Travel time.</p>`);
  const r = i.ref, rt = i.src === 'routine';
  const gymLink = i.tag === 'gym' ? `<button class="btn wide" data-act="go" data-v="gym">Open gym session</button>` : '';
  const note = i.tag === 'stretch' ? C.home.join(' · ') + '. ' + C.homeMin : i.note || '';
  const hasOvr = Object.keys(S.ovr[d] || {}).length;
  openSheet(`<p class="eyebrow">${esc(fmtDay(d))} · ${i.start}–${i.end}${i.moved ? ' · moved' : ''}</p><h2>${esc(i.title)}</h2>${note ? `<p class="lead">${esc(note)}</p>` : ''}${gymLink}
    <div class="card"><p class="label">Move just this day</p><div class="row gap wrap">${[-30, -15, 15, 30].map(n => `<button class="btn small" data-act="mv" data-d="${d}" data-k="${esc(k)}" data-n="${n}">${n > 0 ? '+' : '−'}${Math.abs(n)} min</button>`).join('')}</div>
      <p class="label">Push this and everything after it</p><div class="row gap wrap">${[15, 30, 60].map(n => `<button class="btn small" data-act="pushAfter" data-d="${d}" data-k="${esc(k)}" data-n="${n}">+${n} min</button>`).join('')}</div>
      <p class="hint">Work shifts and your evening routine (from 21:30) stay where they are. Commutes move with your plans.</p>
      <div class="row gap wrap"><button class="btn small soft" data-act="addAfter" data-d="${d}" data-k="${esc(k)}">+ Insert something after this</button>${hasOvr ? `<button class="link" data-act="resetDay" data-d="${d}">Reset this day's times</button>` : ''}</div></div>
    <details class="li"><summary>Edit</summary>${eventForm({ src: i.src, id: r.id, title: r.title, cat: r.cat, date: d, start: r.start, end: r.end, rep: rt ? 'weekly' : 'once', days: rt ? r.days : [wdOf(d)], xp: r.xp || 0, remind: r.remind, note: r.note, act: r.act, travel: r.travel || 0 })}</details>`);
}
function sheetSlot(d, s, e, social) {
  const mins = toMin(e) - toMin(s), sug = suggest(d, mins, social);
  openSheet(`<p class="eyebrow">${esc(fmtDay(d))} · ${s}–${e} · ${fmtDur(mins)} free</p><h2>${social ? 'Social time — who or what?' : 'What fits here?'}</h2>
    ${isLow(d) ? '<p class="hint">Rest day — calm options first.</p>' : ''}
    <div class="list">${sug.map(x => x.type === 'todo'
      ? `<button class="li tap row between" data-act="slotTodo" data-id="${x.t.id}" data-d="${d}" data-s="${s}"><span><i class="dot" style="background:${C.cats[x.t.cat].color}"></i>${esc(x.t.title)}</span><span class="hint">${esc(x.why)} · ${fmtDur(x.t.mins)}</span></button>`
      : `<button class="li tap row between" data-act="slotAct" data-id="${x.a.id}" data-d="${d}" data-s="${s}" data-e="${e}"><span><i class="dot" style="background:${C.cats[x.a.cat].color}"></i>${esc(x.a.title)}</span><span class="hint">${x.why ? esc(x.why) + ' · ' : ''}${fmtDur(x.a.mins)}</span></button>`).join('')}</div>
    <details class="li" ${sug.length ? '' : 'open'}><summary>Something else (appointment, meet-up…)</summary>${eventForm({ date: d, start: s, end: addMin(s, Math.min(mins, 60)), cat: social ? 'social' : 'mind', xp: 15, remind: 15 })}</details>
    <details class="li"><summary>All activities</summary><div class="list">${S.activities.map(a => `<button class="li tap row between" data-act="slotAct" data-id="${a.id}" data-d="${d}" data-s="${s}" data-e="${e}"><span>${esc(a.title)}</span><span class="hint">${fmtDur(a.mins)}</span></button>`).join('')}</div></details>`);
}
function sheetTodo(id) {
  const t = S.todos.find(x => x.id === id) || { id: '', title: '', mins: 30, cat: 'mind', prio: 1 };
  openSheet(`<h2>${t.id ? 'Edit to-do' : 'New to-do'}</h2><form data-form="todoEdit" class="form"><input type="hidden" name="id" value="${t.id}">
    <input name="title" value="${esc(t.title)}" placeholder="What needs doing?" required autocomplete="off">
    <label class="label">How long?</label><div class="seg mini">${[15, 30, 45, 60, 90, 120].map(m => `<label><input type="radio" name="mins" value="${m}"${t.mins === m ? ' checked' : ''}><span>${fmtDur(m)}</span></label>`).join('')}</div>
    <label class="label">Priority</label><div class="seg mini">${[[1, 'Normal'], [2, 'Important'], [3, 'Urgent']].map(([p, n]) => `<label><input type="radio" name="prio" value="${p}"${(t.prio || 1) === p ? ' checked' : ''}><span>${n}</span></label>`).join('')}</div>
    ${catChips(t.cat)}
    <label>Due date (optional)<input type="date" name="due" value="${t.due || ''}"></label>
    <button class="btn primary wide" type="submit">Save</button>
    ${t.id ? `<div class="row gap wrap">${t.plan ? `<button class="btn" type="button" data-act="unplan" data-id="${t.id}">Remove from calendar</button>` : `<button class="btn" type="button" data-act="planTodo" data-id="${t.id}">Plan into a free slot</button>`}<button class="btn danger" type="button" data-act="delTodo" data-id="${t.id}">Delete</button></div>` : ''}</form>`);
}
function sheetPlanTodo(id) {
  const t = S.todos.find(x => x.id === id); if (!t) return;
  const opts = [];
  for (let i = 0; i < 10 && opts.length < 8; i++) {
    const d = addDays(TODAY, i);
    for (const s of freeSlots(d, itemsFor(d))) if (s.mins >= t.mins && opts.length < 8 && !(isLow(d) && t.prio < 3)) opts.push([d, s]);
  }
  openSheet(`<p class="eyebrow">${esc(t.title)} · ${fmtDur(t.mins)}</p><h2>Pick a slot</h2>
    <div class="list">${opts.map(([d, s]) => `<button class="li tap row between" data-act="slotTodo" data-id="${t.id}" data-d="${d}" data-s="${s.start}"><span>${esc(fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${s.start}</span><span class="hint">${fmtDur(s.mins)} free</span></button>`).join('') || '<p class="empty">No free slot that fits in the next 10 days.</p>'}</div>`);
}
function sheetAct(id) {
  const a = S.activities.find(x => x.id === id) || { id: '', title: '', cat: 'social', mins: 30, xp: 15, weekly: 0 };
  openSheet(`<h2>${a.id ? 'Edit activity' : 'New activity'}</h2><form data-form="act" class="form"><input type="hidden" name="id" value="${a.id}">
    <input name="title" value="${esc(a.title)}" placeholder="e.g. Call Grandma" required autocomplete="off">${catChips(a.cat)}
    <div class="grid3"><label>Minutes<input type="number" name="mins" value="${a.mins}" min="5" step="5" inputmode="numeric"></label><label>XP<input type="number" name="xp" value="${a.xp}" min="0" step="5" inputmode="numeric"></label><label>Times/week<input type="number" name="weekly" value="${a.weekly || 0}" min="0" max="7" inputmode="numeric"></label></div>
    <p class="hint">Times/week above 0 makes it a weekly quest — it shows under “This week” and gets suggested first.</p>
    <button class="btn primary wide" type="submit">Save</button>${a.id ? `<button class="btn danger wide" type="button" data-act="delAct" data-id="${a.id}">Delete</button>` : ''}</form>`);
}
function sheetAdd(d) {
  openSheet(`<h2>Add</h2><div class="list">
    <button class="li tap" data-act="addEvent" data-d="${d}"><b>Event or appointment</b><span class="hint"> · once or weekly</span></button>
    <button class="li tap" data-act="editTodo" data-id=""><b>To-do</b><span class="hint"> · goes to your list</span></button>
    <button class="li tap" data-act="slotPick" data-d="${d}"><b>Activity in a free slot</b></button></div>`);
}
function sheetSettings() {
  const st = S.settings, r = st.remind, inPreview = !('serviceWorker' in navigator) || window.top !== window;
  openSheet(`<h2>Settings</h2>
  <form data-form="settings" class="form">
    <label>Your name<input name="name" value="${esc(st.name)}" autocomplete="off"></label>
    <div class="grid3"><label>Water (glasses)<input type="number" name="water" value="${st.water}" min="4" max="16" inputmode="numeric"></label><label>Protein (g)<input type="number" name="protein" value="${st.protein}" min="40" max="250" step="5" inputmode="numeric"></label><label>Cycle length<input type="number" name="cycleLen" value="${S.cycleLen}" min="21" max="40" inputmode="numeric"></label></div>
    <button class="btn primary wide" type="submit">Save</button></form>
  <h3>Look</h3>
  <p class="label">Colour theme</p><div class="chips">${C.themes.map(t => `<button class="chip${S.look.theme === t.id ? ' on' : ''}${unlocked(t) ? '' : ' locked'}" data-act="look" data-k="theme" data-id="${t.id}"><i class="dot" style="background:${t.light}"></i>${esc(t.name)}${unlocked(t) ? '' : ' · ' + (t.boss ? 'beat ' + t.boss + ' boss' : 'level ' + t.level)}</button>`).join('')}</div>
  <p class="label">Flowers</p><div class="chips">${C.flowers.map(f => `<button class="chip${S.look.flower === f.id ? ' on' : ''}${unlocked(f) ? '' : ' locked'}" data-act="look" data-k="flower" data-id="${f.id}"><i class="dot" style="background:${f.petal};box-shadow:inset 0 0 0 1px var(--line)"></i>${esc(f.name)}${unlocked(f) ? '' : ' · ' + (f.boss ? 'beat ' + f.boss + ' bosses' : 'level ' + f.level)}</button>`).join('')}</div>
  <h3>Notifications</h3>
  <div class="card soft"><p>iPhone reminders come through the free <b>ntfy</b> app. Set up once:</p>
    <ol><li>Install “ntfy” from the App Store and allow notifications.</li><li>In ntfy tap <b>+</b> and subscribe to the topic below (server: ntfy.sh).</li><li>Tap “Send test”.</li></ol>
    ${st.topic ? `<div class="row between topic"><code>${esc(st.topic)}</code><button class="btn small" data-act="copyTopic">Copy</button></div>` : `<button class="btn" data-act="makeTopic">Create my private topic</button>`}
    ${st.topic ? `<div class="row gap wrap"><button class="btn" data-act="testNtfy">Send test</button><button class="btn" data-act="resync">Re-sync reminders</button></div>` : ''}
    ${inPreview ? '<p class="hint">Reminders only work in the installed app, not in this preview.</p>' : ''}
    <p class="hint">Reminders are scheduled up to 2 days ahead each time you open the app. Texts never include health or cycle details.</p></div>
  <div class="card list">${[['routine', 'Routine (job hunt, gym, Daily 10, wind-down…)'], ['events', 'Your events (15 min before)'], ['morning', 'Morning motto at 07:00'], ['eat', 'Eat after gym'], ['mom', 'Nudge to call Mom (Thursday)']].map(([k, n]) => `<label class="toggle li"><input type="checkbox" data-act-change="remindOpt" data-k="${k}"${r[k] ? ' checked' : ''}><span>${n}</span></label>`).join('')}</div>
  <h3>Habits you're tracking</h3><p class="hint">Weekly limit 0 = aiming for none. Untick to hide a habit; its history stays.</p>
  <form data-form="habits" class="form">${S.habits.map((h, i) => `<div class="card habitrow"><div class="grid3"><label>Name<input name="name${i}" value="${esc(h.name)}" autocomplete="off"></label><label>Counted in<input name="unit${i}" value="${esc(h.unit)}" autocomplete="off"></label><label>Limit / week<input type="number" name="limit${i}" value="${h.limit}" min="0" max="200" inputmode="numeric"></label></div><label class="toggle"><input type="checkbox" name="on${i}"${h.on ? ' checked' : ''}><span>Track this</span></label></div>`).join('')}
    <div class="row gap wrap"><button class="btn primary" type="submit">Save habits</button><button class="btn" type="button" data-act="hnew">+ Add habit</button></div></form>
  <h3>Backup</h3><p class="hint">Your data lives on this phone. Export a backup once a month.</p>
  <div class="row gap wrap"><button class="btn" data-act="export">Export backup</button><label class="btn">Import backup<input type="file" accept="application/json,.json" class="hide" data-act-change="import"></label></div>
  <p class="hint">Life Quest ${esc(C.version)}</p>`);
}

/* ---------- moving things around ---------- */
function shiftItem(d, it, n) {
  const dur = toMin(it.end) - toMin(it.start), s = Math.max(0, Math.min(toMin(it.start) + n, 1439 - dur));
  const ns = fromMin(s), ne = fromMin(s + dur);
  if (it.src === 'routine') { (S.ovr[d] = S.ovr[d] || {})[it.key] = { start: ns, end: ne }; }
  else if (it.src === 'event') { it.ref.start = ns; it.ref.end = ne; }
  else if (it.src === 'todo') { it.ref.plan.start = ns; }
  return ns;
}
const movable = i => i.kind !== 'open' && i.src !== 'commute' && i.cat !== 'work' && toMin(i.start) < 21 * 60 + 30;
function makeRoom(d, newKey, start, end) {
  const s0 = toMin(start), e0 = toMin(end);
  const after = itemsFor(d).filter(i => i.key !== newKey && movable(i) && toMin(i.start) >= s0);
  if (!after.length) return;
  const first = Math.min(...after.map(i => toMin(i.start) - (i.travel || 0)));
  const delta = e0 - first; if (delta <= 0) return;
  after.forEach(i => shiftItem(d, i, delta));
  toast('Made room: later plans moved ' + delta + ' min back');
}

/* ---------- reminders via ntfy ---------- */
async function ntfyPost(seq, at, title, msg) {
  const topic = S.settings.topic; if (!topic) return;
  const u = `https://ntfy.sh/${encodeURIComponent(topic)}/${encodeURIComponent(seq)}?title=${encodeURIComponent(title)}` + (at > Date.now() + 15000 ? `&at=${Math.floor(at / 1000)}` : '') + '&tags=seedling';
  try { await fetch(u, { method: 'POST', mode: 'no-cors', body: msg }); S.sent[seq] = { h: at + '|' + title + '|' + msg, at }; } catch (e) {}
}
async function ntfyDel(seq) {
  const topic = S.settings.topic; if (!topic) return;
  try { await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}/${encodeURIComponent(seq)}`, { method: 'DELETE' }); } catch (e) {
    try { await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}/${encodeURIComponent(seq)}/delete`, { mode: 'no-cors' }); } catch (e2) {}
  }
}
let syncing = false;
async function syncReminders() {
  if (syncing || !S.settings.topic || !navigator.onLine) return;
  syncing = true;
  const now = Date.now(), horizon = now + 47 * 3600e3, want = {}, r = S.settings.remind;
  for (let k = 0; k < 3; k++) {
    const d = addDays(TODAY, k), L = peek(d);
    if (r.morning) want[d + '-motto'] = [dateTime(d, '07:00'), 'Good morning', motto(d)];
    for (const i of itemsFor(d)) {
      if (i.remind == null || L.q[i.key] || i.kind === 'open') continue;
      if (i.src === 'routine' && !r.routine) continue;
      if (i.src !== 'routine' && !r.events) continue;
      const at = dateTime(d, i.start) - ((i.travel || 0) + i.remind) * 60000;
      const msg = i.travel ? 'Leave at ' + fromMin(toMin(i.start) - i.travel) + ' · starts ' + i.start + '.' : i.remind ? 'Starts at ' + i.start + '.' : (i.note || 'Now: ' + i.title).slice(0, 180);
      want[d + '-' + i.key.replace(/[^a-z0-9]/gi, '')] = [at, i.travel ? 'Time to leave: ' + i.title : i.title, msg];
    }
    if (r.mom && wdOf(d) === 3) { const mom = S.activities.find(a => a.id === 'mom'); if (mom && weekCount(d, 'w:mom') < mom.weekly) want[d + '-mom'] = [dateTime(d, '18:30'), 'Call Mom this week', 'You haven’t called yet this week. A free slot tonight or at the weekend?']; }
  }
  for (const [seq, [at, t, m]] of Object.entries(want)) {
    if (at < now + 60000 || at > horizon) continue;
    const h = at + '|' + t + '|' + m;
    if (!S.sent[seq] || S.sent[seq].h !== h) { await ntfyPost(seq, at, t, m); await new Promise(z => setTimeout(z, 250)); }
  }
  for (const [seq, v] of Object.entries(S.sent)) {
    if (v.at < now) { delete S.sent[seq]; continue; }
    if (!want[seq] && !seq.startsWith('eat-')) { await ntfyDel(seq); delete S.sent[seq]; }
  }
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  syncing = false;
}

/* ---------- actions ---------- */
const A = {
  go: el => { location.hash = el.dataset.v; closeSheet(); },
  day: el => { DAY = addDays(DAY, +el.dataset.n); render(); },
  tick: el => { const i = itemByKey(el.dataset.d, el.dataset.k); if (!i) return; if (i.tag === 'gym' && !i.gentle && !peek(el.dataset.d).q[i.key]) { location.hash = 'gym'; return; }
    if (i.tag === 'meditate' && !peek(el.dataset.d).q[i.key] && el.dataset.d === TODAY) { MIND_TAB = 'med'; closeSheet(); if (location.hash === '#mind') render(); else location.hash = 'mind'; return; } closeSheet(); toggle(el.dataset.d, i); },
  item: el => sheetItem(el.dataset.d, el.dataset.k),
  slot: el => sheetSlot(el.dataset.d, el.dataset.s, el.dataset.e, !!el.dataset.soc),
  slotPick: el => { const d = el.dataset.d, s = freeSlots(d, itemsFor(d))[0]; if (s) sheetSlot(d, s.start, s.end, s.social); else toast('No free slot left that day'); },
  slotAct: el => {
    const a = S.activities.find(x => x.id === el.dataset.id), s = el.dataset.s, slotEnd = toMin(el.dataset.e || '23:59');
    const nid = uid(), en = fromMin(Math.min(toMin(s) + a.mins, el.dataset.room ? 1439 : slotEnd));
    S.events.push({ id: nid, date: el.dataset.d, title: a.title, cat: a.cat, start: s, end: en, xp: a.xp, act: a.id, remind: 15 });
    if (el.dataset.room) makeRoom(el.dataset.d, 'e:' + nid, s, en);
    save(); closeSheet(); render(); toast('Planned: ' + a.title);
  },
  slotTodo: el => { const t = S.todos.find(x => x.id === el.dataset.id); t.plan = { date: el.dataset.d, start: el.dataset.s }; if (el.dataset.room) makeRoom(el.dataset.d, 't:' + t.id, t.plan.start, addMin(t.plan.start, t.mins)); save(); closeSheet(); render(); toast('Planned: ' + t.title); },
  arrange: () => { S.arrange = !S.arrange; save(); render(); },
  arrMode: el => { ARR_MODE = el.dataset.m; render(); },
  ins: el => sheetInsert(el.dataset.d, el.dataset.t),
  nudge: el => {
    const d = el.dataset.d, it = itemByKey(d, el.dataset.k), n = +el.dataset.n; if (!it) return;
    const y = window.scrollY;
    if (ARR_MODE === 'rest') { const s = toMin(it.start); itemsFor(d).filter(i => i.key === it.key || (movable(i) && toMin(i.start) >= s)).forEach(i => shiftItem(d, i, n)); }
    else shiftItem(d, it, n);
    save(); render(); window.scrollTo(0, y);
  },
  weeklyDone: el => { const a = S.activities.find(x => x.id === el.dataset.id), d = el.dataset.d; const L = log(d), k = 'w:' + a.id + ':' + uid(); L.q[k] = { xp: a.xp, cat: a.cat, tag: 'w:' + a.id }; save(); render(); reward({ tag: a.id }, a.xp); },
  motto: el => { const d = el.dataset.d; openSheet(`<h2>Motto of the day</h2><form data-form="motto" class="form"><input type="hidden" name="d" value="${d}"><textarea name="m" rows="3">${esc(motto(d))}</textarea><div class="row gap"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="mottoNew" data-d="${d}">Another one</button></div></form>`); },
  mottoNew: el => { const L = log(el.dataset.d); const c = cycle(el.dataset.d); const pool = C.mottos.filter(m => !m.phase || (c && m.phase === c.ph)); L.motto = pool[Math.floor(Math.random() * pool.length)].t; save(); closeSheet(); render(); },
  lowoff: el => { const d = el.dataset.d; if (S.lowOff[d]) delete S.lowOff[d]; else S.lowOff[d] = 1; save(); render(); },
  energy: el => { log(el.dataset.d).energy = +el.dataset.n; save(); render(); },
  water: el => { const L = log(el.dataset.d), n = +el.dataset.n, was = L.water; L.water = L.water === n ? n - 1 : n; if (was < S.settings.water && L.water >= S.settings.water) toast('Water goal · +15 XP'); save(); render(); },
  protein: el => { const L = log(el.dataset.d), was = L.protein; L.protein = Math.max(0, L.protein + +el.dataset.g); if (was < S.settings.protein && L.protein >= S.settings.protein) toast('Protein goal · +15 XP'); else toast('Protein ' + L.protein + ' g'); save(); if (VIEW !== 'gym') render(); },
  sleep: el => { const L = log(el.dataset.d), was = L.sleep; L.sleep = Math.max(0, Math.min(14, (L.sleep ?? 7.5) + (L.sleep == null ? 0 : +el.dataset.n))); if (!(was >= 7.5) && L.sleep >= 7.5) toast('Well rested · +15 XP'); save(); render(); },
  vit: el => { const L = log(el.dataset.d); L.vit = L.vit ? 0 : 1; if (L.vit) toast('+5 XP · vitamins'); save(); render(); },
  hideInstall: () => { S.hideInstall = 1; save(); render(); },
  rewardDone: () => { const co = $('#appCo'), ro = $('#appRole'); if (co && co.value.trim()) { S.apps.push({ d: TODAY, co: co.value.trim(), role: ro ? ro.value.trim() : '' }); save(); toast('Application logged'); } closeSheet(); },
  closeSheet: () => closeSheet(),
  ptab: el => { PLAN_TAB = el.dataset.t; render(); },
  pday: el => { PLAN_DAY = el.dataset.d; render(); },
  pweek: el => { PLAN_DAY = addDays(PLAN_DAY, +el.dataset.n); render(); },
  add: el => sheetAdd(el.dataset.d),
  addEvent: el => { const d = el.dataset.d; openSheet('<h2>New event</h2>' + eventForm({ date: d, start: '18:00', end: '19:00', cat: 'social', xp: 0, remind: 15 })); },
  skipDay: el => { const r = S.routine.find(x => x.id === el.dataset.id); (r.skip = r.skip || []).push(el.dataset.d); save(); closeSheet(); render(); toast('Skipped for that day'); },
  delItem: el => {
    const id = el.dataset.id;
    if (el.dataset.src === 'routine') { if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = 'Tap again to delete every week'; return; } S.routine = S.routine.filter(x => x.id !== id); }
    else S.events = S.events.filter(x => x.id !== id);
    save(); closeSheet(); render();
  },
  editTodo: el => sheetTodo(el.dataset.id),
  todoDone: el => { const t = S.todos.find(x => x.id === el.dataset.id); const d = t.plan ? t.plan.date : TODAY; const item = { key: 't:' + t.id, src: 'todo', ref: t, xp: todoXP(t), cat: t.cat, tag: 'todo' }; toggle(t.done ? (t.doneAt || d) : TODAY, item); },
  planTodo: el => sheetPlanTodo(el.dataset.id),
  unplan: el => { const t = S.todos.find(x => x.id === el.dataset.id); delete t.plan; save(); closeSheet(); render(); },
  delTodo: el => { S.todos = S.todos.filter(x => x.id !== el.dataset.id); save(); closeSheet(); render(); },
  editAct: el => sheetAct(el.dataset.id),
  delAct: el => { S.activities = S.activities.filter(x => x.id !== el.dataset.id); save(); closeSheet(); render(); },
  gymPick: el => { if (S.draft && S.draft.date === TODAY && S.draft.session !== el.dataset.s && Object.keys(S.draft.sets).length) { toast('Finish the current workout first'); return; } PICK = el.dataset.s; render(); },
  gymStart: el => gymStart(el.dataset.s),
  gclose: () => closeGym(),
  gnext: () => { const n = gymSteps().length; S.draft.step = Math.min(n - 1, S.draft.step + 1); S.draft.cur = null; restEnd = 0; save(); renderGym(); },
  gprev: () => { S.draft.step = Math.max(0, S.draft.step - 1); S.draft.cur = null; restEnd = 0; save(); renderGym(); },
  warm: el => { const i = el.dataset.i; S.draft.warm[i] = !S.draft.warm[i]; save(); renderGym(); },
  swap: el => { S.draft.swaps[el.dataset.id] = !S.draft.swaps[el.dataset.id]; save(); renderGym(); },
  gw: el => { const c = S.draft.cur; c.w = Math.max(0, +(c.w + +el.dataset.n).toFixed(1)); renderGym(); },
  gr: el => { const c = S.draft.cur; c.r = Math.max(0, c.r + +el.dataset.n); renderGym(); },
  logSet: el => {
    const D = S.draft, c = D.cur; (D.sets[c.id] = D.sets[c.id] || []).push({ w: c.w, r: c.r });
    const ses = C.sessions[D.session], ex = ses.ex.find(e => e.id === c.id);
    if (D.sets[c.id].length < setsFor(ex, gymMode(D.date))) { restEnd = Date.now() + (+el.dataset.rest) * 1000; }
    try { audioCtx && audioCtx.state === 'suspended' && audioCtx.resume(); } catch (e) {}
    save(); renderGym();
  },
  undoSet: () => { const c = S.draft.cur; (S.draft.sets[c.id] || []).pop(); restEnd = 0; save(); renderGym(); },
  skipRest: () => { restEnd = 0; tickRest(); },
  gfinish: () => finishGym(),
  ladder: el => { S.ladder = Math.max(1, Math.min(7, S.ladder + +el.dataset.n)); save(); if ($('#gm').classList.contains('on')) renderGym(); else render(); },
  jmood: el => { const L = log(DAY); L.j = L.j || {}; L.j.mood = +el.dataset.n; L.j.savedAt = Date.now(); save(); render(); },
  jsym: el => { const L = log(DAY); L.j = L.j || {}; const s = L.j.sym = L.j.sym || []; const v = el.dataset.s; L.j.sym = s.includes(v) ? s.filter(x => x !== v) : [...s, v]; save(); render(); },
  jopen: el => { DAY = el.dataset.d; render(); window.scrollTo(0, 0); },
  mtab: el => { MIND_TAB = el.dataset.t; render(); },
  mv: el => { const d = el.dataset.d, it = itemByKey(d, el.dataset.k); if (!it) return; const ns = shiftItem(d, it, +el.dataset.n); save(); render(); sheetItem(d, it.key); toast('Moved to ' + ns); },
  pushAfter: el => { const d = el.dataset.d, it = itemByKey(d, el.dataset.k); if (!it) return; const s = toMin(it.start), n = +el.dataset.n;
    itemsFor(d).filter(i => movable(i) && toMin(i.start) >= s).forEach(i => shiftItem(d, i, n)); save(); render(); sheetItem(d, it.key); toast('Pushed the rest of the day by ' + n + ' min'); },
  addAfter: el => { const d = el.dataset.d, it = itemByKey(d, el.dataset.k); if (!it) return; openSheet('<h2>Insert after ' + esc(it.title) + '</h2>' + eventForm({ date: d, start: it.end, end: addMin(it.end, 60), cat: 'social', xp: 15, remind: 15, room: true })); },
  resetDay: el => { delete S.ovr[el.dataset.d]; save(); closeSheet(); render(); toast('Times reset to your normal plan'); },
  side: el => { const L = log(el.dataset.d); L.side = L.side ? 0 : 1; save(); render(); if (L.side) reward({ tag: 'side' }, 25); },
  sideSwap: el => { const L = log(el.dataset.d); L.sideIdx = (sideOf(el.dataset.d) + 7) % C.sideQuests.length; L.sideSwapped = 1; save(); render(); },
  look: el => { const o = (el.dataset.k === 'theme' ? C.themes : C.flowers).find(x => x.id === el.dataset.id); if (!o || !unlocked(o)) { toast('Still locked — keep levelling up'); return; } S.look[el.dataset.k] = o.id; applyLook(); save(); sheetSettings(); },
  medOpen: el => medOpen(el.dataset.id, +el.dataset.m, !!el.dataset.lesson),
  medBefore: el => { MS.before = +el.dataset.n; $$('#mdBefore button').forEach(b => b.classList.toggle('on', b === el)); },
  medBegin: () => medBegin(),
  medPause: () => medPause(),
  medEnd: () => { if (MS && MS.started) medEnd(false); else medClose(); },
  medClose: () => medClose(),
  medAfter: el => { const n = +el.dataset.n, s = MS && MS.sess, xp = MS ? MS.xp : 0; if (s && n) { s.after = n; save(); } medClose(); reward({ tag: 'meditate' }, xp); },
  settings: () => sheetSettings(),
  makeTopic: () => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let t = 'lq-'; const r = crypto.getRandomValues(new Uint8Array(18)); r.forEach(x => t += a[x % a.length]); S.settings.topic = t; save(); sheetSettings(); },
  copyTopic: el => { navigator.clipboard && navigator.clipboard.writeText(S.settings.topic).then(() => toast('Copied'), () => toast('Long-press the topic to copy')); },
  testNtfy: () => { ntfyPost('test-' + uid(), Date.now(), 'Life Quest', 'Reminders are working. Your plant says hi.'); toast('Test sent — check your notifications'); },
  resync: () => { S.sent = {}; syncReminders(); toast('Reminders re-scheduled'); },
  export: () => {
    const blob = new Blob([JSON.stringify(S)], { type: 'application/json' }), name = 'lifequest-backup-' + TODAY + '.json';
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'Life Quest backup' }).catch(() => {}); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  },
  periodToday: () => { if (!S.periods.includes(TODAY)) S.periods.push(TODAY); save(); render(); toast('Logged · rest mode for 2 days'); },
  periodDel: el => { S.periods = S.periods.filter(p => p !== el.dataset.d); save(); render(); },
  hadd: el => {
    const d = el.dataset.d, id = el.dataset.id, h = S.habits.find(x => x.id === id), L = log(d);
    L.h = L.h || {}; const x = L.h[id] = Object.assign({ n: 0, r: 0, t: [] }, L.h[id]); x.n++; save(); render();
    const w = habitWeek(d, id), ins = Math.random() < 0.6 ? pickInsight('habit') : null;
    openSheet(`<p class="eyebrow">${esc(h.name)} · ${w}/${h.limit} this week</p><h2>Logged. What was going on?</h2>
      <p class="hint">Knowing your triggers is how you change the cue instead of fighting it.</p>
      <div class="chips">${C.triggers.map(t => `<button class="chip" data-act="htrig" data-d="${d}" data-id="${id}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      ${ins ? `<div class="card soft"><p class="eyebrow">Worth knowing</p><h3>${esc(ins.t)}</h3><p>${esc(ins.b)}</p><p class="src">${esc(ins.src)}</p></div>` : ''}
      <button class="btn wide" data-act="closeSheet">Skip</button>`);
    if (ins) save();
  },
  htrig: el => { const x = log(el.dataset.d).h[el.dataset.id]; (x.t = x.t || []).push(el.dataset.t); save(); closeSheet(); toast('Noted · ' + el.dataset.t.toLowerCase()); },
  hsub: el => { const x = (log(el.dataset.d).h || {})[el.dataset.id]; if (x && x.n > 0) { x.n--; x.t && x.t.length > x.n && x.t.pop(); } save(); render(); },
  hres: el => {
    const L = log(el.dataset.d); L.h = L.h || {}; const x = L.h[el.dataset.id] = Object.assign({ n: 0, r: 0, t: [] }, L.h[el.dataset.id]); x.r++;
    save(); render(); toast((x.r <= 3 ? '+5 XP · ' : '') + 'Urge surfed. ' + C.cheers[Math.floor(Math.random() * C.cheers.length)]);
  },
  hnew: () => { S.habits.push({ id: uid(), name: 'New habit', unit: 'times', limit: 0, on: true, created: TODAY }); save(); sheetSettings(); setTimeout(() => { const f = $$('[data-form=habits] input[name^=name]').pop(); f && f.focus(); }, 60); }
};
const CH = {
  periodDate: el => { if (el.value && !S.periods.includes(el.value)) { S.periods.push(el.value); save(); render(); toast('Period logged'); } },
  remindOpt: el => { S.settings.remind[el.dataset.k] = el.checked; save(); },
  medVoice: el => { S.med.voice = el.checked; save(); if (el.checked) say('Voice guidance is on.'); },
  import: el => {
    const f = el.files[0]; if (!f) return;
    f.text().then(t => { const x = JSON.parse(t); if (x.v !== 2) throw 0; S = Object.assign(fresh(), x); save(); closeSheet(); render(); toast('Backup restored'); }).catch(() => toast('That file is not a Life Quest backup'));
  }
};
const FORMS = {
  todo: f => { const v = $('#todoIn').value.trim(); if (!v) return; S.todos.push({ id: uid(), title: v, mins: 30, cat: 'mind', prio: 1, created: TODAY }); save(); render(); setTimeout(() => $('#todoIn') && $('#todoIn').focus(), 50); },
  todoEdit: f => {
    const v = Object.fromEntries(new FormData(f));
    let t = S.todos.find(x => x.id === v.id);
    if (!t) { t = { id: uid(), created: TODAY }; S.todos.push(t); }
    Object.assign(t, { title: v.title.trim(), mins: +v.mins || 30, prio: +v.prio || 1, cat: v.cat || 'mind', due: v.due || '' });
    save(); closeSheet(); render();
  },
  act: f => {
    const v = Object.fromEntries(new FormData(f));
    let a = S.activities.find(x => x.id === v.id);
    if (!a) { a = { id: uid() }; S.activities.push(a); }
    Object.assign(a, { title: v.title.trim(), cat: v.cat || 'social', mins: Math.max(5, +v.mins || 30), xp: +v.xp || 0, weekly: Math.max(0, Math.min(7, +v.weekly || 0)) });
    save(); closeSheet(); render();
  },
  event: f => {
    const fd = new FormData(f), v = Object.fromEntries(fd), days = fd.getAll('days').map(Number);
    if (toMin(v.end) <= toMin(v.start)) { toast('End must be after start'); return; }
    const base = { title: v.title.trim(), cat: v.cat || 'social', start: v.start, end: v.end, xp: v.quest ? 15 : 0, remind: v.remind ? 15 : undefined, note: v.note, travel: +v.travel || 0 };
    if (v.src === 'routine' && v.id) {
      const r = S.routine.find(x => x.id === v.id);
      Object.assign(r, base, { edited: 1, xp: v.quest ? (r.xp || 15) : 0, days: v.rep === 'weekly' && days.length ? days : r.days, remind: v.remind ? (r.remind ?? 15) : undefined });
      if (!v.quest && r.kind !== 'open') r.kind = 'fixed'; else if (v.quest && r.kind === 'fixed') delete r.kind;
    } else if (v.rep === 'weekly') {
      if (v.src === 'event' && v.id) S.events = S.events.filter(x => x.id !== v.id);
      S.routine.push(Object.assign({ id: uid(), tag: v.act || 'custom', days: days.length ? days : [wdOf(v.date)], from: v.date }, base, v.quest ? {} : { kind: 'fixed' }));
    } else if (v.src === 'event' && v.id) {
      Object.assign(S.events.find(x => x.id === v.id), base, { date: v.date });
    } else { const nid = uid(); S.events.push(Object.assign({ id: nid, date: v.date, act: v.act || undefined }, base)); if (v.room) makeRoom(v.date, 'e:' + nid, v.start, v.end); }
    save(); closeSheet(); render(); toast('Saved');
  },
  motto: f => { const v = Object.fromEntries(new FormData(f)); log(v.d).motto = v.m.trim() || undefined; save(); closeSheet(); render(); },
  habits: f => {
    const v = Object.fromEntries(new FormData(f));
    S.habits.forEach((h, i) => { h.name = (v['name' + i] || h.name).trim(); h.unit = (v['unit' + i] || h.unit).trim(); h.limit = Math.max(0, +v['limit' + i] || 0); h.on = !!v['on' + i]; });
    save(); closeSheet(); render(); toast('Habits saved');
  },
  settings: f => { const v = Object.fromEntries(new FormData(f)); S.settings.name = v.name.trim() || 'Anastasiia'; S.settings.water = +v.water || 8; S.settings.protein = +v.protein || 115; S.cycleLen = +v.cycleLen || 28; save(); closeSheet(); render(); toast('Saved'); }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  if (el.tagName === 'INPUT') return;
  const f = A[el.dataset.act]; if (f) { e.preventDefault(); f(el, e); }
});
document.addEventListener('change', e => { const el = e.target.closest('[data-act-change]'); if (el && CH[el.dataset.actChange]) CH[el.dataset.actChange](el); });
document.addEventListener('submit', e => { const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault(); FORMS[f.dataset.form] && FORMS[f.dataset.form](f); });
let jT = null;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.j) { const L = log(DAY); L.j = L.j || {}; L.j[el.dataset.j] = el.value; L.j.savedAt = Date.now(); clearTimeout(jT); jT = setTimeout(() => { save(); const h = $$('.card .hint').find(x => /Save/.test(x.textContent)); if (h) h.textContent = 'Saved · ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }, 600); }
  if (el.id === 'jq') { JQ = el.value; clearTimeout(jT); jT = setTimeout(() => { const pos = el.selectionStart; render(); const n = $('#jq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 300); }
});
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSheet(); } });

/* ---------- routing + lifecycle ---------- */
function route() {
  let v = location.hash.slice(1);
  if (v === 'journal') { v = 'mind'; MIND_TAB = 'journal'; }
  VIEW = ['today', 'plan', 'gym', 'mind', 'garden'].includes(v) ? v : 'today';
  if (VIEW !== 'today' && VIEW !== 'mind') DAY = TODAY;
  render(); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const t = iso(new Date());
  if (t !== TODAY) { if (DAY === TODAY) DAY = t; if (PLAN_DAY === TODAY) PLAN_DAY = t; TODAY = t; }
  render(); syncReminders(); runDaily();
  if (restEnd) tickRest();
  if (MS && MS.started) medTick();
});
if (S.draft && S.draft.date !== TODAY) S.draft = null;
applyLook();
route();
runDaily();
if (S.draft && Object.keys(S.draft.sets).length) setTimeout(() => toast('Workout in progress — open Gym to resume'), 800);
setTimeout(syncReminders, 1500);
setInterval(() => { if (!document.hidden && VIEW === 'today' && !$('#sheet').classList.contains('on')) render(); }, 60000);

/* service worker (installed app only) */
if ('serviceWorker' in navigator && location.protocol === 'https:' && window.top === window) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { $('#update').classList.add('on'); } });
    });
    setInterval(() => reg.update().catch(() => {}), 3600e3);
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  $('#update').addEventListener('click', () => navigator.serviceWorker.getRegistration().then(r => r && r.waiting && r.waiting.postMessage('skip')));
}
window.__LQ = { get S() { return S; }, itemsFor, freeSlots, cycle, suggestion, gymMode, render };
})();
