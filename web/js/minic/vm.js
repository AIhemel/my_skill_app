/*
 * MiniC part 3: code generation (AST -> JS closures), memory, C library,
 * and a virtual STM32-like microcontroller board.
 *
 * Memory map (like an ARM Cortex-M4):
 *   0x08000000  Flash (256 KB, read-only): function addresses, string literals, const data
 *   0x20000000  SRAM (128 KB): globals, heap, stack (grows down from 0x20020000)
 *   0x40000000+ peripherals (GPIO, RCC, USART, TIM2, ADC1, EXTI)
 *   0xE000E000  SysTick + NVIC
 */
(function (MC) {
  'use strict';
  const { CError, T, isInt, isFlo, isPtr, isArr, isFunc, isAgg, convertValue, evalBinop, alignTo } = MC;

  const FLASH_BASE = 0x08000000, FLASH_SIZE = 0x40000;
  const SRAM_BASE = 0x20000000, SRAM_SIZE = 0x20000;
  const STACK_SIZE = 0x8000, HEAP_MAX = 0x8000;
  const US_PER_STEP = 1; // virtual µs per executed statement
  const HARNESS_LINE = 10001;
  const BREAK = 1, CONTINUE = 2, RETURN = 3;
  MC.HARNESS_LINE = HARNESS_LINE;

  const hex8 = v => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
  MC.hex8 = hex8;

  class Halt {
    constructor(reason, code) {
      this.reason = reason;
      this.code = code;
    }
  }

  function rt(vm, msg) {
    const where = vm.callStack.length ? ' (in ' + vm.callStack[vm.callStack.length - 1] + '())' : '';
    return new CError('runtime', msg + where, vm.line);
  }

  function kindOf(ty) {
    if (isPtr(ty)) return 'u32';
    if (ty.kind === 'bool') return 'u8';
    if (ty.kind === 'float') return 'f32';
    if (ty.kind === 'double') return 'f64';
    return (ty.unsigned ? 'u' : 'i') + ty.size * 8;
  }
  const KIND_SIZE = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, f32: 4, f64: 8 };
  const DV_GET = { i8: 'getInt8', u8: 'getUint8', i16: 'getInt16', u16: 'getUint16', i32: 'getInt32', u32: 'getUint32', i64: 'getBigInt64', u64: 'getBigUint64', f32: 'getFloat32', f64: 'getFloat64' };
  const DV_SET = { i8: 'setInt8', u8: 'setUint8', i16: 'setInt16', u16: 'setUint16', i32: 'setInt32', u32: 'setUint32', i64: 'setBigInt64', u64: 'setBigUint64', f32: 'setFloat32', f64: 'setFloat64' };

  function wrapFn(size, uns) {
    if (size === 1) return uns ? v => v & 0xff : v => (v << 24) >> 24;
    if (size === 2) return uns ? v => v & 0xffff : v => (v << 16) >> 16;
    return uns ? v => v >>> 0 : v => v | 0;
  }

  // ===================================================================== board

  const RCC_BASE = 0x40023800, GPIO_BASES = [0x40020000, 0x40020400, 0x40020800];
  const USART1_BASE = 0x40011000, USART2_BASE = 0x40004400, EXTI_BASE = 0x40013C00, SYSCFG_BASE = 0x40013800;
  const ADC1_BASE = 0x40012000, TIM2_BASE = 0x40000000, SCS_BASE = 0xE000E000;
  const CLOCK_MHZ = 16;
  const IRQ_TIM2 = 28, IRQ_USART2 = 38, IRQ_EXTI15_10 = 40;

  class Board {
    constructor(vm, input) {
      this.vm = vm;
      this.used = false;
      this.notes = [];
      this.noteSet = new Set();
      this.rcc = { CR: 0x83, CFGR: 0, AHB1ENR: 0, APB1ENR: 0, APB2ENR: 0 };
      this.gpio = [0, 1, 2].map(() => ({ MODER: 0, OTYPER: 0, OSPEEDR: 0, PUPDR: 0, ODR: 0, LCKR: 0, AFRL: 0, AFRH: 0 }));
      this.leds = 0;
      this.ledTimeline = [{ t: 0, v: 0 }];
      this.ledWrites = 0;
      this.usart = { 1: { SR: 0xC0, BRR: 0, CR1: 0, CR2: 0, CR3: 0 }, 2: { SR: 0xC0, BRR: 0, CR1: 0, CR2: 0, CR3: 0 } };
      this.uartText = '';
      this.uartTimeline = [];
      this.st = { CTRL: 0, LOAD: 0, period: 0, next: Infinity, last: 0, countflag: 0, pending: false };
      this.nvic = [0, 0, 0];
      this.exti = { IMR: 0, EMR: 0, RTSR: 0, FTSR: 0, SWIER: 0, PR: 0 };
      this.syscfg = {};
      this.tim = { CR1: 0, DIER: 0, SR: 0, PSC: 0, ARR: 0xFFFFFFFF, CCR: [0, 0, 0, 0], other: {}, start: 0, next: Infinity, period: 0, countPeriod: 0, running: false };
      this.adc = { SR: 0, CR1: 0, CR2: 0, DR: 0, other: {} };
      this.irqCounts = { SysTick: 0, EXTI15_10: 0, TIM2: 0 };
      this.button = false;
      this.events = [];
      this.evIdx = 0;
      input = input || {};
      if (input.buttonHeld) this.button = true;
      // A mechanical contact "bounces" for a few ms before it settles.
      const BOUNCE_US = [0, 800, 1500, 2600, 4000];
      const edge = (t, pressed) => {
        if (!input.bounce) { this.events.push({ t, pressed }); return; }
        BOUNCE_US.forEach((dt, k) => this.events.push({ t: t + dt, pressed: k % 2 === 0 ? pressed : !pressed }));
      };
      (input.button || []).forEach(([down, up]) => {
        edge(down * 1000, true);
        if (up !== undefined && up !== null) edge(up * 1000, false);
      });
      this.events.sort((a, b) => a.t - b.t);
      this.pot = input.pot === undefined ? 2048 : input.pot;
      this.noiseSeed = 7;
      this.potNoise = input.potNoise || 0;
    }

    note(msg) {
      if (!this.noteSet.has(msg) && this.notes.length < 30) {
        this.noteSet.add(msg);
        this.notes.push(msg);
      }
    }

    static isPeriph(a) {
      return (a >= 0x40000000 && a < 0x60000000) || (a >= 0xE0000000 && a < 0xE0100000);
    }

    clockOn(reg, bit) { return ((this.rcc[reg] >>> bit) & 1) === 1; }

    potValue(now) {
      let v;
      if (Array.isArray(this.pot)) {
        v = this.pot[0].v;
        for (const p of this.pot) if (p.t * 1000 <= now) v = p.v;
      } else v = this.pot;
      if (this.potNoise) {
        this.noiseSeed = (this.noiseSeed * 1103515245 + 12345) & 0x7fffffff;
        v += Math.round(((this.noiseSeed / 0x7fffffff) * 2 - 1) * this.potNoise);
      }
      return Math.max(0, Math.min(4095, v));
    }

    // --- time-driven state
    sync(now) {
      const st = this.st;
      if ((st.CTRL & 1) && st.next <= now) {
        const n = Math.floor((now - st.next) / st.period) + 1;
        st.last = st.next + (n - 1) * st.period;
        st.next += n * st.period;
        st.countflag = 1;
        if (st.CTRL & 2) st.pending = true;
      }
      const tm = this.tim;
      if (tm.running && tm.next <= now) {
        const n = Math.floor((now - tm.next) / tm.period) + 1;
        tm.next += n * tm.period;
        tm.SR |= 1;
      }
    }

    tick(now) {
      while (this.evIdx < this.events.length && this.events[this.evIdx].t <= now) {
        const e = this.events[this.evIdx++];
        const was = this.button;
        this.button = e.pressed;
        if (was !== this.button) {
          const rising = this.button;
          if (((this.exti.IMR >>> 13) & 1) && ((rising ? this.exti.RTSR : this.exti.FTSR) >>> 13) & 1) this.exti.PR |= 1 << 13;
        }
      }
      this.sync(now);
      this.dispatch();
    }

    nextEventTime() {
      let t = Infinity;
      if (this.evIdx < this.events.length) t = this.events[this.evIdx].t;
      if ((this.st.CTRL & 3) === 3) t = Math.min(t, this.st.next);
      if (this.tim.running && (this.tim.DIER & 1)) t = Math.min(t, this.tim.next);
      return t;
    }

    nvicOn(irq) { return ((this.nvic[irq >> 5] >>> (irq & 31)) & 1) === 1; }

    pendingIrq() {
      if (this.st.pending) return 'SysTick';
      if ((this.exti.PR & this.exti.IMR & (0xFC00)) !== 0) {
        if (this.nvicOn(IRQ_EXTI15_10)) return 'EXTI15_10';
        this.note('EXTI line 13 is pending, but its interrupt is not enabled in the NVIC — call NVIC_EnableIRQ(EXTI15_10_IRQn).');
      }
      if ((this.tim.SR & 1) && (this.tim.DIER & 1)) {
        if (this.nvicOn(IRQ_TIM2)) return 'TIM2';
        this.note('TIM2 update interrupt is pending, but not enabled in the NVIC — call NVIC_EnableIRQ(TIM2_IRQn).');
      }
      return null;
    }

    dispatch() {
      const vm = this.vm;
      if (vm.inIrq || vm.primask) return;
      let last = null, repeats = 0;
      for (;;) {
        const irq = this.pendingIrq();
        if (!irq) return;
        const name = irq === 'SysTick' ? 'SysTick_Handler' : irq + '_IRQHandler';
        const h = vm.handlers[name];
        if (!h) {
          throw rt(vm, 'Interrupt ' + irq + " fired but there is no '" + name + "()' function. A real MCU would get stuck in Default_Handler. Define: void " + name + '(void) { ... }');
        }
        if (irq === last) repeats++; else { last = irq; repeats = 0; }
        if (repeats > 200) {
          const hint = irq === 'TIM2' ? 'clear the flag with TIM2->SR &= ~TIM_SR_UIF;' : 'clear the pending bit with EXTI->PR = (1U << 13);';
          throw rt(vm, 'Interrupt storm: ' + name + ' keeps re-entering because its pending flag is never cleared — ' + hint);
        }
        if (irq === 'SysTick') this.st.pending = false;
        this.irqCounts[irq]++;
        vm.inIrq = true;
        try {
          vm.invoke(h, [], 0);
        } finally {
          vm.inIrq = false;
        }
      }
    }

    // --- registers
    read(addr, size) {
      this.used = true;
      const vm = this.vm;
      const now = vm.now();
      this.sync(now);
      const a = (addr & ~3) >>> 0, shift = (addr & 3) * 8;
      const v = this.read32(a, now) >>> 0;
      if (size === 4) return v;
      return (v >>> shift) & (size === 1 ? 0xff : 0xffff);
    }

    write(addr, size, value) {
      this.used = true;
      const vm = this.vm;
      const now = vm.now();
      this.sync(now);
      const a = (addr & ~3) >>> 0, shift = (addr & 3) * 8;
      let v;
      if (size === 4) v = value >>> 0;
      else {
        const mask = ((size === 1 ? 0xff : 0xffff) << shift) >>> 0;
        const cur = this.peek32(a);
        v = ((cur & ~mask) | ((value << shift) & mask)) >>> 0;
      }
      this.write32(a, v, now, size < 4 ? (value & (size === 1 ? 0xff : 0xffff)) : null);
    }

    block(a) {
      if (a >= RCC_BASE && a < RCC_BASE + 0x400) return ['rcc', a - RCC_BASE];
      for (let i = 0; i < 3; i++) if (a >= GPIO_BASES[i] && a < GPIO_BASES[i] + 0x400) return ['gpio', a - GPIO_BASES[i], i];
      if (a >= USART1_BASE && a < USART1_BASE + 0x400) return ['usart', a - USART1_BASE, 1];
      if (a >= USART2_BASE && a < USART2_BASE + 0x400) return ['usart', a - USART2_BASE, 2];
      if (a >= EXTI_BASE && a < EXTI_BASE + 0x400) return ['exti', a - EXTI_BASE];
      if (a >= SYSCFG_BASE && a < SYSCFG_BASE + 0x400) return ['syscfg', a - SYSCFG_BASE];
      if (a >= ADC1_BASE && a < ADC1_BASE + 0x400) return ['adc', a - ADC1_BASE];
      if (a >= TIM2_BASE && a < TIM2_BASE + 0x400) return ['tim', a - TIM2_BASE];
      if (a >= SCS_BASE && a < SCS_BASE + 0x1000) return ['scs', a - SCS_BASE];
      return null;
    }

    noBlock(a, write) {
      const vm = this.vm;
      throw rt(vm, 'BusFault: no peripheral at ' + hex8(a) + ' (' + (write ? 'write' : 'read') + '). Check the register address — see the Board reference.');
    }

    peek32(a) {
      const b = this.block(a);
      if (!b) return 0;
      return this.read32(a, this.vm.now(), true) >>> 0;
    }

    read32(a, now, quiet) {
      const b = this.block(a);
      if (!b) this.noBlock(a, false);
      const [kind, off, idx] = b;
      switch (kind) {
        case 'rcc':
          return { 0x00: this.rcc.CR, 0x08: this.rcc.CFGR, 0x30: this.rcc.AHB1ENR, 0x40: this.rcc.APB1ENR, 0x44: this.rcc.APB2ENR }[off] || 0;
        case 'gpio': {
          const g = this.gpio[idx];
          if (!this.clockOn('AHB1ENR', idx)) {
            if (!quiet) this.note('GPIO' + 'ABC'[idx] + ' was read while its clock is off — enable it with RCC->AHB1ENR |= (1U << ' + idx + ') first.');
            return 0;
          }
          switch (off) {
            case 0x00: return g.MODER;
            case 0x04: return g.OTYPER;
            case 0x08: return g.OSPEEDR;
            case 0x0C: return g.PUPDR;
            case 0x10: {
              let outMask = 0;
              for (let p = 0; p < 16; p++) if (((g.MODER >>> (2 * p)) & 3) === 1) outMask |= 1 << p;
              let v = g.ODR & outMask;
              if (idx === 2 && this.button && ((g.MODER >>> 26) & 3) === 0) v |= 1 << 13;
              return v >>> 0;
            }
            case 0x14: return g.ODR;
            case 0x18: return 0;
            case 0x1C: return g.LCKR;
            case 0x20: return g.AFRL;
            case 0x24: return g.AFRH;
          }
          return 0;
        }
        case 'usart': {
          const u = this.usart[idx];
          return { 0x00: u.SR, 0x04: 0, 0x08: u.BRR, 0x0C: u.CR1, 0x10: u.CR2, 0x14: u.CR3 }[off] || 0;
        }
        case 'exti':
          return { 0x00: this.exti.IMR, 0x04: this.exti.EMR, 0x08: this.exti.RTSR, 0x0C: this.exti.FTSR, 0x10: this.exti.SWIER, 0x14: this.exti.PR }[off] || 0;
        case 'syscfg':
          return this.syscfg[off] || 0;
        case 'adc': {
          const d = this.adc;
          if (off === 0x00) return d.SR;
          if (off === 0x04) return d.CR1;
          if (off === 0x08) return d.CR2;
          if (off === 0x4C) {
            if (!quiet) d.SR &= ~2;
            return d.DR;
          }
          return d.other[off] || 0;
        }
        case 'tim': {
          const tm = this.tim;
          switch (off) {
            case 0x00: return tm.CR1;
            case 0x0C: return tm.DIER;
            case 0x10: return tm.SR;
            case 0x24: {
              if (!tm.running) return 0;
              const counts = Math.floor((now - tm.start) / tm.countPeriod);
              return counts % (tm.ARR + 1);
            }
            case 0x28: return tm.PSC;
            case 0x2C: return tm.ARR;
            case 0x34: case 0x38: case 0x3C: case 0x40: return tm.CCR[(off - 0x34) / 4];
          }
          return tm.other[off] || 0;
        }
        case 'scs': {
          const st = this.st;
          if (off === 0x10) {
            const v = (st.CTRL & 7) | (st.countflag << 16);
            if (!quiet) st.countflag = 0;
            return v;
          }
          if (off === 0x14) return st.LOAD;
          if (off === 0x18) {
            if (!(st.CTRL & 1)) return 0;
            const clk = (st.CTRL & 4) ? CLOCK_MHZ : CLOCK_MHZ / 8;
            const elapsed = Math.floor((now - st.last) * clk);
            return (st.LOAD - (elapsed % (st.LOAD + 1)) + st.LOAD + 1) % (st.LOAD + 1);
          }
          if (off === 0x1C) return 0x4000000 | 16000; // CALIB (TENMS)
          if (off >= 0x100 && off < 0x10C) return this.nvic[(off - 0x100) / 4];
          if (off >= 0x180 && off < 0x18C) return this.nvic[(off - 0x180) / 4];
          return 0;
        }
      }
      return 0;
    }

    write32(a, v, now, raw) {
      const b = this.block(a);
      if (!b) this.noBlock(a, true);
      const [kind, off, idx] = b;
      switch (kind) {
        case 'rcc':
          if (off === 0x30) this.rcc.AHB1ENR = v;
          else if (off === 0x40) { const was = this.rcc.APB1ENR; this.rcc.APB1ENR = v; if ((was ^ v) & 1) this.timerUpdate(now); }
          else if (off === 0x44) this.rcc.APB2ENR = v;
          else if (off === 0x08) this.rcc.CFGR = v;
          return;
        case 'gpio': {
          const g = this.gpio[idx];
          const port = 'GPIO' + 'ABC'[idx];
          if (!this.clockOn('AHB1ENR', idx)) {
            this.note(port + ' was written while its clock is off, so the write was ignored. Enable it first: RCC->AHB1ENR |= (1U << ' + idx + ');');
            return;
          }
          switch (off) {
            case 0x00: g.MODER = v; break;
            case 0x04: g.OTYPER = v; break;
            case 0x08: g.OSPEEDR = v; break;
            case 0x0C: g.PUPDR = v; break;
            case 0x10: this.note(port + '->IDR is read-only (it reports pin levels). Write ODR or BSRR to drive outputs.'); break;
            case 0x14: g.ODR = v & 0xffff; break;
            case 0x18: {
              const set = v & 0xffff, reset = (v >>> 16) & 0xffff;
              g.ODR = ((g.ODR & ~reset) | set) & 0xffff;
              break;
            }
            case 0x1C: g.LCKR = v; break;
            case 0x20: g.AFRL = v; break;
            case 0x24: g.AFRH = v; break;
          }
          if (idx === 0) this.updateLeds(now);
          return;
        }
        case 'usart': {
          const u = this.usart[idx];
          if (off === 0x04) {
            const clk = idx === 2 ? this.clockOn('APB1ENR', 17) : this.clockOn('APB2ENR', 4);
            const name = 'USART' + idx;
            if (!clk) { this.note(name + ' DR written but its clock is off — enable it in RCC->' + (idx === 2 ? 'APB1ENR (bit 17)' : 'APB2ENR (bit 4)') + '. Byte lost.'); return; }
            if (!((u.CR1 >>> 13) & 1) || !((u.CR1 >>> 3) & 1)) { this.note(name + ' DR written but the UART is not enabled — set USART_CR1_UE and USART_CR1_TE in CR1. Byte lost.'); return; }
            const ch = (raw !== null ? raw : v) & 0xff;
            this.uartBytes = this.uartBytes || [];
            this.uartBytes.push(ch);
            const s = String.fromCharCode(ch);
            this.uartText += s;
            if (this.uartTimeline.length < 5000) this.uartTimeline.push({ t: now, s });
            if (this.uartText.length > 20000) throw new Halt('output');
            return;
          }
          if (off === 0x00) u.SR = (u.SR & ~(~v & 0x60)) | 0xC0;
          else if (off === 0x08) u.BRR = v;
          else if (off === 0x0C) u.CR1 = v;
          else if (off === 0x10) u.CR2 = v;
          else if (off === 0x14) u.CR3 = v;
          return;
        }
        case 'exti': {
          const e = this.exti;
          if (off === 0x00) e.IMR = v;
          else if (off === 0x04) e.EMR = v;
          else if (off === 0x08) e.RTSR = v;
          else if (off === 0x0C) e.FTSR = v;
          else if (off === 0x10) { e.SWIER = v; e.PR |= v & e.IMR; }
          else if (off === 0x14) e.PR &= ~v;
          return;
        }
        case 'syscfg':
          this.syscfg[off] = v;
          return;
        case 'adc': {
          const d = this.adc;
          if (off === 0x00) d.SR &= v;
          else if (off === 0x04) d.CR1 = v;
          else if (off === 0x08) {
            d.CR2 = v & ~(1 << 30);
            if ((v >>> 30) & 1) {
              if (!this.clockOn('APB2ENR', 8)) { this.note('ADC1 started but its clock is off — enable RCC->APB2ENR bit 8 (RCC_APB2ENR_ADC1EN).'); return; }
              if (!(v & 1)) { this.note('ADC1 conversion requested but the ADC is off — set ADC_CR2_ADON first.'); return; }
              d.DR = this.potValue(now);
              d.SR |= 2;
            }
          } else d.other[off] = v;
          return;
        }
        case 'tim': {
          const tm = this.tim;
          switch (off) {
            case 0x00: tm.CR1 = v; this.timerUpdate(now); return;
            case 0x0C: tm.DIER = v; return;
            case 0x10: tm.SR &= v; return;
            case 0x14: if (v & 1) { tm.start = now; this.timerUpdate(now, true); } return;
            case 0x24: tm.start = now - v * (tm.countPeriod || 0); return;
            case 0x28: tm.PSC = v & 0xffff; this.timerUpdate(now); return;
            case 0x2C: tm.ARR = v; this.timerUpdate(now); return;
            case 0x34: case 0x38: case 0x3C: case 0x40: tm.CCR[(off - 0x34) / 4] = v; return;
          }
          tm.other[off] = v;
          return;
        }
        case 'scs': {
          const st = this.st;
          if (off === 0x10) {
            const was = st.CTRL & 1;
            st.CTRL = v & 7;
            if ((v & 1) && !was) this.startSysTick(now);
            if (!(v & 1)) st.next = Infinity;
            return;
          }
          if (off === 0x14) { st.LOAD = v & 0xffffff; if (st.CTRL & 1) this.startSysTick(now); return; }
          if (off === 0x18) { st.countflag = 0; if (st.CTRL & 1) this.startSysTick(now); return; }
          if (off >= 0x100 && off < 0x10C) { this.nvic[(off - 0x100) / 4] |= v; this.dispatchSoon(); return; }
          if (off >= 0x180 && off < 0x18C) { this.nvic[(off - 0x180) / 4] &= ~v; return; }
          return;
        }
      }
    }

    dispatchSoon() { this.vm.nextCheck = this.vm.steps + 1; }

    startSysTick(now) {
      const st = this.st;
      const clk = (st.CTRL & 4) ? CLOCK_MHZ : CLOCK_MHZ / 8;
      st.period = (st.LOAD + 1) / clk;
      if (st.LOAD === 0) { st.next = Infinity; return; }
      if (st.period < 1) { st.period = 1; this.note('SysTick period is shorter than 1 µs — the CPU would do nothing but run the interrupt.'); }
      st.last = now;
      st.next = now + st.period;
      this.dispatchSoon();
    }

    timerUpdate(now, restart) {
      const tm = this.tim;
      const on = (tm.CR1 & 1) && this.clockOn('APB1ENR', 0);
      if ((tm.CR1 & 1) && !this.clockOn('APB1ENR', 0)) this.note('TIM2 enabled (CEN) but its clock is off — set RCC->APB1ENR bit 0 (RCC_APB1ENR_TIM2EN).');
      tm.countPeriod = (tm.PSC + 1) / CLOCK_MHZ;
      tm.period = tm.countPeriod * (tm.ARR + 1);
      if (!on) { tm.running = false; tm.next = Infinity; return; }
      if (!tm.running || restart) tm.start = now;
      tm.running = true;
      const elapsed = now - tm.start;
      tm.next = tm.start + (Math.floor(elapsed / tm.period) + 1) * tm.period;
      if (tm.period < 1) { tm.period = 1; this.note('TIM2 overflows faster than once per µs — check PSC and ARR.'); }
      this.dispatchSoon();
    }

    updateLeds(now) {
      const g = this.gpio[0];
      let v = 0;
      for (let p = 0; p < 8; p++) {
        const mode = (g.MODER >>> (2 * p)) & 3;
        const on = (g.ODR >>> p) & 1;
        if (on && mode === 1) v |= 1 << p;
        else if (on && mode !== 1) this.note('PA' + p + ' is set in ODR but not configured as an output — set its MODER bits to 01: GPIOA->MODER |= (1U << ' + 2 * p + ');');
      }
      this.ledWrites++;
      if (v !== this.leds) {
        this.leds = v;
        if (this.ledTimeline.length < 20000) this.ledTimeline.push({ t: now, v });
      }
    }

    summary() {
      const g = this.gpio;
      return {
        used: this.used,
        leds: this.leds,
        ledTimeline: this.ledTimeline,
        uart: this.uartText,
        uartTimeline: this.uartTimeline,
        notes: this.notes,
        irqCounts: this.irqCounts,
        regs: {
          RCC_AHB1ENR: this.rcc.AHB1ENR, RCC_APB1ENR: this.rcc.APB1ENR, RCC_APB2ENR: this.rcc.APB2ENR,
          GPIOA_MODER: g[0].MODER, GPIOA_ODR: g[0].ODR, GPIOC_MODER: g[2].MODER,
          USART2_CR1: this.usart[2].CR1, USART2_BRR: this.usart[2].BRR,
          SysTick_CTRL: this.st.CTRL, SysTick_LOAD: this.st.LOAD,
          TIM2_PSC: this.tim.PSC, TIM2_ARR: this.tim.ARR, TIM2_CR1: this.tim.CR1, TIM2_DIER: this.tim.DIER,
          EXTI_IMR: this.exti.IMR, EXTI_RTSR: this.exti.RTSR, NVIC_ISER1: this.nvic[1], NVIC_ISER0: this.nvic[0],
        },
      };
    }
  }
  MC.Board = Board;

  // ================================================================== machine

  class Machine {
    constructor(prog, opts) {
      this.opts = opts;
      this.ramBuf = new ArrayBuffer(SRAM_SIZE);
      this.ram = new DataView(this.ramBuf);
      this.ramU8 = new Uint8Array(this.ramBuf);
      this.romBuf = new ArrayBuffer(FLASH_SIZE);
      this.rom = new DataView(this.romBuf);
      this.romU8 = new Uint8Array(this.romBuf);
      this.romWritable = false;
      // Fresh RAM holds garbage, like real hardware after power-up.
      let s = (opts.seed || 0x2545F491) >>> 0;
      for (let i = 0; i < SRAM_SIZE; i += 4) {
        s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
        this.ram.setUint32(i, s, true);
      }
      this.outChunks = [];
      this.outLen = 0;
      this.outTimeline = [];
      this.steps = 0;
      this.extraUs = 0;
      this.line = 0;
      this.callStack = [];
      this.depth = 0;
      this.inIrq = false;
      this.primask = 0;
      this.maxSteps = opts.maxSteps || 20000000;
      this.maxTimeUs = (opts.maxTimeMs || 10000) * 1000;
      this.nextCheck = 1;
      this.stdin = opts.stdin || '';
      this.stdinPos = 0;
      this.randState = 1;
      this.board = new Board(this, opts.input);
      this.prog = prog;
      this.loaders = {};
      this.storers = {};
      this.layout(prog);
      this.codegen(prog);
    }

    now() { return this.steps * US_PER_STEP + this.extraUs; }

    // --- memory
    load(ty) {
      const k = kindOf(ty);
      if (this.loaders[k]) return this.loaders[k];
      const dv = this.ram, vm = this, get = DV_GET[k], size = KIND_SIZE[k], lim = SRAM_SIZE - size;
      let f;
      switch (k) {
        case 'i8': f = a => { const o = a - SRAM_BASE; return o >= 0 && o <= lim ? dv.getInt8(o) : vm.slowLoad(a, k); }; break;
        case 'u8': f = a => { const o = a - SRAM_BASE; return o >= 0 && o <= lim ? dv.getUint8(o) : vm.slowLoad(a, k); }; break;
        case 'i16': f = a => { const o = a - SRAM_BASE; return o >= 0 && o <= lim ? dv.getInt16(o, true) : vm.slowLoad(a, k); }; break;
        case 'u16': f = a => { const o = a - SRAM_BASE; return o >= 0 && o <= lim ? dv.getUint16(o, true) : vm.slowLoad(a, k); }; break;
        case 'i32': f = a => { const o = a - SRAM_BASE; return o >= 0 && o <= lim ? dv.getInt32(o, true) : vm.slowLoad(a, k); }; break;
        case 'u32': f = a => { const o = a - SRAM_BASE; return o >= 0 && o <= lim ? dv.getUint32(o, true) : vm.slowLoad(a, k); }; break;
        default: f = a => { const o = a - SRAM_BASE; return o >= 0 && o <= lim ? dv[get](o, true) : vm.slowLoad(a, k); };
      }
      this.loaders[k] = f;
      return f;
    }

    store(ty) {
      const k = kindOf(ty);
      if (this.storers[k]) return this.storers[k];
      const dv = this.ram, vm = this, set = DV_SET[k], size = KIND_SIZE[k], lim = SRAM_SIZE - size;
      let f;
      switch (k) {
        case 'i8': case 'u8': f = (a, v) => { const o = a - SRAM_BASE; if (o >= 0 && o <= lim) dv.setUint8(o, v); else vm.slowStore(a, k, v); }; break;
        case 'i16': case 'u16': f = (a, v) => { const o = a - SRAM_BASE; if (o >= 0 && o <= lim) dv.setUint16(o, v, true); else vm.slowStore(a, k, v); }; break;
        case 'i32': case 'u32': f = (a, v) => { const o = a - SRAM_BASE; if (o >= 0 && o <= lim) dv.setUint32(o, v, true); else vm.slowStore(a, k, v); }; break;
        default: f = (a, v) => { const o = a - SRAM_BASE; if (o >= 0 && o <= lim) dv[set](o, v, true); else vm.slowStore(a, k, v); };
      }
      this.storers[k] = f;
      return f;
    }

    slowLoad(a, k) {
      a = a >>> 0;
      const size = KIND_SIZE[k];
      const fo = a - FLASH_BASE;
      if (fo >= 0 && fo + size <= FLASH_SIZE) return this.rom[DV_GET[k]](fo, true);
      if (Board.isPeriph(a)) {
        if (size === 8) {
          const lo = this.board.read(a, 4), hi = this.board.read(a + 4, 4);
          const b = (BigInt(hi) << 32n) | BigInt(lo);
          return k === 'i64' ? BigInt.asIntN(64, b) : b;
        }
        const raw = this.board.read(a, size);
        switch (k) {
          case 'i8': return (raw << 24) >> 24;
          case 'i16': return (raw << 16) >> 16;
          case 'i32': return raw | 0;
          case 'f32': { const t = new DataView(new ArrayBuffer(4)); t.setUint32(0, raw); return t.getFloat32(0); }
          default: return raw >>> 0;
        }
      }
      this.fault(a, size, false);
    }

    slowStore(a, k, v) {
      a = a >>> 0;
      const size = KIND_SIZE[k];
      const fo = a - FLASH_BASE;
      if (fo >= 0 && fo + size <= FLASH_SIZE && this.romWritable) { this.rom[DV_SET[k]](fo, v, true); return; }
      if (Board.isPeriph(a)) {
        if (size === 8) {
          const b = BigInt.asUintN(64, BigInt(v));
          this.board.write(a, 4, Number(b & 0xffffffffn));
          this.board.write(a + 4, 4, Number(b >> 32n));
          return;
        }
        let raw = v;
        if (k === 'f32') { const t = new DataView(new ArrayBuffer(4)); t.setFloat32(0, v); raw = t.getUint32(0); }
        this.board.write(a, size, raw >>> 0);
        return;
      }
      this.fault(a, size, true);
    }

    fault(a, size, write) {
      const what = write ? 'write to' : 'read from';
      if (a < 0x1000) {
        throw rt(this, 'Segmentation fault: tried to ' + what + ' address ' + hex8(a) + ' — that is a NULL pointer dereference (on a real MCU: HardFault). Check the pointer is set before you use it.');
      }
      if (a >= FLASH_BASE && a < FLASH_BASE + FLASH_SIZE) {
        throw rt(this, 'HardFault: tried to write to Flash at ' + hex8(a) + '. String literals and const data live in read-only Flash — copy into a char array (char s[] = "...") if you need to modify it.');
      }
      const o = a - SRAM_BASE;
      if (o >= 0 && o < SRAM_SIZE + 64) throw rt(this, 'HardFault: access past the end of RAM at ' + hex8(a) + '.');
      throw rt(this, 'HardFault: invalid memory ' + (write ? 'write' : 'read') + ' at ' + hex8(a) + ' — nothing is mapped there. Is the pointer uninitialized, or did an array index run out of bounds?');
    }

    rb(a) { return this.load(T.uchar)(a >>> 0); }
    wb(a, v) { this.store(T.uchar)(a >>> 0, v & 0xff); }

    memcpy(dst, src, n) {
      const d = dst - SRAM_BASE, s = src - SRAM_BASE;
      if (d >= 0 && d + n <= SRAM_SIZE && s >= 0 && s + n <= SRAM_SIZE) { this.ramU8.copyWithin(d, s, s + n); return; }
      const tmp = [];
      for (let i = 0; i < n; i++) tmp.push(this.rb(src + i));
      for (let i = 0; i < n; i++) this.wb(dst + i, tmp[i]);
    }

    memset(dst, c, n) {
      const d = dst - SRAM_BASE;
      if (d >= 0 && d + n <= SRAM_SIZE) { this.ramU8.fill(c & 0xff, d, d + n); return; }
      for (let i = 0; i < n; i++) this.wb(dst + i, c);
    }

    readBytes(a, max) {
      if (a === 0) throw rt(this, 'Segmentation fault: a NULL pointer was passed where a string was expected.');
      const out = [];
      const lim = max === undefined || max === null ? 100000 : max;
      for (let i = 0; i < lim; i++) {
        const b = this.rb(a + i);
        if (b === 0) break;
        out.push(b);
        if (i === 99999) throw rt(this, 'String has no terminating \\0 (read 100000 bytes without finding one).');
      }
      return out;
    }

    cstr(a) { return utf8Decode(this.readBytes(a)); }

    writeOut(bytes) {
      if (!bytes.length) return;
      this.outChunks.push(bytes);
      this.outLen += bytes.length;
      if (this.outTimeline.length < 3000) this.outTimeline.push({ t: this.now(), s: utf8Decode(bytes) });
      if (this.outLen > 100000) throw new Halt('output');
    }

    // --- layout
    layout(prog) {
      this.funcByAddr = new Map();
      this.handlers = {};
      prog.functions.forEach((f, i) => {
        f.addr = FLASH_BASE + 0x400 + i * 0x40;
        this.funcByAddr.set(f.addr, f);
        if (f.isDefinition && !f.isBuiltin) this.handlers[f.name] = f;
      });
      let rod = FLASH_BASE + 0x8000;
      let data = SRAM_BASE;
      const constObj = t => t.isConst || (isArr(t) && constObj(t.base));
      this.romWritable = true;
      for (const g of prog.globals) {
        const size = Math.max(g.ty.size, 1), align = Math.max(g.ty.align, 1);
        if (g.rodata || constObj(g.ty)) {
          rod = alignTo(rod, align);
          g.addr = rod;
          rod += size;
          if (rod > FLASH_BASE + FLASH_SIZE) throw new CError('compile', 'Out of Flash: constant data is larger than 256 KB', g.tok ? g.tok.line : 0);
          if (g.bytes) this.romU8.set(g.bytes, g.addr - FLASH_BASE);
        } else {
          data = alignTo(data, align);
          g.addr = data;
          data += size;
        }
      }
      this.dataEnd = data;
      this.stackTop = SRAM_BASE + SRAM_SIZE;
      this.stackLimit = this.stackTop - STACK_SIZE;
      if (data > this.stackLimit) {
        throw new CError('compile', 'Out of RAM: global variables need ' + (data - SRAM_BASE) + ' bytes but only ' + (SRAM_SIZE - STACK_SIZE) + ' are available (this MCU has 128 KB of RAM, 32 KB is reserved for the stack).', 0);
      }
      this.ramU8.fill(0, 0, data - SRAM_BASE); // .bss and .data start at zero
      this.heapStart = alignTo(data, 8);
      this.heapEnd = Math.min(this.heapStart + HEAP_MAX, this.stackLimit);
      this.freeList = this.heapEnd > this.heapStart ? [{ a: this.heapStart, s: this.heapEnd - this.heapStart }] : [];
      this.allocs = new Map();
      this.freed = new Set();
      this.heapUsed = 0;
      this.heapPeak = 0;
      this.sp = this.stackTop;
      this.fp = this.stackTop;
      this.minSp = this.stackTop;
      // argv for main(int argc, char **argv)
      const name = [109, 97, 105, 110, 0]; // "main"
      this.argvStr = rod; this.romU8.set(name, rod - FLASH_BASE); rod = alignTo(rod + 5, 4);
      this.argv = rod; this.rom.setUint32(rod - FLASH_BASE, this.argvStr, true); this.rom.setUint32(rod + 4 - FLASH_BASE, 0, true);
    }

    // --- code generation
    codegen(prog) {
      for (const f of prog.functions) {
        if (!f.isDefinition || f.isBuiltin) continue;
        f.compiled = {
          frameSize: f.frameSize,
          params: f.params.map(p => ({ offset: p.offset, ty: p.ty, st: isAgg(p.ty) ? null : this.store(p.ty), size: p.ty.size })),
          body: null,
        };
      }
      for (const f of prog.functions) {
        if (!f.isDefinition || f.isBuiltin) continue;
        this.curFn = f;
        f.compiled.body = this.stmt(f.body);
      }
      this.curFn = null;
      this.globalInits = prog.globals.filter(g => g.initNode).map(g => this.expr(g.initNode));
    }

    stmt(n) {
      const vm = this;
      const line = n.line;
      switch (n.k) {
        case 'block': {
          const list = n.body.map(s => this.stmt(s));
          const len = list.length;
          if (len === 0) return () => 0;
          if (len === 1) return list[0];
          return () => {
            for (let i = 0; i < len; i++) {
              const s = list[i]();
              if (s) return s;
            }
            return 0;
          };
        }
        case 'expr': {
          const e = this.expr(n.e);
          return () => {
            vm.line = line;
            if (++vm.steps >= vm.nextCheck) vm.check();
            e();
            return 0;
          };
        }
        case 'null':
          return () => {
            if (++vm.steps >= vm.nextCheck) vm.check();
            return 0;
          };
        case 'if': {
          const c = this.cond(n.cond), t = this.stmt(n.then), e = n.els ? this.stmt(n.els) : null;
          return () => {
            vm.line = line;
            if (++vm.steps >= vm.nextCheck) vm.check();
            return c() ? t() : e ? e() : 0;
          };
        }
        case 'for': {
          const init = n.init ? this.stmt(n.init) : null;
          const c = n.cond ? this.cond(n.cond) : null;
          const inc = n.inc ? this.expr(n.inc) : null;
          const body = this.stmt(n.body);
          return () => {
            if (init) init();
            for (;;) {
              vm.line = line;
              if (++vm.steps >= vm.nextCheck) vm.check();
              if (c && !c()) break;
              const s = body();
              if (s === BREAK) break;
              if (s === RETURN) return s;
              if (inc) { vm.line = line; inc(); }
            }
            return 0;
          };
        }
        case 'do': {
          const body = this.stmt(n.body), c = this.cond(n.cond);
          return () => {
            for (;;) {
              const s = body();
              if (s === BREAK) break;
              if (s === RETURN) return s;
              vm.line = line;
              if (++vm.steps >= vm.nextCheck) vm.check();
              if (!c()) break;
            }
            return 0;
          };
        }
        case 'switch': {
          const items = [], labels = new Map();
          let defIdx = -1;
          const top = n.body.k === 'block' ? n.body.body : [n.body];
          for (let st of top) {
            while (st.k === 'case' || st.k === 'default') {
              if (st.k === 'case') labels.set(String(st.val), items.length);
              else defIdx = items.length;
              st = st.body;
            }
            items.push(this.stmt(st));
          }
          if (labels.size !== n.cases.length || (n.def && defIdx < 0)) {
            throw new CError('compile', 'case labels inside nested blocks are not supported — put each case directly inside the switch braces', line);
          }
          const cond = this.expr(n.cond), len = items.length;
          return () => {
            vm.line = line;
            if (++vm.steps >= vm.nextCheck) vm.check();
            let i = labels.get(String(cond()));
            if (i === undefined) i = defIdx;
            if (i < 0) return 0;
            for (; i < len; i++) {
              const s = items[i]();
              if (s === BREAK) return 0;
              if (s) return s;
            }
            return 0;
          };
        }
        case 'case':
        case 'default':
          return this.stmt(n.body);
        case 'break': return () => BREAK;
        case 'continue': return () => CONTINUE;
        case 'return': {
          if (!n.e) return () => { vm.line = line; return RETURN; };
          const e = this.expr(n.e);
          if (isAgg(n.e.ty)) {
            const size = n.e.ty.size;
            return () => {
              vm.line = line;
              const src = e();
              vm.memcpy(vm.retBuf, src, size);
              vm.retVal = vm.retBuf;
              return RETURN;
            };
          }
          return () => {
            vm.line = line;
            if (++vm.steps >= vm.nextCheck) vm.check();
            vm.retVal = e();
            return RETURN;
          };
        }
      }
      throw new CError('compile', 'internal: unknown statement ' + n.k, line);
    }

    addr(n) {
      const vm = this;
      switch (n.k) {
        case 'var': {
          const o = n.obj;
          if (o.isLocal) { const off = o.offset; return () => vm.fp + off; }
          const a = o.addr;
          return () => a;
        }
        case 'deref': return this.expr(n.e);
        case 'member': {
          const b = this.addr(n.e), off = n.offset;
          return off ? () => b() + off : b;
        }
      }
      if (isAgg(n.ty)) return this.expr(n);
      throw new CError('compile', 'internal: not an lvalue (' + n.k + ')', n.line);
    }

    cond(n) {
      if (n.k === 'binop' && ['==', '!=', '<', '<=', '>', '>='].includes(n.op)) {
        const l = this.expr(n.lhs), r = this.expr(n.rhs);
        switch (n.op) {
          case '==': return () => l() === r();
          case '!=': return () => l() !== r();
          case '<': return () => l() < r();
          case '<=': return () => l() <= r();
          case '>': return () => l() > r();
          case '>=': return () => l() >= r();
        }
      }
      if (n.k === 'not') { const c = this.cond(n.e); return () => !c(); }
      if (n.k === 'logand') { const a = this.cond(n.lhs), b = this.cond(n.rhs); return () => a() && b(); }
      if (n.k === 'logor') { const a = this.cond(n.lhs), b = this.cond(n.rhs); return () => a() || b(); }
      if (n.k === 'num') { const b = !MC.isZero(n.val); return () => b; }
      const e = this.expr(n);
      if (isInt(n.ty) && n.ty.size === 8) return () => e() !== 0n;
      return () => e() !== 0;
    }

    castFn(f, from, to) {
      if (to.kind === 'void' || isAgg(to)) return f;
      if (isArr(from) || isFunc(from)) return f;
      if (to.kind === 'bool') {
        if (isInt(from) && from.size === 8) return () => (f() !== 0n ? 1 : 0);
        return () => (f() !== 0 ? 1 : 0);
      }
      const from64 = isInt(from) && from.size === 8;
      if (isFlo(to)) {
        if (from64) return to.kind === 'float' ? () => Math.fround(Number(f())) : () => Number(f());
        if (to.kind === 'float') return from.kind === 'float' ? f : () => Math.fround(f());
        return f;
      }
      const size = isPtr(to) ? 4 : to.size, uns = isPtr(to) || to.unsigned;
      if (isFlo(from)) {
        if (size === 8) {
          return () => {
            let v = Math.trunc(f());
            if (!isFinite(v)) v = 0;
            return uns ? BigInt.asUintN(64, BigInt(v)) : BigInt.asIntN(64, BigInt(v));
          };
        }
        const w = wrapFn(size, uns);
        return () => { const v = f(); return isFinite(v) ? w(Math.trunc(v)) : 0; };
      }
      const fsize = isPtr(from) ? 4 : from.size, funs = isPtr(from) || !!from.unsigned;
      if (size === 8) {
        if (fsize === 8) return funs === uns ? f : uns ? () => BigInt.asUintN(64, f()) : () => BigInt.asIntN(64, f());
        return uns ? () => BigInt.asUintN(64, BigInt(f())) : () => BigInt(f());
      }
      if (fsize === 8) {
        const w = wrapFn(size, uns);
        return () => w(Number(BigInt.asUintN(32, f())));
      }
      if (from.kind === 'bool') return f;
      if (size > fsize && (uns === funs || (!uns && funs))) return f;
      if (size === fsize && uns === funs) return f;
      const w = wrapFn(size, uns);
      return () => w(f());
    }

    binop(n) {
      const op = n.op, ty = n.opTy, vm = this;
      if (['==', '!=', '<', '<=', '>', '>='].includes(op)) {
        const c = this.cond(n);
        return () => (c() ? 1 : 0);
      }
      const l = this.expr(n.lhs);
      let r = this.expr(n.rhs);
      if (isFlo(ty)) {
        const fr = ty.kind === 'float' ? Math.fround : null;
        let f;
        switch (op) {
          case '+': f = () => l() + r(); break;
          case '-': f = () => l() - r(); break;
          case '*': f = () => l() * r(); break;
          case '/': f = () => l() / r(); break;
          default: throw new CError('compile', 'invalid operator ' + op + ' for floating point', n.line);
        }
        return fr ? () => fr(f()) : f;
      }
      if ((op === '<<' || op === '>>') && n.rhs.ty.size === 8) { const r0 = r; r = () => Number(r0()); }
      if (ty.size === 8 && !isPtr(ty)) {
        return () => {
          const v = evalBinop(op, l(), r(), ty);
          if (v === undefined) throw rt(vm, 'Division by zero (on a Cortex-M this can trigger a UsageFault).');
          return v;
        };
      }
      const uns = !!ty.unsigned;
      const dz = () => { throw rt(vm, 'Division by zero (on a Cortex-M this can trigger a UsageFault).'); };
      switch (op) {
        case '+': return uns ? () => (l() + r()) >>> 0 : () => (l() + r()) | 0;
        case '-': return uns ? () => (l() - r()) >>> 0 : () => (l() - r()) | 0;
        case '*': return uns ? () => Math.imul(l(), r()) >>> 0 : () => Math.imul(l(), r());
        case '/': return uns
          ? () => { const a = l(), b = r(); if (b === 0) dz(); return (a / b) >>> 0; }
          : () => { const a = l(), b = r(); if (b === 0) dz(); return (a / b) | 0; };
        case '%': return uns
          ? () => { const a = l(), b = r(); if (b === 0) dz(); return (a % b) >>> 0; }
          : () => { const a = l(), b = r(); if (b === 0) dz(); return (a % b) | 0; };
        case '&': return uns ? () => (l() & r()) >>> 0 : () => l() & r();
        case '|': return uns ? () => (l() | r()) >>> 0 : () => l() | r();
        case '^': return uns ? () => (l() ^ r()) >>> 0 : () => l() ^ r();
        case '<<': return uns ? () => (l() << r()) >>> 0 : () => l() << r();
        case '>>': return uns ? () => l() >>> r() : () => l() >> r();
      }
      throw new CError('compile', 'internal: unknown operator ' + op, n.line);
    }

    bitGetter(mem) {
      const unitTy = mem.ty.size === 1 ? T.uchar : mem.ty.size === 2 ? T.ushort : T.uint;
      const ld = this.load(unitTy), w = mem.bitWidth, b = mem.bitOffset, signed = !mem.ty.unsigned && mem.ty.kind !== 'bool';
      const mask = w >= 32 ? 0xffffffff : (1 << w) - 1;
      return a => {
        let v = ((ld(a) >>> b) & mask) >>> 0;
        if (signed && w < 32) v = (v << (32 - w)) >> (32 - w);
        return v;
      };
    }

    bitSetter(mem) {
      const unitTy = mem.ty.size === 1 ? T.uchar : mem.ty.size === 2 ? T.ushort : T.uint;
      const ld = this.load(unitTy), st = this.store(unitTy), w = mem.bitWidth, b = mem.bitOffset;
      const mask = w >= 32 ? 0xffffffff : (1 << w) - 1;
      const get = this.bitGetter(mem);
      return (a, v) => {
        const unit = ld(a);
        const nu = ((unit & ~((mask << b) >>> 0)) | ((Number(v) & mask) << b)) >>> 0;
        st(a, nu);
        return get(a);
      };
    }

    call(n) {
      const vm = this;
      const args = n.args.map(a => this.expr(a));
      const argTys = n.args.map(a => a.ty);
      const nargs = args.length;
      const retOff = n.retBuf ? n.retBuf.offset : -1;
      const evalArgs = () => {
        const vals = new Array(nargs);
        for (let i = 0; i < nargs; i++) vals[i] = args[i]();
        return vals;
      };
      if (n.fn.k === 'var' && n.fn.obj.isFunction) {
        const f = n.fn.obj;
        if (f.isBuiltin) {
          const impl = BUILTINS[f.name];
          return () => impl(vm, evalArgs(), argTys, n);
        }
        if (!f.isDefinition) {
          throw new CError('compile', "undefined reference to '" + f.name + "' — it is declared but its body is never written", n.line);
        }
        if (retOff >= 0) return () => { const v = evalArgs(); return vm.invoke(f, v, vm.fp + retOff); };
        return () => vm.invoke(f, evalArgs(), 0);
      }
      const fp = this.expr(n.fn);
      return () => {
        const a = fp();
        const vals = evalArgs();
        const f = vm.funcByAddr.get(a);
        if (!f) {
          if (a === 0) throw rt(vm, 'Called a NULL function pointer (HardFault). Make sure the function pointer is assigned before calling it.');
          throw rt(vm, 'HardFault: called a function pointer holding ' + hex8(a) + ', which is not a function.');
        }
        if (f.isBuiltin) return BUILTINS[f.name](vm, vals, argTys, n);
        if (!f.isDefinition) throw rt(vm, "Called '" + f.name + "' but it is never defined.");
        return vm.invoke(f, vals, retOff >= 0 ? vm.fp + retOff : 0);
      };
    }

    invoke(f, vals, retBuf) {
      const c = f.compiled;
      const savedFp = this.fp, savedSp = this.sp, savedRet = this.retBuf, savedLine = this.line;
      const sp = (this.sp - c.frameSize - 8) & ~7;
      if (sp < this.stackLimit || ++this.depth > 3000) {
        throw rt(this, 'Stack overflow while calling ' + f.name + '() — ' + (this.depth > 3000 ? 'recursion is too deep (does it have a base case?)' : 'the 32 KB stack is full. Deep or endless recursion (missing base case?) or big local arrays use it up.'));
      }
      if (sp < this.minSp) this.minSp = sp;
      this.sp = sp;
      this.fp = sp;
      const ps = c.params;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (p.st) p.st(sp + p.offset, vals[i] === undefined ? 0 : vals[i]);
        else this.memcpy(sp + p.offset, vals[i], p.size);
      }
      this.retBuf = retBuf;
      this.retVal = undefined;
      this.callStack.push(f.name);
      const st = c.body();
      let rv = st === RETURN ? this.retVal : undefined;
      if (rv === undefined && f.ty.ret.kind !== 'void') rv = isFlo(f.ty.ret) ? 0 : (f.ty.ret.size === 8 ? 0n : 0);
      this.callStack.pop();
      this.depth--;
      this.fp = savedFp;
      this.sp = savedSp;
      this.retBuf = savedRet;
      this.line = savedLine;
      return rv;
    }

    expr(n) {
      const vm = this;
      switch (n.k) {
        case 'num': { const v = n.val; return () => v; }
        case 'var':
        case 'deref':
        case 'member': {
          if (isArr(n.ty) || isFunc(n.ty) || isAgg(n.ty)) return this.addr(n);
          if (n.k === 'member' && n.mem.bitWidth !== undefined) {
            const a = this.addr(n), g = this.bitGetter(n.mem);
            return () => g(a());
          }
          const ld = this.load(n.ty);
          if (n.k === 'var' && n.obj.isLocal) { const off = n.obj.offset; return () => ld(vm.fp + off); }
          const a = this.addr(n);
          return () => ld(a());
        }
        case 'cur': { const box = n.box; return () => box.v; }
        case 'cast': return this.castFn(this.expr(n.e), n.e.ty, n.ty);
        case 'binop': return this.binop(n);
        case 'ptradd': {
          const p = this.expr(n.ptr), i = this.expr(n.idx), s = n.scale;
          return n.neg ? () => (p() - i() * s) >>> 0 : () => (p() + i() * s) >>> 0;
        }
        case 'ptrsub': {
          const l = this.expr(n.lhs), r = this.expr(n.rhs), s = n.scale;
          return () => ((l() - r()) / s) | 0;
        }
        case 'neg': {
          const e = this.expr(n.e), ty = n.ty;
          if (isFlo(ty)) return ty.kind === 'float' ? () => Math.fround(-e()) : () => -e();
          if (ty.size === 8) return ty.unsigned ? () => BigInt.asUintN(64, -e()) : () => BigInt.asIntN(64, -e());
          return ty.unsigned ? () => (-e()) >>> 0 : () => (-e()) | 0;
        }
        case 'bitnot': {
          const e = this.expr(n.e), ty = n.ty;
          if (ty.size === 8) return ty.unsigned ? () => BigInt.asUintN(64, ~e()) : () => BigInt.asIntN(64, ~e());
          return ty.unsigned ? () => (~e()) >>> 0 : () => ~e();
        }
        case 'not': { const c = this.cond(n.e); return () => (c() ? 0 : 1); }
        case 'logand':
        case 'logor': { const c = this.cond(n); return () => (c() ? 1 : 0); }
        case 'addr': return this.addr(n.e);
        case 'assign': {
          const lhs = n.lhs, ty = lhs.ty;
          if (isAgg(ty)) {
            const d = this.addr(lhs), s = this.expr(n.rhs), size = ty.size;
            return () => { const da = d(); vm.memcpy(da, s(), size); return da; };
          }
          const v = this.expr(n.rhs);
          if (lhs.k === 'member' && lhs.mem.bitWidth !== undefined) {
            const a = this.addr(lhs), set = this.bitSetter(lhs.mem);
            return () => { const ad = a(); return set(ad, v()); };
          }
          const st = this.store(ty);
          if (lhs.k === 'var' && lhs.obj.isLocal) {
            const off = lhs.obj.offset;
            return () => { const x = v(); st(vm.fp + off, x); return x; };
          }
          const a = this.addr(lhs);
          return () => { const ad = a(); const x = v(); st(ad, x); return x; };
        }
        case 'opassign': {
          const box = { v: 0 };
          n.cur.box = box;
          const lhs = n.lhs, post = n.post;
          const a = this.addr(lhs), e = this.expr(n.expr);
          let ld, st;
          if (lhs.k === 'member' && lhs.mem.bitWidth !== undefined) {
            ld = this.bitGetter(lhs.mem);
            st = this.bitSetter(lhs.mem);
          } else {
            ld = this.load(lhs.ty);
            st = this.store(lhs.ty);
          }
          if (post) return () => { const ad = a(); const old = ld(ad); box.v = old; st(ad, e()); return old; };
          return () => { const ad = a(); box.v = ld(ad); const nv = e(); st(ad, nv); return nv; };
        }
        case 'cond': {
          const c = this.cond(n.cond), t = this.expr(n.then), e = this.expr(n.els);
          return () => (c() ? t() : e());
        }
        case 'comma': {
          const l = this.expr(n.lhs), r = this.expr(n.rhs);
          return () => { l(); return r(); };
        }
        case 'call': return this.call(n);
        case 'initblk': {
          const assigns = n.assigns.map(a => this.expr(a));
          const a = this.addr({ k: 'var', obj: n.obj, ty: n.obj.ty }), size = n.obj.ty.size, zero = n.zero;
          return () => {
            if (zero) vm.memset(a(), 0, size);
            for (let i = 0; i < assigns.length; i++) assigns[i]();
            return 0;
          };
        }
      }
      throw new CError('compile', 'internal: unknown expression ' + n.k, n.line);
    }

    // --- execution
    check() {
      if (this.steps >= this.maxSteps) throw new Halt('steps');
      const now = this.now();
      if (now >= this.maxTimeUs) throw new Halt('time');
      if (!this.inIrq) this.board.tick(now);
      this.scheduleCheck();
    }

    scheduleCheck() {
      const now = this.now();
      const next = Math.min(this.maxTimeUs, this.board.nextEventTime());
      const until = Math.max(1, Math.ceil((next - now) / US_PER_STEP));
      this.nextCheck = Math.min(this.maxSteps, this.steps + (this.inIrq ? Math.max(until, 1000) : until));
    }

    delayUs(us) {
      if (!(us > 0)) return;
      if (this.inIrq) this.board.note('delay called inside an interrupt handler — keep ISRs short and never block in them.');
      const target = this.now() + us;
      for (;;) {
        const now = this.now();
        const next = this.inIrq ? Infinity : this.board.nextEventTime();
        if (next >= target || next < now) {
          this.extraUs += Math.max(0, target - now);
          break;
        }
        this.extraUs += next - now;
        if (this.now() >= this.maxTimeUs) throw new Halt('time');
        this.board.tick(this.now());
      }
      if (this.now() >= this.maxTimeUs) { this.extraUs -= this.now() - this.maxTimeUs; throw new Halt('time'); }
      this.scheduleCheck();
    }

    waitForInterrupt() {
      const next = this.board.nextEventTime();
      if (next === Infinity) {
        this.board.note('__WFI() with no interrupt source enabled — the CPU sleeps forever.');
        this.extraUs += this.maxTimeUs - this.now();
        throw new Halt('time');
      }
      if (next > this.now()) this.extraUs += next - this.now();
      if (this.now() >= this.maxTimeUs) throw new Halt('time');
      this.board.tick(this.now());
      this.scheduleCheck();
    }

    start() {
      this.romWritable = true;
      this.line = 0;
      for (const init of this.globalInits) init();
      this.romWritable = false;
      const main = this.handlers.main;
      this.scheduleCheck();
      const args = main.params.length >= 2 ? [1, this.argv] : main.params.length === 1 ? [1] : [];
      const rv = this.invoke(main, args, 0);
      return main.ty.ret.kind === 'void' ? 0 : Number(rv);
    }

    malloc(n) {
      n = alignTo(Math.max(1, n), 8);
      for (let i = 0; i < this.freeList.length; i++) {
        const b = this.freeList[i];
        if (b.s >= n) {
          const a = b.a;
          if (b.s === n) this.freeList.splice(i, 1);
          else { b.a += n; b.s -= n; }
          this.allocs.set(a, n);
          this.freed.delete(a);
          this.heapUsed += n;
          this.heapPeak = Math.max(this.heapPeak, this.heapUsed);
          return a;
        }
      }
      this.board.note('malloc(' + n + ') failed: the heap (' + (this.heapEnd - this.heapStart) + ' bytes) is full, so it returned NULL. Always check malloc\'s result!');
      return 0;
    }

    free(p) {
      if (!p) return;
      const n = this.allocs.get(p);
      if (n === undefined) {
        if (this.freed.has(p)) throw rt(this, 'free(): double free detected at ' + hex8(p) + ' — this block was already freed.');
        throw rt(this, 'free(): invalid pointer ' + hex8(p) + ' — only pass pointers that came from malloc/calloc/realloc.');
      }
      this.allocs.delete(p);
      this.freed.add(p);
      this.heapUsed -= n;
      this.freeList.push({ a: p, s: n });
      this.freeList.sort((x, y) => x.a - y.a);
      for (let i = 0; i < this.freeList.length - 1;) {
        const x = this.freeList[i], y = this.freeList[i + 1];
        if (x.a + x.s === y.a) { x.s += y.s; this.freeList.splice(i + 1, 1); } else i++;
      }
    }
  }

  // ================================================================ C library

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    return String.fromCharCode.apply(null, bytes);
  }
  const ascii = s => Array.from(s, c => c.charCodeAt(0) & 0xff);

  function fmtFloat(v, conv, prec, flags) {
    const upper = conv === conv.toUpperCase();
    let neg = v < 0 || Object.is(v, -0);
    const a = Math.abs(v);
    let body;
    if (!isFinite(a)) body = isNaN(a) ? 'nan' : 'inf';
    else {
      const c = conv.toLowerCase();
      const expForm = (x, p) => {
        let [m, e] = x.toExponential(p).split('e');
        const en = parseInt(e, 10);
        return m + 'e' + (en < 0 ? '-' : '+') + String(Math.abs(en)).padStart(2, '0');
      };
      if (c === 'f') body = a < 1e21 ? a.toFixed(prec) : BigInt(Math.round(a)).toString() + (prec ? '.' + '0'.repeat(prec) : '');
      else if (c === 'e') body = expForm(a, prec);
      else {
        const P = prec === 0 ? 1 : prec;
        const X = a === 0 ? 0 : parseInt(a.toExponential(P - 1).split('e')[1], 10);
        if (P > X && X >= -4) body = a.toFixed(Math.max(0, P - 1 - X));
        else body = expForm(a, P - 1);
        if (!flags.includes('#')) {
          if (body.includes('e')) body = body.replace(/\.?0+e/, 'e');
          else if (body.includes('.')) body = body.replace(/\.?0+$/, '');
        }
      }
      if (flags.includes('#') && !body.includes('.') && c !== 'g') body = body.replace(/^(\d+)/, '$1.');
    }
    if (upper) body = body.toUpperCase();
    if (isNaN(v)) neg = false;
    return { sign: neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '', body, numeric: isFinite(a) };
  }

  function format(vm, fmtAddr, args, ai) {
    const fmt = vm.readBytes(fmtAddr);
    const out = [];
    const next = () => (ai < args.length ? args[ai++] : 0);
    for (let i = 0; i < fmt.length; i++) {
      const c = fmt[i];
      if (c !== 37) { out.push(c); continue; }
      let j = i + 1;
      const ch = () => String.fromCharCode(fmt[j] || 0);
      let flags = '';
      while ('-+ #0'.includes(ch()) && j < fmt.length) flags += ch(), j++;
      let width = 0;
      if (ch() === '*') { width = Number(next()) | 0; j++; if (width < 0) { flags += '-'; width = -width; } }
      else while (ch() >= '0' && ch() <= '9' && j < fmt.length) width = width * 10 + (fmt[j++] - 48);
      let prec = null;
      if (ch() === '.') {
        j++;
        prec = 0;
        if (ch() === '*') { prec = Number(next()) | 0; j++; if (prec < 0) prec = null; }
        else while (ch() >= '0' && ch() <= '9' && j < fmt.length) prec = prec * 10 + (fmt[j++] - 48);
      }
      let len = '';
      while ('hlLqjzt'.includes(ch()) && j < fmt.length) len += ch(), j++;
      const conv = ch();
      i = j;
      if (conv === '%') { out.push(37); continue; }
      if (j >= fmt.length) { out.push(...fmt.slice(i - (j - i))); break; }
      let sign = '', prefix = '', body = '', numeric = true, bytes = null;
      const v = next();
      switch (conv) {
        case 'd': case 'i': {
          let x;
          if (len === 'hh') x = (Number(v) << 24) >> 24;
          else if (len === 'h') x = (Number(v) << 16) >> 16;
          else if (len === 'll' || len === 'j' || len === 'q') x = BigInt.asIntN(64, BigInt(typeof v === 'bigint' ? v : Math.trunc(Number(v))));
          else x = typeof v === 'bigint' ? Number(BigInt.asIntN(32, v)) : Number(v) | 0;
          const neg = x < 0;
          body = (neg ? -x : x).toString();
          sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
          if (prec !== null) { body = body.padStart(prec, '0'); if (prec === 0 && body === '0') body = ''; }
          break;
        }
        case 'u': case 'x': case 'X': case 'o': case 'b': {
          let x;
          if (len === 'hh') x = Number(v) & 0xff;
          else if (len === 'h') x = Number(v) & 0xffff;
          else if (len === 'll' || len === 'j' || len === 'q') x = BigInt.asUintN(64, BigInt(typeof v === 'bigint' ? v : Math.trunc(Number(v))));
          else x = typeof v === 'bigint' ? Number(BigInt.asUintN(32, v)) : Number(v) >>> 0;
          const radix = conv === 'u' ? 10 : conv === 'o' ? 8 : conv === 'b' ? 2 : 16;
          body = x.toString(radix);
          if (conv === 'X') body = body.toUpperCase();
          if (prec !== null) { body = body.padStart(prec, '0'); if (prec === 0 && body === '0') body = ''; }
          if (flags.includes('#') && body !== '0' && body !== '') {
            if (conv === 'x') prefix = '0x'; else if (conv === 'X') prefix = '0X'; else if (conv === 'o' && body[0] !== '0') prefix = '0';
          }
          break;
        }
        case 'c':
          bytes = [Number(v) & 0xff];
          numeric = false;
          break;
        case 's': {
          numeric = false;
          if (!v) bytes = ascii('(null)');
          else bytes = vm.readBytes(Number(v), prec);
          break;
        }
        case 'p':
          prefix = '0x';
          body = (Number(v) >>> 0).toString(16).padStart(8, '0');
          break;
        case 'f': case 'F': case 'e': case 'E': case 'g': case 'G': {
          const r = fmtFloat(typeof v === 'bigint' ? Number(v) : Number(v), conv, prec === null ? 6 : prec, flags);
          sign = r.sign; body = r.body; numeric = r.numeric;
          break;
        }
        case 'n':
          continue;
        default:
          out.push(37, ...ascii(conv));
          continue;
      }
      let content = bytes || ascii(sign + prefix + body);
      const pad = width - content.length;
      if (pad > 0) {
        if (flags.includes('-')) content = content.concat(ascii(' '.repeat(pad)));
        else if (flags.includes('0') && numeric && !(prec !== null && 'diuxXo'.includes(conv))) content = ascii(sign + prefix + '0'.repeat(pad) + body);
        else content = ascii(' '.repeat(pad)).concat(content);
      }
      out.push(...content);
    }
    return out;
  }

  function writeString(vm, dst, bytes, limit) {
    const n = limit === undefined ? bytes.length : Math.min(bytes.length, Math.max(0, limit - 1));
    for (let i = 0; i < n; i++) vm.wb(dst + i, bytes[i]);
    if (limit === undefined || limit > 0) vm.wb(dst + n, 0);
  }

  function parseIntFrom(vm, a, base) {
    let i = a;
    while ([32, 9, 10, 13, 11, 12].includes(vm.rb(i))) i++;
    let neg = false;
    if (vm.rb(i) === 45) { neg = true; i++; } else if (vm.rb(i) === 43) i++;
    if ((base === 0 || base === 16) && vm.rb(i) === 48 && (vm.rb(i + 1) | 32) === 120) { base = 16; i += 2; }
    else if (base === 0 && vm.rb(i) === 48) base = 8;
    else if (base === 0) base = 10;
    let v = 0, any = false;
    for (;;) {
      const c = vm.rb(i);
      let d = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 122 ? c - 87 : c >= 65 && c <= 90 ? c - 55 : 99;
      if (d >= base) break;
      v = v * base + d;
      any = true;
      i++;
    }
    return { v: neg ? -v : v, end: any ? i : a };
  }

  const ctype = {
    isdigit: c => c >= 48 && c <= 57,
    isalpha: c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122),
    isupper: c => c >= 65 && c <= 90,
    islower: c => c >= 97 && c <= 122,
    isspace: c => c === 32 || (c >= 9 && c <= 13),
    isxdigit: c => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102),
    ispunct: c => c > 32 && c < 127 && !((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)),
    isprint: c => c >= 32 && c < 127,
  };
  ctype.isalnum = c => ctype.isdigit(c) || ctype.isalpha(c);

  const BUILTINS = {
    printf: (vm, a) => { const b = format(vm, a[0], a, 1); vm.writeOut(b); return b.length; },
    fprintf: (vm, a) => { const b = format(vm, a[1], a, 2); vm.writeOut(b); return b.length; },
    sprintf: (vm, a) => { const b = format(vm, a[1], a, 2); writeString(vm, a[0], b); return b.length; },
    snprintf: (vm, a) => { const b = format(vm, a[2], a, 3); writeString(vm, a[0], b, a[1]); return b.length; },
    puts: (vm, a) => { vm.writeOut(vm.readBytes(a[0]).concat([10])); return 1; },
    fputs: (vm, a) => { vm.writeOut(vm.readBytes(a[0])); return 1; },
    putchar: (vm, a) => { vm.writeOut([a[0] & 0xff]); return a[0] & 0xff; },
    fflush: () => 0,
    getchar: vm => (vm.stdinPos < vm.stdin.length ? vm.stdin.charCodeAt(vm.stdinPos++) & 0xff : -1),
    scanf: (vm, a, tys) => {
      const fmt = vm.cstr(a[0]);
      let ai = 1, count = 0, i = 0;
      const s = vm.stdin;
      const skipWs = () => { while (vm.stdinPos < s.length && /\s/.test(s[vm.stdinPos])) vm.stdinPos++; };
      while (i < fmt.length) {
        const c = fmt[i];
        if (/\s/.test(c)) { skipWs(); i++; continue; }
        if (c !== '%') { if (s[vm.stdinPos] === c) { vm.stdinPos++; i++; continue; } break; }
        i++;
        let len = '';
        let width = 0;
        while (/\d/.test(fmt[i])) width = width * 10 + Number(fmt[i++]);
        while ('hlLjz'.includes(fmt[i])) len += fmt[i++];
        const conv = fmt[i++];
        if (conv === '%') { skipWs(); if (s[vm.stdinPos] === '%') { vm.stdinPos++; continue; } break; }
        if (conv !== 'c') skipWs();
        if (vm.stdinPos >= s.length) return count === 0 ? -1 : count;
        const ptr = a[ai], pty = tys[ai];
        ai++;
        if (!ptr) throw MC.rtError(vm, 'scanf: argument is NULL — pass the address of a variable, e.g. scanf("%d", &x)');
        const base = pty && MC.hasBase(pty) ? pty.base : T.int;
        if (conv === 'c') { vm.store(base)(ptr, s.charCodeAt(vm.stdinPos++)); count++; continue; }
        if (conv === 's') {
          let k = 0;
          while (vm.stdinPos < s.length && !/\s/.test(s[vm.stdinPos]) && (!width || k < width)) vm.wb(ptr + k++, s.charCodeAt(vm.stdinPos++));
          vm.wb(ptr + k, 0);
          count++;
          continue;
        }
        const rest = s.slice(vm.stdinPos);
        const re = 'fFeEgG'.includes(conv) ? /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/ : conv === 'x' || conv === 'X' ? /^[+-]?(0[xX])?[0-9a-fA-F]+/ : /^[+-]?\d+/;
        const m = re.exec(width ? rest.slice(0, width) : rest);
        if (!m) break;
        vm.stdinPos += m[0].length;
        let val = 'fFeEgG'.includes(conv) ? parseFloat(m[0]) : parseInt(m[0], conv === 'x' || conv === 'X' ? 16 : 10);
        vm.store(base)(ptr, convertValue(isFlo(base) ? val : (base.size === 8 ? BigInt(val) : val), isFlo(base) ? T.double : T.llong, base));
        count++;
      }
      return count;
    },
    strlen: (vm, a) => vm.readBytes(a[0]).length,
    strcpy: (vm, a) => { writeString(vm, a[0], vm.readBytes(a[1])); return a[0]; },
    strncpy: (vm, a) => {
      const b = vm.readBytes(a[1], a[2]);
      for (let i = 0; i < a[2]; i++) vm.wb(a[0] + i, i < b.length ? b[i] : 0);
      return a[0];
    },
    strcat: (vm, a) => { const d = vm.readBytes(a[0]).length; writeString(vm, a[0] + d, vm.readBytes(a[1])); return a[0]; },
    strncat: (vm, a) => { const d = vm.readBytes(a[0]).length; writeString(vm, a[0] + d, vm.readBytes(a[1], a[2])); return a[0]; },
    strcmp: (vm, a) => {
      for (let i = 0; ; i++) {
        const x = vm.rb(a[0] + i), y = vm.rb(a[1] + i);
        if (x !== y || x === 0) return x - y;
      }
    },
    strncmp: (vm, a) => {
      for (let i = 0; i < a[2]; i++) {
        const x = vm.rb(a[0] + i), y = vm.rb(a[1] + i);
        if (x !== y || x === 0) return x - y;
      }
      return 0;
    },
    strchr: (vm, a) => {
      for (let i = 0; ; i++) {
        const x = vm.rb(a[0] + i);
        if (x === (a[1] & 0xff)) return a[0] + i;
        if (x === 0) return 0;
      }
    },
    strrchr: (vm, a) => {
      let found = 0;
      for (let i = 0; ; i++) {
        const x = vm.rb(a[0] + i);
        if (x === (a[1] & 0xff)) found = a[0] + i;
        if (x === 0) return found;
      }
    },
    strstr: (vm, a) => {
      const h = vm.readBytes(a[0]), nd = vm.readBytes(a[1]);
      outer: for (let i = 0; i + nd.length <= h.length; i++) {
        for (let j = 0; j < nd.length; j++) if (h[i + j] !== nd[j]) continue outer;
        return a[0] + i;
      }
      return 0;
    },
    memset: (vm, a) => { vm.memset(a[0], a[1], a[2]); return a[0]; },
    memcpy: (vm, a) => { vm.memcpy(a[0], a[1], a[2]); return a[0]; },
    memmove: (vm, a) => { vm.memcpy(a[0], a[1], a[2]); return a[0]; },
    memcmp: (vm, a) => {
      for (let i = 0; i < a[2]; i++) {
        const x = vm.rb(a[0] + i), y = vm.rb(a[1] + i);
        if (x !== y) return x - y;
      }
      return 0;
    },
    malloc: (vm, a) => vm.malloc(a[0]),
    calloc: (vm, a) => { const n = a[0] * a[1]; const p = vm.malloc(n); if (p) vm.memset(p, 0, n); return p; },
    realloc: (vm, a) => {
      if (!a[0]) return vm.malloc(a[1]);
      const old = vm.allocs.get(a[0]);
      if (old === undefined) throw MC.rtError(vm, 'realloc(): invalid pointer ' + hex8(a[0]));
      const p = vm.malloc(a[1]);
      if (!p) return 0;
      vm.memcpy(p, a[0], Math.min(old, a[1]));
      vm.free(a[0]);
      return p;
    },
    free: (vm, a) => { vm.free(a[0]); },
    abs: (vm, a) => Math.abs(a[0]) | 0,
    labs: (vm, a) => Math.abs(a[0]) | 0,
    atoi: (vm, a) => parseIntFrom(vm, a[0], 10).v | 0,
    atol: (vm, a) => parseIntFrom(vm, a[0], 10).v | 0,
    strtol: (vm, a) => {
      const r = parseIntFrom(vm, a[0], a[2]);
      if (a[1]) vm.store(MC.ptrTo(T.char))(a[1], r.end);
      return Math.max(-2147483648, Math.min(2147483647, r.v)) | 0;
    },
    strtoul: (vm, a) => {
      const r = parseIntFrom(vm, a[0], a[2]);
      if (a[1]) vm.store(MC.ptrTo(T.char))(a[1], r.end);
      return r.v >>> 0;
    },
    rand: vm => {
      vm.randState = (Math.imul(vm.randState, 1103515245) + 12345) >>> 0;
      return (vm.randState >>> 16) & 0x7fff;
    },
    srand: (vm, a) => { vm.randState = a[0] >>> 0; },
    exit: (vm, a) => { throw new Halt('exit', a[0] | 0); },
    abort: vm => { throw MC.rtError(vm, 'abort() was called'); },
    qsort: (vm, a) => {
      const [base, n, size, cmp] = a;
      const f = vm.funcByAddr.get(cmp);
      if (!f || !f.isDefinition) throw MC.rtError(vm, 'qsort: the compare function pointer is invalid');
      const items = [];
      for (let i = 0; i < n; i++) { const it = []; for (let j = 0; j < size; j++) it.push(vm.rb(base + i * size + j)); items.push(it); }
      const pa = vm.malloc(size), pb = vm.malloc(size);
      if (!pa || !pb) throw MC.rtError(vm, 'qsort: out of heap memory');
      const compare = (x, y) => {
        for (let j = 0; j < size; j++) { vm.wb(pa + j, x[j]); vm.wb(pb + j, y[j]); }
        return Number(vm.invoke(f, [pa, pb], 0)) | 0;
      };
      const sorted = mergeSort(items, compare);
      sorted.forEach((it, i) => { for (let j = 0; j < size; j++) vm.wb(base + i * size + j, it[j]); });
      vm.free(pa);
      vm.free(pb);
    },
    toupper: (vm, a) => (ctype.islower(a[0]) ? a[0] - 32 : a[0]),
    tolower: (vm, a) => (ctype.isupper(a[0]) ? a[0] + 32 : a[0]),
    sqrt: (vm, a) => Math.sqrt(a[0]),
    sqrtf: (vm, a) => Math.fround(Math.sqrt(a[0])),
    pow: (vm, a) => Math.pow(a[0], a[1]),
    fabs: (vm, a) => Math.abs(a[0]),
    fabsf: (vm, a) => Math.fround(Math.abs(a[0])),
    floor: (vm, a) => Math.floor(a[0]),
    ceil: (vm, a) => Math.ceil(a[0]),
    round: (vm, a) => (a[0] < 0 ? -Math.round(-a[0]) : Math.round(a[0])),
    sin: (vm, a) => Math.sin(a[0]),
    cos: (vm, a) => Math.cos(a[0]),
    tan: (vm, a) => Math.tan(a[0]),
    atan: (vm, a) => Math.atan(a[0]),
    atan2: (vm, a) => Math.atan2(a[0], a[1]),
    exp: (vm, a) => Math.exp(a[0]),
    log: (vm, a) => Math.log(a[0]),
    log10: (vm, a) => Math.log10(a[0]),
    log2: (vm, a) => Math.log2(a[0]),
    fmod: (vm, a) => a[0] % a[1],
    fmin: (vm, a) => Math.min(a[0], a[1]),
    fmax: (vm, a) => Math.max(a[0], a[1]),
    assert: (vm, a) => { if (!a[0]) throw MC.rtError(vm, 'Assertion failed'); },
    delay_ms: (vm, a) => { vm.delayUs((a[0] >>> 0) * 1000); },
    delay_us: (vm, a) => { vm.delayUs(a[0] >>> 0); },
    millis: vm => Math.floor(vm.now() / 1000) >>> 0,
    micros: vm => Math.floor(vm.now()) >>> 0,
    __NOP: () => {},
    __WFI: vm => { vm.waitForInterrupt(); },
    __enable_irq: vm => { vm.primask = 0; vm.nextCheck = vm.steps + 1; },
    __disable_irq: vm => { vm.primask = 1; },
    NVIC_EnableIRQ: (vm, a) => { if (a[0] >= 0) { vm.board.nvic[a[0] >> 5] |= 1 << (a[0] & 31); vm.nextCheck = vm.steps + 1; } },
    NVIC_DisableIRQ: (vm, a) => { if (a[0] >= 0) vm.board.nvic[a[0] >> 5] &= ~(1 << (a[0] & 31)); },
    SysTick_Config: (vm, a) => {
      const ticks = a[0] >>> 0;
      if (ticks - 1 > 0xffffff) return 1;
      vm.board.write(0xE000E014, 4, ticks - 1);
      vm.board.write(0xE000E018, 4, 0);
      vm.board.write(0xE000E010, 4, 7);
      return 0;
    },
  };
  for (const [k, f] of Object.entries(ctype)) BUILTINS[k] = (vm, a) => (f(a[0]) ? 1 : 0);
  MC.BUILTINS = BUILTINS;
  MC.rtError = rt;

  function mergeSort(arr, cmp) {
    if (arr.length <= 1) return arr;
    const mid = arr.length >> 1;
    const l = mergeSort(arr.slice(0, mid), cmp), r = mergeSort(arr.slice(mid), cmp);
    const out = [];
    let i = 0, j = 0;
    while (i < l.length && j < r.length) out.push(cmp(l[i], r[j]) <= 0 ? l[i++] : r[j++]);
    return out.concat(l.slice(i), r.slice(j));
  }

  // ========================================================= headers & driver

  const PREDEFINED = {
    NULL: '((void *)0)', true: '1', false: '0', EOF: '(-1)', stdout: '((FILE *)1)', stderr: '((FILE *)2)', stdin: '((FILE *)0)',
    EXIT_SUCCESS: '0', EXIT_FAILURE: '1', RAND_MAX: '32767', CHAR_BIT: '8',
    SCHAR_MIN: '(-128)', SCHAR_MAX: '127', UCHAR_MAX: '255', CHAR_MIN: '(-128)', CHAR_MAX: '127',
    SHRT_MIN: '(-32768)', SHRT_MAX: '32767', USHRT_MAX: '65535',
    INT_MIN: '(-2147483647-1)', INT_MAX: '2147483647', UINT_MAX: '4294967295U',
    LONG_MIN: '(-2147483647L-1)', LONG_MAX: '2147483647L', ULONG_MAX: '4294967295UL',
    LLONG_MIN: '(-9223372036854775807LL-1)', LLONG_MAX: '9223372036854775807LL', ULLONG_MAX: '18446744073709551615ULL',
    INT8_MIN: '(-128)', INT8_MAX: '127', UINT8_MAX: '255', INT16_MIN: '(-32768)', INT16_MAX: '32767', UINT16_MAX: '65535',
    INT32_MIN: '(-2147483647-1)', INT32_MAX: '2147483647', UINT32_MAX: '4294967295U',
    INT64_MAX: '9223372036854775807LL', UINT64_MAX: '18446744073709551615ULL', SIZE_MAX: '4294967295U',
    M_PI: '3.14159265358979323846', M_E: '2.7182818284590452354', FLT_MAX: '3.40282347e+38F', DBL_MAX: '1.7976931348623157e+308',
    FLT_EPSILON: '1.19209290e-7F', DBL_EPSILON: '2.2204460492503131e-16', FLT_MIN: '1.17549435e-38F',
    PRId8: '"d"', PRIu8: '"u"', PRIx8: '"x"', PRId16: '"d"', PRIu16: '"u"', PRIx16: '"x"', PRIX16: '"X"',
    PRId32: '"d"', PRIu32: '"u"', PRIx32: '"x"', PRIX32: '"X"', PRId64: '"lld"', PRIu64: '"llu"', PRIx64: '"llx"',
    __STDC__: '1', __STDC_VERSION__: '201112L', __GNUC__: '12', __ARM_ARCH: '7', __arm__: '1', __CORTEX_M: '4',
  };
  // offsetof needs function-like syntax; added via source below.
  const PREDEFINED_SRC = '#define offsetof(type, member) ((size_t)&(((type *)0)->member))\n';

  MC.BOARD_H = `
#ifndef BOARD_H
#define BOARD_H
/* SkillBoost virtual board: an STM32F4-style Cortex-M4 at 16 MHz.
   LEDs: PA0..PA7   Button: PC13 (reads 1 while pressed)   Pot: ADC1 (0..4095)
   UART terminal: USART2 (TX)                                                */
#define __IO volatile
#define __I  volatile const
#define SystemCoreClock 16000000UL

typedef struct { __IO uint32_t MODER, OTYPER, OSPEEDR, PUPDR, IDR, ODR, BSRR, LCKR, AFR[2]; } GPIO_TypeDef;
typedef struct { __IO uint32_t CR, PLLCFGR, CFGR, CIR, AHB1RSTR, AHB2RSTR, AHB3RSTR, RESERVED0, APB1RSTR, APB2RSTR,
                 RESERVED1[2], AHB1ENR, AHB2ENR, AHB3ENR, RESERVED2, APB1ENR, APB2ENR; } RCC_TypeDef;
typedef struct { __IO uint32_t SR, DR, BRR, CR1, CR2, CR3, GTPR; } USART_TypeDef;
typedef struct { __IO uint32_t IMR, EMR, RTSR, FTSR, SWIER, PR; } EXTI_TypeDef;
typedef struct { __IO uint32_t MEMRMP, PMC, EXTICR[4]; } SYSCFG_TypeDef;
typedef struct { __IO uint32_t SR, CR1, CR2, SMPR1, SMPR2, JOFR1, JOFR2, JOFR3, JOFR4, HTR, LTR, SQR1, SQR2, SQR3,
                 JSQR, JDR1, JDR2, JDR3, JDR4, DR; } ADC_TypeDef;
typedef struct { __IO uint32_t CR1, CR2, SMCR, DIER, SR, EGR, CCMR1, CCMR2, CCER, CNT, PSC, ARR, RCR,
                 CCR1, CCR2, CCR3, CCR4; } TIM_TypeDef;
typedef struct { __IO uint32_t CTRL, LOAD, VAL; __I uint32_t CALIB; } SysTick_Type;

#define RCC     ((RCC_TypeDef *)    0x40023800UL)
#define GPIOA   ((GPIO_TypeDef *)   0x40020000UL)
#define GPIOB   ((GPIO_TypeDef *)   0x40020400UL)
#define GPIOC   ((GPIO_TypeDef *)   0x40020800UL)
#define USART1  ((USART_TypeDef *)  0x40011000UL)
#define USART2  ((USART_TypeDef *)  0x40004400UL)
#define EXTI    ((EXTI_TypeDef *)   0x40013C00UL)
#define SYSCFG  ((SYSCFG_TypeDef *) 0x40013800UL)
#define ADC1    ((ADC_TypeDef *)    0x40012000UL)
#define TIM2    ((TIM_TypeDef *)    0x40000000UL)
#define SysTick ((SysTick_Type *)   0xE000E010UL)

/* Raw register addresses, for the "pointer to a register" style */
#define RCC_AHB1ENR_ADDR  0x40023830UL
#define GPIOA_MODER_ADDR  0x40020000UL
#define GPIOA_IDR_ADDR    0x40020010UL
#define GPIOA_ODR_ADDR    0x40020014UL
#define GPIOA_BSRR_ADDR   0x40020018UL
#define GPIOC_IDR_ADDR    0x40020810UL

#define RCC_AHB1ENR_GPIOAEN   (1U << 0)
#define RCC_AHB1ENR_GPIOBEN   (1U << 1)
#define RCC_AHB1ENR_GPIOCEN   (1U << 2)
#define RCC_APB1ENR_TIM2EN    (1U << 0)
#define RCC_APB1ENR_USART2EN  (1U << 17)
#define RCC_APB2ENR_USART1EN  (1U << 4)
#define RCC_APB2ENR_ADC1EN    (1U << 8)
#define RCC_APB2ENR_SYSCFGEN  (1U << 14)

#define USART_SR_TXE   (1U << 7)
#define USART_SR_TC    (1U << 6)
#define USART_SR_RXNE  (1U << 5)
#define USART_CR1_UE   (1U << 13)
#define USART_CR1_TE   (1U << 3)
#define USART_CR1_RE   (1U << 2)

#define TIM_CR1_CEN    (1U << 0)
#define TIM_DIER_UIE   (1U << 0)
#define TIM_SR_UIF     (1U << 0)
#define TIM_EGR_UG     (1U << 0)

#define ADC_CR2_ADON     (1U << 0)
#define ADC_CR2_SWSTART  (1U << 30)
#define ADC_SR_EOC       (1U << 1)

#define EXTI_IMR_MR13    (1U << 13)
#define EXTI_RTSR_TR13   (1U << 13)
#define EXTI_FTSR_TR13   (1U << 13)
#define EXTI_PR_PR13     (1U << 13)

#define SysTick_CTRL_ENABLE_Msk     (1U << 0)
#define SysTick_CTRL_TICKINT_Msk    (1U << 1)
#define SysTick_CTRL_CLKSOURCE_Msk  (1U << 2)
#define SysTick_CTRL_COUNTFLAG_Msk  (1U << 16)

typedef enum { SysTick_IRQn = -1, TIM2_IRQn = 28, USART2_IRQn = 38, EXTI15_10_IRQn = 40 } IRQn_Type;

#define LED_COUNT  8
#define BUTTON_PIN 13
#endif
`;

  function compile(src, opts) {
    opts = opts || {};
    const warnings = [];
    const defines = Object.assign({}, PREDEFINED, opts.defines || {});
    const pp = new MC.Preprocessor({ includes: { 'board.h': MC.BOARD_H }, defines, warnings });
    let toks = MC.tokenize(PREDEFINED_SRC, 0);
    toks.pop();
    toks = toks.concat(MC.tokenize(src, 1));
    if (opts.harness) {
      toks.pop();
      toks = toks.concat(MC.tokenize(opts.harness, HARNESS_LINE));
    }
    toks = pp.run(toks);
    const parser = new MC.Parser(toks, { warnings });
    const prog = parser.program();
    const main = prog.functions.find(f => f.name === 'main' && f.isDefinition);
    if (!main) throw new CError('compile', "undefined reference to 'main' — every C program needs an int main(void) { ... } function", 0);
    prog.warnings = warnings;
    return prog;
  }
  MC.compile = compile;

  // Compiles and runs a program. Never throws for user errors.
  MC.run = function (src, opts) {
    opts = opts || {};
    const res = {
      compiled: false, errors: [], warnings: [], stdout: '', exitCode: null, status: 'error',
      runtimeError: null, message: '', steps: 0, timeMs: 0, board: null, heap: null, stackUsed: 0,
    };
    let prog, vm;
    try {
      prog = compile(src, opts);
      vm = new Machine(prog, opts);
    } catch (e) {
      if (!(e instanceof CError)) throw e;
      res.errors.push({ line: e.line, msg: e.message });
      return res;
    }
    res.compiled = true;
    res.warnings = prog.warnings.filter(w => w.line > 0 && w.line < HARNESS_LINE);
    const seen = new Set();
    res.warnings = res.warnings.filter(w => { const k = w.line + w.msg; if (seen.has(k)) return false; seen.add(k); return true; });
    try {
      res.exitCode = vm.start();
      res.status = 'ok';
    } catch (e) {
      if (e instanceof Halt) {
        if (e.reason === 'exit') { res.status = 'ok'; res.exitCode = e.code; }
        else if (e.reason === 'time') { res.status = 'timeout'; res.message = 'Simulation stopped at ' + (vm.now() / 1e6).toFixed(3) + ' s of virtual time. Firmware normally loops forever, so this is expected for board programs.'; }
        else if (e.reason === 'steps') { res.status = 'timeout'; res.message = 'Stopped after ' + vm.steps.toLocaleString('en-US') + ' steps — is there an infinite loop?'; }
        else if (e.reason === 'output') { res.status = 'timeout'; res.message = 'Too much output — the program was stopped.'; }
      } else if (e instanceof CError) {
        res.status = 'error';
        res.runtimeError = { line: e.line, msg: e.message };
      } else if (e instanceof RangeError) {
        res.status = 'error';
        res.runtimeError = { line: vm.line, msg: 'Stack overflow — recursion is too deep (does it have a base case?)' };
      } else {
        throw e;
      }
    }
    const all = [];
    for (const c of vm.outChunks) for (const b of c) all.push(b);
    res.stdout = utf8Decode(all);
    res.outTimeline = vm.outTimeline;
    res.steps = vm.steps;
    res.timeMs = vm.now() / 1000;
    res.board = vm.board.summary();
    res.heap = { inUse: vm.heapUsed, blocks: vm.allocs.size, peak: vm.heapPeak, size: vm.heapEnd - vm.heapStart };
    res.stackUsed = vm.stackTop - vm.minSp;
    res.globalsSize = vm.dataEnd - SRAM_BASE;
    return res;
  };

  MC.formatValueForTest = format;
})(typeof window !== 'undefined' ? (window.MiniC = window.MiniC || {}) : (global.MiniC = global.MiniC || {}));
