/* Words: daily new words, spaced repetition, quizzes, games, word list. */
(function () {
  'use strict';
  const { h } = SB;

  // ------------------------------------------------------------ data
  const toEntry = deck => r => ({ w: r[0], pos: r[1], def: r[2], ex: r[3], syn: r[4].split(/,\s*/).filter(Boolean), cl: r[5] || '', deck });
  const GRE = (window.VOCAB_GRE || []).map(toEntry('gre'));
  const IELTS = (window.VOCAB_IELTS || []).map(toEntry('ielts'));
  const byWord = new Map();
  GRE.concat(IELTS).forEach(e => { if (!byWord.has(e.w)) byWord.set(e.w, e); });
  const POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', conj: 'conjunction' };

  const V = (SB.vocab = {
    GRE, IELTS, byWord, POS,
    deck() {
      const d = SB.state.vocab.deck;
      return d === 'ielts' ? IELTS : d === 'both' ? GRE.concat(IELTS) : GRE;
    },
    card: w => SB.state.vocab.cards[w],
    // A per-install shuffled order, so daily words are varied (not alphabetical).
    order() {
      const seed = SB.state.created;
      return V.deck().slice().sort((a, b) => SB.hash(seed + a.w) - SB.hash(seed + b.w));
    },
    unseen() { return V.order().filter(e => !SB.state.vocab.cards[e.w]); },
    learned() { return V.deck().filter(e => SB.state.vocab.cards[e.w]); },
    due() {
      const t = SB.dayKey();
      return V.learned().filter(e => SB.state.vocab.cards[e.w].due <= t)
        .sort((a, b) => (SB.state.vocab.cards[a.w].due < SB.state.vocab.cards[b.w].due ? -1 : 1));
    },
    newToday: () => SB.today().newWords || 0,
    stats() {
      const cards = SB.state.vocab.cards;
      const deck = V.deck();
      let learned = 0, mastered = 0;
      for (const e of deck) {
        const c = cards[e.w];
        if (c) { learned++; if (c.ivl >= 21) mastered++; }
      }
      return { total: deck.length, learned, mastered, due: V.due().length };
    },
    wordOfDay() {
      const all = GRE;
      return all[SB.hash(SB.dayKey() + 'wotd') % all.length];
    },
    // SM-2 style scheduling. q: 0 again, 1 hard, 2 good, 3 easy
    rate(w, q) {
      const t = SB.dayKey();
      const c = SB.state.vocab.cards[w] || { ease: 2.5, ivl: 0, reps: 0, lapses: 0, added: t };
      if (q === 0) { c.reps = 0; c.lapses++; c.ivl = 0; c.ease = Math.max(1.3, c.ease - 0.2); }
      else if (q === 1) { c.ivl = Math.max(1, Math.round(c.ivl * 1.2)); c.ease = Math.max(1.3, c.ease - 0.15); }
      else if (q === 2) { c.ivl = c.reps === 0 ? 1 : c.reps === 1 ? 3 : Math.round(c.ivl * c.ease); c.reps++; }
      else { c.ivl = c.reps === 0 ? 4 : Math.round(Math.max(c.ivl, 1) * c.ease * 1.3); c.ease += 0.15; c.reps++; }
      c.ivl = Math.min(c.ivl, 365);
      c.due = SB.addDays(t, c.ivl);
      c.last = t;
      SB.state.vocab.cards[w] = c;
      SB.save();
      return c;
    },
    introduce(w, knewIt) {
      const t = SB.dayKey();
      SB.state.vocab.cards[w] = knewIt
        ? { ease: 2.6, ivl: 7, reps: 2, lapses: 0, added: t, last: t, due: SB.addDays(t, 7) }
        : { ease: 2.5, ivl: 1, reps: 1, lapses: 0, added: t, last: t, due: SB.addDays(t, 1) };
      SB.bump('newWords');
      SB.save();
    },
    markWrong(w) {
      const c = SB.state.vocab.cards[w];
      if (c) { c.due = SB.dayKey(); c.ease = Math.max(1.3, c.ease - 0.1); SB.save(); }
    },
  });

  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stemRe = w => new RegExp('\\b(' + escRe(w.slice(0, Math.max(4, w.length - 3))) + '[\\w\'-]*)', 'i');
  V.highlight = e => {
    const m = stemRe(e.w).exec(e.ex);
    if (!m) return SB.esc(e.ex);
    return SB.esc(e.ex.slice(0, m.index)) + '<mark>' + SB.esc(m[1]) + '</mark>' + SB.esc(e.ex.slice(m.index + m[1].length));
  };
  V.blanked = e => {
    const m = stemRe(e.w).exec(e.ex);
    if (!m) return null;
    return SB.esc(e.ex.slice(0, m.index)) + '<span class="blank">?</span>' + SB.esc(e.ex.slice(m.index + m[1].length));
  };

  const speakBtn = w => h('button', { class: 'speak', 'aria-label': 'Pronounce ' + w, onclick: ev => { ev.stopPropagation(); SB.speak(w); } }, '🔊');

  function wordDetail(e) {
    const starred = () => !!SB.state.vocab.starred[e.w];
    const card = V.card(e.w);
    return SB.modal(close => [
      h('div', { class: 'row between' },
        h('div', null, h('div', { class: 'word-big' }, e.w), h('div', { class: 'pos' }, POS[e.pos] || e.pos, e.deck === 'ielts' ? ' · IELTS · ' + e.cl : '')),
        speakBtn(e.w)),
      h('p', { class: 'def mt' }, e.def),
      h('p', { class: 'example', html: V.highlight(e) }),
      h('div', { class: 'syn mb' }, e.syn.map(s => h('span', null, s))),
      card ? h('p', { class: 'small muted' }, card.ivl >= 21 ? '✅ Mastered' : '📈 Learning', ' · next review ', card.due) : h('p', { class: 'small muted' }, 'Not learned yet'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn secondary', onclick: ev => { SB.state.vocab.starred[e.w] = !starred(); if (!starred()) delete SB.state.vocab.starred[e.w]; SB.save(); ev.target.textContent = starred() ? '★ Starred' : '☆ Star'; } }, starred() ? '★ Starred' : '☆ Star'),
        h('button', { class: 'btn', onclick: close }, 'Close')),
    ]);
  }
  V.showWord = w => { const e = byWord.get(w); if (e) wordDetail(e); };

  // ------------------------------------------------------------ hub
  SB.route('/words', view => {
    const s = V.stats();
    const newLeft = Math.max(0, SB.state.settings.newPerDay - V.newToday());
    const wotd = V.wordOfDay();
    SB.append(view, 
      h('div', { class: 'card hero' },
        h('div', { class: 'row between' },
          h('div', null, h('div', { class: 'small muted' }, 'Your vocabulary'), h('h1', { style: { margin: 0 } }, s.learned + ' ', h('span', { class: 'small muted' }, '/ ' + s.total + ' words'))),
          h('div', { class: 'center' }, h('div', { style: { fontSize: '1.6rem', fontWeight: 800 } }, s.mastered), h('div', { class: 'tiny muted' }, 'mastered'))),
        h('div', { class: 'mt' }, SB.progress(s.learned / Math.max(1, s.total)))),
      h('div', { class: 'seg mb' }, ['gre', 'ielts', 'both'].map(d => h('button', {
        class: SB.state.vocab.deck === d ? 'on' : '',
        onclick: () => { SB.state.vocab.deck = d; SB.save(); SB.render(); },
      }, d === 'gre' ? 'GRE' : d === 'ielts' ? 'IELTS' : 'Both'))),
      h('div', { class: 'tile-grid' },
        h('a', { class: 'tile accent', href: '#/words/learn' }, h('span', { class: 'emoji' }, '✨'), h('b', null, 'Learn new'), h('span', { class: 'sub' }, newLeft ? newLeft + ' new words today' : 'Daily goal done — learn extra?')),
        h('a', { class: 'tile', href: '#/words/review' }, h('span', { class: 'emoji' }, '🔁'), h('b', null, 'Review'), h('span', { class: 'sub' }, s.due ? s.due + ' due now' : 'Nothing due — great!')),
        h('a', { class: 'tile', href: '#/words/quiz/mix' }, h('span', { class: 'emoji' }, '🎯'), h('b', null, 'Quiz'), h('span', { class: 'sub' }, '10 mixed questions')),
        h('a', { class: 'tile', href: '#/words/quiz/se' }, h('span', { class: 'emoji' }, '🧩'), h('b', null, 'Sentence Equivalence'), h('span', { class: 'sub' }, 'GRE style: pick 2'))),
      SB.sectionTitle('Word of the day'),
      h('div', { class: 'card', onclick: () => wordDetail(wotd) },
        h('div', { class: 'row between' }, h('div', null, h('div', { class: 'word-big', style: { fontSize: '1.6rem' } }, wotd.w), h('div', { class: 'pos' }, POS[wotd.pos])), speakBtn(wotd.w)),
        h('p', { class: 'def', style: { marginTop: '8px' } }, wotd.def),
        h('p', { class: 'example', html: V.highlight(wotd) })),
      SB.sectionTitle('Practice modes'),
      h('div', { class: 'list' },
        SB.listItem('📖', 'Meaning', 'See a word, pick its definition', () => SB.go('/words/quiz/meaning')),
        SB.listItem('🔤', 'Reverse', 'See a definition, pick the word', () => SB.go('/words/quiz/reverse')),
        SB.listItem('🤝', 'Synonyms', 'Find the closest synonym', () => SB.go('/words/quiz/synonym')),
        SB.listItem('✏️', 'Fill the blank', 'Complete real sentences', () => SB.go('/words/quiz/blank'))),
      SB.sectionTitle('Word games'),
      h('div', { class: 'list' },
        SB.listItem('🔀', 'Scramble', 'Unscramble the word from its meaning', () => SB.go('/words/game/scramble')),
        SB.listItem('🧷', 'Match pairs', 'Connect 6 words to their meanings', () => SB.go('/words/game/match')),
        SB.listItem('⏱️', 'Speed round', '60 seconds — how many can you get?', () => SB.go('/words/game/speed'), null, h('span', { class: 'badge new' }, 'Best ' + (SB.state.vocab.speedBest || 0)))),
      SB.sectionTitle('Your words'),
      h('div', { class: 'list' },
        SB.listItem('📚', 'Word list', s.learned + ' learned · tap any word for details', () => SB.go('/words/list')),
        SB.listItem('★', 'Starred words', Object.keys(SB.state.vocab.starred).length + ' saved for extra practice', () => SB.go('/words/list?starred')))
    );
  }, { tab: 'words', top: true, title: 'Words' });

  // ------------------------------------------------------------ learn
  SB.route('/words/learn', view => {
    const goal = SB.state.settings.newPerDay;
    const left = goal - V.newToday();
    const n = left > 0 ? left : 5;
    const batch = V.unseen().slice(0, n);
    if (!batch.length) {
      SB.append(view, SB.empty('🏆', 'You have learned every word in this deck. Switch decks or keep reviewing!'));
      return;
    }
    let i = 0;
    const learnedNow = [];
    const show = () => {
      view.innerHTML = '';
      if (i >= batch.length) return checkQuiz(view, learnedNow);
      const e = batch[i];
      SB.append(view, 
        h('div', { class: 'quiz-top' }, h('span', { class: 'small muted' }, (i + 1) + ' / ' + batch.length), SB.progress(i / batch.length)),
        h('div', { class: 'card', style: { padding: '22px' } },
          h('div', { class: 'row between' }, h('div', null, h('div', { class: 'word-big' }, e.w), h('div', { class: 'pos' }, POS[e.pos] || e.pos)), speakBtn(e.w)),
          h('p', { class: 'def', style: { marginTop: '14px' } }, e.def),
          h('p', { class: 'example', html: V.highlight(e) }),
          h('div', { class: 'small muted', style: { marginBottom: '6px' } }, e.deck === 'ielts' ? 'Synonyms / collocations' : 'Synonyms'),
          h('div', { class: 'syn' }, e.syn.map(s => h('span', null, s)))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn secondary', onclick: () => { V.introduce(e.w, true); learnedNow.push(e); i++; SB.addXP(2); show(); } }, 'I knew it'),
          h('button', { class: 'btn', onclick: () => { V.introduce(e.w, false); learnedNow.push(e); i++; SB.addXP(5); show(); } }, 'Got it — next')),
        h('p', { class: 'tiny faint center mt' }, 'Tip: say the example sentence out loud. It sticks better.')
      );
      SB.speak(e.w);
    };
    show();
  }, { tab: 'words', title: 'Learn new words', parent: '/words' });

  function checkQuiz(view, words) {
    if (words.length < 2) { finish(); return; }
    const qs = SB.shuffle(words).map(e => makeQ('meaning', e, V.deck()));
    runQuiz(view, qs, { title: 'Quick check', onDone: (score) => {
      SB.confetti();
      view.innerHTML = '';
      SB.append(view, h('div', { class: 'card center' },
        h('div', { style: { fontSize: '3rem' } }, '🎉'),
        h('h2', null, 'Session complete!'),
        h('p', { class: 'muted' }, 'You learned ' + words.length + ' words and got ' + score + '/' + qs.length + ' in the quick check. They will come back for review at the right time.'),
        h('div', { class: 'btn-row mt' }, h('a', { class: 'btn secondary', href: '#/words' }, 'Done'), h('a', { class: 'btn', href: '#/words/learn' }, 'Learn more'))));
    } });
    function finish() { SB.go('/words'); }
  }

  // ------------------------------------------------------------ review
  SB.route('/words/review', view => {
    let queue = V.due().slice(0, 60);
    const total = queue.length;
    if (!total) {
      SB.append(view, SB.empty('🌤️', 'No words due right now. Learn some new ones or take a quiz!'),
        h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/words/learn' }, 'Learn new'), h('a', { class: 'btn secondary', href: '#/words/quiz/mix' }, 'Quiz')));
      return;
    }
    let done = 0;
    const requeued = new Set();
    const show = () => {
      view.innerHTML = '';
      if (!queue.length) {
        SB.confetti();
        SB.append(view, h('div', { class: 'card center' }, h('div', { style: { fontSize: '3rem' } }, '✅'), h('h2', null, 'Review done!'),
          h('p', { class: 'muted' }, done + ' cards reviewed. Spaced repetition will bring each word back just before you would forget it.'),
          h('a', { class: 'btn mt', href: '#/words' }, 'Back to Words')));
        return;
      }
      const e = queue[0];
      const flash = h('div', { class: 'flash' },
        h('div', { class: 'face front' },
          h('div', { class: 'word-big' }, e.w), h('div', { class: 'pos' }, POS[e.pos] || e.pos),
          h('div', { class: 'row', style: { justifyContent: 'center' } }, speakBtn(e.w)),
          h('p', { class: 'small faint' }, 'Recall the meaning, then tap to flip')),
        h('div', { class: 'face back' },
          h('div', { class: 'row between' }, h('b', { style: { fontSize: '1.3rem' } }, e.w), speakBtn(e.w)),
          h('p', { class: 'def' }, e.def),
          h('p', { class: 'example', html: V.highlight(e) }),
          h('div', { class: 'syn' }, e.syn.map(s => h('span', null, s)))));
      const rates = h('div', { class: 'rate-row hidden' },
        [['again', 'Again', 0, '<1d'], ['hard', 'Hard', 1, ''], ['good', 'Good', 2, ''], ['easy', 'Easy', 3, '']].map(([cls, label, q]) =>
          h('button', { class: 'btn ' + cls, onclick: () => rate(q) }, label, h('small', null, preview(e, q)))));
      const flip = () => { flash.classList.add('flipped'); rates.classList.remove('hidden'); showBtn.classList.add('hidden'); };
      const showBtn = h('button', { class: 'btn block', onclick: flip }, 'Show meaning');
      flash.addEventListener('click', flip);
      SB.append(view, 
        h('div', { class: 'quiz-top' }, h('span', { class: 'small muted' }, done + ' / ' + total), SB.progress(done / total)),
        h('div', { class: 'flash-wrap' }, flash), showBtn, rates);
      function rate(q) {
        V.rate(e.w, q);
        queue.shift();
        if (q === 0 && !requeued.has(e.w)) { requeued.add(e.w); queue.push(e); SB.bad(); } else { done++; SB.bump('reviews'); SB.addXP(q === 0 ? 1 : 2); }
        show();
      }
    };
    show();
  }, { tab: 'words', title: 'Review', parent: '/words' });

  function preview(e, q) {
    const c = Object.assign({ ease: 2.5, ivl: 0, reps: 0 }, V.card(e.w));
    let ivl;
    if (q === 0) return '<1d';
    if (q === 1) ivl = Math.max(1, Math.round(c.ivl * 1.2));
    else if (q === 2) ivl = c.reps === 0 ? 1 : c.reps === 1 ? 3 : Math.round(c.ivl * c.ease);
    else ivl = c.reps === 0 ? 4 : Math.round(Math.max(c.ivl, 1) * c.ease * 1.3);
    return ivl >= 30 ? Math.round(ivl / 30) + 'mo' : ivl + 'd';
  }

  // ------------------------------------------------------------ quizzes
  function distractors(e, pool, n, key, filter) {
    const used = new Set([key(e)]);
    const out = [];
    for (const x of SB.shuffle(pool)) {
      if (out.length >= n) break;
      if (x.w === e.w || (e.cl && x.cl === e.cl) || (filter && !filter(x))) continue;
      const k = key(x);
      if (used.has(k)) continue;
      used.add(k);
      out.push(x);
    }
    return out;
  }

  function makeQ(mode, e, pool) {
    if (mode === 'meaning') {
      const opts = SB.shuffle([e].concat(distractors(e, pool, 3, x => x.def)));
      return { prompt: h('div', null, h('div', { class: 'row' }, h('span', { class: 'word-big', style: { fontSize: '1.7rem' } }, e.w), speakBtn(e.w)), h('div', { class: 'pos' }, POS[e.pos])),
        options: opts.map(o => o.def), answer: opts.indexOf(e), entry: e, explain: e.ex };
    }
    if (mode === 'reverse') {
      const opts = SB.shuffle([e].concat(distractors(e, pool, 3, x => x.w, x => x.pos === e.pos)));
      return { prompt: h('div', null, h('div', { class: 'small muted' }, 'Which word means…'), h('div', { class: 'def' }, e.def)),
        options: opts.map(o => o.w), answer: opts.indexOf(e), entry: e, explain: e.ex };
    }
    if (mode === 'synonym') {
      const syn = SB.pick(e.syn.filter(s => !/["“]/.test(s)));
      const others = distractors(e, pool, 3, x => x.syn[0], x => x.pos === e.pos).map(x => SB.pick(x.syn.filter(s => !/["“]/.test(s))));
      const opts = SB.shuffle([syn].concat(others));
      return { prompt: h('div', null, h('div', { class: 'small muted' }, 'Closest in meaning to'), h('div', { class: 'row' }, h('span', { class: 'word-big', style: { fontSize: '1.7rem' } }, e.w), speakBtn(e.w))),
        options: opts, answer: opts.indexOf(syn), entry: e, explain: e.w + ': ' + e.def };
    }
    if (mode === 'blank') {
      const html = V.blanked(e);
      const opts = SB.shuffle([e].concat(distractors(e, pool, 3, x => x.w, x => x.pos === e.pos)));
      return { prompt: h('div', null, h('div', { class: 'small muted' }, 'Choose the word that best completes the sentence'), h('p', { class: 'passage', html })),
        options: opts.map(o => o.w), answer: opts.indexOf(e), entry: e, explain: e.w + ' — ' + e.def };
    }
    return null;
  }

  // Sentence Equivalence: two words from the same meaning cluster both fit the blank.
  function makeSE(pool) {
    const groups = {};
    for (const e of GRE) if (e.cl) (groups[e.cl + '/' + e.pos] = groups[e.cl + '/' + e.pos] || []).push(e);
    const keys = Object.keys(groups).filter(k => groups[k].length >= 2);
    const learnedSet = new Set(pool.map(e => e.w));
    let candidates = keys.filter(k => groups[k].some(e => learnedSet.has(e.w)));
    if (candidates.length < 5) candidates = keys;
    const key = SB.pick(candidates);
    const [a, b] = SB.shuffle(groups[key]);
    const pos = a.pos;
    const dis = SB.shuffle(GRE.filter(x => x.pos === pos && x.cl !== a.cl && x.w !== a.w && x.w !== b.w)).slice(0, 4);
    const opts = SB.shuffle([a, b].concat(dis));
    return {
      prompt: h('div', null, h('div', { class: 'small muted' }, 'Select the TWO words that complete the sentence and give it the same meaning'), h('p', { class: 'passage', html: V.blanked(a) })),
      options: opts.map(o => o.w), answers: [opts.indexOf(a), opts.indexOf(b)], entry: a, multi: true,
      explain: a.w + ' and ' + b.w + ' both mean "' + a.def + '".',
    };
  }

  function runQuiz(view, questions, opts) {
    let i = 0, score = 0;
    const wrong = [];
    const show = () => {
      view.innerHTML = '';
      if (i >= questions.length) {
        if (opts.onDone) return opts.onDone(score, wrong);
        return;
      }
      const q = questions[i];
      const picked = new Set();
      let answered = false;
      const fb = h('div');
      const optionEls = q.options.map((o, idx) => h('button', { class: 'option', onclick: () => choose(idx) }, o));
      const next = h('button', { class: 'btn block mt hidden', onclick: () => { i++; show(); } }, i + 1 < questions.length ? 'Next' : 'Finish');
      const check = q.multi ? h('button', { class: 'btn block mt', disabled: true, onclick: () => grade() }, 'Check') : null;
      SB.append(view, 
        h('div', { class: 'quiz-top' }, h('span', { class: 'small muted' }, opts.title ? opts.title + ' · ' : '', (i + 1) + '/' + questions.length), SB.progress(i / questions.length)),
        h('div', { class: 'quiz-q' }, q.prompt),
        h('div', { class: 'options' }, optionEls), check, fb, next);
      function choose(idx) {
        if (answered) return;
        if (q.multi) {
          if (picked.has(idx)) picked.delete(idx); else if (picked.size < 2) picked.add(idx);
          optionEls.forEach((el, k) => el.classList.toggle('picked', picked.has(k)));
          check.disabled = picked.size !== 2;
          return;
        }
        picked.add(idx);
        grade();
      }
      function grade() {
        answered = true;
        const correctSet = new Set(q.multi ? q.answers : [q.answer]);
        const ok = [...picked].every(p => correctSet.has(p)) && picked.size === correctSet.size;
        optionEls.forEach((el, k) => {
          el.disabled = true;
          if (correctSet.has(k)) el.classList.add('correct');
          else if (picked.has(k)) el.classList.add('wrong');
        });
        if (ok) { score++; SB.good(); } else { SB.bad(); wrong.push(q.entry); if (q.entry) V.markWrong(q.entry.w); }
        fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
        fb.innerHTML = '';
        SB.append(fb, h('b', null, ok ? 'Correct! ' : 'Not quite. '), q.explain ? h('span', null, q.explain) : null,
          q.entry ? h('div', { class: 'mt small' }, h('a', { href: 'javascript:void 0', onclick: () => V.showWord(q.entry.w) }, 'See "' + q.entry.w + '" details')) : null);
        if (check) check.classList.add('hidden');
        next.classList.remove('hidden');
        SB.bump('quiz');
      }
    };
    show();
  }
  SB.runQuiz = runQuiz;

  SB.route('/words/quiz/:mode', (view, p) => {
    const learned = V.learned();
    const pool = learned.length >= 12 ? learned : V.deck();
    const N = 10;
    const modes = ['meaning', 'reverse', 'synonym', 'blank'];
    const qs = [];
    const picks = SB.shuffle(pool).slice(0, N);
    for (let k = 0; k < N; k++) {
      if (p.mode === 'se') qs.push(makeSE(learned));
      else {
        const mode = p.mode === 'mix' ? modes[k % modes.length] : p.mode;
        const e = picks[k % picks.length];
        const q = makeQ(mode, e, V.deck());
        if (q && (mode !== 'blank' || V.blanked(e))) qs.push(q); else qs.push(makeQ('meaning', e, V.deck()));
      }
    }
    if (learned.length < 12 && p.mode !== 'se') {
      SB.append(view, h('p', { class: 'small muted' }, 'Tip: these questions use the whole deck. Once you learn 12+ words, quizzes focus on your words.'));
    }
    const box = h('div');
    SB.append(view, box);
    runQuiz(box, qs, {
      onDone: (score, wrong) => {
        const xp = score * 3 + (score === qs.length ? 10 : 0);
        SB.addXP(xp, 'quiz');
        if (score === qs.length) SB.confetti();
        box.innerHTML = '';
        SB.append(box, h('div', { class: 'card center' },
          h('div', { style: { fontSize: '3rem' } }, score >= 8 ? '🏆' : score >= 5 ? '👍' : '🌱'),
          h('h2', null, score + ' / ' + qs.length),
          h('p', { class: 'muted' }, score === qs.length ? 'Perfect score!' : score >= 7 ? 'Strong work. Mistakes are now scheduled for review.' : 'Every mistake is a word you will remember better next time.'),
          wrong.length ? h('div', { class: 'syn', style: { justifyContent: 'center', margin: '10px 0' } }, wrong.map(e => h('span', { onclick: () => V.showWord(e.w) }, e.w))) : null,
          h('div', { class: 'btn-row mt' }, h('a', { class: 'btn secondary', href: '#/words' }, 'Done'), h('button', { class: 'btn', onclick: () => SB.render() }, 'Again'))));
      },
    });
  }, { tab: 'words', title: 'Quiz', parent: '/words' });

  // ------------------------------------------------------------ games
  SB.route('/words/game/:name', (view, p) => {
    const learned = V.learned();
    const pool = learned.length >= 8 ? learned : V.deck();
    if (p.name === 'scramble') scramble(view, SB.sample(pool.filter(e => e.w.length <= 11), 8));
    else if (p.name === 'match') match(view, pool);
    else speed(view, pool);
  }, { tab: 'words', title: 'Word game', parent: '/words' });

  function scramble(view, words) {
    let i = 0, score = 0;
    const show = () => {
      view.innerHTML = '';
      if (i >= words.length) {
        SB.addXP(score * 3, 'scramble');
        SB.append(view, h('div', { class: 'card center' }, h('div', { style: { fontSize: '3rem' } }, '🔀'), h('h2', null, score + ' / ' + words.length + ' unscrambled'),
          h('div', { class: 'btn-row mt' }, h('a', { class: 'btn secondary', href: '#/words' }, 'Done'), h('button', { class: 'btn', onclick: () => SB.render() }, 'Play again'))));
        return;
      }
      const e = words[i];
      const letters = SB.shuffle(e.w.split(''));
      if (letters.join('') === e.w && e.w.length > 2) letters.reverse();
      const built = [];
      let hinted = false;
      const slots = h('div', { class: 'answer-slots' });
      const tiles = letters.map((ch, k) => h('button', { onclick: () => tap(k) }, ch));
      const msg = h('div', { class: 'center small muted mt' });
      const render = () => {
        slots.innerHTML = '';
        for (let k = 0; k < e.w.length; k++) SB.append(slots, h('span', null, built[k] !== undefined ? letters[built[k]] : ''));
        tiles.forEach((t, k) => t.classList.toggle('used', built.includes(k)));
      };
      function tap(k) {
        if (built.includes(k)) return;
        built.push(k);
        render();
        if (built.length === e.w.length) {
          const guess = built.map(b => letters[b]).join('');
          if (guess === e.w) {
            if (!hinted) score++;
            SB.good();
            msg.textContent = '✅ ' + e.w + ' — nice!';
            setTimeout(() => { i++; show(); }, 900);
          } else {
            SB.bad();
            msg.textContent = 'Not quite — try again';
            setTimeout(() => { built.length = 0; render(); msg.textContent = ''; }, 700);
          }
        }
      }
      SB.append(view, 
        h('div', { class: 'quiz-top' }, h('span', { class: 'small muted' }, (i + 1) + '/' + words.length), SB.progress(i / words.length)),
        h('div', { class: 'card' }, h('div', { class: 'small muted' }, POS[e.pos]), h('p', { class: 'def' }, e.def)),
        slots, h('div', { class: 'scramble-tiles' }, tiles), msg,
        h('div', { class: 'btn-row mt' },
          h('button', { class: 'btn secondary', onclick: () => { built.length = 0; render(); } }, 'Clear'),
          h('button', { class: 'btn secondary', onclick: () => {
            hinted = true;
            const pos = built.length;
            const want = e.w[pos];
            const k = letters.findIndex((c, idx) => c === want && !built.includes(idx));
            if (built.every((b, idx) => letters[b] === e.w[idx]) && k >= 0) tap(k); else { built.length = 0; render(); }
          } }, 'Hint'),
          h('button', { class: 'btn ghost', onclick: () => { msg.textContent = 'It was: ' + e.w; setTimeout(() => { i++; show(); }, 1200); } }, 'Skip')));
      render();
    };
    show();
  }

  function match(view, pool) {
    const set = SB.sample(pool, 6);
    const left = SB.shuffle(set), right = SB.shuffle(set);
    let selL = null, selR = null, found = 0, mistakes = 0;
    const start = Date.now();
    const lBtns = left.map(e => h('button', { onclick: () => pick('L', e, lBtns[left.indexOf(e)]) }, h('b', null, e.w)));
    const rBtns = right.map(e => h('button', { onclick: () => pick('R', e, rBtns[right.indexOf(e)]) }, e.def));
    const grid = h('div', { class: 'match-grid' });
    for (let k = 0; k < 6; k++) SB.append(grid, lBtns[k], rBtns[k]);
    SB.append(view, h('p', { class: 'muted small' }, 'Tap a word, then its meaning.'), grid);
    function pick(side, e, el) {
      if (side === 'L') { lBtns.forEach(b => b.classList.remove('sel')); selL = { e, el }; } else { rBtns.forEach(b => b.classList.remove('sel')); selR = { e, el }; }
      el.classList.add('sel');
      if (selL && selR) {
        if (selL.e === selR.e) {
          SB.good();
          selL.el.classList.add('gone'); selR.el.classList.add('gone');
          found++;
          if (found === 6) {
            const secs = Math.round((Date.now() - start) / 1000);
            SB.addXP(Math.max(6, 18 - mistakes * 2), 'match');
            setTimeout(() => {
              view.innerHTML = '';
              SB.append(view, h('div', { class: 'card center' }, h('div', { style: { fontSize: '3rem' } }, '🧷'), h('h2', null, 'All matched in ' + secs + 's'),
                h('p', { class: 'muted' }, mistakes ? mistakes + ' mistake(s)' : 'No mistakes!'),
                h('div', { class: 'btn-row mt' }, h('a', { class: 'btn secondary', href: '#/words' }, 'Done'), h('button', { class: 'btn', onclick: () => SB.render() }, 'Play again'))));
            }, 400);
          }
        } else {
          SB.bad();
          mistakes++;
          const a = selL.el, b = selR.el;
          a.classList.add('bad'); b.classList.add('bad');
          setTimeout(() => { a.classList.remove('bad', 'sel'); b.classList.remove('bad', 'sel'); }, 400);
        }
        selL = selR = null;
      }
    }
  }

  function speed(view, pool) {
    let score = 0, timeLeft = 60, timer = null, running = true;
    const timeEl = h('div', { class: 'timer' }, '60');
    const scoreEl = h('div', { class: 'center muted' }, 'Score: 0');
    const box = h('div');
    SB.append(view, timeEl, scoreEl, box);
    timer = setInterval(() => {
      timeLeft--;
      timeEl.textContent = timeLeft;
      if (timeLeft <= 0) end();
    }, 1000);
    SB.onLeave(() => clearInterval(timer));
    const next = () => {
      if (!running) return;
      const e = SB.pick(pool);
      const q = makeQ(Math.random() < 0.5 ? 'meaning' : 'reverse', e, V.deck());
      box.innerHTML = '';
      SB.append(box, h('div', { class: 'quiz-q' }, q.prompt), h('div', { class: 'options' }, q.options.map((o, idx) => h('button', {
        class: 'option', onclick: ev => {
          if (idx === q.answer) { score++; SB.good(); ev.target.classList.add('correct'); }
          else { SB.bad(); ev.target.classList.add('wrong'); timeLeft = Math.max(0, timeLeft - 2); }
          scoreEl.textContent = 'Score: ' + score;
          setTimeout(next, 250);
        },
      }, o))));
    };
    function end() {
      running = false;
      clearInterval(timer);
      const best = SB.state.vocab.speedBest || 0;
      if (score > best) { SB.state.vocab.speedBest = score; SB.save(); if (score > 3) SB.confetti(); }
      SB.addXP(Math.min(30, score * 2), 'speed round');
      view.innerHTML = '';
      SB.append(view, h('div', { class: 'card center' }, h('div', { style: { fontSize: '3rem' } }, '⏱️'), h('h2', null, score + ' correct'),
        h('p', { class: 'muted' }, score > best ? 'New personal best!' : 'Best: ' + best),
        h('div', { class: 'btn-row mt' }, h('a', { class: 'btn secondary', href: '#/words' }, 'Done'), h('button', { class: 'btn', onclick: () => SB.render() }, 'Play again'))));
    }
    next();
  }

  // ------------------------------------------------------------ list
  SB.route('/words/list', view => {
    const starredOnly = location.hash.includes('?starred');
    let filter = starredOnly ? 'starred' : 'all', query = '';
    const listEl = h('div', { class: 'card flat', style: { padding: '0 4px' } });
    const draw = () => {
      const cards = SB.state.vocab.cards;
      let items = V.deck().slice().sort((a, b) => a.w.localeCompare(b.w));
      if (filter === 'learning') items = items.filter(e => cards[e.w] && cards[e.w].ivl < 21);
      if (filter === 'mastered') items = items.filter(e => cards[e.w] && cards[e.w].ivl >= 21);
      if (filter === 'new') items = items.filter(e => !cards[e.w]);
      if (filter === 'starred') items = items.filter(e => SB.state.vocab.starred[e.w]);
      if (query) { const q = query.toLowerCase(); items = items.filter(e => e.w.includes(q) || e.def.toLowerCase().includes(q) || e.syn.join(' ').toLowerCase().includes(q)); }
      listEl.innerHTML = '';
      if (!items.length) { SB.append(listEl, SB.empty('🔍', 'No words here yet.')); return; }
      items.slice(0, 300).forEach(e => {
        const c = cards[e.w];
        const lvl = !c ? 0 : c.ivl >= 21 ? 4 : c.ivl >= 7 ? 3 : c.ivl >= 3 ? 2 : 1;
        SB.append(listEl, h('div', { class: 'word-row', onclick: () => wordDetail(e) },
          h('div', { class: 'grow' }, h('b', null, e.w), ' ', h('span', { class: 'pos' }, e.pos), h('div', { class: 'small muted', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, e.def)),
          SB.state.vocab.starred[e.w] ? h('span', null, '★') : null,
          h('div', { class: 'level-dots' }, [1, 2, 3, 4].map(k => h('i', { class: k <= lvl ? 'on' : '' })))));
      });
      if (items.length > 300) SB.append(listEl, h('p', { class: 'center small muted' }, 'Showing 300 of ' + items.length + ' — search to narrow down.'));
    };
    const tabs = h('div', { class: 'tabs' }, ['all', 'learning', 'mastered', 'new', 'starred'].map(f => h('button', {
      class: f === filter ? 'on' : '', onclick: ev => { filter = f; tabs.querySelectorAll('button').forEach(b => b.classList.remove('on')); ev.target.classList.add('on'); draw(); },
    }, f[0].toUpperCase() + f.slice(1))));
    SB.append(view, h('input', { type: 'search', placeholder: 'Search words, meanings, synonyms…', oninput: ev => { query = ev.target.value.trim(); draw(); }, style: { marginBottom: '10px' } }), tabs, listEl);
    draw();
  }, { tab: 'words', title: 'Word list', parent: '/words' });
})();
