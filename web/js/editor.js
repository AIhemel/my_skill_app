/* A small code editor: highlighted overlay, line numbers, auto-indent and a
   symbol bar for characters that are hard to type on a phone keyboard. */
(function () {
  'use strict';
  const { h } = SB;

  const SYMBOLS = [
    ['⇥', '    '], ['{', '{'], ['}', '}'], ['(', '()', 1], [')', ')'], ['[', '[]', 1], [']', ']'], [';', ';'],
    ['*', '*'], ['&', '&'], ['->', '->'], ['=', '='], ['==', '=='], ['<', '<'], ['>', '>'], ['|', '|'], ['^', '^'],
    ['~', '~'], ['<<', '<<'], ['>>', '>>'], ['!', '!'], ['%', '%'], ['#', '#'], ['"', '""', 1], ["'", "''", 1],
    ['\\n', '\\n'], ['_', '_'], ['0x', '0x'], ['◀', null, 'left'], ['▶', null, 'right'],
  ];

  SB.Editor = function (opts) {
    opts = opts || {};
    const ta = h('textarea', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', wrap: 'off', 'aria-label': 'Code editor' });
    const pre = h('pre', { 'aria-hidden': 'true' });
    const gutter = h('div', { class: 'gutter', 'aria-hidden': 'true' });
    const scroll = h('div', { class: 'ed-scroll' }, h('div', { class: 'ed-inner' }, gutter, h('div', { class: 'ed-code' }, pre, ta)));
    const symbar = h('div', { class: 'symbar' });
    const el = h('div', { class: 'editor' }, scroll, symbar);
    let marks = { err: new Set(), wrn: new Set() };
    let changeTimer = null;

    const refresh = () => {
      const v = ta.value;
      pre.innerHTML = SB.highlightC(v) + '\n';
      const lines = v.split('\n').length;
      let g = '';
      for (let i = 1; i <= lines; i++) {
        const cls = marks.err.has(i) ? 'err' : marks.wrn.has(i) ? 'wrn' : '';
        g += cls ? '<span class="' + cls + '">' + i + '</span>\n' : i + '\n';
      }
      gutter.innerHTML = g;
    };
    const changed = () => {
      refresh();
      if (opts.onChange) {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => opts.onChange(ta.value), 400);
      }
    };

    const insert = (text, cursorBack) => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.setRangeText(text, s, e, 'end');
      if (cursorBack) { const p = ta.selectionStart - cursorBack; ta.setSelectionRange(p, p); }
      changed();
    };

    ta.addEventListener('input', changed);
    ta.addEventListener('keydown', ev => {
      if (ev.key === 'Tab') { ev.preventDefault(); insert('    '); return; }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const v = ta.value, s = ta.selectionStart;
        const lineStart = v.lastIndexOf('\n', s - 1) + 1;
        const line = v.slice(lineStart, s);
        let indent = (/^[ \t]*/.exec(line) || [''])[0];
        if (/\{\s*$/.test(line)) indent += '    ';
        insert('\n' + indent);
        return;
      }
      if (ev.key === '}') {
        const v = ta.value, s = ta.selectionStart;
        const lineStart = v.lastIndexOf('\n', s - 1) + 1;
        const before = v.slice(lineStart, s);
        if (/^ {4,}$/.test(before) && ta.selectionStart === ta.selectionEnd) {
          ev.preventDefault();
          ta.setRangeText('}', s - 4, s, 'end');
          changed();
        }
      }
    });

    SYMBOLS.forEach(([label, text, extra]) => {
      const b = h('button', { type: 'button', 'aria-label': label }, label);
      b.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        if (extra === 'left' || extra === 'right') {
          const p = Math.max(0, Math.min(ta.value.length, ta.selectionStart + (extra === 'left' ? -1 : 1)));
          ta.setSelectionRange(p, p);
          ta.focus();
          return;
        }
        ta.focus();
        insert(text, typeof extra === 'number' ? extra : 0);
      });
      symbar.appendChild(b);
    });

    const api = {
      el,
      get value() { return ta.value; },
      set value(v) { ta.value = v; refresh(); },
      focus() { ta.focus(); },
      mark(errors, warnings) {
        marks = { err: new Set((errors || []).map(e => e.line)), wrn: new Set((warnings || []).map(w => w.line)) };
        refresh();
      },
      gotoLine(n) {
        const lines = ta.value.split('\n');
        let pos = 0;
        for (let i = 0; i < Math.min(n - 1, lines.length); i++) pos += lines[i].length + 1;
        ta.focus();
        ta.setSelectionRange(pos, pos + (lines[n - 1] || '').length);
        scroll.scrollTop = Math.max(0, (n - 4) * 21.6);
      },
    };
    api.value = opts.value || '';
    return api;
  };

  // Formats a MiniC.run() result for a console element.
  SB.renderRun = function (run, opts) {
    opts = opts || {};
    const out = h('div', { class: 'console' });
    const line = (cls, text, lineNo) => {
      const span = h('div', { class: cls }, text);
      if (lineNo && opts.onLine) { span.style.cursor = 'pointer'; span.onclick = () => opts.onLine(lineNo); }
      out.appendChild(span);
    };
    const where = l => (l && l < MiniC.HARNESS_LINE ? 'Line ' + l + ': ' : '');
    run.errors.forEach(e => line('err', '✗ ' + where(e.line) + e.msg, e.line));
    if (!run.compiled) {
      line('info', '\nCompilation failed — fix the first error and run again. Tap an error to jump to its line.');
      return out;
    }
    run.warnings.forEach(w => line('wrn', '⚠ ' + where(w.line) + 'warning: ' + w.msg, w.line));
    if (run.warnings.length) line('info', '');
    if (run.stdout) out.appendChild(document.createTextNode(run.stdout.length > 20000 ? run.stdout.slice(0, 20000) + '\n…(output truncated)' : run.stdout));
    if (run.runtimeError) line('err', (run.stdout && !run.stdout.endsWith('\n') ? '\n' : '') + '💥 ' + where(run.runtimeError.line) + run.runtimeError.msg, run.runtimeError.line);
    const secs = (run.timeMs / 1000).toFixed(3);
    if (run.status === 'ok') line('ok', (run.stdout && !run.stdout.endsWith('\n') ? '\n' : '') + '✓ Exited with code ' + run.exitCode + ' · ' + secs + ' s simulated · ' + run.steps.toLocaleString('en-US') + ' steps');
    else if (run.status === 'timeout') line('info', '\n⏱ ' + run.message);
    if (run.heap && run.heap.blocks > 0) line('wrn', '⚠ ' + run.heap.blocks + ' heap block(s) (' + run.heap.inUse + ' bytes) never freed — memory leak?');
    if (!run.stdout && !run.errors.length && !run.runtimeError && run.status === 'ok' && !(run.board && run.board.used)) line('info', '(no output)');
    return out;
  };
})();
