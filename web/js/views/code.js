/* Code: embedded C course, challenges, playground and board reference. */
(function () {
  'use strict';
  const { h } = SB;
  const LESSONS = window.LESSONS || [];

  const C = (SB.code = {
    lessons: LESSONS,
    byId: id => LESSONS.find(l => l.id === id),
    state: id => SB.state.code.lessons[id] || {},
    isDone: id => !!(SB.state.code.lessons[id] && SB.state.code.lessons[id].done),
    todayLesson() {
      return LESSONS.find(l => !C.isDone(l.id)) || null;
    },
    doneCount: () => LESSONS.filter(l => C.isDone(l.id)).length,
    chKey: (id, n) => id + ':' + n,
    solved: (id, n) => !!SB.state.code.challenges[C.chKey(id, n)],
    solvedCount: () => Object.keys(SB.state.code.challenges).length,
    totalChallenges: () => LESSONS.reduce((a, l) => a + l.challenges.length, 0),
    // A challenge still waiting to be solved in a lesson that has been read.
    nextChallenge() {
      for (const l of LESSONS) {
        if (!C.state(l.id).read) continue;
        for (let i = 0; i < l.challenges.length; i++) if (!C.solved(l.id, i)) return { lesson: l, n: i };
      }
      return null;
    },
  });

  const paragraphs = text => String(text).split(/\n\n/).map(p => h('p', { html: SB.inline(p).replace(/\n/g, '<br>') }));

  function runCode(code, options, done) {
    setTimeout(() => {
      let run;
      try {
        run = MiniC.run(code, Object.assign({ maxSteps: 8000000, maxTimeMs: 10000 }, options));
      } catch (e) {
        run = { compiled: false, errors: [{ line: 0, msg: 'Internal simulator error: ' + e.message }], warnings: [], stdout: '' };
      }
      if (run.compiled && !SB.state.code.ranProgram) { SB.state.code.ranProgram = true; SB.save(); SB.checkBadges(); }
      if (run.board && run.board.ledTimeline.length > 2 && !SB.state.code.blinked) { SB.state.code.blinked = true; SB.save(); SB.checkBadges(); }
      done(run);
    }, 30);
  }

  // Inline runnable code block used inside lessons.
  function codeBlock(src, runnable) {
    const pre = h('pre', { class: 'code', html: SB.highlightC(src) });
    if (!runnable) return pre;
    const outBox = h('div');
    const usesBoard = /board\.h|RCC|GPIO|delay_ms/.test(src);
    const runBtn = h('button', { class: 'btn small', onclick: () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Running…';
      runCode(src, {}, run => {
        runBtn.disabled = false;
        runBtn.textContent = '▶ Run';
        outBox.innerHTML = '';
        outBox.appendChild(SB.renderRun(run));
        if (usesBoard && run.compiled) {
          const bv = SB.BoardView({ compact: true });
          outBox.appendChild(h('div', { class: 'mt' }, bv.el));
          bv.show(run);
        }
        outBox.lastChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    } }, '▶ Run');
    return h('div', { class: 'mb' }, pre, h('div', { class: 'row', style: { marginTop: '-6px', marginBottom: '8px' } }, runBtn,
      h('button', { class: 'btn small secondary', onclick: () => { SB.state.code.playground = src; SB.save(); SB.go('/code/playground'); } }, '✎ Edit in playground')), outBox);
  }

  function renderBlocks(blocks) {
    return h('div', { class: 'lesson-body' }, blocks.map(b => {
      switch (b[0]) {
        case 'p': return h('p', { html: SB.inline(b[1]) });
        case 'h': return h('h3', null, b[1]);
        case 'code': return codeBlock(b[1], b[2]);
        case 'ul': return h('ul', null, b[1].map(t => h('li', { html: SB.inline(t) })));
        case 'ol': return h('ol', null, b[1].map(t => h('li', { html: SB.inline(t) })));
        case 'note': return h('div', { class: 'note', html: 'ℹ️ ' + SB.inline(b[1]) });
        case 'tip': return h('div', { class: 'note', html: '💡 ' + SB.inline(b[1]) });
        case 'warn': return h('div', { class: 'warn', html: '⚠️ ' + SB.inline(b[1]) });
        case 'pre': return h('div', { class: 'diagram' }, b[1]);
        case 'table': return h('table', null, b[1].map((row, i) => h('tr', null, row.map(c => h(i === 0 ? 'th' : 'td', { html: SB.inline(c) })))));
      }
      return null;
    }));
  }

  // ------------------------------------------------------------ hub
  SB.route('/code', view => {
    const done = C.doneCount(), total = LESSONS.length;
    const today = C.todayLesson();
    const next = C.nextChallenge();
    SB.append(view, 
      h('div', { class: 'card hero' },
        h('div', { class: 'small muted' }, 'Embedded C course'),
        h('h2', { style: { margin: '2px 0 6px' } }, done + ' / ' + total + ' lessons · ' + C.solvedCount() + ' / ' + C.totalChallenges() + ' challenges'),
        SB.progress(done / Math.max(1, total)),
        today ? h('div', { class: 'mt' },
          h('div', { class: 'small muted' }, "Today's lesson · Day " + (LESSONS.indexOf(today) + 1)),
          h('div', { style: { fontWeight: 750, fontSize: '1.15rem', margin: '2px 0 10px' } }, today.emoji + ' ' + today.title),
          h('a', { class: 'btn', style: { background: '#fff', color: '#4338ca' }, href: '#/code/lesson/' + today.id }, 'Start lesson →'))
          : h('p', { class: 'mt' }, '🎓 You finished the whole course! Keep sharpening your skills in the playground.')),
      h('div', { class: 'tile-grid' },
        h('a', { class: 'tile accent', href: '#/code/playground' }, h('span', { class: 'emoji' }, '🧪'), h('b', null, 'Playground'), h('span', { class: 'sub' }, 'Write & run any C on the virtual board')),
        next ? h('a', { class: 'tile', href: '#/code/challenge/' + next.lesson.id + '/' + next.n }, h('span', { class: 'emoji' }, '🏋️'), h('b', null, 'Next challenge'), h('span', { class: 'sub' }, next.lesson.challenges[next.n].title))
          : h('a', { class: 'tile', href: '#/code/reference' }, h('span', { class: 'emoji' }, '📘'), h('b', null, 'Board reference'), h('span', { class: 'sub' }, 'Registers, pins & memory map'))),
      h('div', { class: 'list mb' }, SB.listItem('📘', 'Board reference & C cheat sheet', 'Memory map, registers, pins, functions', () => SB.go('/code/reference'))));
    let unit = null, unitNo = 0;
    LESSONS.forEach((l, i) => {
      if (l.unit !== unit) {
        unit = l.unit;
        unitNo++;
        SB.append(view, h('div', { class: 'unit-head' }, h('span', { class: 'num' }, unitNo), h('h2', { style: { margin: 0 } }, unit)));
      }
      const solved = l.challenges.filter((c, n) => C.solved(l.id, n)).length;
      const isToday = today && today.id === l.id;
      SB.append(view, h('div', { style: { marginBottom: '8px' } }, SB.listItem(C.isDone(l.id) ? '✅' : l.emoji, 'Day ' + (i + 1) + ' · ' + l.title,
        l.minutes + ' min · ' + solved + '/' + l.challenges.length + ' challenges' + (isToday ? ' · today' : ''),
        () => SB.go('/code/lesson/' + l.id), (C.isDone(l.id) ? 'done' : '') + (isToday ? ' current' : ''))));
    });
  }, { tab: 'code', top: true, title: 'Code' });

  // ------------------------------------------------------------ lesson
  SB.route('/code/lesson/:id', (view, p) => {
    const L = C.byId(p.id);
    if (!L) { SB.replace('/code'); return; }
    const idx = LESSONS.indexOf(L);
    const ls = SB.state.code.lessons[L.id] = SB.state.code.lessons[L.id] || {};
    if (!ls.read) { ls.read = SB.dayKey(); SB.save(); }
    SB.state.code.lastLesson = L.id;
    SB.setTitle('Day ' + (idx + 1) + ' · ' + L.title);
    SB.append(view, 
      h('div', { class: 'small muted' }, L.unit + ' · ' + L.minutes + ' min'),
      h('h1', null, L.emoji + ' ' + L.title),
      renderBlocks(L.body));

    // quiz
    const quizBox = h('div', { class: 'card' });
    SB.append(view, SB.sectionTitle('Check your understanding', ls.quiz !== undefined ? h('span', { class: 'badge ok' }, 'Best ' + ls.quiz + '/' + L.quiz.length) : null), quizBox);
    let qi = 0, score = 0;
    const drawQ = () => {
      quizBox.innerHTML = '';
      if (qi >= L.quiz.length) {
        const first = !ls.done;
        ls.quiz = Math.max(ls.quiz || 0, score);
        if (first) { ls.done = SB.dayKey(); SB.bump('lessons'); }
        SB.save();
        if (first) { SB.addXP(15 + score * 5, 'lesson'); SB.confetti(); }
        SB.append(quizBox, h('div', { class: 'center' },
          h('div', { style: { fontSize: '2.4rem' } }, score === L.quiz.length ? '🏆' : '✅'),
          h('h3', null, score + ' / ' + L.quiz.length + ' correct'),
          h('p', { class: 'muted' }, first ? 'Lesson complete! Now lock it in with the coding challenges below.' : 'Nice review.'),
          h('button', { class: 'btn secondary small', onclick: () => { qi = 0; score = 0; drawQ(); } }, 'Retake quiz')));
        return;
      }
      const q = L.quiz[qi];
      const fb = h('div');
      const opts = q.options.map((o, i) => h('button', { class: 'option', onclick: () => {
        opts.forEach((b, k) => { b.disabled = true; if (k === q.answer) b.classList.add('correct'); });
        const ok = i === q.answer;
        if (ok) { score++; SB.good(); } else { opts[i].classList.add('wrong'); SB.bad(); }
        fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
        SB.append(fb, h('b', null, ok ? 'Correct! ' : 'Not quite. '), q.explain);
        SB.append(quizBox, h('button', { class: 'btn block mt', onclick: () => { qi++; drawQ(); } }, qi + 1 < L.quiz.length ? 'Next question' : 'Finish'));
      } }, h('span', { html: SB.inline(o) })));
      SB.append(quizBox, h('div', { class: 'small muted' }, 'Question ' + (qi + 1) + ' of ' + L.quiz.length), h('div', { class: 'quiz-q', html: SB.inline(q.q) }), h('div', { class: 'options' }, opts), fb);
    };
    drawQ();

    SB.append(view, SB.sectionTitle('Coding challenges'), h('div', { class: 'list' }, L.challenges.map((c, n) =>
      SB.listItem(C.solved(L.id, n) ? '✅' : '🏋️', c.title, c.mode === 'function' ? 'Write a function · auto-graded' : 'Write a program · auto-graded',
        () => SB.go('/code/challenge/' + L.id + '/' + n), C.solved(L.id, n) ? 'done' : ''))));
    const nextL = LESSONS[idx + 1];
    SB.append(view, h('div', { class: 'btn-row mt' },
      idx > 0 ? h('a', { class: 'btn secondary', href: '#/code/lesson/' + LESSONS[idx - 1].id }, '← Previous') : null,
      nextL ? h('a', { class: 'btn secondary', href: '#/code/lesson/' + nextL.id }, 'Next lesson →') : null));
  }, { tab: 'code', title: 'Lesson', parent: '/code' });

  // ------------------------------------------------------------ challenge
  SB.route('/code/challenge/:id/:n', (view, p) => {
    const L = C.byId(p.id);
    const n = Number(p.n);
    const ch = L && L.challenges[n];
    if (!ch) { SB.replace('/code'); return; }
    const key = C.chKey(L.id, n);
    SB.state.code.drafts = SB.state.code.drafts || {};
    const meta = (SB.state.code.chMeta = SB.state.code.chMeta || {})[key] = SB.state.code.chMeta[key] || { hints: 0, peeked: false };
    SB.setTitle(ch.title);
    const usesBoard = /board\.h/.test(ch.starter + ch.solution);
    const editor = SB.Editor({ value: SB.state.code.drafts[key] || ch.starter, onChange: v => { SB.state.code.drafts[key] = v; SB.save(); } });
    const board = usesBoard ? SB.BoardView() : null;
    const results = h('div');
    const hintBox = h('div');
    const firstTest = ch.tests[0];
    const stdinBox = ch.tests.some(t => t.stdin) ? h('input', { type: 'text', value: firstTest.stdin || '', placeholder: 'stdin (input for scanf)' }) : null;

    const showHint = () => {
      if (meta.hints >= ch.hints.length) { SB.toast('No more hints — check the solution if you are stuck'); return; }
      meta.hints++;
      SB.save();
      drawHints();
    };
    const drawHints = () => {
      hintBox.innerHTML = '';
      ch.hints.slice(0, meta.hints).forEach((t, i) => SB.append(hintBox, h('details', { class: 'hint', open: true }, h('summary', null, 'Hint ' + (i + 1)), h('div', { html: SB.inline(t) }))));
    };
    drawHints();

    const run = () => {
      results.innerHTML = '';
      SB.append(results, h('p', { class: 'muted' }, 'Running…'));
      const opts = { harness: ch.mode === 'function' ? (firstTest.harness || ch.harness) : undefined, stdin: stdinBox ? stdinBox.value : firstTest.stdin, input: board ? board.input() : firstTest.input };
      runCode(editor.value, opts, r => {
        results.innerHTML = '';
        editor.mark(r.errors.concat(r.runtimeError ? [r.runtimeError] : []), r.warnings);
        if (ch.mode === 'function') SB.append(results, h('p', { class: 'small muted' }, 'Ran your function with the first test\'s main(). Press Check to run all tests.'));
        SB.append(results, SB.renderRun(r, { onLine: l => editor.gotoLine(l) }));
        if (board) board.show(r);
      });
    };

    const check = () => {
      results.innerHTML = '';
      SB.append(results, h('p', { class: 'muted' }, 'Running ' + ch.tests.length + ' test(s)…'));
      setTimeout(() => {
        const g = MiniC.grade(editor.value, ch);
        results.innerHTML = '';
        const firstRun = g.results.find(r => r.run) || {};
        if (firstRun.run) editor.mark(firstRun.run.errors.concat(firstRun.run.runtimeError ? [firstRun.run.runtimeError] : []), firstRun.run.warnings);
        const card = h('div', { class: 'card' },
          h('h3', null, g.passed === g.total ? '🎉 All ' + g.total + ' tests passed!' : g.passed + ' / ' + g.total + ' tests passed'),
          g.results.map(r => h('div', { class: 'test-row' },
            h('span', { class: 'ti' }, r.pass ? '✅' : '❌'),
            h('div', { class: 'grow' }, h('b', null, r.name), r.msg ? h('pre', null, r.msg) : null))));
        SB.append(results, card);
        const warnings = firstRun.run ? firstRun.run.warnings : [];
        if (warnings.length) SB.append(results, h('div', { class: 'console' }, warnings.map(w => h('div', { class: 'wrn' }, '⚠ Line ' + w.line + ': warning: ' + w.msg))));
        if (board && firstRun.run && firstRun.run.compiled) board.show(firstRun.run);
        if (g.passed === g.total) {
          SB.confetti();
          SB.sfx('level');
          if (!C.solved(L.id, n)) {
            SB.state.code.challenges[key] = { date: SB.dayKey(), hints: meta.hints, peeked: meta.peeked };
            SB.bump('challenges');
            SB.save();
            const xp = meta.peeked ? 10 : meta.hints ? 30 : 40;
            SB.addXP(xp, 'challenge solved');
          }
          const nextN = n + 1 < L.challenges.length ? '/code/challenge/' + L.id + '/' + (n + 1) : '/code/lesson/' + L.id;
          SB.append(card, h('div', { class: 'btn-row mt' }, h('a', { class: 'btn', href: '#' + nextN }, n + 1 < L.challenges.length ? 'Next challenge →' : 'Back to lesson')));
        } else {
          SB.bad();
        }
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 30);
    };

    SB.append(view, 
      h('div', { class: 'small muted' }, 'Day ' + (LESSONS.indexOf(L) + 1) + ' · ' + L.title + (C.solved(L.id, n) ? ' · ✅ solved' : '')),
      h('h2', null, ch.title),
      h('div', { class: 'card' }, paragraphs(ch.prompt)),
      editor.el,
      stdinBox ? h('div', { class: 'mt' }, h('label', { class: 'field' }, h('span', null, 'Input for Run (stdin)'), stdinBox)) : null,
      h('div', { class: 'btn-row mt' },
        h('button', { class: 'btn secondary', onclick: run }, '▶ Run'),
        h('button', { class: 'btn success', onclick: check }, '✓ Check')),
      h('div', { class: 'btn-row mt' },
        h('button', { class: 'btn ghost small', onclick: showHint }, '💡 Hint'),
        h('button', { class: 'btn ghost small', onclick: async () => {
          if (await SB.confirm('Reset code?', 'Your changes will be replaced with the starter code.', 'Reset')) {
            editor.value = ch.starter; SB.state.code.drafts[key] = ch.starter; SB.save(); editor.mark([], []);
          }
        } }, '↺ Reset'),
        h('button', { class: 'btn ghost small', onclick: async () => {
          if (!C.solved(L.id, n) && !meta.peeked && !(await SB.confirm('Show the solution?', 'Struggling is how learning happens — try a hint first! If you view the solution now, this challenge gives less XP.', 'Show solution'))) return;
          meta.peeked = !C.solved(L.id, n) || meta.peeked;
          SB.save();
          SB.modal(close => [h('h2', null, 'Reference solution'), h('pre', { class: 'code', html: SB.highlightC(ch.solution) }),
            h('p', { class: 'small muted' }, 'Read it, close it, then type it from memory — that is how it sticks.'),
            h('button', { class: 'btn block', onclick: close }, 'Close')]);
        } }, '👀 Solution')),
      hintBox,
      board ? h('div', { class: 'mt' }, board.el) : null,
      h('div', { class: 'mt' }, results));
  }, { tab: 'code', title: 'Challenge', parent: '/code' });

  // ------------------------------------------------------------ playground
  const EXAMPLES = [
    ['Hello, world', String.raw`#include <stdio.h>

int main(void)
{
    printf("Hello from a simulated ARM Cortex-M!\n");
    for (int i = 1; i <= 5; i++) {
        printf("%d squared is %d\n", i, i * i);
    }
    return 0;
}`],
    ['Blink an LED', String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;   // clock for port A
    GPIOA->MODER |= (1U << (5 * 2));       // PA5 = output
    while (1) {
        GPIOA->ODR ^= (1U << 5);           // toggle
        delay_ms(300);
    }
}`],
    ['Knight Rider LEDs', String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER = (GPIOA->MODER & ~0xFFFFU) | 0x5555U;   // PA0..PA7 outputs
    int pos = 0, dir = 1;
    while (1) {
        GPIOA->ODR = 1U << pos;
        delay_ms(80);
        pos += dir;
        if (pos == 7 || pos == 0) dir = -dir;
    }
}`],
    ['Button → LED', String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN | RCC_AHB1ENR_GPIOCEN;
    GPIOA->MODER |= 1U;                       // PA0 output
    while (1) {
        int pressed = (GPIOC->IDR >> 13) & 1U;   // PC13: 1 while pressed
        GPIOA->ODR = pressed ? 1U : 0U;
        delay_ms(5);
    }
}
// Tip: choose a button preset below the board before running.`],
    ['UART hello', String.raw`#include "board.h"

void uart_putc(char c)
{
    while (!(USART2->SR & USART_SR_TXE)) { }
    USART2->DR = (uint8_t)c;
}

int main(void)
{
    RCC->APB1ENR |= RCC_APB1ENR_USART2EN;
    USART2->BRR = SystemCoreClock / 115200;
    USART2->CR1 = USART_CR1_UE | USART_CR1_TE;
    const char *msg = "Hello over UART!\r\n";
    for (int i = 0; i < 3; i++) {
        for (const char *p = msg; *p; p++) uart_putc(*p);
        delay_ms(500);
    }
    return 0;
}`],
    ['SysTick interrupt', String.raw`#include "board.h"

volatile uint32_t ticks = 0;

void SysTick_Handler(void) { ticks++; }

int main(void)
{
    SysTick_Config(SystemCoreClock / 1000);    // 1 ms
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= 0x5555U;
    while (1) {
        GPIOA->ODR = (ticks / 100) & 0xFF;      // binary counter, 10 Hz
        __WFI();
    }
}`],
    ['ADC voltmeter', String.raw`#include "board.h"

uint16_t adc_read(void)
{
    ADC1->CR2 |= ADC_CR2_SWSTART;
    while (!(ADC1->SR & ADC_SR_EOC)) { }
    return (uint16_t)ADC1->DR;
}

int main(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;
    ADC1->CR2 |= ADC_CR2_ADON;
    uint16_t raw = adc_read();
    printf("raw = %u -> %u mV\n", raw, raw * 3300u / 4095u);
    return 0;
}
// Move the Pot slider below the board, then run again.`],
    ['Pointer explorer', String.raw`#include <stdio.h>
#include <stdint.h>

int main(void)
{
    int a[4] = {10, 20, 30, 40};
    int *p = a;
    for (int i = 0; i < 4; i++, p++) {
        printf("p = %p  *p = %d\n", (void *)p, *p);
    }
    uint32_t word = 0xCAFEBABE;
    uint8_t *b = (uint8_t *)&word;
    printf("bytes in memory: %02X %02X %02X %02X (little-endian)\n", b[0], b[1], b[2], b[3]);
    return 0;
}`],
    ['Struct padding', String.raw`#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

typedef struct {
    uint8_t  a;
    uint32_t b;
    uint16_t c;
} S;

int main(void)
{
    printf("sizeof(S) = %zu\n", sizeof(S));
    printf("offset a=%zu b=%zu c=%zu\n", offsetof(S, a), offsetof(S, b), offsetof(S, c));
    return 0;
}`],
    ['Bits printer', String.raw`#include <stdio.h>
#include <stdint.h>

void print_bin(uint8_t v)
{
    for (int i = 7; i >= 0; i--) putchar((v >> i) & 1 ? '1' : '0');
    putchar('\n');
}

int main(void)
{
    uint8_t reg = 0;
    reg |= (1U << 3);     print_bin(reg);
    reg |= (1U << 6);     print_bin(reg);
    reg ^= 0xFF;          print_bin(reg);
    reg &= ~(1U << 0);    print_bin(reg);
    return 0;
}`],
  ];

  SB.route('/code/playground', view => {
    const editor = SB.Editor({ value: SB.state.code.playground || EXAMPLES[0][1], onChange: v => { SB.state.code.playground = v; SB.save(); } });
    const board = SB.BoardView();
    const out = h('div');
    const stdin = h('input', { type: 'text', placeholder: 'stdin (optional input for scanf/getchar)' });
    const sel = h('select', { onchange: async ev => {
      const ex = EXAMPLES[Number(ev.target.value)];
      ev.target.value = '';
      if (!ex) return;
      const untouched = !editor.value.trim() || EXAMPLES.some(e => e[1] === editor.value);
      if (!untouched && !(await SB.confirm('Load example?', 'This replaces the code in the editor.', 'Load'))) return;
      editor.value = ex[1];
      SB.state.code.playground = ex[1];
      SB.save();
      editor.mark([], []);
    } }, h('option', { value: '' }, '📂 Load an example…'), EXAMPLES.map((e, i) => h('option', { value: String(i) }, e[0])));
    const run = () => {
      out.innerHTML = '';
      SB.append(out, h('p', { class: 'muted' }, 'Compiling & running…'));
      runCode(editor.value, { stdin: stdin.value, input: board.input() }, r => {
        out.innerHTML = '';
        editor.mark(r.errors.concat(r.runtimeError ? [r.runtimeError] : []), r.warnings);
        SB.append(out, SB.renderRun(r, { onLine: l => editor.gotoLine(l) }));
        board.show(r);
        if (r.compiled) SB.append(out, h('p', { class: 'tiny faint mt' }, 'RAM: ' + r.globalsSize + ' B globals · ' + r.stackUsed + ' B stack peak · heap peak ' + r.heap.peak + ' B'));
      });
    };
    SB.append(view, 
      h('div', { class: 'row mb' }, sel),
      editor.el,
      h('div', { class: 'mt' }, stdin),
      h('div', { class: 'btn-row mt' }, h('button', { class: 'btn', onclick: run }, '▶ Run'),
        h('a', { class: 'btn secondary', href: '#/code/reference' }, '📘 Reference')),
      h('div', { class: 'mt' }, out),
      h('div', { class: 'mt' }, board.el));
  }, { tab: 'code', title: 'Playground', parent: '/code' });

  // ------------------------------------------------------------ reference
  SB.route('/code/reference', view => {
    SB.append(view, renderBlocks([
      ['h', 'The virtual board'],
      ['p', 'An STM32F4-style ARM Cortex-M4 at **16 MHz** with 256 KB Flash and 128 KB SRAM. `#include "board.h"` for CMSIS-style register structs like `GPIOA->ODR`.'],
      ['table', [['Part', 'Connection', 'Notes'], ['8 LEDs', 'PA0 – PA7', 'lit when the pin is an output (MODER = 01) and ODR bit = 1'], ['User button', 'PC13', 'reads 1 while pressed; EXTI line 13 → EXTI15_10_IRQHandler'], ['Potentiometer', 'ADC1', '0 – 4095 (12-bit), optional noise'], ['UART terminal', 'USART2 TX', 'needs RCC APB1ENR bit 17, CR1 UE + TE'], ['Timer', 'TIM2', 'PSC/ARR/CNT, update interrupt → TIM2_IRQHandler'], ['SysTick', 'core', 'SysTick_Config(ticks) → SysTick_Handler']]],
      ['h', 'Memory map'],
      ['table', [['Address', 'Region'], ['0x0800 0000', 'Flash (code, string literals, const data) — read-only'], ['0x2000 0000', 'SRAM: .data/.bss, heap (32 KB), stack (32 KB, top at 0x20020000)'], ['0x4000 0000', 'TIM2'], ['0x4000 4400', 'USART2'], ['0x4001 1000', 'USART1'], ['0x4001 2000', 'ADC1'], ['0x4001 3C00', 'EXTI'], ['0x4002 0000', 'GPIOA (GPIOB +0x400, GPIOC +0x800)'], ['0x4002 3800', 'RCC (AHB1ENR +0x30, APB1ENR +0x40, APB2ENR +0x44)'], ['0xE000 E010', 'SysTick'], ['0xE000 E100', 'NVIC ISER']]],
      ['h', 'Clock enable bits'],
      ['table', [['Peripheral', 'Register', 'Macro'], ['GPIOA / B / C', 'RCC->AHB1ENR bit 0 / 1 / 2', 'RCC_AHB1ENR_GPIOAEN …'], ['TIM2', 'RCC->APB1ENR bit 0', 'RCC_APB1ENR_TIM2EN'], ['USART2', 'RCC->APB1ENR bit 17', 'RCC_APB1ENR_USART2EN'], ['USART1', 'RCC->APB2ENR bit 4', 'RCC_APB2ENR_USART1EN'], ['ADC1', 'RCC->APB2ENR bit 8', 'RCC_APB2ENR_ADC1EN']]],
      ['h', 'Built-in helper functions'],
      ['table', [['Function', 'What it does'], ['delay_ms(n) / delay_us(n)', 'wait (interrupts still run)'], ['millis() / micros()', 'time since reset'], ['SysTick_Config(ticks)', 'start SysTick with an interrupt every `ticks` cycles'], ['NVIC_EnableIRQ(irq)', 'enable an interrupt: EXTI15_10_IRQn, TIM2_IRQn'], ['__enable_irq() / __disable_irq()', 'global interrupt enable/disable (critical sections)'], ['__WFI()', 'sleep until the next interrupt'], ['printf, puts, putchar', 'console output (like semihosting / a retargeted UART)'], ['malloc, free, string.h, math.h, ctype.h, stdlib.h', 'the usual C library']]],
      ['h', 'Simulator model'],
      ['ul', ['`int`, `long` and pointers are 4 bytes; `long long` is 8; `char` is signed.', 'Little-endian, natural alignment, ARM-style struct layout.', 'Uninitialized locals and fresh heap memory contain garbage, just like real hardware.', 'Each C statement takes about 1 µs of virtual time; `delay_ms` advances time exactly.', 'Writes to Flash, NULL dereferences and wild pointers trigger a HardFault with an explanation.']],
      ['h', 'C quick reference'],
      ['table', [['Idiom', 'Code'], ['Set / clear / toggle bit n', 'r |= (1U << n);   r &= ~(1U << n);   r ^= (1U << n);'], ['Test bit n', 'if (r & (1U << n))'], ['Array length', 'sizeof(a) / sizeof(a[0])'], ['Register access', '*(volatile uint32_t *)0x40020014 = 1;'], ['Elapsed time', 'if ((uint32_t)(millis() - start) >= period)'], ['Function pointer', 'void (*cb)(int) = handler; cb(5);']]],
    ]));
  }, { tab: 'code', title: 'Board reference', parent: '/code' });
})();
