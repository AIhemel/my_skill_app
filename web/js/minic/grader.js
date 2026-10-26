/*
 * MiniC part 4: grades a challenge solution against its tests.
 * Shared by the app and by tests/lessons.test.js.
 */
(function (MC) {
  'use strict';

  const norm = s => String(s).replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');

  // Returns { passed, total, results: [{ name, pass, msg, run }] }
  MC.grade = function (code, challenge, opts) {
    opts = opts || {};
    const results = [];
    for (const t of challenge.tests) {
      const harness = t.harness || challenge.harness || '';
      if (challenge.mode === 'function' && /\bint\s+main\s*\(/.test(code) && /\bmain\s*\(/.test(harness)) {
        results.push({ name: t.name, pass: false, msg: 'This challenge provides main() for you — delete your main() and keep only the function.' });
        continue;
      }
      const run = MC.run(code, {
        harness,
        stdin: t.stdin || '',
        input: t.input,
        maxSteps: t.maxSteps || opts.maxSteps || 6000000,
        maxTimeMs: t.maxTimeMs || 5000,
        seed: t.seed,
      });
      run.src = code;
      let pass = true, msg = '';
      if (run.errors.length) {
        pass = false;
        const e = run.errors[0];
        msg = (e.line >= MC.HARNESS_LINE ? 'Error in the test code (does your function have the right name and parameters?): ' : (e.line ? 'Line ' + e.line + ': ' : '')) + e.msg;
      } else if (run.runtimeError) {
        pass = false;
        const e = run.runtimeError;
        msg = (e.line && e.line < MC.HARNESS_LINE ? 'Line ' + e.line + ': ' : '') + e.msg;
      } else {
        if (run.status === 'timeout' && !t.allowTimeout) { pass = false; msg = run.message; }
        if (pass && t.expect !== undefined && norm(run.stdout) !== norm(t.expect)) {
          pass = false;
          msg = 'Expected output:\n' + norm(t.expect) + '\n\nYour output:\n' + (norm(run.stdout) || '(nothing)');
        }
        if (pass && t.contains) {
          for (const c of t.contains) {
            if (!run.stdout.includes(c)) { pass = false; msg = 'Output should contain: ' + JSON.stringify(c); break; }
          }
        }
        if (pass && t.check) {
          let r;
          try { r = t.check(run); } catch (e) { r = 'Check failed: ' + e.message; }
          if (r !== true) { pass = false; msg = typeof r === 'string' ? r : 'Not quite right yet.'; }
        }
      }
      results.push({ name: t.name, pass, msg, run });
    }
    return { passed: results.filter(r => r.pass).length, total: results.length, results };
  };

  // Helper for board checks: LED state (bitmask) at time t (ms).
  MC.ledsAt = function (run, ms) {
    let v = 0;
    for (const e of run.board.ledTimeline) {
      if (e.t <= ms * 1000) v = e.v; else break;
    }
    return v;
  };
  // Times (ms) at which a given LED bit changed state.
  MC.ledEdges = function (run, bit) {
    const out = [];
    let prev = 0;
    for (const e of run.board.ledTimeline) {
      const b = (e.v >> bit) & 1;
      if (b !== prev) { out.push({ t: e.t / 1000, on: !!b }); prev = b; }
    }
    return out;
  };
})(typeof window !== 'undefined' ? (window.MiniC = window.MiniC || {}) : (global.MiniC = global.MiniC || {}));
