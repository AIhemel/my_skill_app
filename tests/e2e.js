// End-to-end smoke test: loads the app from file:// (like the Android WebView)
// at phone size, visits every screen, exercises key flows, and fails on any JS error.
// Run: node tests/e2e.js [screenshotDir]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const shotDir = process.argv[2] || null;
const url = 'file://' + path.resolve(__dirname, '../web/index.html');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const shot = async name => { if (shotDir) await page.screenshot({ path: path.join(shotDir, name + '.png') }); };
  // Close celebration popups (level-up etc.), like a user tapping "Awesome".
  const dismiss = () => page.evaluate(() => { while (SB.closeTopModal()) { /* close all */ } });
  // Click, retrying if a popup appeared in the way.
  const tap = async (target) => {
    for (let i = 0; i < 6; i++) {
      await dismiss();
      try {
        if (typeof target === 'string') await page.click(target, { timeout: 1500 });
        else await target.click({ timeout: 1500 });
        return;
      } catch (e) { if (i === 5) throw e; }
    }
  };
  const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(250); };
  const step = (name, fn) => fn().then(() => console.log('ok  ', name)).catch(e => { errors.push(name + ': ' + e.message); console.log('FAIL', name, e.message); });

  await page.goto(url);
  await page.waitForTimeout(600);
  await shot('00-onboarding');
  await step('onboarding', async () => {
    await page.fill('.sheet input[type=text]', 'Asraf');
    await page.click('.sheet .btn.block');
    await page.waitForTimeout(400);
    const title = await page.textContent('.greeting');
    if (!/Asraf/.test(title)) throw new Error('greeting missing name: ' + title);
  });
  await shot('01-today');

  await step('words hub', async () => { await go('#/words'); await shot('02-words'); });
  await step('learn words', async () => {
    await go('#/words/learn');
    await shot('03-learn');
    for (let i = 0; i < 10; i++) {
      await dismiss();
      const btn = await page.$('button.btn:not(.secondary):has-text("Got it")');
      if (!btn) break;
      await tap(btn);
      await page.waitForTimeout(80);
    }
    // quick check quiz
    for (let i = 0; i < 10; i++) {
      await dismiss();
      const opt = await page.$('.option:not([disabled])');
      if (!opt) break;
      await tap(opt);
      await page.waitForTimeout(60);
      const next = await page.$('button.btn.block:not(.hidden):has-text("Next"), button.btn.block:not(.hidden):has-text("Finish")');
      if (next) await tap(next);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(300);
    await shot('04-learn-done');
    const learned = await page.evaluate(() => Object.keys(SB.state.vocab.cards).length);
    if (learned < 10) throw new Error('only ' + learned + ' words learned');
  });
  await step('quiz mix', async () => {
    await go('#/words/quiz/mix');
    await page.click('.option');
    await page.waitForTimeout(100);
    await shot('05-quiz');
  });
  await step('quiz se (words)', async () => {
    await go('#/words/quiz/se');
    const opts = await page.$$('.option');
    await opts[0].click(); await opts[1].click();
    await page.click('button:has-text("Check")');
    await page.waitForTimeout(100);
    await shot('06-se');
  });
  await step('games', async () => {
    await go('#/words/game/scramble'); await shot('07-scramble');
    await go('#/words/game/match'); await shot('08-match');
    await go('#/words/game/speed'); await page.waitForTimeout(300); await shot('09-speed');
    await go('#/words/list'); await page.fill('input[type=search]', 'cogent'); await page.waitForTimeout(100); await shot('10-list');
  });
  await step('review (none due today)', async () => { await go('#/words/review'); });

  await step('code hub', async () => { await go('#/code'); await shot('11-code'); });
  await step('lesson + inline run', async () => {
    await go('#/code/lesson/gpio');
    await page.click('.lesson-body button:has-text("Run")');
    await page.waitForTimeout(1500);
    const leds = await page.$$('.lesson-body .led.on, .lesson-body .led');
    if (!leds.length) throw new Error('no board shown');
    await shot('12-lesson-gpio');
  });
  await step('lesson quiz completes lesson', async () => {
    await go('#/code/lesson/hello');
    for (let i = 0; i < 4; i++) {
      await page.click('.quiz-q + .options .option');
      await page.click('button:has-text("Next question"), button:has-text("Finish")');
      await page.waitForTimeout(80);
    }
    const done = await page.evaluate(() => SB.code.isDone('hello'));
    if (!done) throw new Error('lesson not marked done');
  });
  await step('challenge solve', async () => {
    await go('#/code/challenge/hello/0');
    await page.evaluate(() => {
      const ta = document.querySelector('.editor textarea');
      ta.value = window.LESSONS[0].challenges[0].solution;
      ta.dispatchEvent(new Event('input'));
    });
    await page.click('button:has-text("Check")');
    await page.waitForTimeout(800);
    const txt = await page.textContent('#view');
    if (!/All 1 tests passed/.test(txt)) throw new Error('challenge not passed');
    await shot('13-challenge-passed');
  });
  await step('board challenge with wrong code shows notes', async () => {
    await go('#/code/challenge/gpio/0');
    await page.click('button:has-text("Check")');
    await page.waitForTimeout(800);
    await shot('14-challenge-failed');
  });
  await step('playground blink', async () => {
    await go('#/code/playground');
    await page.waitForTimeout(1000);
    await dismiss();
    await page.selectOption('select', '1');
    await page.waitForTimeout(100);
    await page.click('button:has-text("▶ Run")');
    await page.waitForTimeout(2500);
    const on = await page.$$('.board .led.on');
    await shot('15-playground');
    const txt = await page.textContent('.console');
    if (!/Simulation stopped/.test(txt)) throw new Error('unexpected console: ' + txt.slice(0, 200));
  });
  await step('playground compile error', async () => {
    await page.evaluate(() => {
      const ta = document.querySelector('.editor textarea');
      ta.value = '#include <stdio.h>\nint main(void) {\n  int x = 5\n  printf("%d", x);\n}\n';
      ta.dispatchEvent(new Event('input'));
    });
    await page.click('button:has-text("▶ Run")');
    await page.waitForTimeout(500);
    const txt = await page.textContent('.console');
    if (!/Line 3: expected ';'/.test(txt)) throw new Error('no line-3 error: ' + txt);
    await shot('16-compile-error');
  });
  await step('reference', async () => { await go('#/code/reference'); await shot('17-reference'); });

  await step('verbal hub', async () => { await go('#/verbal'); await shot('18-verbal'); });
  await step('reading passage', async () => {
    await go('#/verbal/read/difficulties');
    await shot('19-reading');
    for (let i = 0; i < 4; i++) {
      await page.click('.options .option');
      await page.click('button:has-text("Next question"), button:has-text("See results")');
      await page.waitForTimeout(60);
    }
    await shot('20-reading-done');
  });
  await step('text completion', async () => {
    await go('#/verbal/tc');
    await page.waitForTimeout(1000);
    await dismiss();
    const groups = await page.$$('.options');
    for (const g of groups) { const o = await g.$('.option'); await o.click(); }
    await page.click('button:has-text("Check")');
    await page.waitForTimeout(100);
    await shot('21-tc');
  });
  await step('sentence equivalence', async () => { await go('#/verbal/se'); await shot('22-se'); });
  await step('ielts', async () => {
    await go('#/ielts/speaking'); await shot('23-speaking');
    await go('#/ielts/part1');
    await go('#/ielts/writing');
    await go('#/ielts/writing/0'); await page.fill('textarea', 'Word '.repeat(60)); await shot('24-writing');
    await page.click('button:has-text("Save essay")');
    await page.waitForTimeout(200);
    await go('#/ielts/language');
  });

  await step('calm', async () => {
    await go('#/calm'); await shot('25-calm');
    await page.click('.mood-row button:nth-child(4)');
    await page.waitForTimeout(200);
    await go('#/calm/breathe'); await page.click('button:has-text("Begin")'); await page.waitForTimeout(1500); await shot('26-breathe');
    await go('#/calm/ground'); await shot('27-ground');
    await go('#/calm/wins'); await page.fill('input[type=text]', 'Built my first LED blinker'); await page.click('button:has-text("Add")'); await shot('28-wins');
    await go('#/calm/focus'); await shot('29-focus');
  });
  await step('profile', async () => { await go('#/profile'); await shot('30-profile'); });
  await step('today after activity', async () => { await go('#/today'); await page.waitForTimeout(300); await shot('31-today-after'); });
  await step('light theme', async () => {
    await page.evaluate(() => { SB.state.settings.theme = 'light'; SB.applyTheme(); });
    await go('#/code'); await shot('32-light-code');
    await go('#/today'); await shot('33-light-today');
  });
  await step('back button handler', async () => {
    await go('#/words/list');
    const handled = await page.evaluate(() => SB.back());
    if (handled !== true) throw new Error('back not handled');
    await go('#/today');
    const exit = await page.evaluate(() => SB.back());
    if (exit !== false) throw new Error('back on today should exit');
  });
  await step('state persisted', async () => {
    await page.reload();
    await page.waitForTimeout(500);
    const xp = await page.evaluate(() => SB.state.xp);
    if (!(xp > 50)) throw new Error('xp not persisted: ' + xp);
  });

  // Native bridge paths, with a fake AndroidBridge like the one MainActivity injects.
  await step('android bridge', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx2.addInitScript(() => {
      const calls = (window.__calls = []);
      const prefs = { state: localStorage.getItem('__native') || '' };
      window.AndroidBridge = {
        isNative: () => true, canSpeak: () => true,
        speak: t => calls.push('speak:' + t), vibrate: ms => calls.push('vibrate'),
        share: (t, x) => calls.push('share'), setSystemBars: (c, l) => calls.push('bars:' + c + ':' + l),
        setReminder: (on, hh, mm) => calls.push('reminder:' + on + ':' + hh + ':' + mm),
        getReminder: () => '{"on":false,"hour":20,"minute":0}', testReminder: () => calls.push('test'),
        saveState: j => { prefs.state = j; localStorage.setItem('__native', j); calls.push('save'); },
        loadState: () => prefs.state,
      };
    });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', e => errors.push('bridge pageerror: ' + e.message));
    await p2.goto(url);
    await p2.waitForTimeout(400);
    await p2.evaluate(() => { SB.state.name = 'Native'; SB.state.onboarded = true; SB.state.xp = 321; SB.save(); SB.flush(); while (SB.closeTopModal()) {} });
    await p2.evaluate(() => { location.hash = '#/profile'; });
    await p2.waitForTimeout(300);
    await p2.evaluate(() => {
      const cb = document.querySelectorAll('#view .switch input')[2];   // the reminder toggle
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    });
    await p2.waitForTimeout(100);
    const calls = await p2.evaluate(() => window.__calls);
    if (!calls.some(c => c.startsWith('bars:'))) throw new Error('setSystemBars not called');
    if (!calls.some(c => c.startsWith('reminder:true'))) throw new Error('setReminder not called: ' + calls.join(','));
    // WebView storage wiped: progress must come back from the native copy.
    await p2.evaluate(() => localStorage.removeItem('skillboost.v1'));
    await p2.reload();
    await p2.waitForTimeout(400);
    const restored = await p2.evaluate(() => ({ name: SB.state.name, xp: SB.state.xp }));
    if (restored.name !== 'Native' || restored.xp !== 321) throw new Error('state not restored from native copy: ' + JSON.stringify(restored));
    await ctx2.close();
  });

  await browser.close();
  if (errors.length) {
    console.log('\nERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('\nAll e2e steps passed');
})();
