/* Calm corner: mood check-in, breathing, grounding, wins jar, focus sounds. */
(function () {
  'use strict';
  const { h } = SB;
  const CALM = window.CALM;

  SB.calm = {
    todayMood() {
      const t = SB.dayKey();
      return SB.state.calm.moods.find(m => m.d === t) || null;
    },
    logMood(i, note) {
      const t = SB.dayKey();
      const moods = SB.state.calm.moods.filter(m => m.d !== t);
      const first = moods.length === SB.state.calm.moods.length;
      moods.push({ d: t, m: i, note: note || '' });
      SB.state.calm.moods = moods.slice(-120);
      SB.save();
      if (first) SB.addXP(5, 'check-in');
    },
    moodPicker(onPick) {
      const cur = SB.calm.todayMood();
      return h('div', { class: 'mood-row' }, CALM.moods.map(([e, label], i) => h('button', {
        class: cur && cur.m === i ? 'on' : '', 'aria-label': label, title: label,
        onclick: () => { SB.calm.logMood(i); SB.buzz(15); if (onPick) onPick(i); },
      }, e)));
    },
  };

  SB.route('/calm', view => {
    const mood = SB.calm.todayMood();
    const resp = h('p', { class: 'small muted', style: { marginTop: '10px', marginBottom: 0 } }, mood ? CALM.moods[mood.m][2] : 'Tap how you feel. There are no wrong answers.');
    const kind = h('p', { class: 'quote', style: { fontSize: '1.1rem', margin: 0 } }, SB.pick(CALM.kind));
    SB.append(view, 
      h('div', { class: 'card' },
        h('h2', null, 'How are you feeling today?'),
        SB.calm.moodPicker(i => { resp.textContent = CALM.moods[i][2]; SB.render(); }),
        resp,
        moodChart()),
      h('div', { class: 'card', onclick: () => { kind.textContent = SB.pick(CALM.kind); } },
        h('div', { class: 'small muted', style: { marginBottom: '6px' } }, '💜 A kind thought (tap for another)'), kind),
      h('div', { class: 'tile-grid' },
        h('a', { class: 'tile accent', href: '#/calm/breathe' }, h('span', { class: 'emoji' }, '🫁'), h('b', null, 'Breathe'), h('span', { class: 'sub' }, '1–5 minutes, guided')),
        h('a', { class: 'tile', href: '#/calm/ground' }, h('span', { class: 'emoji' }, '🌍'), h('b', null, '5-4-3-2-1'), h('span', { class: 'sub' }, 'Grounding for anxious moments')),
        h('a', { class: 'tile', href: '#/calm/focus' }, h('span', { class: 'emoji' }, '🎧'), h('b', null, 'Focus sounds'), h('span', { class: 'sub' }, 'Rain & noise + Pomodoro')),
        h('a', { class: 'tile', href: '#/calm/wins' }, h('span', { class: 'emoji' }, '🫙'), h('b', null, 'Wins jar'), h('span', { class: 'sub' }, SB.state.calm.wins.length + ' small wins saved'))),
      h('div', { class: 'card flat' },
        h('h3', null, '🤝 If things feel heavy'),
        h('p', { class: 'small' }, 'You do not have to carry it alone. Talking to someone you trust — a friend, family member, teacher or counselor — really helps, and it is a sign of strength.'),
        h('p', { class: 'small' }, 'If you are in crisis or thinking about hurting yourself, please contact your local emergency number or a crisis line right now. You can find free, confidential helplines for your country at findahelpline.com.'),
        h('a', { class: 'btn secondary small', href: 'https://findahelpline.com', target: '_blank', rel: 'noopener' }, 'Find a helpline')));
  }, { tab: 'calm', top: true, title: 'Calm' });

  function moodChart() {
    const days = [];
    const map = {};
    SB.state.calm.moods.forEach(m => { map[m.d] = m.m; });
    for (let i = 13; i >= 0; i--) days.push(SB.addDays(SB.dayKey(), -i));
    const any = days.some(d => map[d] !== undefined);
    if (!any) return null;
    const colors = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#22d3ee'];
    return h('div', { class: 'mt' }, h('div', { class: 'tiny muted', style: { marginBottom: '6px' } }, 'Last 14 days'),
      h('div', { class: 'mood-chart' }, days.map(d => {
        const m = map[d];
        return h('i', { title: d, style: m === undefined ? {} : { height: (20 + m * 20) + '%', background: colors[m] } });
      })));
  }

  // ------------------------------------------------------------ breathing
  SB.route('/calm/breathe', view => {
    let pattern = CALM.patterns[0], minutes = 1, timer = null, running = false;
    SB.onLeave(() => clearTimeout(timer));
    const circle = h('div', { class: 'breath-circle' });
    const label = h('div', { class: 'breath-label' }, 'Ready');
    const stage = h('div', { class: 'breath-stage' }, circle, label);
    const remain = h('div', { class: 'center muted' }, '');
    const desc = h('p', { class: 'small muted center' }, pattern.desc);
    const patSeg = h('div', { class: 'seg mb' }, CALM.patterns.map(p => h('button', { class: p === pattern ? 'on' : '', onclick: ev => {
      if (running) return;
      pattern = p;
      patSeg.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      ev.target.classList.add('on');
      desc.textContent = p.desc;
    } }, p.name)));
    const minSeg = h('div', { class: 'seg mb' }, [1, 3, 5].map(m => h('button', { class: m === minutes ? 'on' : '', onclick: ev => {
      if (running) return;
      minutes = m;
      minSeg.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      ev.target.classList.add('on');
    } }, m + ' min')));
    const startBtn = h('button', { class: 'btn block', onclick: () => (running ? finish(false) : start()) }, 'Begin');
    SB.append(view, patSeg, minSeg, desc, stage, remain, startBtn,
      h('p', { class: 'tiny faint center mt' }, 'Breathe through your nose if you can. If you feel dizzy, return to normal breathing.'));

    function start() {
      running = true;
      startBtn.textContent = 'Stop';
      const end = Date.now() + minutes * 60000;
      let i = 0;
      const step = () => {
        if (Date.now() >= end) { finish(true); return; }
        const [text, secs, scale] = pattern.steps[i % pattern.steps.length];
        label.textContent = text;
        circle.style.transitionDuration = secs + 's';
        circle.style.transform = 'scale(' + scale + ')';
        SB.buzz(text === 'Hold' ? 8 : 25);
        const left = Math.ceil((end - Date.now()) / 1000);
        remain.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + ' left';
        i++;
        timer = setTimeout(step, secs * 1000);
      };
      step();
    }
    function finish(complete) {
      clearTimeout(timer);
      running = false;
      circle.style.transform = 'scale(1)';
      label.textContent = complete ? 'Well done' : 'Ready';
      startBtn.textContent = 'Begin again';
      remain.textContent = '';
      if (complete) {
        SB.state.calm.breaths++;
        SB.state.calm.minutes += minutes;
        SB.bump('calm');
        SB.save();
        SB.addXP(10, 'calm');
        SB.toast('🌿 ' + minutes + ' calm minute' + (minutes > 1 ? 's' : '') + '. Notice how you feel now.');
      }
    }
  }, { tab: 'calm', title: 'Breathe', parent: '/calm' });

  // ------------------------------------------------------------ grounding
  SB.route('/calm/ground', view => {
    let i = 0;
    const show = () => {
      view.innerHTML = '';
      if (i >= CALM.grounding.length) {
        SB.bump('calm');
        SB.addXP(10, 'grounding');
        SB.append(view, h('div', { class: 'card center' }, h('div', { style: { fontSize: '3rem' } }, '🌿'), h('h2', null, 'You are here'),
          h('p', { class: 'muted' }, 'You just brought your attention back to the present moment. Anxiety often lives in the future; you are safe right now.'),
          h('div', { class: 'btn-row mt' }, h('a', { class: 'btn secondary', href: '#/calm' }, 'Done'), h('a', { class: 'btn', href: '#/calm/breathe' }, 'Breathe for a minute'))));
        return;
      }
      const [e, title, text] = CALM.grounding[i];
      SB.append(view, 
        h('div', { class: 'quiz-top' }, h('span', { class: 'small muted' }, (i + 1) + ' / 5'), SB.progress(i / 5)),
        h('div', { class: 'card center', style: { padding: '30px 20px' } },
          h('div', { style: { fontSize: '3.4rem' } }, e), h('h2', null, title), h('p', { class: 'muted' }, text)),
        h('button', { class: 'btn block', onclick: () => { i++; show(); } }, i < 4 ? 'Next' : 'Finish'));
    };
    show();
  }, { tab: 'calm', title: 'Grounding', parent: '/calm' });

  // ------------------------------------------------------------ wins jar
  SB.route('/calm/wins', view => {
    const input = h('input', { type: 'text', placeholder: 'e.g. "I finished the pointers lesson" or "I went for a walk"' });
    const list = h('div', { class: 'list' });
    const draw = () => {
      list.innerHTML = '';
      const wins = SB.state.calm.wins.slice().reverse();
      if (!wins.length) SB.append(list, SB.empty('🫙', 'Your jar is empty. Add one small thing you did today — no win is too small.'));
      wins.forEach(w => SB.append(list, h('div', { class: 'list-item' }, h('div', { class: 'li-icon' }, '⭐'), h('div', { class: 'li-body' }, h('div', { class: 'li-title' }, w.t), h('div', { class: 'li-sub' }, w.d)))));
    };
    const add = () => {
      const t = input.value.trim();
      if (!t) return;
      const first = !SB.state.calm.wins.some(w => w.d === SB.dayKey());
      SB.state.calm.wins.push({ d: SB.dayKey(), t: t.slice(0, 200) });
      SB.save();
      input.value = '';
      if (first) SB.addXP(5, 'win');
      SB.good();
      draw();
    };
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') add(); });
    const past = SB.state.calm.wins.filter(w => w.d !== SB.dayKey());
    SB.append(view, 
      past.length ? h('div', { class: 'jar-note mb' }, '✨ Remember when: "' + SB.pick(past).t + '"') : null,
      h('div', { class: 'pill-input mb' }, input, h('button', { class: 'btn', onclick: add }, 'Add')),
      list);
    draw();
  }, { tab: 'calm', title: 'Wins jar', parent: '/calm' });

  // ------------------------------------------------------------ focus sounds
  SB.route('/calm/focus', view => {
    let src = null, gain = null, kind = null;
    let pomo = null, left = 25 * 60, phase = 'Focus';
    const timeEl = h('div', { class: 'timer' }, '25:00');
    const phaseEl = h('div', { class: 'center muted' }, 'Pomodoro: 25 min focus, 5 min break');
    const stopSound = () => {
      if (src) { try { src.stop(); } catch (e) { /* already stopped */ } src.disconnect(); }
      src = null;
      kind = null;
    };
    SB.onLeave(() => { stopSound(); clearInterval(pomo); });
    const play = type => {
      stopSound();
      const a = SB.audio();
      if (!a) { SB.toast('Audio is not available'); return; }
      const len = a.sampleRate * 4;
      const buf = a.createBuffer(2, len, a.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let last = 0, b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
          else if (type === 'rain') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11 * (Math.random() < 0.0008 ? 3 : 1); }
          else { const t = i / a.sampleRate; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 * (0.55 + 0.45 * Math.sin(2 * Math.PI * t / 4)); }
        }
      }
      src = a.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      gain = a.createGain();
      gain.gain.value = 0.35;
      src.connect(gain);
      gain.connect(a.destination);
      src.start();
      kind = type;
    };
    const soundBtns = h('div', { class: 'list' }, [['brown', '🟤', 'Brown noise', 'Deep, steady — great for concentration'], ['rain', '🌧️', 'Rain', 'Soft rainfall'], ['ocean', '🌊', 'Ocean waves', 'Slow rising and falling surf']].map(([t, e, name, sub]) =>
      SB.listItem(e, name, sub, ev => {
        const item = ev.currentTarget;
        soundBtns.querySelectorAll('.list-item').forEach(x => x.classList.remove('current'));
        if (kind === t) { stopSound(); return; }
        play(t);
        item.classList.add('current');
      })));
    const pomoBtn = h('button', { class: 'btn block', onclick: () => {
      if (pomo) { clearInterval(pomo); pomo = null; pomoBtn.textContent = '▶ Resume'; return; }
      pomoBtn.textContent = '⏸ Pause';
      pomo = setInterval(() => {
        left--;
        timeEl.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
        if (left <= 0) {
          SB.sfx('done');
          SB.buzz(300);
          if (phase === 'Focus') { phase = 'Break'; left = 5 * 60; SB.addXP(10, 'focus session'); SB.toast('☕ Break time! Stand up, stretch, drink water.'); }
          else { phase = 'Focus'; left = 25 * 60; SB.toast('🎯 Back to focus'); }
          phaseEl.textContent = phase === 'Focus' ? 'Focus time — one task only' : 'Break — look away from the screen';
        }
      }, 1000);
    } }, '▶ Start Pomodoro');
    SB.append(view, soundBtns, h('div', { class: 'card mt' }, timeEl, phaseEl, h('div', { class: 'mt' }, pomoBtn)),
      h('p', { class: 'tiny faint center' }, 'Sounds are generated on your phone — no internet needed. Use headphones for the best effect.'));
  }, { tab: 'calm', title: 'Focus sounds', parent: '/calm' });
})();
