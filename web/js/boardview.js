/* The virtual development board: LEDs, button, potentiometer, UART terminal,
   with real-time playback of what the simulated firmware did. */
(function () {
  'use strict';
  const { h } = SB;

  const BUTTON_PRESETS = [
    ['none', 'Not pressed', null],
    ['held', 'Held the whole run', 'held'],
    ['one', 'Click at 0.5 s', [[500, 800]]],
    ['three', '3 clicks (0.5, 1.5, 2.5 s)', [[500, 700], [1500, 1700], [2500, 2700]]],
    ['long', 'Long press 1–3 s', [[1000, 3000]]],
  ];

  SB.BoardView = function (opts) {
    opts = opts || {};
    const st = Object.assign({ button: 'none', bounce: false, pot: 2048, noise: false }, SB.state.code.boardInput || {});
    const save = () => { SB.state.code.boardInput = Object.assign({}, st); SB.save(); };

    const leds = [];
    const ledRow = h('div', { class: 'leds' });
    for (let i = 0; i < 8; i++) {
      const led = h('div', { class: 'led' }, h('i'), 'PA' + i);
      leds.push(led);
      ledRow.appendChild(led);
    }
    const timeEl = h('span', { class: 'time' }, 't = 0.000 s');
    const uart = h('div', { class: 'uart hidden' });
    const notes = h('div', { class: 'notes' });
    const replayBtn = h('button', { class: 'btn small secondary hidden', onclick: () => play(lastRun) }, '↻ Replay');
    const speedSel = h('select', { style: { width: 'auto', padding: '6px 8px' } }, ['1', '2', '4', '10'].map(s => h('option', { value: s }, s + '×')));
    const potVal = h('b', null, String(st.pot));
    const potSlider = h('input', { type: 'range', min: '0', max: '4095', value: String(st.pot), oninput: ev => { st.pot = Number(ev.target.value); potVal.textContent = st.pot; save(); } });
    const btnSel = h('select', { style: { width: 'auto', padding: '6px 8px', flex: '1' }, onchange: ev => { st.button = ev.target.value; save(); } },
      BUTTON_PRESETS.map(([k, label]) => h('option', { value: k }, label)));
    btnSel.value = st.button;
    const toggle = (label, key) => h('label', { class: 'row', style: { gap: '6px' } },
      h('input', { type: 'checkbox', checked: st[key] ? true : null, onchange: ev => { st[key] = ev.target.checked; save(); } }), label);

    const el = h('div', { class: 'board' },
      h('div', { class: 'row between' }, h('span', { class: 'chipname' }, 'SB-M4 VIRTUAL BOARD · 16 MHz'), timeEl),
      ledRow,
      opts.compact ? null : h('div', { class: 'board-controls' },
        h('div', { class: 'btn-hw', title: 'User button PC13' }, 'PC13'),
        btnSel, toggle('Bouncy', 'bounce')),
      opts.compact ? null : h('div', { class: 'board-controls' },
        h('span', null, '🎚️ Pot'), potSlider, potVal, toggle('Noise', 'noise')),
      uart,
      h('div', { class: 'row', style: { marginTop: '8px', justifyContent: 'flex-end' } }, replayBtn, h('span', { class: 'tiny', style: { color: '#a7f3d0' } }, 'speed'), speedSel),
      notes);

    let raf = null, lastRun = null;
    const setLeds = v => leds.forEach((l, i) => l.classList.toggle('on', !!((v >> i) & 1)));
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = null; };
    SB.onLeave(stop);

    function play(run) {
      stop();
      if (!run || !run.board) return;
      const b = run.board;
      const endUs = Math.max(run.timeMs * 1000, 1);
      let speed = Number(speedSel.value);
      if (endUs / speed > 12e6) speed = endUs / 12e6;
      const start = performance.now();
      let li = 0, ui = 0;
      uart.textContent = '';
      uart.classList.toggle('hidden', !b.uart);
      const frame = now => {
        const t = Math.min(endUs, (now - start) * 1000 * speed);
        while (li < b.ledTimeline.length && b.ledTimeline[li].t <= t) setLeds(b.ledTimeline[li++].v);
        let add = '';
        while (ui < b.uartTimeline.length && b.uartTimeline[ui].t <= t) add += b.uartTimeline[ui++].s;
        if (add) { uart.textContent += add; uart.scrollTop = uart.scrollHeight; }
        timeEl.textContent = 't = ' + (t / 1e6).toFixed(3) + ' s';
        if (t < endUs) raf = requestAnimationFrame(frame);
        else { setLeds(b.leds); uart.textContent = b.uart; raf = null; }
      };
      if (li === 0) setLeds(0);
      raf = requestAnimationFrame(frame);
      replayBtn.classList.remove('hidden');
    }

    return {
      el,
      input() {
        const preset = BUTTON_PRESETS.find(p => p[0] === st.button);
        const input = { pot: st.pot, potNoise: st.noise ? 80 : 0, bounce: st.bounce };
        if (preset && preset[2] === 'held') input.buttonHeld = true;
        else if (preset && preset[2]) input.button = preset[2];
        return input;
      },
      show(run) {
        lastRun = run;
        notes.innerHTML = '';
        if (run.board) run.board.notes.forEach(n => notes.appendChild(h('div', null, '🔎 ' + n)));
        play(run);
      },
      reset() { stop(); setLeds(0); uart.textContent = ''; uart.classList.add('hidden'); notes.innerHTML = ''; timeEl.textContent = 't = 0.000 s'; },
    };
  };
})();
