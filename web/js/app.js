/* App bootstrap: theme, top bar, onboarding, routing. */
(function () {
  'use strict';
  const { h } = SB;
  SB.version = '1.0.0';

  SB.applyTheme();
  SB.updateTopbar();
  SB.$('#back-btn').addEventListener('click', () => SB.back());
  SB.$('#level-chip').addEventListener('click', () => SB.go('/profile'));
  SB.$('#streak-chip').addEventListener('click', () => {
    const s = SB.state.streak;
    SB.modal(close => [
      h('div', { class: 'center' }, h('div', { style: { fontSize: '3rem' } }, '🔥'), h('h2', null, SB.currentStreak() + '-day streak'),
        h('p', { class: 'muted' }, 'Reach your daily XP goal (' + SB.state.settings.goalXp + ' XP) to keep the streak going. Best: ' + s.best + ' days.'),
        h('p', { class: 'small' }, '🧊 Streak freezes: ' + s.freezes + ' — they automatically protect your streak if you miss a day. You earn one every 7 days (max 2). Missing a day is okay; coming back is what counts.'),
        h('button', { class: 'btn block', onclick: close }, 'Got it')),
    ]);
  });
  if (window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: light)');
    if (mq.addEventListener) mq.addEventListener('change', () => SB.state.settings.theme === 'auto' && SB.applyTheme());
  }

  SB.onPause = () => { SB.save(); SB.flush(); };
  window.addEventListener('hashchange', SB.render);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { SB.updateTopbar(); if (SB.current && SB.current.opts.top) SB.render(); }
  });

  function onboarding() {
    const name = h('input', { type: 'text', placeholder: 'What should I call you?', maxlength: '30' });
    let goal = 40;
    const goals = h('div', { class: 'seg' }, [[20, 'Light'], [40, 'Steady'], [60, 'Serious'], [100, 'Intense']].map(([v, l]) =>
      h('button', { class: v === goal ? 'on' : '', onclick: ev => { goal = v; goals.querySelectorAll('button').forEach(b => b.classList.remove('on')); ev.target.classList.add('on'); } }, l)));
    SB.modal(close => [
      h('div', { class: 'center' }, h('div', { style: { fontSize: '3rem' } }, '⚡'), h('h1', null, 'Welcome to SkillBoost')),
      h('p', { class: 'muted' }, 'A little every day: GRE & IELTS vocabulary, verbal practice, and embedded C lessons with real coding challenges — plus a calm corner for when you need a breather. Everything works offline.'),
      h('label', { class: 'field' }, h('span', null, 'Your name'), name),
      h('label', { class: 'field' }, h('span', null, 'Daily goal'), goals),
      h('p', { class: 'tiny faint' }, 'Light ≈ 5 min · Steady ≈ 10–15 min · Serious ≈ 20–30 min · Intense ≈ 45 min a day'),
      h('button', { class: 'btn block mt', onclick: () => {
        SB.state.name = name.value.trim().slice(0, 30);
        SB.state.settings.goalXp = goal;
        SB.state.onboarded = true;
        SB.save();
        close();
        SB.render();
        SB.confetti();
      } }, "Let's start"),
    ], { sticky: true });
  }

  if (!location.hash) history.replaceState(null, '', '#/today');
  SB.render();
  if (!SB.state.onboarded) onboarding();
  SB.checkBadges();
})();
