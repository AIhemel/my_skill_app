// Validates every lesson: runnable examples compile, quizzes are well-formed,
// every reference solution passes its tests and every starter fails them.
// Run: node tests/lessons.test.js
global.window = global;
const MC = require('./load-minic.js');
require('../web/js/minic/grader.js');
const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, '../web/js/data');
fs.readdirSync(dataDir).filter(f => /^lessons-\d+\.js$/.test(f)).sort().forEach(f => require(path.join(dataDir, f)));
const LESSONS = global.LESSONS;

let fails = 0, checks = 0;
const fail = (where, msg) => { fails++; console.log('FAIL', where + ':', msg); };
const ids = new Set();

for (const L of LESSONS) {
  if (ids.has(L.id)) fail(L.id, 'duplicate id');
  ids.add(L.id);
  for (const k of ['id', 'unit', 'title', 'emoji', 'body', 'quiz', 'challenges']) if (!L[k]) fail(L.id, 'missing ' + k);
  L.body.forEach((b, i) => {
    if (!['p', 'h', 'code', 'ul', 'ol', 'note', 'warn', 'tip', 'pre', 'table'].includes(b[0])) fail(L.id, 'bad block type ' + b[0]);
    if (b[0] === 'code' && b[2]) {
      checks++;
      const r = MC.run(b[1], { maxTimeMs: 3000, maxSteps: 3000000 });
      if (r.errors.length) fail(L.id + ' example ' + i, r.errors.map(e => e.line + ': ' + e.msg).join('; ') + '\n' + b[1]);
      if (process.env.SHOW) console.log('---', L.id, i, '\n' + r.stdout + (r.runtimeError ? 'RUNTIME: ' + r.runtimeError.msg : '') + (r.warnings.length ? '\nWARN: ' + r.warnings.map(w => w.line + ' ' + w.msg).join(' | ') : ''));
    }
  });
  L.quiz.forEach((q, i) => {
    checks++;
    if (!(q.answer >= 0 && q.answer < q.options.length)) fail(L.id + ' quiz ' + i, 'answer out of range');
    if (!q.explain) fail(L.id + ' quiz ' + i, 'missing explanation');
  });
  L.challenges.forEach((c, i) => {
    const where = L.id + ' challenge ' + i + ' (' + c.title + ')';
    checks++;
    const sol = MC.grade(c.solution, c);
    if (sol.passed !== sol.total) {
      sol.results.filter(r => !r.pass).forEach(r => fail(where, 'solution fails "' + r.name + '": ' + r.msg + (r.run ? '\n   stdout: ' + JSON.stringify(r.run.stdout) : '')));
    }
    if (sol.results.some(r => r.run && r.run.warnings.length)) {
      sol.results.forEach(r => r.run && r.run.warnings.forEach(w => console.log('  warn', where, 'solution line', w.line, w.msg)));
    }
    const st = MC.grade(c.starter, c);
    if (st.passed === st.total) fail(where, 'starter already passes all tests');
    if (c.mode === 'function' && !c.starterIncomplete) {
      const compileErr = st.results.find(r => r.run && r.run.errors.length);
      if (compileErr) fail(where, 'starter does not compile with harness: ' + compileErr.msg);
    }
    if (!c.hints || !c.hints.length) fail(where, 'no hints');
  });
}
console.log(`${LESSONS.length} lessons, ${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
