/* Today: the daily plan that ties everything together. */
(function () {
  'use strict';
  const { h } = SB;

  function greeting() {
    const hr = new Date().getHours();
    const part = hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : hr < 22 ? 'Good evening' : 'Hello, night owl';
    return part + (SB.state.name ? ', ' + SB.state.name : '') + ' 👋';
  }

  function ring(frac, label) {
    const r = 30, c = 2 * Math.PI * r;
    const svg = '<svg class="goal-ring" viewBox="0 0 74 74"><circle class="bg" cx="37" cy="37" r="' + r + '"/>' +
      '<circle class="fg" cx="37" cy="37" r="' + r + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - Math.min(1, frac))).toFixed(1) + '"/>' +
      '<text x="37" y="37">' + label + '</text></svg>';
    return h('div', { html: svg });
  }

  SB.planItems = () => {
    const day = SB.today();
    const items = [];
    const newGoal = SB.state.settings.newPerDay;
    items.push({ icon: '✨', title: 'Learn ' + newGoal + ' new words', sub: Math.min(day.newWords, newGoal) + ' / ' + newGoal, done: day.newWords >= newGoal, href: '#/words/learn' });
    const due = SB.vocab.due().length;
    const hadCards = SB.vocabCount() > 0;
    items.push({ icon: '🔁', title: 'Review your words', sub: due ? due + ' due now' : hadCards ? 'All caught up' : 'Unlocks after your first words', done: hadCards && due === 0, href: '#/words/review' });
    const lesson = SB.code.todayLesson();
    items.push({ icon: '🔧', title: lesson && !day.lessons ? 'Lesson: ' + lesson.title : 'Embedded C lesson', sub: day.lessons ? 'Done for today ✓' : lesson ? 'Day ' + (SB.code.lessons.indexOf(lesson) + 1) + ' · ' + lesson.minutes + ' min' : 'Course complete!', done: day.lessons > 0 || !lesson, href: lesson ? '#/code/lesson/' + lesson.id : '#/code' });
    const nc = SB.code.nextChallenge();
    items.push({ icon: '💻', title: 'Solve a coding challenge', sub: day.challenges ? day.challenges + ' solved today ✓' : nc ? nc.lesson.challenges[nc.n].title : 'Read a lesson to unlock one', done: day.challenges > 0, href: nc ? '#/code/challenge/' + nc.lesson.id + '/' + nc.n : '#/code' });
    const unread = (window.VERBAL.passages || []).find(p => !SB.state.verbal.passages[p.id]);
    items.push({ icon: '📖', title: 'Verbal practice', sub: day.reading ? 'Done ✓' : unread ? 'Read: ' + unread.title : 'Text completion set', done: day.reading > 0, href: unread ? '#/verbal/read/' + unread.id : '#/verbal/tc' });
    items.push({ icon: '🌿', title: 'One calm minute', sub: day.calm ? 'Done ✓' : 'Breathe, reset, then continue', done: day.calm > 0, href: '#/calm/breathe' });
    return items;
  };

  SB.route('/today', view => {
    const st = SB.state, day = SB.today();
    const goal = st.settings.goalXp;
    const lvl = SB.levelOf(st.xp);
    const lvlStart = SB.xpForLevel(lvl), lvlEnd = SB.xpForLevel(lvl + 1);
    const items = SB.planItems();
    const doneCount = items.filter(i => i.done).length;
    const streak = SB.currentStreak();

    SB.append(view, h('div', { class: 'greeting' }, greeting()),
      h('p', { class: 'muted', style: { marginBottom: '14px' } }, doneCount === items.length ? 'Everything done today. You are amazing. 🌟' : doneCount ? doneCount + ' of ' + items.length + ' done — keep the momentum!' : 'Here is your plan for today. Small steps count.'));

    SB.append(view, h('div', { class: 'card hero' },
      h('div', { class: 'row' },
        ring(day.xp / goal, Math.min(day.xp, 999) + ''),
        h('div', { class: 'grow' },
          h('div', { style: { fontWeight: 750, fontSize: '1.1rem' } }, day.goalMet ? 'Daily goal reached! 🎯' : (goal - day.xp) + ' XP to today\'s goal'),
          h('div', { class: 'small muted' }, '🔥 ' + streak + '-day streak · 🧊 ' + st.streak.freezes + ' freeze' + (st.streak.freezes === 1 ? '' : 's')),
          h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Level ' + lvl + ' · ' + SB.titleOf(lvl)),
          h('div', { style: { marginTop: '4px' } }, SB.progress((st.xp - lvlStart) / (lvlEnd - lvlStart)))))));

    if (!SB.calm.todayMood()) {
      SB.append(view, h('div', { class: 'card' }, h('div', { style: { fontWeight: 650, marginBottom: '10px' } }, 'How are you feeling right now?'),
        SB.calm.moodPicker(i => { SB.toast(window.CALM.moods[i][2]); SB.render(); })));
    }

    SB.append(view, SB.sectionTitle("Today's plan", h('span', { class: 'badge ' + (doneCount === items.length ? 'ok' : 'new') }, doneCount + '/' + items.length)),
      h('div', { class: 'card', style: { padding: '4px 14px' } }, items.map(it => h('a', { class: 'plan-item' + (it.done ? ' done' : ''), href: it.href },
        h('div', { class: 'plan-check' }, it.done ? '✓' : it.icon),
        h('div', { class: 'grow' }, h('div', { class: 'li-title' }, it.title), h('div', { class: 'small muted' }, it.sub)),
        h('span', { class: 'faint' }, '›')))));

    const w = SB.vocab.wordOfDay();
    SB.append(view, SB.sectionTitle('Word of the day'),
      h('div', { class: 'card', onclick: () => SB.vocab.showWord(w.w) },
        h('div', { class: 'row between' }, h('div', null, h('b', { style: { fontSize: '1.4rem' } }, w.w), ' ', h('span', { class: 'pos' }, SB.vocab.POS[w.pos])),
          h('button', { class: 'speak', onclick: ev => { ev.stopPropagation(); SB.speak(w.w); } }, '🔊')),
        h('p', { style: { margin: '6px 0 0' } }, w.def)));

    // this week
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    const monday = SB.addDays(SB.dayKey(), -dow);
    const week = h('div', { class: 'week' });
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((label, i) => {
      const k = SB.addDays(monday, i);
      const d = st.days[k];
      const cls = 'dot' + (d && d.goalMet ? ' hit' : d && (d.xp > 0 || d.frozen) ? ' part' : '') + (k === SB.dayKey() ? ' today' : '');
      SB.append(week, h('div', { class: 'd' }, label, h('div', { class: cls }, d && d.goalMet ? '🔥' : d && d.frozen ? '🧊' : '')));
    });
    SB.append(view, SB.sectionTitle('This week'), h('div', { class: 'card' }, week));

    const q = window.CALM.quotes[SB.dayOfYear() % window.CALM.quotes.length];
    SB.append(view, h('div', { class: 'card flat quote' }, '“' + q[0] + '”', h('footer', null, '— ' + q[1])));
  }, { tab: 'today', top: true, title: 'Today' });
})();
