/* SkillBoost core: state, XP/streaks, router, UI helpers. */
(function () {
  'use strict';
  const SB = (window.SB = window.SB || {});

  // ------------------------------------------------------------ DOM helpers
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'value') el.value = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(k => add(el, k)); return; }
    el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  SB.h = h;
  // Like Element.append, but flattens arrays and skips null/false (as h() does).
  SB.append = function (el) {
    for (let i = 1; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  };
  SB.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  SB.$ = sel => document.querySelector(sel);

  // ------------------------------------------------------------ random/date
  SB.shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  SB.sample = (arr, n) => SB.shuffle(arr).slice(0, n);
  SB.pick = arr => arr[Math.floor(Math.random() * arr.length)];
  SB.hash = s => {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
    return x >>> 0;
  };
  SB.dayKey = d => {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  SB.daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
  SB.addDays = (k, n) => { const d = new Date(parseKey(k) + n * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
  SB.dayOfYear = () => { const n = new Date(); return Math.floor((n - new Date(n.getFullYear(), 0, 0)) / 86400000); };

  // ------------------------------------------------------------ state
  const KEY = 'skillboost.v1';
  const defaults = () => ({
    v: 1,
    created: SB.dayKey(),
    name: '',
    onboarded: false,
    xp: 0,
    streak: { count: 0, last: null, best: 0, freezes: 1 },
    days: {},
    vocab: { cards: {}, starred: {}, deck: 'gre' },
    verbal: { passages: {}, tc: {}, se: {}, essays: [], speaking: 0 },
    code: { lessons: {}, challenges: {}, playground: null, lastLesson: null },
    calm: { moods: [], wins: [], breaths: 0, minutes: 0 },
    badges: {},
    settings: { theme: 'dark', newPerDay: 10, goalXp: 40, sound: true, haptics: true, reminder: { on: false, hour: 20, minute: 0 } },
  });
  function merge(base, saved) {
    for (const k in saved) {
      if (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], saved[k]);
      else base[k] = saved[k];
    }
    return base;
  }
  // The Android app keeps a second copy in SharedPreferences, in case WebView storage is cleared.
  const bridge = window.AndroidBridge && typeof window.AndroidBridge.saveState === 'function' ? window.AndroidBridge : null;
  function load() {
    try {
      const raw = localStorage.getItem(KEY) || (bridge && bridge.loadState()) || '';
      if (raw) return merge(defaults(), JSON.parse(raw));
    } catch (e) { /* corrupted or blocked storage: start fresh */ }
    return defaults();
  }
  SB.state = load();
  let nativeTimer = null;
  SB.save = () => {
    const json = JSON.stringify(SB.state);
    try { localStorage.setItem(KEY, json); } catch (e) { if (!bridge) SB.toast('Could not save progress'); }
    if (bridge) {
      clearTimeout(nativeTimer);
      nativeTimer = setTimeout(() => bridge.saveState(JSON.stringify(SB.state)), 800);
    }
  };
  SB.flush = () => { if (bridge) { clearTimeout(nativeTimer); bridge.saveState(JSON.stringify(SB.state)); } };
  SB.resetAll = () => { SB.state = defaults(); SB.save(); SB.flush(); };
  SB.importState = json => { SB.state = merge(defaults(), JSON.parse(json)); SB.save(); };

  SB.today = () => {
    const k = SB.dayKey();
    const d = SB.state.days;
    if (!d[k]) d[k] = { xp: 0, newWords: 0, reviews: 0, quiz: 0, lessons: 0, challenges: 0, reading: 0, calm: 0, goalMet: false };
    return d[k];
  };
  SB.bump = (field, n) => { SB.today()[field] = (SB.today()[field] || 0) + (n || 1); SB.save(); };

  // ------------------------------------------------------------ levels & XP
  SB.levelOf = xp => Math.floor(Math.sqrt(xp / 40)) + 1;
  SB.xpForLevel = l => 40 * (l - 1) * (l - 1);
  const TITLES = ['Curious Beginner', 'Word Seeker', 'Bit Flipper', 'Loop Rider', 'Pointer Tamer', 'Register Ranger',
    'Lexicon Builder', 'Interrupt Hero', 'Struct Architect', 'Verbal Virtuoso', 'Firmware Crafter', 'Silicon Sage',
    'Logophile', 'Kernel Knight', 'Grandmaster'];
  SB.titleOf = l => TITLES[Math.min(l - 1, TITLES.length - 1)];

  SB.currentStreak = () => {
    const s = SB.state.streak;
    if (!s.last) return 0;
    const gap = SB.daysBetween(s.last, SB.dayKey());
    if (gap <= 1) return s.count;
    if (gap - 1 <= s.freezes) return s.count;
    return 0;
  };

  function updateStreak() {
    const s = SB.state.streak, t = SB.dayKey();
    if (s.last === t) return;
    const gap = s.last ? SB.daysBetween(s.last, t) : null;
    if (gap === 1) s.count++;
    else if (gap !== null && gap > 1 && gap - 1 <= s.freezes) {
      s.freezes -= gap - 1;
      s.count++;
      for (let i = 1; i < gap; i++) {
        const k = SB.addDays(s.last, i);
        SB.state.days[k] = Object.assign(SB.state.days[k] || {}, { frozen: true });
      }
      setTimeout(() => SB.toast('🧊 A streak freeze protected your streak'), 1200);
    } else s.count = 1;
    s.last = t;
    s.best = Math.max(s.best, s.count);
    if (s.count % 7 === 0 && s.freezes < 2) {
      s.freezes++;
      setTimeout(() => SB.toast('You earned a streak freeze 🧊'), 2400);
    }
  }

  SB.addXP = (n, label) => {
    if (!n) return;
    const st = SB.state, day = SB.today();
    const before = SB.levelOf(st.xp);
    st.xp += n;
    day.xp += n;
    SB.toast('+' + n + ' XP' + (label ? ' · ' + label : ''), 'xp');
    if (!day.goalMet && day.xp >= st.settings.goalXp) {
      day.goalMet = true;
      updateStreak();
      setTimeout(() => {
        SB.confetti();
        SB.sfx('level');
        SB.toast('🎯 Daily goal reached! Streak: ' + SB.currentStreak() + ' 🔥');
      }, 500);
    }
    const after = SB.levelOf(st.xp);
    SB.save();
    SB.updateTopbar();
    SB.checkBadges();
    if (after > before) setTimeout(() => SB.levelUp(after), 900);
  };

  SB.levelUp = lvl => {
    SB.confetti();
    SB.sfx('level');
    SB.modal(close => [
      h('div', { class: 'levelup' },
        h('div', { class: 'big' }, '⚡'),
        h('h2', null, 'Level ' + lvl + '!'),
        h('p', { class: 'muted' }, 'You are now a ', h('b', null, SB.titleOf(lvl)), '. Every small session adds up — keep going.'),
        h('button', { class: 'btn block', onclick: close }, 'Awesome')),
    ]);
  };

  // ------------------------------------------------------------ badges
  const sumDays = f => Object.values(SB.state.days).reduce((a, d) => a + (d[f] || 0), 0);
  SB.vocabCount = () => Object.keys(SB.state.vocab.cards).length;
  SB.BADGES = [
    { id: 'first-word', e: '🌱', name: 'First word', test: () => SB.vocabCount() >= 1 },
    { id: 'words-50', e: '📗', name: '50 words', test: () => SB.vocabCount() >= 50 },
    { id: 'words-200', e: '📚', name: '200 words', test: () => SB.vocabCount() >= 200 },
    { id: 'words-500', e: '🧠', name: '500 words', test: () => SB.vocabCount() >= 500 },
    { id: 'reviews-100', e: '🔁', name: '100 reviews', test: () => sumDays('reviews') >= 100 },
    { id: 'streak-3', e: '🔥', name: '3-day streak', test: () => SB.state.streak.best >= 3 },
    { id: 'streak-7', e: '🌟', name: '7-day streak', test: () => SB.state.streak.best >= 7 },
    { id: 'streak-30', e: '🏆', name: '30-day streak', test: () => SB.state.streak.best >= 30 },
    { id: 'first-run', e: '💡', name: 'First program', test: () => !!SB.state.code.ranProgram },
    { id: 'first-solve', e: '✅', name: 'First challenge', test: () => Object.keys(SB.state.code.challenges).length >= 1 },
    { id: 'solves-10', e: '🛠️', name: '10 challenges', test: () => Object.keys(SB.state.code.challenges).length >= 10 },
    { id: 'solves-30', e: '🚀', name: '30 challenges', test: () => Object.keys(SB.state.code.challenges).length >= 30 },
    { id: 'blinky', e: '💡', name: 'Blinky', test: () => !!SB.state.code.blinked },
    { id: 'lessons-7', e: '📅', name: '7 lessons', test: () => Object.values(SB.state.code.lessons).filter(l => l.done).length >= 7 },
    { id: 'lessons-all', e: '🎓', name: 'Course done', test: () => window.LESSONS && Object.values(SB.state.code.lessons).filter(l => l.done).length >= window.LESSONS.length },
    { id: 'reader-5', e: '📖', name: '5 passages', test: () => Object.keys(SB.state.verbal.passages).length >= 5 },
    { id: 'tc-25', e: '✍️', name: '25 verbal Qs', test: () => Object.keys(SB.state.verbal.tc).length + Object.keys(SB.state.verbal.se).length >= 25 },
    { id: 'calm-5', e: '🌿', name: 'Calm x5', test: () => SB.state.calm.breaths >= 5 },
    { id: 'moods-7', e: '💜', name: '7 check-ins', test: () => SB.state.calm.moods.length >= 7 },
    { id: 'level-5', e: '⚡', name: 'Level 5', test: () => SB.levelOf(SB.state.xp) >= 5 },
    { id: 'level-10', e: '👑', name: 'Level 10', test: () => SB.levelOf(SB.state.xp) >= 10 },
  ];
  SB.checkBadges = () => {
    for (const b of SB.BADGES) {
      if (SB.state.badges[b.id]) continue;
      let ok = false;
      try { ok = b.test(); } catch (e) { ok = false; }
      if (ok) {
        SB.state.badges[b.id] = SB.dayKey();
        SB.save();
        setTimeout(() => SB.toast(b.e + ' Badge unlocked: ' + b.name), 1600);
      }
    }
  };

  // ------------------------------------------------------------ feedback
  SB.toast = (msg, kind) => {
    const host = SB.$('#toast-host');
    const t = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, msg);
    host.appendChild(t);
    while (host.children.length > 3) host.removeChild(host.firstChild);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; }, 1900);
    setTimeout(() => t.remove(), 2300);
  };

  let modalStack = [];
  SB.modal = (build, opts) => {
    const host = SB.$('#modal-host');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      modalStack = modalStack.filter(m => m !== close);
      if (opts && opts.onClose) opts.onClose();
    };
    const sheet = h('div', { class: 'sheet', role: 'dialog' });
    const backdrop = h('div', { class: 'backdrop', onclick: e => { if (e.target === backdrop && !(opts && opts.sticky)) close(); } }, sheet);
    add(sheet, build(close));
    host.appendChild(backdrop);
    modalStack.push(close);
    return close;
  };
  SB.closeTopModal = () => {
    const c = modalStack[modalStack.length - 1];
    if (c) { c(); return true; }
    return false;
  };
  SB.confirm = (title, text, okLabel, danger) => new Promise(res => {
    SB.modal(close => [
      h('h2', null, title),
      h('p', { class: 'muted' }, text),
      h('div', { class: 'btn-row mt' },
        h('button', { class: 'btn secondary', onclick: () => { close(); res(false); } }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : ''), onclick: () => { close(); res(true); } }, okLabel || 'OK')),
    ], { onClose: () => res(false) });
  });

  // confetti
  SB.confetti = () => {
    const c = SB.$('#confetti');
    const ctx = c.getContext('2d');
    const W = (c.width = window.innerWidth), H = (c.height = window.innerHeight);
    const colors = ['#7c6cff', '#22d3ee', '#f472b6', '#fbbf24', '#34d399', '#fb923c'];
    const parts = Array.from({ length: 140 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 13 - 4,
      r: Math.random() * 6 + 3, c: SB.pick(colors), a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4,
    }));
    const start = performance.now();
    const frame = t => {
      const el = t - start;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.globalAlpha = Math.max(0, 1 - el / 2200);
        ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
      }
      if (el < 2200) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    };
    requestAnimationFrame(frame);
  };

  // sounds (generated, so they work offline)
  let actx = null;
  SB.audio = () => {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  };
  SB.sfx = kind => {
    if (!SB.state.settings.sound) return;
    const a = SB.audio();
    if (!a) return;
    const notes = { ok: [660, 880], bad: [220, 180], level: [523, 659, 784, 1047], tap: [520], done: [523, 784] }[kind] || [440];
    notes.forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = kind === 'bad' ? 'triangle' : 'sine';
      o.frequency.value = f;
      const t0 = a.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + 0.25);
    });
  };

  // native bridge (present inside the Android app)
  SB.native = window.AndroidBridge && typeof window.AndroidBridge.isNative === 'function' ? window.AndroidBridge : null;
  SB.buzz = ms => {
    if (!SB.state.settings.haptics) return;
    if (SB.native) SB.native.vibrate(ms || 20);
    else if (navigator.vibrate) navigator.vibrate(ms || 20);
  };
  SB.speak = text => {
    if (SB.native) { SB.native.speak(text); return; }
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
  };
  SB.share = (title, text) => {
    if (SB.native) { SB.native.share(title, text); return true; }
    if (navigator.share) { navigator.share({ title, text }).catch(() => {}); return true; }
    return false;
  };
  SB.good = () => { SB.sfx('ok'); SB.buzz(15); };
  SB.bad = () => { SB.sfx('bad'); SB.buzz(60); };

  // theme
  SB.applyTheme = () => {
    let t = SB.state.settings.theme;
    if (t === 'auto') t = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    const bg = t === 'light' ? '#F4F5FB' : '#0F1222';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bg);
    if (SB.native) SB.native.setSystemBars(bg, t === 'light');
  };

  // ------------------------------------------------------------ router
  const routes = [];
  let leaveHooks = [];
  SB.route = (pattern, render, opts) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ re, keys, render, opts: opts || {} });
  };
  SB.onLeave = fn => leaveHooks.push(fn);
  SB.go = path => { location.hash = '#' + path; };
  SB.replace = path => { history.replaceState(null, '', '#' + path); SB.render(); };
  SB.setTitle = t => { SB.$('#page-title').textContent = t; };
  SB.current = null;

  SB.render = () => {
    leaveHooks.forEach(f => { try { f(); } catch (e) { /* ignore */ } });
    leaveHooks = [];
    while (modalStack.length) modalStack[modalStack.length - 1]();
    const full = (location.hash || '#/today').slice(1) || '/today';
    const path = full.split('?')[0];
    SB.query = full.includes('?') ? full.slice(full.indexOf('?') + 1) : '';
    let match = null, params = {};
    for (const r of routes) {
      const m = r.re.exec(path);
      if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
    }
    if (!match) { SB.replace('/today'); return; }
    SB.current = { path, params, opts: match.opts };
    const view = SB.$('#view');
    view.innerHTML = '';
    view.style.animation = 'none';
    void view.offsetWidth;
    view.style.animation = '';
    const tab = match.opts.tab;
    document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    SB.$('#back-btn').hidden = !!match.opts.top;
    SB.updateTopbar();
    document.body.classList.toggle('focus-mode', !!match.opts.focus);
    SB.setTitle(match.opts.title || 'SkillBoost');
    window.scrollTo(0, 0);
    try {
      match.render(view, params);
    } catch (e) {
      console.error(e);
      view.appendChild(h('div', { class: 'card' }, h('h3', null, 'Something went wrong'), h('pre', { class: 'code' }, String(e && e.stack || e))));
    }
  };

  // Called by the Android back button. Returns true if handled.
  SB.back = () => {
    if (SB.closeTopModal()) return true;
    const cur = SB.current;
    if (cur && cur.opts.top) {
      if (cur.path !== '/today') { SB.go('/today'); return true; }
      return false;
    }
    if (cur && cur.opts.parent) { history.length > 1 ? history.back() : SB.go(cur.opts.parent); return true; }
    history.back();
    return true;
  };

  SB.updateTopbar = () => {
    SB.$('#streak-chip b').textContent = SB.currentStreak();
    SB.$('#level-chip b').textContent = SB.levelOf(SB.state.xp);
  };

  // ------------------------------------------------------------ small widgets
  SB.progress = (frac) => h('div', { class: 'progress' }, h('i', { style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%' } }));
  SB.empty = (emoji, text) => h('div', { class: 'empty' }, h('span', { class: 'big' }, emoji), text);
  SB.sectionTitle = (title, right) => h('div', { class: 'section-title' }, h('h2', null, title), right || null);
  SB.listItem = (icon, title, sub, onclick, extraClass, right) => h('button', { class: 'list-item ' + (extraClass || ''), onclick },
    h('div', { class: 'li-icon' }, icon),
    h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, title), sub ? h('div', { class: 'li-sub' }, sub) : null),
    right || h('span', { class: 'faint' }, '›'));

  // Minimal, safe markdown-ish formatter for authored content: `code`, **bold**, *italic*.
  SB.inline = s => SB.esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');

  // C syntax highlighter (used for code blocks and the editor overlay)
  const C_KW = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'sizeof', 'typedef', 'struct', 'union', 'enum', 'static', 'extern', 'const', 'volatile', 'inline', 'register']);
  const C_TY = new Set(['void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '_Bool', 'bool', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t', 'size_t', 'uintptr_t', 'FILE']);
  SB.highlightC = src => {
    let out = '';
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(^[ \t]*#[^\n]*)|(\b0[xX][0-9a-fA-F]+[uUlL]*\b|\b0[bB][01]+[uUlL]*\b|\b\d+\.?\d*(?:[eE][+-]?\d+)?[uUlLfF]*\b)|([A-Za-z_]\w*)(\s*\()?/gm;
    let last = 0, m;
    while ((m = re.exec(src))) {
      out += SB.esc(src.slice(last, m.index));
      last = re.lastIndex;
      if (m[1]) out += '<span class="tok-com">' + SB.esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="tok-str">' + SB.esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="tok-pp">' + SB.esc(m[3]) + '</span>';
      else if (m[4]) out += '<span class="tok-num">' + SB.esc(m[4]) + '</span>';
      else if (m[5]) {
        const w = m[5];
        const cls = C_KW.has(w) ? 'tok-kw' : C_TY.has(w) || /_t$/.test(w) || /_TypeDef$/.test(w) ? 'tok-ty' : m[6] ? 'tok-fn' : '';
        out += cls ? '<span class="' + cls + '">' + w + '</span>' : w;
        if (m[6]) out += SB.esc(m[6]);
      }
      if (m[0].length === 0) re.lastIndex++;
    }
    return out + SB.esc(src.slice(last));
  };
})();
