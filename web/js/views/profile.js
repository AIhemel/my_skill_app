/* Profile: stats, badges, activity and settings. */
(function () {
  'use strict';
  const { h } = SB;

  SB.route('/profile', view => {
    const st = SB.state;
    const lvl = SB.levelOf(st.xp);
    const lvlStart = SB.xpForLevel(lvl), lvlEnd = SB.xpForLevel(lvl + 1);
    const vs = SB.vocab.stats();
    const allWords = Object.keys(st.vocab.cards).length;

    SB.append(view, h('div', { class: 'card hero center' },
      h('div', { style: { fontSize: '2.6rem' } }, '⚡'),
      h('h1', { style: { margin: 0 } }, (st.name || 'Learner')),
      h('div', { class: 'muted' }, 'Level ' + lvl + ' · ' + SB.titleOf(lvl)),
      h('div', { class: 'mt' }, SB.progress((st.xp - lvlStart) / (lvlEnd - lvlStart))),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, st.xp + ' XP · ' + (lvlEnd - st.xp) + ' XP to level ' + (lvl + 1))));

    const sum = f => Object.values(st.days).reduce((a, d) => a + (d[f] || 0), 0);
    SB.append(view, h('div', { class: 'stat-row mb' },
      h('div', { class: 'stat' }, h('b', null, SB.currentStreak()), h('span', null, 'day streak')),
      h('div', { class: 'stat' }, h('b', null, st.streak.best), h('span', null, 'best streak')),
      h('div', { class: 'stat' }, h('b', null, allWords), h('span', null, 'words learned'))),
    h('div', { class: 'stat-row mb' },
      h('div', { class: 'stat' }, h('b', null, vs.mastered), h('span', null, 'mastered')),
      h('div', { class: 'stat' }, h('b', null, SB.code.doneCount()), h('span', null, 'lessons')),
      h('div', { class: 'stat' }, h('b', null, SB.code.solvedCount()), h('span', null, 'challenges'))),
    h('div', { class: 'stat-row mb' },
      h('div', { class: 'stat' }, h('b', null, sum('reviews')), h('span', null, 'reviews')),
      h('div', { class: 'stat' }, h('b', null, Object.keys(st.verbal.passages).length), h('span', null, 'passages')),
      h('div', { class: 'stat' }, h('b', null, st.calm.minutes), h('span', null, 'calm minutes'))));

    // activity heatmap: last 15 weeks
    const heat = h('div', { class: 'heat' });
    for (let i = 104; i >= 0; i--) {
      const d = st.days[SB.addDays(SB.dayKey(), -i)];
      const xp = d ? d.xp : 0;
      SB.append(heat, h('i', { title: SB.addDays(SB.dayKey(), -i) + ': ' + xp + ' XP', class: xp >= st.settings.goalXp * 2 ? 'l3' : xp >= st.settings.goalXp ? 'l2' : xp > 0 ? 'l1' : '' }));
    }
    SB.append(view, SB.sectionTitle('Activity', h('span', { class: 'small muted' }, 'last 15 weeks')), h('div', { class: 'card' }, heat));

    SB.append(view, SB.sectionTitle('Badges', h('span', { class: 'small muted' }, Object.keys(st.badges).length + '/' + SB.BADGES.length)),
      h('div', { class: 'badges mb' }, SB.BADGES.map(b => h('div', { class: 'badge-tile' + (st.badges[b.id] ? ' got' : '') }, h('span', { class: 'e' }, b.e), b.name))));

    // settings
    const s = st.settings;
    const seg = (values, current, labelFn, onPick) => {
      const el = h('div', { class: 'seg' }, values.map(v => h('button', { class: v === current ? 'on' : '', onclick: ev => {
        el.querySelectorAll('button').forEach(b => b.classList.remove('on'));
        ev.target.classList.add('on');
        onPick(v);
        SB.save();
      } }, labelFn(v))));
      return el;
    };
    const switchRow = (label, key) => h('div', { class: 'row between', style: { padding: '8px 0' } }, h('span', null, label),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s[key] ? true : null, onchange: ev => { s[key] = ev.target.checked; SB.save(); } }), h('span')));
    const nameInput = h('input', { type: 'text', value: st.name, placeholder: 'Your name', onchange: ev => { st.name = ev.target.value.trim().slice(0, 30); SB.save(); } });

    const reminderBox = h('div');
    if (SB.native) {
      let rem = s.reminder;
      try { rem = JSON.parse(SB.native.getReminder()); } catch (e) { /* use saved */ }
      const time = h('input', { type: 'time', value: String(rem.hour).padStart(2, '0') + ':' + String(rem.minute).padStart(2, '0'), style: { width: '130px' } });
      const toggle = h('input', { type: 'checkbox', checked: rem.on ? true : null });
      const apply = () => {
        const [hh, mm] = time.value.split(':').map(Number);
        s.reminder = { on: toggle.checked, hour: hh || 0, minute: mm || 0 };
        SB.save();
        SB.native.setReminder(toggle.checked, s.reminder.hour, s.reminder.minute);
        SB.toast(toggle.checked ? '⏰ Daily reminder set for ' + time.value : 'Reminder off');
      };
      time.addEventListener('change', apply);
      toggle.addEventListener('change', apply);
      SB.append(reminderBox, h('div', { class: 'row between', style: { padding: '8px 0' } }, h('span', null, 'Daily reminder'), h('div', { class: 'row' }, time, h('label', { class: 'switch' }, toggle, h('span')))),
        h('button', { class: 'btn small ghost', onclick: () => SB.native.testReminder() }, 'Send a test notification'));
    } else {
      SB.append(reminderBox, h('p', { class: 'small muted' }, 'Daily reminders are available in the Android app.'));
    }

    SB.append(view, SB.sectionTitle('Settings'), h('div', { class: 'card' },
      h('label', { class: 'field' }, h('span', null, 'Name'), nameInput),
      h('label', { class: 'field' }, h('span', null, 'Theme'), seg(['dark', 'light', 'auto'], s.theme, v => v[0].toUpperCase() + v.slice(1), v => { s.theme = v; SB.applyTheme(); })),
      h('label', { class: 'field' }, h('span', null, 'Daily XP goal'), seg([20, 40, 60, 100], s.goalXp, v => v + ' XP', v => { s.goalXp = v; })),
      h('label', { class: 'field' }, h('span', null, 'New words per day'), seg([5, 10, 15, 20], s.newPerDay, v => String(v), v => { s.newPerDay = v; })),
      switchRow('Sound effects', 'sound'),
      switchRow('Vibration', 'haptics'),
      reminderBox));

    // backup
    const backupText = () => JSON.stringify(SB.state);
    SB.append(view, SB.sectionTitle('Backup'), h('div', { class: 'card' },
      h('p', { class: 'small muted' }, 'Your progress is stored only on this phone. Export a backup now and then (e.g. send it to yourself), so you can restore it after reinstalling.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn secondary', onclick: () => {
          if (!SB.share('SkillBoost backup ' + SB.dayKey(), backupText())) {
            const ta = h('textarea', { rows: '6', readonly: true, value: backupText() });
            SB.modal(close => [h('h3', null, 'Copy this backup'), ta, h('button', { class: 'btn block mt', onclick: () => { ta.select(); try { document.execCommand('copy'); SB.toast('Copied'); } catch (e) { /* ignore */ } close(); } }, 'Copy & close')]);
          }
        } }, '📤 Export'),
        h('button', { class: 'btn secondary', onclick: () => {
          const ta = h('textarea', { rows: '6', placeholder: 'Paste your backup text here' });
          SB.modal(close => [h('h3', null, 'Restore a backup'), h('p', { class: 'small muted' }, 'This replaces your current progress.'), ta,
            h('button', { class: 'btn block mt', onclick: () => {
              try { SB.importState(ta.value.trim()); close(); SB.applyTheme(); SB.updateTopbar(); SB.toast('✅ Progress restored'); SB.go('/today'); }
              catch (e) { SB.toast('That does not look like a valid backup'); }
            } }, 'Restore')]);
        } }, '📥 Import')),
      h('button', { class: 'btn ghost small mt', onclick: async () => {
        if (await SB.confirm('Reset everything?', 'All XP, streaks, words and progress will be deleted. This cannot be undone.', 'Delete everything', true)) {
          SB.resetAll(); SB.applyTheme(); SB.updateTopbar(); SB.go('/today'); location.reload();
        }
      } }, '🗑️ Reset all progress')));

    SB.append(view, h('p', { class: 'tiny faint center mt' }, 'SkillBoost ' + (SB.version || '') + ' · works fully offline · your data never leaves your phone'));
  }, { tab: null, title: 'Profile', parent: '/today' });
})();
