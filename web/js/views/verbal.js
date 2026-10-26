/* Verbal: GRE reading, text completion, sentence equivalence, and IELTS practice. */
(function () {
  'use strict';
  const { h } = SB;
  const VB = window.VERBAL || { passages: [], tc: [], se: [] };
  const IE = window.IELTS || {};

  // Highlights deck words inside a passage so they can be tapped.
  let vocabRe = null;
  function linkVocab(text) {
    if (!vocabRe) {
      const words = Array.from(SB.vocab.byWord.keys()).filter(w => w.length > 3).sort((a, b) => b.length - a.length);
      vocabRe = new RegExp('\\b(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(s|es|d|ed|ing|ly)?\\b', 'gi');
    }
    return SB.esc(text).replace(vocabRe, (m, base) => '<span class="vw" data-w="' + base.toLowerCase() + '">' + m + '</span>');
  }
  function bindVocab(el) {
    el.addEventListener('click', ev => {
      const t = ev.target.closest('.vw');
      if (t) SB.vocab.showWord(t.dataset.w);
    });
  }

  // ------------------------------------------------------------ hub
  SB.route('/verbal', view => {
    const vs = SB.state.verbal;
    const readCount = Object.keys(vs.passages).length;
    const tcDone = Object.keys(vs.tc).length, seDone = Object.keys(vs.se).length;
    SB.append(view, 
      h('div', { class: 'card hero' },
        h('div', { class: 'small muted' }, 'GRE Verbal + IELTS'),
        h('h2', { style: { margin: '2px 0 8px' } }, 'Read a little every day'),
        h('p', { class: 'muted', style: { margin: 0 } }, readCount + '/' + VB.passages.length + ' passages · ' + tcDone + '/' + VB.tc.length + ' text completions · ' + seDone + '/' + VB.se.length + ' sentence equivalence')),
      SB.sectionTitle('GRE Verbal'),
      h('div', { class: 'tile-grid' },
        h('a', { class: 'tile accent', href: '#/verbal/tc' }, h('span', { class: 'emoji' }, '🧩'), h('b', null, 'Text Completion'), h('span', { class: 'sub' }, '5 questions per set')),
        h('a', { class: 'tile', href: '#/verbal/se' }, h('span', { class: 'emoji' }, '⚖️'), h('b', null, 'Sentence Equivalence'), h('span', { class: 'sub' }, 'Pick the two that match'))),
      h('h3', { style: { margin: '6px 2px 10px' } }, '📖 Reading comprehension'),
      h('div', { class: 'list' }, VB.passages.map(p => {
        const r = vs.passages[p.id];
        return SB.listItem(r ? '✅' : '📄', p.title, p.topic + (r ? ' · best ' + r.best + '/' + p.questions.length : ' · ' + p.questions.length + ' questions'), () => SB.go('/verbal/read/' + p.id), r ? 'done' : '');
      })),
      SB.sectionTitle('IELTS'),
      h('div', { class: 'tile-grid' },
        h('a', { class: 'tile accent', href: '#/ielts/speaking' }, h('span', { class: 'emoji' }, '🎤'), h('b', null, 'Speaking Part 2'), h('span', { class: 'sub' }, 'Cue card + timer')),
        h('a', { class: 'tile', href: '#/ielts/writing' }, h('span', { class: 'emoji' }, '✍️'), h('b', null, 'Writing Task 2'), h('span', { class: 'sub' }, (vs.essays || []).length + ' essays written'))),
      h('div', { class: 'list' },
        SB.listItem('💬', 'Speaking Part 1 questions', 'Short everyday topics — answer out loud', () => SB.go('/ielts/part1')),
        SB.listItem('🧰', 'Useful language', 'Linking words, Task 1 trend vocabulary, band tips', () => SB.go('/ielts/language')),
        SB.listItem('📚', 'IELTS vocabulary deck', 'Switch the Words deck to IELTS', () => { SB.state.vocab.deck = 'ielts'; SB.save(); SB.go('/words'); })));
  }, { tab: 'verbal', top: true, title: 'Verbal' });

  // ------------------------------------------------------------ reading
  SB.route('/verbal/read/:id', (view, p) => {
    const P = VB.passages.find(x => x.id === p.id);
    if (!P) { SB.replace('/verbal'); return; }
    SB.setTitle(P.title);
    const passage = h('div', { class: 'card passage' }, h('div', { class: 'small muted', style: { marginBottom: '8px' } }, P.topic + ' · tap underlined words for definitions'),
      P.text.map(t => h('p', { html: linkVocab(t) })));
    bindVocab(passage);
    const qBox = h('div');
    const startedAt = Date.now();
    let qi = 0, score = 0;
    const draw = () => {
      qBox.innerHTML = '';
      if (qi >= P.questions.length) {
        const prev = SB.state.verbal.passages[P.id];
        const first = !prev;
        SB.state.verbal.passages[P.id] = { best: Math.max(score, prev ? prev.best : 0), last: SB.dayKey() };
        if (first) SB.bump('reading');
        SB.save();
        SB.addXP(first ? 10 + score * 5 : score * 2, 'reading');
        if (score === P.questions.length) SB.confetti();
        const mins = Math.round((Date.now() - startedAt) / 60000);
        SB.append(qBox, h('div', { class: 'card center' }, h('div', { style: { fontSize: '2.6rem' } }, score === P.questions.length ? '🏆' : '📖'),
          h('h2', null, score + ' / ' + P.questions.length), h('p', { class: 'muted' }, 'Time: ' + (mins || '<1') + ' min. On the GRE you have about 1.5 minutes per question.'),
          h('a', { class: 'btn', href: '#/verbal' }, 'Back to Verbal')));
        return;
      }
      const q = P.questions[qi];
      const fb = h('div');
      const opts = q.options.map((o, i) => h('button', { class: 'option', onclick: () => {
        opts.forEach((b, k) => { b.disabled = true; if (k === q.answer) b.classList.add('correct'); });
        if (i === q.answer) { score++; SB.good(); } else { opts[i].classList.add('wrong'); SB.bad(); }
        fb.className = 'feedback ' + (i === q.answer ? 'ok' : 'bad');
        SB.append(fb, h('b', null, i === q.answer ? 'Correct. ' : 'Not quite. '), q.explain);
        SB.append(qBox, h('button', { class: 'btn block mt', onclick: () => { qi++; draw(); } }, qi + 1 < P.questions.length ? 'Next question' : 'See results'));
      } }, String.fromCharCode(65 + i) + '. ' + o));
      SB.append(qBox, h('div', { class: 'small muted' }, 'Question ' + (qi + 1) + ' of ' + P.questions.length), h('div', { class: 'quiz-q' }, q.q), h('div', { class: 'options' }, opts), fb);
    };
    SB.append(view, passage, qBox);
    draw();
  }, { tab: 'verbal', title: 'Reading', parent: '/verbal' });

  // ------------------------------------------------------------ text completion
  SB.route('/verbal/tc', view => {
    const done = SB.state.verbal.tc;
    const fresh = VB.tc.filter(q => !done[q.id] || !done[q.id].ok);
    const set = SB.shuffle(fresh.length >= 5 ? fresh : VB.tc).slice(0, 5);
    let i = 0, score = 0;
    const show = () => {
      view.innerHTML = '';
      if (i >= set.length) {
        SB.addXP(score * 4, 'text completion');
        if (score === set.length) SB.confetti();
        SB.append(view, h('div', { class: 'card center' }, h('div', { style: { fontSize: '2.6rem' } }, '🧩'), h('h2', null, score + ' / ' + set.length),
          h('p', { class: 'muted' }, 'Tip: read the whole sentence first and look for signal words like although, despite, because, and far from.'),
          h('div', { class: 'btn-row mt' }, h('a', { class: 'btn secondary', href: '#/verbal' }, 'Done'), h('button', { class: 'btn', onclick: () => SB.render() }, 'Another set'))));
        return;
      }
      const q = set[i];
      const picks = q.blanks.map(() => -1);
      const roman = ['i', 'ii', 'iii'];
      const sentence = h('p', { class: 'passage quiz-q' });
      const renderSentence = () => {
        sentence.innerHTML = SB.esc(q.s).replace(/___\((i{1,3})\)___/g, (m, r) => {
          const k = roman.indexOf(r);
          return '<span class="blank">' + (picks[k] >= 0 ? SB.esc(q.blanks[k][picks[k]]) : '(' + r + ')') + '</span>';
        });
      };
      renderSentence();
      const groups = q.blanks.map((opts, k) => h('div', { class: 'mb' },
        q.blanks.length > 1 ? h('div', { class: 'small muted', style: { margin: '4px 0 6px' } }, 'Blank (' + roman[k] + ')') : null,
        h('div', { class: 'options' }, opts.map((o, j) => h('button', { class: 'option', 'data-k': k, 'data-j': j, onclick: ev => {
          if (checked) return;
          picks[k] = j;
          ev.currentTarget.parentNode.querySelectorAll('.option').forEach(b => b.classList.toggle('picked', Number(b.dataset.j) === j));
          renderSentence();
          checkBtn.disabled = picks.some(p => p < 0);
        } }, o)))));
      let checked = false;
      const fb = h('div');
      const checkBtn = h('button', { class: 'btn block', disabled: true, onclick: () => {
        checked = true;
        const ok = picks.every((p, k) => p === q.answer[k]);
        groups.forEach((g, k) => g.querySelectorAll('.option').forEach(b => {
          const j = Number(b.dataset.j);
          b.disabled = true;
          if (j === q.answer[k]) b.classList.add('correct');
          else if (j === picks[k]) b.classList.add('wrong');
        }));
        if (ok) { score++; SB.good(); } else SB.bad();
        SB.state.verbal.tc[q.id] = { ok, d: SB.dayKey() };
        SB.save();
        fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
        SB.append(fb, h('b', null, ok ? 'Correct! ' : 'Not quite. '), q.explain, q.blanks.length > 1 ? h('div', { class: 'tiny muted mt' }, 'GRE scoring: all blanks must be right to earn the point.') : null);
        checkBtn.replaceWith(h('button', { class: 'btn block', onclick: () => { i++; show(); } }, i + 1 < set.length ? 'Next' : 'Finish'));
      } }, 'Check');
      SB.append(view, h('div', { class: 'quiz-top' }, h('span', { class: 'small muted' }, (i + 1) + '/' + set.length), SB.progress(i / set.length)),
        h('div', { class: 'card' }, sentence), groups, checkBtn, fb);
    };
    show();
  }, { tab: 'verbal', title: 'Text Completion', parent: '/verbal' });

  // ------------------------------------------------------------ sentence equivalence
  SB.route('/verbal/se', view => {
    const done = SB.state.verbal.se;
    const fresh = VB.se.filter(q => !done[q.id] || !done[q.id].ok);
    const set = SB.shuffle(fresh.length >= 5 ? fresh : VB.se).slice(0, 5);
    const qs = set.map(q => ({
      id: q.id,
      prompt: h('div', null, h('div', { class: 'small muted' }, 'Select the TWO answers that complete the sentence and produce sentences alike in meaning'), h('p', { class: 'passage', html: SB.esc(q.s).replace('______', '<span class="blank">?</span>') })),
      options: q.options, answers: q.answer, multi: true, explain: q.explain,
    }));
    const box = h('div');
    SB.append(view, box);
    SB.runQuiz(box, qs, {
      onDone: score => {
        set.forEach(q => { if (!SB.state.verbal.se[q.id]) SB.state.verbal.se[q.id] = { d: SB.dayKey() }; });
        SB.save();
        SB.addXP(score * 4, 'sentence equivalence');
        box.innerHTML = '';
        SB.append(box, h('div', { class: 'card center' }, h('div', { style: { fontSize: '2.6rem' } }, '⚖️'), h('h2', null, score + ' / ' + qs.length),
          h('p', { class: 'muted' }, 'Strategy: predict your own word for the blank first, then look for TWO options that match it. Watch out for synonym pairs that do not fit the sentence!'),
          h('div', { class: 'btn-row mt' }, h('a', { class: 'btn secondary', href: '#/words/quiz/se' }, 'More (from your words)'), h('button', { class: 'btn', onclick: () => SB.render() }, 'Another set'))));
      },
    });
  }, { tab: 'verbal', title: 'Sentence Equivalence', parent: '/verbal' });

  // ------------------------------------------------------------ IELTS speaking part 2
  SB.route('/ielts/speaking', view => {
    let card = SB.pick(IE.cards);
    let timer = null;
    SB.onLeave(() => clearInterval(timer));
    const draw = () => {
      clearInterval(timer);
      view.innerHTML = '';
      const timeEl = h('div', { class: 'timer' }, '1:00');
      const phase = h('div', { class: 'center muted' }, 'Read the card, then start your 1 minute of preparation.');
      const notes = h('textarea', { placeholder: 'Quick notes (keywords only)…', rows: '4' });
      const startBtn = h('button', { class: 'btn block', onclick: () => start() }, '▶ Start 1-minute preparation');
      const after = h('div');
      const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      function countdown(secs, onEnd) {
        let left = secs;
        timeEl.textContent = fmt(left);
        clearInterval(timer);
        timer = setInterval(() => {
          left--;
          timeEl.textContent = fmt(Math.max(0, left));
          if (left <= 0) { clearInterval(timer); onEnd(); }
        }, 1000);
      }
      function start() {
        startBtn.disabled = true;
        phase.textContent = '📝 Preparation: jot down 3–4 keywords for each point.';
        countdown(60, speak);
      }
      function speak() {
        SB.sfx('done');
        SB.buzz(80);
        phase.textContent = '🎤 Now speak for up to 2 minutes. Keep going until the timer ends!';
        startBtn.textContent = '⏹ I am finished';
        startBtn.disabled = false;
        startBtn.onclick = finish;
        countdown(120, finish);
      }
      function finish() {
        clearInterval(timer);
        startBtn.remove();
        phase.textContent = 'Well done! Now the examiner asks follow-up (Part 3) questions:';
        SB.state.verbal.speaking = (SB.state.verbal.speaking || 0) + 1;
        SB.bump('reading');
        SB.save();
        SB.addXP(15, 'speaking practice');
        SB.append(after, 
          h('ul', { class: 'card' }, card.part3.map(q => h('li', null, q))),
          h('div', { class: 'card' }, h('h3', null, 'Self-check'),
            ['Did I cover all the bullet points?', 'Did I speak for close to 2 minutes?', 'Did I use past tenses correctly for my story?', 'Did I use at least 3 less-common words?', 'Did I explain WHY, not just WHAT?'].map(t => h('label', { class: 'row', style: { padding: '6px 0' } }, h('input', { type: 'checkbox' }), t))),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => { card = SB.pick(IE.cards); draw(); } }, 'New cue card')));
      }
      SB.append(view, 
        h('div', { class: 'card' },
          h('div', { class: 'small muted' }, 'Part 2 · Cue card'),
          h('h2', null, card.title),
          h('p', { class: 'muted', style: { margin: '4px 0' } }, 'You should say:'),
          h('ul', null, card.points.map(t => h('li', null, t))),
          h('p', null, card.explain)),
        timeEl, phase, h('div', { class: 'mt' }, notes), h('div', { class: 'mt' }, startBtn), after,
        h('p', { class: 'tiny faint center mt' }, 'Tip: record yourself with your phone\'s voice recorder and listen back — it is the fastest way to improve.'));
    };
    draw();
  }, { tab: 'verbal', title: 'IELTS Speaking', parent: '/verbal' });

  SB.route('/ielts/part1', view => {
    SB.append(view, h('p', { class: 'muted' }, 'Answer each question out loud in 2–3 sentences: answer + reason + example. Tap 🔊 to hear the question.'));
    IE.part1.forEach(t => SB.append(view, h('div', { class: 'card' }, h('h3', null, t.topic),
      t.qs.map(q => h('div', { class: 'row', style: { padding: '6px 0' } }, h('div', { class: 'grow' }, q),
        h('button', { class: 'speak', onclick: () => SB.speak(q) }, '🔊'))))));
  }, { tab: 'verbal', title: 'Speaking Part 1', parent: '/verbal' });

  // ------------------------------------------------------------ IELTS writing
  SB.route('/ielts/writing', view => {
    const essays = SB.state.verbal.essays || [];
    SB.append(view, h('p', { class: 'muted' }, 'Task 2: at least 250 words in 40 minutes. Pick a prompt:'),
      h('div', { class: 'list' }, IE.essays.map((e, i) => SB.listItem(essays.some(x => x.n === i) ? '✅' : '✍️', e.type, e.prompt, () => SB.go('/ielts/writing/' + i)))));
    if (essays.length) {
      SB.append(view, SB.sectionTitle('Your essays'), h('div', { class: 'list' }, essays.slice().reverse().map(e => SB.listItem('📄', e.d + ' · ' + e.words + ' words', e.text.slice(0, 80), () => SB.modal(close => [
        h('h3', null, IE.essays[e.n] ? IE.essays[e.n].prompt : 'Essay'), h('div', { style: { whiteSpace: 'pre-wrap' } }, e.text), h('button', { class: 'btn block mt', onclick: close }, 'Close')])))));
    }
  }, { tab: 'verbal', title: 'IELTS Writing', parent: '/verbal' });

  SB.route('/ielts/writing/:n', (view, p) => {
    const n = Number(p.n);
    const E = IE.essays[n];
    if (!E) { SB.replace('/ielts/writing'); return; }
    const draftKey = 'essayDraft' + n;
    const ta = h('textarea', { rows: '16', placeholder: 'Write your essay here…', value: SB.state.verbal[draftKey] || '' });
    const count = h('b', null, '0');
    const timeEl = h('span', { class: 'badge' }, '40:00');
    let left = 40 * 60, timer = null;
    SB.onLeave(() => clearInterval(timer));
    const updateCount = () => {
      const w = (ta.value.trim().match(/\S+/g) || []).length;
      count.textContent = w;
      count.style.color = w >= 250 ? 'var(--success)' : '';
      return w;
    };
    ta.addEventListener('input', () => { updateCount(); SB.state.verbal[draftKey] = ta.value; SB.save(); });
    updateCount();
    const timerBtn = h('button', { class: 'btn small secondary', onclick: () => {
      if (timer) { clearInterval(timer); timer = null; timerBtn.textContent = '▶ Resume timer'; return; }
      timerBtn.textContent = '⏸ Pause';
      timer = setInterval(() => {
        left--;
        timeEl.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
        if (left <= 0) { clearInterval(timer); timer = null; SB.toast('⏰ Time is up!'); SB.buzz(200); }
      }, 1000);
    } }, '▶ Start 40-min timer');
    SB.append(view, 
      h('div', { class: 'card' }, h('span', { class: 'badge new' }, E.type), h('p', { style: { marginTop: '8px', fontWeight: 600 } }, E.prompt)),
      h('details', { class: 'hint' }, h('summary', null, 'Suggested structure'), h('ol', null, (IE.structures[E.type] || []).map(s => h('li', null, s)))),
      h('div', { class: 'row between mb' }, h('span', { class: 'small' }, 'Words: ', count, ' / 250'), h('div', { class: 'row' }, timeEl, timerBtn)),
      ta,
      h('div', { class: 'btn-row mt' }, h('button', { class: 'btn', onclick: () => {
        const words = updateCount();
        if (words < 50) { SB.toast('Write a bit more first (at least 50 words)'); return; }
        SB.state.verbal.essays = SB.state.verbal.essays || [];
        SB.state.verbal.essays.push({ n, d: SB.dayKey(), words, text: ta.value });
        delete SB.state.verbal[draftKey];
        SB.save();
        SB.addXP(words >= 250 ? 30 : 15, 'essay');
        if (words >= 250) SB.confetti();
        SB.modal(close => [
          h('h2', null, words >= 250 ? '🎉 Essay saved!' : 'Essay saved'),
          h('p', { class: 'muted' }, words + ' words.' + (words < 250 ? ' Remember: under 250 words loses marks in Task Response.' : '')),
          h('h3', null, 'Self-check against the band criteria'),
          IE.tips.writing.map(([k, v]) => h('label', { class: 'row', style: { alignItems: 'flex-start', padding: '6px 0' } }, h('input', { type: 'checkbox', style: { marginTop: '5px' } }), h('div', null, h('b', null, k), h('div', { class: 'small muted' }, v)))),
          h('button', { class: 'btn block mt', onclick: () => { close(); SB.go('/ielts/writing'); } }, 'Done'),
        ]);
      } }, 'Save essay')));
  }, { tab: 'verbal', title: 'Writing Task 2', parent: '/ielts/writing' });

  SB.route('/ielts/language', view => {
    SB.append(view, SB.sectionTitle('Linking words & phrases'));
    IE.linking.forEach(g => SB.append(view, h('div', { class: 'card tight' }, h('b', null, g.cat), h('div', { class: 'syn', style: { marginTop: '8px' } }, g.items.map(i => h('span', null, i))))));
    SB.append(view, SB.sectionTitle('Task 1: describing graphs'));
    IE.task1.forEach(g => SB.append(view, h('div', { class: 'card tight' }, h('b', null, g.cat), h('div', { class: 'syn', style: { marginTop: '8px' } }, g.items.map(i => h('span', null, i))))));
    SB.append(view, SB.sectionTitle('What examiners look for'), h('h3', null, 'Writing'));
    IE.tips.writing.forEach(([k, v]) => SB.append(view, h('div', { class: 'card tight' }, h('b', null, k), h('p', { class: 'small muted', style: { margin: '4px 0 0' } }, v))));
    SB.append(view, h('h3', { class: 'mt' }, 'Speaking'));
    IE.tips.speaking.forEach(([k, v]) => SB.append(view, h('div', { class: 'card tight' }, h('b', null, k), h('p', { class: 'small muted', style: { margin: '4px 0 0' } }, v))));
  }, { tab: 'verbal', title: 'Useful language', parent: '/verbal' });
})();
