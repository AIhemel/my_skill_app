// Embedded C curriculum, part 3: microcontrollers, peripherals, architecture & design.
// Board programs use #include "board.h" (an STM32F4-style register map). See the Board reference.
(function () {
  const MC = window.MiniC;
  // Checks that LED `bit` toggles with the given period (ms), starting state `firstOn`.
  const blinkCheck = (bit, periodMs, minEdges, firstOn, tol) => r => {
    const e = MC.ledEdges(r, bit);
    if (e.length < minEdges) return 'LED PA' + bit + ' changed ' + e.length + ' time(s); expected at least ' + minEdges + '. Check the clock enable and MODER setup.';
    if (firstOn !== undefined && e[0].on !== firstOn) return 'LED PA' + bit + ' should start ' + (firstOn ? 'ON' : 'OFF') + '.';
    for (let i = 1; i < minEdges; i++) {
      const dt = e[i].t - e[i - 1].t;
      if (Math.abs(dt - periodMs) > (tol || 15)) return 'LED PA' + bit + ' changed after ' + dt.toFixed(1) + ' ms; expected every ' + periodMs + ' ms.';
    }
    return true;
  };

  window.LESSONS = (window.LESSONS || []).concat([
{
  id: 'mcu', unit: 'Microcontrollers', title: 'What is inside a microcontroller?', emoji: '🔬', minutes: 15,
  body: [
    ['p', 'A **microcontroller (MCU)** is a whole computer on one chip: CPU, Flash (program memory), SRAM (data memory) and peripherals. A *microprocessor* (like your laptop CPU) needs external RAM and storage chips.'],
    ['pre', String.raw`+--------------------------- MCU chip ---------------------------+
|  +-----------+   bus matrix (AHB)   +-------+   +-------+       |
|  | Cortex-M4 |======================| Flash |   | SRAM  |       |
|  |  CPU+FPU  |          |           | 256K  |   | 128K  |       |
|  +-----------+          |           +-------+   +-------+       |
|      | NVIC        +----+----+  bridges to slower APB buses     |
|  SysTick           |  GPIO   |  UART  SPI  I2C  ADC  TIM  DMA   |
|                    +---------+                                  |
|  RCC (clocks)   watchdog   debug (SWD)                          |
+------------------------------------------------------------------+`],
    ['h', 'Everything is an address'],
    ['p', 'ARM Cortex-M chips use one 4 GB address space. Memory and peripherals each get a range. This simulator follows the STM32F4 layout:'],
    ['table', [['Range', 'What', 'Notes'], ['0x0800 0000', 'Flash', 'code, const data, vector table'], ['0x2000 0000', 'SRAM', 'globals, heap, stack'], ['0x4000 0000', 'Peripherals', 'TIM2 0x40000000, USART2 0x40004400, GPIOA 0x40020000, RCC 0x40023800'], ['0xE000 0000', 'Cortex-M system', 'SysTick 0xE000E010, NVIC 0xE000E100']]],
    ['code', String.raw`#include <stdio.h>
#include <stdlib.h>

int counter = 1;                      // SRAM (.data)
const int table[3] = {1, 2, 3};       // Flash (.rodata)

int main(void)
{
    int local = 0;                    // SRAM (stack)
    int *heap = malloc(16);           // SRAM (heap)
    printf("code  main()   at %p\n", (void *)main);
    printf("const table    at %p\n", (void *)table);
    printf("global counter at %p\n", (void *)&counter);
    printf("heap block     at %p\n", (void *)heap);
    printf("local variable at %p\n", (void *)&local);
    free(heap);
    return 0;
}`, true],
    ['h', 'What happens at reset'],
    ['ol', ['The CPU reads the initial stack pointer from address 0x08000000 and the reset handler address from 0x08000004 (the vector table).', 'The reset handler copies `.data` initial values from Flash to RAM and zeroes `.bss`.', '`SystemInit()` configures clocks (PLL, Flash wait states).', 'Finally it calls `main()`.']],
    ['h', 'Popular families'],
    ['table', [['Family', 'Core', 'Typical use'], ['ATmega328P (Arduino Uno)', '8-bit AVR, 16 MHz', 'hobby, simple control'], ['STM32F0/F4/H7', 'ARM Cortex-M0/M4/M7', 'industry workhorse'], ['ESP32', 'Xtensa / RISC-V + Wi-Fi', 'IoT'], ['RP2040 (Raspberry Pi Pico)', 'dual Cortex-M0+', 'education, maker'], ['nRF52', 'Cortex-M4F + Bluetooth', 'wearables']]],
  ],
  quiz: [
    { q: 'Which memory holds your program code on an MCU?', options: ['SRAM', 'Flash', 'Registers', 'Cache'], answer: 1, explain: 'Code is stored in non-volatile Flash and executed from there.' },
    { q: 'On STM32, peripherals are accessed…', options: ['with special I/O instructions', 'at memory addresses (memory-mapped)', 'only through the OS', 'over USB'], answer: 1, explain: 'Peripheral registers live in the address space starting at 0x40000000.' },
    { q: 'What runs before main() after reset?', options: ['Nothing', 'The reset handler / startup code', 'The bootloader always', 'printf'], answer: 1, explain: 'Startup code initializes .data/.bss, clocks and the stack, then calls main().' },
    { q: 'Which is NOT inside a typical MCU?', options: ['Flash', 'SRAM', 'GPIO', 'A hard disk'], answer: 3, explain: 'MCUs integrate memory and peripherals, but not disks.' },
  ],
  challenges: [
    {
      title: 'Where does this address live?', mode: 'function',
      prompt: 'Write `const char *region_of(uint32_t addr)` that returns:\n\n`"FLASH"` for 0x08000000–0x0803FFFF\n`"SRAM"` for 0x20000000–0x2001FFFF\n`"PERIPH"` for 0x40000000–0x5FFFFFFF\n`"SYSTEM"` for 0xE0000000–0xFFFFFFFF\n`"INVALID"` otherwise.',
      starter: String.raw`#include <stdint.h>

const char *region_of(uint32_t addr)
{
    // TODO
    return "INVALID";
}`,
      solution: String.raw`#include <stdint.h>

const char *region_of(uint32_t addr)
{
    if (addr >= 0x08000000u && addr <= 0x0803FFFFu) return "FLASH";
    if (addr >= 0x20000000u && addr <= 0x2001FFFFu) return "SRAM";
    if (addr >= 0x40000000u && addr <= 0x5FFFFFFFu) return "PERIPH";
    if (addr >= 0xE0000000u) return "SYSTEM";
    return "INVALID";
}`,
      hints: ['Use unsigned constants like 0x40000000u in the comparisons.', 'Check each range with >= start && <= end.'],
      tests: [
        { name: 'fixed addresses', harness: String.raw`#include <stdio.h>
int main(void) { uint32_t a[] = {0x08000000u, 0x0803FFFFu, 0x08040000u, 0x20000000u, 0x40020014u, 0xE000E010u, 0x00000000u, 0x30000000u}; for (int i = 0; i < 8; i++) printf("%s ", region_of(a[i])); printf("\n"); return 0; }`, expect: 'FLASH FLASH INVALID SRAM PERIPH SYSTEM INVALID INVALID' },
        { name: 'real objects', harness: String.raw`#include <stdio.h>
int g; const int k = 5;
int main(void) { int l; printf("%s %s %s %s\n", region_of((uint32_t)&g), region_of((uint32_t)&l), region_of((uint32_t)&k), region_of((uint32_t)main)); return 0; }`, expect: 'SRAM SRAM FLASH FLASH' },
      ],
    },
    {
      title: 'Align an address', mode: 'function',
      prompt: 'Linkers and allocators round addresses up to an alignment. Write `uint32_t align_up(uint32_t addr, uint32_t align)` where align is a power of two. Example: align_up(0x20000005, 8) = 0x20000008. Bonus: do it without division.',
      starter: String.raw`#include <stdint.h>

uint32_t align_up(uint32_t addr, uint32_t align)
{
    // TODO
    return addr;
}`,
      solution: String.raw`#include <stdint.h>

uint32_t align_up(uint32_t addr, uint32_t align)
{
    return (addr + align - 1u) & ~(align - 1u);
}`,
      hints: ['Add align - 1, then clear the low bits.', 'For a power of two, align - 1 is a mask of the low bits: & ~(align - 1).'],
      tests: [{ name: 'values', harness: String.raw`#include <stdio.h>
int main(void) { printf("0x%08X 0x%08X 0x%08X 0x%08X\n", align_up(0x20000005u, 8), align_up(0x20000008u, 8), align_up(13, 4), align_up(0x08000001u, 0x400)); return 0; }`, expect: '0x20000008 0x20000008 0x00000010 0x08000400' }],
    },
  ],
},
{
  id: 'gpio', unit: 'Microcontrollers', title: 'GPIO: your first blinking LED', emoji: '💡', minutes: 18,
  body: [
    ['p', 'GPIO (General-Purpose Input/Output) pins are controlled through registers. On STM32 every port (GPIOA, GPIOB, …) has the same register block:'],
    ['table', [['Register', 'Offset', 'Purpose'], ['MODER', '0x00', '2 bits per pin: 00 input, 01 output, 10 alternate, 11 analog'], ['IDR', '0x10', 'input data: read pin levels'], ['ODR', '0x14', 'output data: 1 = high, 0 = low'], ['BSRR', '0x18', 'write 1 to bit n to set pin n, to bit n+16 to reset it (atomic)']]],
    ['h', 'Three steps to drive an LED'],
    ['ol', ['**Enable the clock** for the port: `RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;` — peripherals are off by default to save power. Forgetting this is the #1 beginner bug.', '**Configure the pin as output**: set its 2 MODER bits to `01`.', '**Write** the output: ODR or BSRR.']],
    ['note', 'The virtual board has **8 LEDs on PA0–PA7**, a **button on PC13** (reads 1 while pressed), a **potentiometer on ADC1** and a **UART terminal on USART2**. `#include "board.h"` gives you CMSIS-style definitions like `GPIOA->ODR`.'],
    ['code', String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;        // 1. clock on

    GPIOA->MODER &= ~(3U << (5 * 2));           // 2. PA5 mode bits = 00
    GPIOA->MODER |=  (1U << (5 * 2));           //    then 01 = output

    while (1) {
        GPIOA->ODR ^= (1U << 5);                // 3. toggle PA5
        delay_ms(500);
    }
}`, true],
    ['h', 'Same thing, raw pointers'],
    ['p', 'The struct style above is just a nicer way to write addresses. Underneath it is exactly this:'],
    ['code', String.raw`#include <stdint.h>

#define RCC_AHB1ENR (*(volatile uint32_t *)0x40023830)
#define GPIOA_MODER (*(volatile uint32_t *)0x40020000)
#define GPIOA_BSRR  (*(volatile uint32_t *)0x40020018)

int main(void)
{
    RCC_AHB1ENR |= 1U;              // GPIOAEN is bit 0
    GPIOA_MODER |= 0x5555U;         // PA0..PA7 as outputs (01 01 01 ...)
    GPIOA_BSRR = (1U << 0) | (1U << 7);          // set PA0 and PA7
    delay_ms(300);
    GPIOA_BSRR = (1U << (0 + 16));               // reset PA0
    return 0;
}`, true],
    ['tip', 'Try deleting the RCC line and running again — the board panel explains why nothing lights up.'],
  ],
  quiz: [
    { q: 'What must you do before using GPIOA on STM32?', options: ['Call printf', 'Enable its clock in RCC', 'Reset the CPU', 'Nothing'], answer: 1, explain: 'Peripheral clocks are gated off by default; registers ignore writes until enabled.' },
    { q: 'To make PA3 an output, its MODER bits [7:6] should be…', options: ['00', '01', '10', '11'], answer: 1, explain: '01 is general-purpose output mode.' },
    { q: 'GPIOA->BSRR = (1U << (2 + 16)); does what?', options: ['Sets PA2', 'Resets (clears) PA2', 'Toggles PA2', 'Sets PA18'], answer: 1, explain: 'The upper 16 bits of BSRR reset pins.' },
    { q: 'Why is BSRR better than ODR |= for changing one pin?', options: ['It is shorter', 'It is a single atomic write, no read-modify-write race', 'ODR is read-only', 'It uses less power'], answer: 1, explain: 'An interrupt cannot sneak in between a read and a write.' },
  ],
  challenges: [
    {
      title: 'Light a pattern', mode: 'program',
      prompt: 'Turn ON the LEDs on PA0, PA2, PA4 and PA6 (the pattern 0x55) and leave the others OFF. Remember the clock and the MODER setup!',
      starter: String.raw`#include "board.h"

int main(void)
{
    // TODO: enable GPIOA clock
    // TODO: PA0..PA7 as outputs
    // TODO: light PA0, PA2, PA4, PA6
    return 0;
}`,
      solution: String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER = (GPIOA->MODER & ~0xFFFFU) | 0x5555U;
    GPIOA->ODR = 0x55;
    return 0;
}`,
      hints: ['Clock: RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;', 'All eight pins as outputs: MODER low 16 bits = 0x5555.', 'Then write 0x55 to ODR (or set those bits with BSRR).'],
      tests: [{ name: 'LEDs show 0x55', check: r => r.board.leds === 0x55 || 'LEDs show 0x' + r.board.leds.toString(16).toUpperCase().padStart(2, '0') + ', expected 0x55.' + (r.board.notes[0] ? ' Board says: ' + r.board.notes[0] : '') }],
    },
    {
      title: 'Blink PA5', mode: 'program',
      prompt: 'Blink the LED on PA5 forever: **ON for 200 ms, OFF for 200 ms**, starting ON. Use `delay_ms()`.',
      starter: String.raw`#include "board.h"

int main(void)
{
    // TODO: setup

    while (1) {
        // TODO: blink
    }
}`,
      solution: String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= (1U << (5 * 2));
    while (1) {
        GPIOA->BSRR = (1U << 5);
        delay_ms(200);
        GPIOA->BSRR = (1U << (5 + 16));
        delay_ms(200);
    }
}`,
      hints: ['Set up the clock and MODER once, before the loop.', 'Inside the loop: on, delay_ms(200), off, delay_ms(200).'],
      tests: [{ name: 'blinks at 200 ms', maxTimeMs: 2100, allowTimeout: true, check: blinkCheck(5, 200, 10, true) }],
    },
  ],
},
{
  id: 'systick', unit: 'Microcontrollers', title: 'Timing with SysTick', emoji: '⏱️', minutes: 16,
  body: [
    ['p', 'A busy loop like `for (volatile int i = 0; i < 100000; i++);` wastes energy and its timing depends on the clock speed and compiler settings. Real firmware uses **hardware timers**.'],
    ['p', 'Every Cortex-M has **SysTick**: a 24-bit counter that counts down at the CPU clock and fires an interrupt when it reaches zero. Configure it for 1 ms and you get a reliable millisecond tick.'],
    ['pre', String.raw`CPU clock = 16 MHz  ->  16 000 ticks per millisecond
SysTick_Config(SystemCoreClock / 1000)   // reload = 16000 - 1, interrupt every 1 ms`],
    ['code', String.raw`#include "board.h"

volatile uint32_t g_ms = 0;          // volatile: changed by the interrupt

void SysTick_Handler(void)           // called every 1 ms by hardware
{
    g_ms++;
}

void delay(uint32_t ms)
{
    uint32_t start = g_ms;
    while ((g_ms - start) < ms) {
        __WFI();                     // sleep until the next interrupt (saves power)
    }
}

int main(void)
{
    SysTick_Config(SystemCoreClock / 1000);
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= 1U;              // PA0 output
    while (1) {
        GPIOA->ODR ^= 1U;
        delay(250);
        printf("t = %u ms\n", g_ms);
    }
}`, true],
    ['h', 'Non-blocking timing'],
    ['p', 'A blocking `delay()` freezes everything. To do several things at once, check the clock instead of waiting:'],
    ['code', String.raw`uint32_t last = 0;
while (1) {
    if ((uint32_t)(millis() - last) >= 500) {   // wrap-around safe
        last += 500;
        toggle_led();
    }
    // ...other work keeps running here...
}`, false],
    ['tip', 'On this simulator `millis()` is provided for you (like Arduino). On a real STM32 you would read your own SysTick counter or call `HAL_GetTick()`.'],
  ],
  quiz: [
    { q: 'How many bits does the SysTick counter have?', options: ['8', '16', '24', '32'], answer: 2, explain: 'SysTick is a 24-bit down-counter.' },
    { q: 'For a 1 ms tick at 16 MHz, the reload value is…', options: ['16', '1000', '16000 - 1', '16 000 000'], answer: 2, explain: '16 000 clock ticks per millisecond; reload is N - 1.' },
    { q: 'Why must g_ms be volatile?', options: ['It is big', 'It is changed inside an interrupt handler', 'It is in Flash', 'It must be signed'], answer: 1, explain: 'The compiler must re-read it every time.' },
    { q: 'What is the advantage of the "if (millis() - last >= period)" pattern?', options: ['Uses less Flash', 'Does not block other work', 'More accurate than hardware', 'No interrupts needed'], answer: 1, explain: 'The main loop keeps running and can handle many tasks.' },
  ],
  challenges: [
    {
      title: 'Your own SysTick delay', mode: 'program',
      prompt: 'Without using `delay_ms()` or `millis()`: write `SysTick_Handler` to count milliseconds, a `delay(ms)` based on it, and blink **PA0** with **250 ms** toggles (start ON).',
      starter: String.raw`#include "board.h"

volatile uint32_t g_ms = 0;

// TODO: void SysTick_Handler(void)

// TODO: void delay(uint32_t ms)

int main(void)
{
    // TODO: SysTick_Config, GPIO setup, blink loop
    while (1) {
    }
}`,
      solution: String.raw`#include "board.h"

volatile uint32_t g_ms = 0;

void SysTick_Handler(void) { g_ms++; }

void delay(uint32_t ms)
{
    uint32_t start = g_ms;
    while ((g_ms - start) < ms) { }
}

int main(void)
{
    SysTick_Config(SystemCoreClock / 1000);
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= 1U;
    while (1) {
        GPIOA->ODR ^= 1U;
        delay(250);
    }
}`,
      hints: ['SysTick_Handler just does g_ms++;', 'delay: remember start = g_ms; wait while (g_ms - start) < ms.', 'SysTick_Config(SystemCoreClock / 1000) gives a 1 ms tick.'],
      tests: [{ name: 'SysTick-driven 250 ms blink', maxTimeMs: 2100, allowTimeout: true, check: r => {
        if (/delay_ms|millis/.test(r.src)) return 'Do not use delay_ms() or millis() — build your own from SysTick.';
        if (r.board.irqCounts.SysTick < 1000) return 'SysTick interrupt fired only ' + r.board.irqCounts.SysTick + ' times — is it configured for 1 ms?';
        return blinkCheck(0, 250, 8, true, 3)(r);
      } }],
    },
    {
      title: 'Two LEDs, two rhythms', mode: 'program',
      prompt: 'Without blocking delays, toggle **PA0 every 500 ms** and **PA1 every 300 ms** at the same time. Both start OFF. Use `millis()` and the non-blocking pattern.',
      starter: String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= (1U << 0) | (1U << 2);   // PA0, PA1 outputs

    uint32_t last0 = 0, last1 = 0;
    while (1) {
        // TODO: toggle PA0 every 500 ms and PA1 every 300 ms
    }
}`,
      solution: String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= (1U << 0) | (1U << 2);

    uint32_t last0 = 0, last1 = 0;
    while (1) {
        uint32_t now = millis();
        if (now - last0 >= 500) { last0 += 500; GPIOA->ODR ^= (1U << 0); }
        if (now - last1 >= 300) { last1 += 300; GPIOA->ODR ^= (1U << 1); }
    }
}`,
      hints: ['Read now = millis() once per loop.', 'if (now - last0 >= 500) { last0 += 500; toggle PA0; }', 'Same for PA1 with 300.'],
      tests: [{ name: 'independent rhythms', maxTimeMs: 3100, allowTimeout: true, check: r => {
        if (/delay_ms|delay_us/.test(r.src)) return 'Avoid delay_ms(): the loop must not block.';
        const a = blinkCheck(0, 500, 5, true)(r);
        if (a !== true) return a;
        const b = blinkCheck(1, 300, 9, true)(r);
        if (b !== true) return b;
        const e0 = MC.ledEdges(r, 0), e1 = MC.ledEdges(r, 1);
        if (Math.abs(e0[0].t - 500) > 15 || Math.abs(e1[0].t - 300) > 15) return 'First toggles should happen at 500 ms (PA0) and 300 ms (PA1).';
        return true;
      } }],
    },
  ],
},
{
  id: 'buttons', unit: 'Microcontrollers', title: 'Buttons, polling & debouncing', emoji: '🔘', minutes: 16,
  body: [
    ['p', 'Reading an input pin is just reading the **IDR** register. On the virtual board the user button is **PC13** and reads 1 while pressed.'],
    ['code', String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN | RCC_AHB1ENR_GPIOCEN;
    GPIOA->MODER |= 1U;                         // PA0 output (LED)
    // PC13 stays in input mode (MODER bits = 00, the reset value)

    while (1) {
        if (GPIOC->IDR & (1U << 13)) GPIOA->BSRR = 1U;          // pressed: LED on
        else                         GPIOA->BSRR = 1U << 16;    // released: off
        delay_ms(5);
    }
}`, true],
    ['tip', 'Use the **Button** controls under the board to schedule presses before you run (e.g. press at 500 ms, release at 1200 ms).'],
    ['h', 'Edge detection'],
    ['p', 'To count presses, react to the **change** from 0 to 1 (a rising edge), not to the level. Keep the previous reading and compare.'],
    ['h', 'Contact bounce'],
    ['pre', String.raw`button pressed here
        v
level: __|‾|_|‾‾|_|‾‾‾‾‾‾‾‾‾‾‾‾‾‾   <- metal contacts bounce for 1..10 ms
          bounce   stable`],
    ['p', 'A naive edge counter sees several presses per click. **Debouncing** fixes it: accept a new state only after it has been stable for a few milliseconds, or sample slowly (every 10–20 ms).'],
    ['code', String.raw`// Integrator debouncer: call every 1 ms with the raw pin level.
// Returns the debounced level (changes only after 5 equal samples).
int debounce(int raw)
{
    static int stable = 0, count = 0;
    if (raw == stable) {
        count = 0;
    } else if (++count >= 5) {
        stable = raw;
        count = 0;
    }
    return stable;
}`, false],
    ['note', 'Turn on **Bouncy button** in the board options to make the virtual button bounce like a real one.'],
  ],
  quiz: [
    { q: 'Which register do you read to get the level of an input pin?', options: ['ODR', 'IDR', 'BSRR', 'MODER'], answer: 1, explain: 'IDR = Input Data Register.' },
    { q: 'What is contact bounce?', options: ['A software bug', 'Rapid on/off flicker when mechanical contacts close or open', 'A power surge', 'An interrupt storm'], answer: 1, explain: 'The metal contacts physically bounce for a few milliseconds.' },
    { q: 'How do you count each press exactly once?', options: ['Count while the level is 1', 'Detect the 0→1 transition (rising edge) after debouncing', 'Read ODR', 'Use a delay of 1 s'], answer: 1, explain: 'Edge detection plus debouncing gives one count per press.' },
  ],
  challenges: [
    {
      title: 'Debouncer function', mode: 'function',
      prompt: 'Write `int debounce(int raw)` — it is called every millisecond with the raw button level (0/1). Return the debounced level, which starts at 0 and changes only after the raw input has had the **new value for 5 consecutive calls**.',
      starter: String.raw`int debounce(int raw)
{
    // TODO: static state, count consecutive differing samples
    return raw;
}`,
      solution: String.raw`int debounce(int raw)
{
    static int stable = 0, count = 0;
    if (raw == stable) {
        count = 0;
    } else if (++count >= 5) {
        stable = raw;
        count = 0;
    }
    return stable;
}`,
      hints: ['Keep static int stable and static int count.', 'If raw equals stable, reset count. Otherwise count++ and switch when count reaches 5.'],
      tests: [{ name: 'filters bounces', harness: String.raw`#include <stdio.h>
int main(void) {
  const char *in = "0001010111111111110100000000011111";
  for (const char *p = in; *p; p++) printf("%d", debounce(*p - '0'));
  printf("\n"); return 0; }`, expect: '0000000000011111111111110000000001' }],
    },
    {
      title: 'Press counter on LEDs', mode: 'program',
      prompt: 'The button **bounces**. Count real presses (rising edges) and show the count in binary on the LEDs PA0–PA7. Each click must count exactly once. Loop forever.',
      starter: String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN | RCC_AHB1ENR_GPIOCEN;
    GPIOA->MODER |= 0x5555U;            // PA0..PA7 outputs

    uint8_t count = 0;
    while (1) {
        int pressed = (GPIOC->IDR >> 13) & 1U;
        // TODO: detect debounced rising edges and count them
        GPIOA->ODR = count;
        delay_ms(1);
    }
}`,
      solution: String.raw`#include "board.h"

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN | RCC_AHB1ENR_GPIOCEN;
    GPIOA->MODER |= 0x5555U;

    uint8_t count = 0;
    int stable = 0, samples = 0;
    while (1) {
        int pressed = (GPIOC->IDR >> 13) & 1U;
        if (pressed == stable) {
            samples = 0;
        } else if (++samples >= 10) {
            stable = pressed;
            samples = 0;
            if (stable) count++;
        }
        GPIOA->ODR = count;
        delay_ms(1);
    }
}`,
      hints: ['Keep the debounced state and a counter of consecutive different samples (like the previous challenge).', 'Only count when the debounced state changes to 1.'],
      tests: [
        { name: '3 bouncy presses → 3', input: { bounce: true, button: [[200, 450], [800, 1000], [1400, 1700]] }, maxTimeMs: 2200, allowTimeout: true, check: r => r.board.leds === 3 || 'LEDs show ' + r.board.leds + ', expected 3. Are bounces counted as extra presses?' },
        { name: '5 bouncy presses → 5', input: { bounce: true, button: [[100, 200], [400, 520], [700, 800], [1000, 1150], [1300, 1500]] }, maxTimeMs: 1900, allowTimeout: true, check: r => r.board.leds === 5 || 'LEDs show ' + r.board.leds + ', expected 5.' },
      ],
    },
  ],
},
{
  id: 'interrupts', unit: 'Microcontrollers', title: 'Interrupts & ISRs', emoji: '⚡', minutes: 18,
  body: [
    ['p', 'Polling means asking "did it happen yet?" over and over. An **interrupt** lets the hardware tap the CPU on the shoulder: the CPU pauses `main()`, runs an **Interrupt Service Routine (ISR)**, then continues exactly where it was.'],
    ['pre', String.raw`main loop ----+         +---------- continues
              | button! |
              v         ^
           EXTI15_10_IRQHandler()   (registers saved and restored by hardware)`],
    ['h', 'Path of a button interrupt on STM32'],
    ['ol', ['**EXTI** (external interrupt controller) watches pin 13: unmask line 13 in `EXTI->IMR` and pick the edge in `EXTI->RTSR` (rising) or `FTSR` (falling).', 'When the edge happens, EXTI sets a **pending bit** in `EXTI->PR`.', 'The **NVIC** (Nested Vectored Interrupt Controller) must have that IRQ enabled: `NVIC_EnableIRQ(EXTI15_10_IRQn)`.', 'The CPU jumps to `EXTI15_10_IRQHandler()` through the vector table.', 'Your ISR must **clear the pending bit** (write 1 to it), or it will fire again immediately.']],
    ['code', String.raw`#include "board.h"

volatile uint32_t presses = 0;

void EXTI15_10_IRQHandler(void)
{
    if (EXTI->PR & EXTI_PR_PR13) {
        EXTI->PR = EXTI_PR_PR13;      // clear pending (write 1!)
        presses++;
    }
}

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOCEN;
    EXTI->IMR  |= EXTI_IMR_MR13;      // unmask line 13
    EXTI->RTSR |= EXTI_RTSR_TR13;     // rising edge
    NVIC_EnableIRQ(EXTI15_10_IRQn);

    uint32_t shown = 0;
    while (1) {
        __WFI();                      // sleep until an interrupt
        if (presses != shown) {
            shown = presses;
            printf("press #%u\n", shown);
        }
    }
}`, true],
    ['h', 'The golden rules of ISRs'],
    ['ul', ['Keep them **short**: set a flag, copy a byte, return.', 'Never call blocking functions (delays, printf, waiting loops) inside an ISR.', 'Variables shared with main must be `volatile`.', 'If main reads a multi-byte value an ISR writes, protect the read with `__disable_irq()` / `__enable_irq()` (a *critical section*).', 'Always clear the interrupt flag.']],
    ['warn', 'Try removing the line that clears `EXTI->PR` in the example — the simulator detects the resulting *interrupt storm*.'],
  ],
  quiz: [
    { q: 'What does an ISR need to do with the pending flag?', options: ['Nothing', 'Clear it, or the interrupt fires again', 'Set it', 'Print it'], answer: 1, explain: 'Pending flags stay set until software clears them.' },
    { q: 'Which is a bad idea inside an ISR?', options: ['Setting a flag', 'Incrementing a counter', 'delay_ms(100)', 'Reading a register'], answer: 2, explain: 'Blocking inside an ISR stalls the whole system and delays other interrupts.' },
    { q: 'What does the NVIC do?', options: ['Generates clocks', 'Enables and prioritizes interrupts for the CPU', 'Stores the program', 'Debounces buttons'], answer: 1, explain: 'The Nested Vectored Interrupt Controller manages interrupt enable, priority and dispatch.' },
    { q: 'What does __WFI() do?', options: ['Waits for an interrupt (low-power sleep)', 'Writes a file', 'Disables interrupts', 'Resets the MCU'], answer: 0, explain: 'Wait For Interrupt puts the core to sleep until an interrupt arrives.' },
  ],
  challenges: [
    {
      title: 'Interrupt-driven toggle', mode: 'program',
      prompt: 'Use the **EXTI interrupt** for PC13 (rising edge) so that each button press toggles the LED on **PA5**. The main loop must only sleep: `while (1) { __WFI(); }`.',
      starter: String.raw`#include "board.h"

void EXTI15_10_IRQHandler(void)
{
    // TODO: clear the pending bit and toggle PA5
}

int main(void)
{
    // TODO: clocks, PA5 output, EXTI line 13 rising edge, NVIC
    while (1) {
        __WFI();
    }
}`,
      solution: String.raw`#include "board.h"

void EXTI15_10_IRQHandler(void)
{
    if (EXTI->PR & EXTI_PR_PR13) {
        EXTI->PR = EXTI_PR_PR13;
        GPIOA->ODR ^= (1U << 5);
    }
}

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN | RCC_AHB1ENR_GPIOCEN;
    GPIOA->MODER |= (1U << 10);
    EXTI->IMR |= EXTI_IMR_MR13;
    EXTI->RTSR |= EXTI_RTSR_TR13;
    NVIC_EnableIRQ(EXTI15_10_IRQn);
    while (1) {
        __WFI();
    }
}`,
      hints: ['Clocks for GPIOA and GPIOC, PA5 as output.', 'EXTI->IMR |= EXTI_IMR_MR13; EXTI->RTSR |= EXTI_RTSR_TR13; NVIC_EnableIRQ(EXTI15_10_IRQn);', 'In the ISR: EXTI->PR = EXTI_PR_PR13; then GPIOA->ODR ^= (1U << 5);'],
      tests: [{ name: '3 presses → 3 toggles', input: { button: [[300, 500], [900, 1100], [1500, 1700]] }, maxTimeMs: 2000, allowTimeout: true, check: r => {
        const e = MC.ledEdges(r, 5);
        if (r.board.irqCounts.EXTI15_10 < 3) return 'The EXTI interrupt ran ' + r.board.irqCounts.EXTI15_10 + ' time(s); expected 3.';
        if (e.length !== 3) return 'PA5 changed ' + e.length + ' times; expected 3 (one per press).';
        if (Math.abs(e[0].t - 300) > 5 || Math.abs(e[2].t - 1500) > 5) return 'Toggles should happen right when the button is pressed.';
        return true;
      } }],
    },
    {
      title: 'Flag from ISR, print from main', mode: 'program',
      prompt: 'Printing inside an ISR is forbidden. Make the ISR only set a `volatile` flag; the **main loop** checks the flag, clears it, and prints `press 1`, `press 2`, … (one line per press).',
      starter: String.raw`#include "board.h"

volatile int pressed_flag = 0;

void EXTI15_10_IRQHandler(void)
{
    // TODO
}

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOCEN;
    // TODO: EXTI + NVIC setup
    int count = 0;
    while (1) {
        __WFI();
        // TODO: if the flag is set: clear it and print "press N"
    }
}`,
      solution: String.raw`#include "board.h"

volatile int pressed_flag = 0;

void EXTI15_10_IRQHandler(void)
{
    if (EXTI->PR & EXTI_PR_PR13) {
        EXTI->PR = EXTI_PR_PR13;
        pressed_flag = 1;
    }
}

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOCEN;
    EXTI->IMR |= EXTI_IMR_MR13;
    EXTI->RTSR |= EXTI_RTSR_TR13;
    NVIC_EnableIRQ(EXTI15_10_IRQn);
    int count = 0;
    while (1) {
        __WFI();
        if (pressed_flag) {
            pressed_flag = 0;
            count++;
            printf("press %d\n", count);
        }
    }
}`,
      hints: ['ISR: clear EXTI->PR bit 13, then pressed_flag = 1;', 'main: if (pressed_flag) { pressed_flag = 0; count++; printf(...); }'],
      tests: [{ name: 'two presses', input: { button: [[400, 600], [1200, 1300]] }, maxTimeMs: 1600, allowTimeout: true, expect: 'press 1\npress 2', check: r => r.board.irqCounts.EXTI15_10 === 2 || 'Use the EXTI interrupt (it ran ' + r.board.irqCounts.EXTI15_10 + ' times).' }],
    },
  ],
},
{
  id: 'timers', unit: 'Microcontrollers', title: 'Hardware timers & PWM', emoji: '⏲️', minutes: 16,
  body: [
    ['p', 'A general-purpose timer (like **TIM2**) is a counter driven by the peripheral clock through a **prescaler** (PSC). It counts from 0 up to the **auto-reload** value (ARR), then wraps to 0 and raises an **update event** (UIF flag, optional interrupt).'],
    ['pre', String.raw`timer clock = f_clk / (PSC + 1)
update rate = f_clk / ((PSC + 1) * (ARR + 1))

16 MHz, PSC = 16000-1  ->  1 kHz counter (1 count per ms)
         ARR = 500-1   ->  update every 500 ms (2 Hz)`],
    ['code', String.raw`#include "board.h"

void TIM2_IRQHandler(void)
{
    if (TIM2->SR & TIM_SR_UIF) {
        TIM2->SR &= ~TIM_SR_UIF;        // clear the update flag
        GPIOA->ODR ^= (1U << 2);        // toggle PA2
    }
}

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= (1U << 4);          // PA2 output
    RCC->APB1ENR |= RCC_APB1ENR_TIM2EN; // timer clock

    TIM2->PSC = 16000 - 1;              // 1 kHz
    TIM2->ARR = 500 - 1;                // 500 ms
    TIM2->DIER |= TIM_DIER_UIE;         // interrupt on update
    NVIC_EnableIRQ(TIM2_IRQn);
    TIM2->CR1 |= TIM_CR1_CEN;           // start counting

    while (1) {
        __WFI();                        // the CPU sleeps; the timer does the work
    }
}`, true],
    ['h', 'PWM: dimming with fast switching'],
    ['p', 'With PWM (pulse-width modulation) the timer also compares the counter with a **capture/compare register** (CCR): output high while CNT < CCR, low otherwise. The ratio CCR/(ARR+1) is the **duty cycle** — it sets LED brightness or motor speed.'],
    ['pre', String.raw`ARR+1 = 100 counts, CCR = 25  -> 25% duty
   ‾‾|_______|‾‾|_______|‾‾|_______
CCR = 75 -> 75% duty
   ‾‾‾‾‾‾‾|__|‾‾‾‾‾‾‾|__|‾‾‾‾‾‾‾|__`],
    ['tip', 'Timers can also measure signals (input capture) — e.g. the pulse width from an ultrasonic distance sensor.'],
  ],
  quiz: [
    { q: 'f_clk = 16 MHz, PSC = 15, ARR = 999. Update frequency?', options: ['1 Hz', '1 kHz', '16 kHz', '1 MHz'], answer: 1, explain: '16e6 / (16 × 1000) = 1000 Hz.' },
    { q: 'What sets the PWM duty cycle?', options: ['PSC', 'CCR relative to ARR', 'The CPU clock', 'MODER'], answer: 1, explain: 'Duty = CCR / (ARR + 1).' },
    { q: 'Why use a hardware timer instead of delay loops?', options: ['Precise timing while the CPU does other work or sleeps', 'It is required', 'It uses more power', 'Delays are illegal'], answer: 0, explain: 'The timer counts independently of the code running.' },
  ],
  challenges: [
    {
      title: 'Compute PSC and ARR', mode: 'function',
      prompt: 'Write `int timer_config(uint32_t clk_hz, uint32_t period_us, uint32_t *psc, uint32_t *arr)` for a **16-bit** timer: pick PSC so the counter ticks at **1 MHz** (PSC = clk_hz / 1 000 000 − 1), then ARR = period_us − 1. Return 0 on success, or −1 if ARR would not fit in 16 bits (period > 65536 µs) or period is 0.',
      starter: String.raw`#include <stdint.h>

int timer_config(uint32_t clk_hz, uint32_t period_us, uint32_t *psc, uint32_t *arr)
{
    // TODO
    return -1;
}`,
      solution: String.raw`#include <stdint.h>

int timer_config(uint32_t clk_hz, uint32_t period_us, uint32_t *psc, uint32_t *arr)
{
    if (period_us == 0 || period_us > 65536u) return -1;
    *psc = clk_hz / 1000000u - 1u;
    *arr = period_us - 1u;
    return 0;
}`,
      hints: ['Check the range first: 1..65536.', 'PSC = clk_hz / 1000000 - 1; ARR = period_us - 1.'],
      tests: [{ name: 'configs', harness: String.raw`#include <stdio.h>
int main(void) { uint32_t p = 0, a = 0; int r = timer_config(16000000, 1000, &p, &a); printf("%d %u %u\n", r, p, a); r = timer_config(84000000, 20000, &p, &a); printf("%d %u %u\n", r, p, a); p = a = 7; r = timer_config(16000000, 70000, &p, &a); printf("%d %u %u\n", r, p, a); return 0; }`, expect: '0 15 999\n0 83 19999\n-1 7 7' }],
    },
    {
      title: 'TIM2 heartbeat', mode: 'program',
      prompt: 'Use **TIM2 with its update interrupt** to toggle **PA0 every 250 ms** (start OFF, first toggle at 250 ms). The main loop only sleeps with `__WFI()`. No delay functions!',
      starter: String.raw`#include "board.h"

void TIM2_IRQHandler(void)
{
    // TODO
}

int main(void)
{
    // TODO: GPIO + TIM2 setup
    while (1) {
        __WFI();
    }
}`,
      solution: String.raw`#include "board.h"

void TIM2_IRQHandler(void)
{
    if (TIM2->SR & TIM_SR_UIF) {
        TIM2->SR &= ~TIM_SR_UIF;
        GPIOA->ODR ^= 1U;
    }
}

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= 1U;
    RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;
    TIM2->PSC = 16000 - 1;
    TIM2->ARR = 250 - 1;
    TIM2->DIER |= TIM_DIER_UIE;
    NVIC_EnableIRQ(TIM2_IRQn);
    TIM2->CR1 |= TIM_CR1_CEN;
    while (1) {
        __WFI();
    }
}`,
      hints: ['PSC = 16000 - 1 gives a 1 kHz count; ARR = 250 - 1 gives 250 ms.', 'Enable TIM_DIER_UIE, NVIC_EnableIRQ(TIM2_IRQn), then set TIM_CR1_CEN.', 'Clear TIM_SR_UIF inside the handler.'],
      tests: [{ name: '250 ms heartbeat', maxTimeMs: 2100, allowTimeout: true, check: r => {
        if (/delay_ms|millis/.test(r.src)) return 'Use the timer interrupt, not delay_ms()/millis().';
        if (r.board.irqCounts.TIM2 < 8) return 'TIM2 interrupt ran ' + r.board.irqCounts.TIM2 + ' times; expected about 8 in 2 seconds.';
        const e = MC.ledEdges(r, 0);
        if (!e.length || Math.abs(e[0].t - 250) > 3) return 'First toggle should be at 250 ms' + (e.length ? ' (was ' + e[0].t.toFixed(1) + ' ms)' : '') + '.';
        return blinkCheck(0, 250, 8, true, 3)(r);
      } }],
    },
  ],
},
{
  id: 'uart', unit: 'Microcontrollers', title: 'UART serial communication', emoji: '📡', minutes: 17,
  body: [
    ['p', 'UART is the simplest way for an MCU to talk to a PC, a GPS or a Bluetooth module: two wires (**TX** and **RX**, crossed between devices) plus ground. No clock wire — both sides agree on a **baud rate**.'],
    ['pre', String.raw`one byte (0x41 'A') at 8N1:
idle ‾‾‾|_|1|0|0|0|0|0|1|0|‾|‾‾‾ idle
        start  LSB first    stop
        bit    8 data bits  bit

115200 baud -> 10 bits per byte -> 11 520 bytes/second`],
    ['h', 'STM32 USART registers'],
    ['table', [['Register', 'Use'], ['BRR', 'baud rate divider = f_clk / baud (16 MHz / 115200 ≈ 139)'], ['CR1', 'UE (bit 13) enables the USART, TE (bit 3) enables the transmitter, RE (bit 2) the receiver'], ['SR', 'TXE (bit 7): transmit data register empty — safe to write the next byte'], ['DR', 'write a byte here to send it']]],
    ['code', String.raw`#include "board.h"

void uart_init(void)
{
    RCC->APB1ENR |= RCC_APB1ENR_USART2EN;      // clock for USART2
    USART2->BRR = SystemCoreClock / 115200;     // baud rate
    USART2->CR1 = USART_CR1_UE | USART_CR1_TE;  // enable, transmitter on
}

void uart_putc(char c)
{
    while (!(USART2->SR & USART_SR_TXE)) { }   // wait until ready
    USART2->DR = (uint8_t)c;
}

void uart_puts(const char *s)
{
    while (*s) uart_putc(*s++);
}

int main(void)
{
    uart_init();
    uart_puts("Booting...\r\n");
    uart_puts("Hello from USART2!\r\n");
    return 0;
}`, true],
    ['note', 'The text appears in the **UART terminal** under the board. On real hardware a USB-to-serial adapter (or the ST-LINK virtual COM port) shows it in PuTTY, minicom or the Arduino serial monitor.'],
    ['tip', 'Serial terminals expect `\\r\\n` (carriage return + line feed) at line ends.'],
    ['h', 'Printing numbers without printf'],
    ['p', '`printf` can cost 10–20 KB of Flash, so small firmware often prints numbers by hand: divide by 10 (or shift by 4 for hex) and convert each digit to a character.'],
  ],
  quiz: [
    { q: 'How many wires does a basic UART link need?', options: ['1', 'TX, RX and GND', '4 plus a clock', '8 data lines'], answer: 1, explain: 'TX→RX, RX←TX, and a common ground. No clock line.' },
    { q: 'At 9600 baud with 8N1 framing, roughly how many bytes per second?', options: ['9600', '1200', '960', '115200'], answer: 2, explain: '10 bits per byte (start + 8 data + stop) → 960 bytes/s.' },
    { q: 'What does the TXE flag mean?', options: ['Transmission error', 'The data register is empty — you can write the next byte', 'Receiver has data', 'UART disabled'], answer: 1, explain: 'Wait for TXE before writing DR.' },
  ],
  challenges: [
    {
      title: 'Hello, UART', mode: 'program',
      prompt: 'Initialize **USART2** (clock, BRR, CR1 with UE and TE), write `uart_putc` that waits for TXE, and send exactly `Hello, UART!\\r\\n`.',
      starter: String.raw`#include "board.h"

void uart_init(void)
{
    // TODO
}

void uart_putc(char c)
{
    // TODO
}

int main(void)
{
    uart_init();
    // TODO: send "Hello, UART!\r\n"
    return 0;
}`,
      solution: String.raw`#include "board.h"

void uart_init(void)
{
    RCC->APB1ENR |= RCC_APB1ENR_USART2EN;
    USART2->BRR = SystemCoreClock / 115200;
    USART2->CR1 = USART_CR1_UE | USART_CR1_TE;
}

void uart_putc(char c)
{
    while (!(USART2->SR & USART_SR_TXE)) { }
    USART2->DR = (uint8_t)c;
}

int main(void)
{
    uart_init();
    const char *msg = "Hello, UART!\r\n";
    while (*msg) uart_putc(*msg++);
    return 0;
}`,
      hints: ['Clock: RCC->APB1ENR |= RCC_APB1ENR_USART2EN;', 'CR1 needs both USART_CR1_UE and USART_CR1_TE.', 'Loop over the string calling uart_putc.'],
      tests: [{ name: 'terminal shows the greeting', check: r => {
        if (r.board.uart === 'Hello, UART!\r\n') return true;
        return 'UART terminal received ' + JSON.stringify(r.board.uart) + '.' + (r.board.notes[0] ? ' Board says: ' + r.board.notes[0] : '');
      } }],
    },
    {
      title: 'Print numbers without printf', mode: 'function',
      prompt: '`uart_init()` and `uart_putc()` are done. Write `uart_put_hex(uint32_t v)` that sends `0x` followed by exactly 8 uppercase hex digits, and `uart_put_dec(uint32_t v)` that sends v in decimal (no leading zeros). Do not use printf/sprintf.',
      starter: String.raw`#include "board.h"

void uart_init(void)
{
    RCC->APB1ENR |= RCC_APB1ENR_USART2EN;
    USART2->BRR = SystemCoreClock / 115200;
    USART2->CR1 = USART_CR1_UE | USART_CR1_TE;
}

void uart_putc(char c)
{
    while (!(USART2->SR & USART_SR_TXE)) { }
    USART2->DR = (uint8_t)c;
}

void uart_put_hex(uint32_t v)
{
    // TODO
}

void uart_put_dec(uint32_t v)
{
    // TODO
}`,
      solution: String.raw`#include "board.h"

void uart_init(void)
{
    RCC->APB1ENR |= RCC_APB1ENR_USART2EN;
    USART2->BRR = SystemCoreClock / 115200;
    USART2->CR1 = USART_CR1_UE | USART_CR1_TE;
}

void uart_putc(char c)
{
    while (!(USART2->SR & USART_SR_TXE)) { }
    USART2->DR = (uint8_t)c;
}

void uart_put_hex(uint32_t v)
{
    static const char digits[] = "0123456789ABCDEF";
    uart_putc('0');
    uart_putc('x');
    for (int shift = 28; shift >= 0; shift -= 4) {
        uart_putc(digits[(v >> shift) & 0xF]);
    }
}

void uart_put_dec(uint32_t v)
{
    char buf[10];
    int n = 0;
    do {
        buf[n++] = (char)('0' + v % 10);
        v /= 10;
    } while (v > 0);
    while (n > 0) uart_putc(buf[--n]);
}`,
      hints: ['Hex: for shift from 28 down to 0 step 4, send digits[(v >> shift) & 0xF].', 'Decimal: collect digits with v % 10 into a buffer (they come out reversed), then send them backwards.', 'Handle v == 0 — a do/while loop does it naturally.'],
      tests: [{ name: 'terminal output', harness: String.raw`int main(void) {
  uart_init();
  uart_put_hex(0xDEADBEEF); uart_putc(' '); uart_put_hex(0x2A); uart_putc(' ');
  uart_put_dec(0); uart_putc(' '); uart_put_dec(1234567); uart_putc(' '); uart_put_dec(4294967295u);
  return 0; }`, check: r => {
        if (/printf/.test(r.src)) return 'Do not use printf or sprintf.';
        const want = '0xDEADBEEF 0x0000002A 0 1234567 4294967295';
        return r.board.uart === want || 'UART received ' + JSON.stringify(r.board.uart) + ', expected ' + JSON.stringify(want);
      } }],
    },
  ],
},
{
  id: 'adc', unit: 'Microcontrollers', title: 'ADC: reading the analog world', emoji: '🎚️', minutes: 16,
  body: [
    ['p', 'Sensors such as thermistors, light sensors and potentiometers output a **voltage**. An **ADC** (analog-to-digital converter) turns it into a number. A 12-bit ADC gives 0…4095 for 0…Vref (typically 3.3 V).'],
    ['pre', String.raw`mV = raw * 3300 / 4095        raw 0    -> 0 mV
                              raw 2048 -> ~1650 mV
                              raw 4095 -> 3300 mV`],
    ['code', String.raw`#include "board.h"

uint16_t adc_read(void)
{
    ADC1->CR2 |= ADC_CR2_SWSTART;             // start a conversion
    while (!(ADC1->SR & ADC_SR_EOC)) { }      // wait for End Of Conversion
    return (uint16_t)ADC1->DR;                // reading DR clears EOC
}

int main(void)
{
    RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;
    ADC1->CR2 |= ADC_CR2_ADON;                // power the ADC on
    for (int i = 0; i < 5; i++) {
        uint16_t raw = adc_read();
        uint32_t mv = (uint32_t)raw * 3300u / 4095u;
        printf("raw=%4u  %4u mV\n", raw, mv);
        delay_ms(100);
    }
    return 0;
}`, true],
    ['note', 'Move the **potentiometer slider** under the board and run again. Enable **Noise** to see why filtering matters.'],
    ['h', 'Taming noise'],
    ['ul', ['**Average** N samples (N a power of two lets you divide with a shift).', '**Moving average**: keep the last N samples in a ring buffer.', '**Exponential filter**: `avg += (sample - avg) / 8;` — tiny RAM, smooth output.']],
    ['h', 'Fixed-point instead of float'],
    ['p', 'Cortex-M0 and M3 have no floating-point unit, so float math is slow and big. Keep values as integers in useful units (millivolts, tenths of a degree): `int32_t temp_x10 = 231;` means 23.1 °C.'],
  ],
  quiz: [
    { q: 'A 10-bit ADC returns values from…', options: ['0 to 255', '0 to 1023', '0 to 4095', '0 to 65535'], answer: 1, explain: '2^10 = 1024 levels: 0..1023.' },
    { q: '12-bit ADC, Vref 3.3 V, raw = 1024. Voltage ≈', options: ['0.33 V', '0.83 V', '1.65 V', '3.3 V'], answer: 1, explain: '1024 / 4095 × 3.3 ≈ 0.825 V.' },
    { q: 'Why use fixed-point math on small MCUs?', options: ['Floats are illegal', 'Many MCUs have no FPU, so float math is slow and large', 'Integers are more accurate', 'ADCs only output integers'], answer: 1, explain: 'Software floating point costs time and Flash.' },
  ],
  challenges: [
    {
      title: 'Raw to millivolts', mode: 'function',
      prompt: 'Write `uint32_t adc_to_mv(uint16_t raw)` for a 12-bit ADC with Vref = 3300 mV, using **integer math only** and rounding to the nearest millivolt: `(raw * 3300 + 2047) / 4095`.',
      starter: String.raw`#include <stdint.h>

uint32_t adc_to_mv(uint16_t raw)
{
    // TODO
    return 0;
}`,
      solution: String.raw`#include <stdint.h>

uint32_t adc_to_mv(uint16_t raw)
{
    return ((uint32_t)raw * 3300u + 2047u) / 4095u;
}`,
      hints: ['Cast raw to uint32_t before multiplying so nothing overflows.', 'Adding half the divisor (2047) before dividing rounds to nearest.'],
      tests: [{ name: 'conversions', harness: String.raw`#include <stdio.h>
int main(void) { printf("%u %u %u %u %u\n", adc_to_mv(0), adc_to_mv(4095), adc_to_mv(2048), adc_to_mv(1241), adc_to_mv(1)); return 0; }`, expect: '0 3300 1650 1000 1' }],
    },
    {
      title: 'Bar-graph voltmeter', mode: 'program',
      prompt: 'The pot is **noisy**. Average **16** ADC samples, then light a bar graph on PA0–PA7: number of LEDs lit = `avg * 9 / 4096` (0–8), filled from PA0 upward. Do it once and return.',
      starter: String.raw`#include "board.h"

uint16_t adc_read(void)
{
    ADC1->CR2 |= ADC_CR2_SWSTART;
    while (!(ADC1->SR & ADC_SR_EOC)) { }
    return (uint16_t)ADC1->DR;
}

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;
    GPIOA->MODER |= 0x5555U;
    ADC1->CR2 |= ADC_CR2_ADON;

    // TODO: average 16 samples, compute the number of LEDs, show the bar
    return 0;
}`,
      solution: String.raw`#include "board.h"

uint16_t adc_read(void)
{
    ADC1->CR2 |= ADC_CR2_SWSTART;
    while (!(ADC1->SR & ADC_SR_EOC)) { }
    return (uint16_t)ADC1->DR;
}

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;
    GPIOA->MODER |= 0x5555U;
    ADC1->CR2 |= ADC_CR2_ADON;

    uint32_t sum = 0;
    for (int i = 0; i < 16; i++) sum += adc_read();
    uint32_t avg = sum / 16;
    uint32_t n = avg * 9 / 4096;
    GPIOA->ODR = (1U << n) - 1U;
    return 0;
}`,
      hints: ['Sum 16 readings in a uint32_t, then divide by 16 (or >> 4).', 'n LEDs lit from PA0 is the mask (1U << n) - 1.'],
      tests: [
        { name: 'pot ≈ 3000 → 6 LEDs', input: { pot: 3000, potNoise: 60 }, check: r => r.board.leds === 0x3F || 'LEDs = 0x' + r.board.leds.toString(16).toUpperCase() + ', expected 0x3F (6 LEDs).' },
        { name: 'pot ≈ 500 → 1 LED', input: { pot: 500, potNoise: 60 }, check: r => r.board.leds === 0x01 || 'LEDs = 0x' + r.board.leds.toString(16).toUpperCase() + ', expected 0x01.' },
        { name: 'pot max → 8 LEDs', input: { pot: 4095, potNoise: 30 }, check: r => r.board.leds === 0xFF || 'LEDs = 0x' + r.board.leds.toString(16).toUpperCase() + ', expected 0xFF.' },
      ],
    },
  ],
},
{
  id: 'cpu', unit: 'Architecture & Design', title: 'Inside the CPU: architectures', emoji: '🏗️', minutes: 18,
  body: [
    ['p', 'Every CPU repeats one loop forever: **fetch** an instruction from memory at the program counter (PC), **decode** it, **execute** it. Pipelining overlaps these steps: while one instruction executes, the next is decoded and a third is fetched.'],
    ['pre', String.raw`cycle:      1      2      3      4      5
instr 1:  FETCH  DECODE  EXEC
instr 2:         FETCH  DECODE  EXEC
instr 3:                FETCH  DECODE  EXEC     (Cortex-M3/M4: 3 stages)`],
    ['h', 'Key ideas'],
    ['table', [['Concept', 'Meaning'], ['Registers', 'tiny, fast storage inside the CPU. Cortex-M: R0–R12, SP (R13), LR (R14, return address), PC (R15), xPSR (flags)'], ['RISC', 'few simple instructions, fixed size, load/store: only loads and stores touch memory (ARM, RISC-V, AVR)'], ['CISC', 'many complex instructions, variable length, instructions can operate on memory directly (x86)'], ['von Neumann', 'one memory/bus for code and data'], ['Harvard', 'separate buses for code and data, so fetching and data access happen in parallel (AVR; Cortex-M3/M4 have separate I-code and D-code buses)']]],
    ['h', 'From C to instructions'],
    ['pre', String.raw`int add3(int a, int b, int c)      add3:                  @ a in r0, b in r1, c in r2
{                                     adds  r0, r0, r1     @ r0 = a + b
    return a + b + c;                 adds  r0, r0, r2     @ r0 += c
}                                     bx    lr             @ return (result in r0)`],
    ['p', 'The ARM calling convention (AAPCS) passes the first four arguments in **R0–R3** and returns the result in **R0**. More arguments and saved registers go on the **stack**. When an interrupt fires, the Cortex-M hardware automatically pushes R0–R3, R12, LR, PC and xPSR — which is why ISRs can be plain C functions.'],
    ['h', 'Families at a glance'],
    ['table', [['Core', 'Bits', 'Notes'], ['AVR', '8', 'Harvard, 32 registers, 1 instruction per clock'], ['Cortex-M0/M0+', '32', 'tiny, ultra low power, no divide instruction'], ['Cortex-M3', '32', 'hardware divide, 3-stage pipeline'], ['Cortex-M4/M4F', '32', 'DSP instructions, optional single-precision FPU'], ['Cortex-M7', '32', 'superscalar, caches, up to ~1 GHz'], ['RISC-V (e.g. ESP32-C3)', '32', 'open instruction set, growing fast']]],
  ],
  quiz: [
    { q: 'Which register holds the address of the next instruction?', options: ['SP', 'LR', 'PC', 'R0'], answer: 2, explain: 'The program counter (R15) points to the instruction being fetched.' },
    { q: 'In a load/store (RISC) architecture…', options: ['every instruction can access memory', 'only load and store instructions access memory', 'there are no registers', 'instructions have variable length'], answer: 1, explain: 'Arithmetic works on registers; memory is reached only through loads and stores.' },
    { q: 'Where does a Cortex-M function return its int result?', options: ['On the stack', 'In R0', 'In LR', 'In the PC'], answer: 1, explain: 'AAPCS: result in R0 (and R1 for 64-bit values).' },
    { q: 'A Harvard architecture has…', options: ['one shared bus', 'separate instruction and data paths', 'no cache', 'only 8-bit registers'], answer: 1, explain: 'Separate paths allow fetching code while accessing data.' },
  ],
  challenges: [
    {
      title: 'Build a tiny CPU', mode: 'function',
      prompt: 'Emulate a 4-register machine (R0–R3). Every instruction is 3 bytes: `op, x, y`. Write `int run_program(const uint8_t *code, int len)`:\n\n`0x01 r v` MOV: R[r] = v\n`0x02 r s` ADD: R[r] = R[r] + R[s]\n`0x03 r v` SUBI: R[r] = R[r] − v\n`0x04 r a` JNZ: if R[r] ≠ 0, jump to byte address a\n`0x00` HALT: return R0\n\nThe PC starts at 0 and advances by 3. Registers start at 0. If the PC runs past `len` or more than 10 000 instructions execute, return −1.',
      starter: String.raw`#include <stdint.h>

int run_program(const uint8_t *code, int len)
{
    int reg[4] = {0, 0, 0, 0};
    int pc = 0;
    // TODO: fetch, decode, execute
    return -1;
}`,
      solution: String.raw`#include <stdint.h>

int run_program(const uint8_t *code, int len)
{
    int reg[4] = {0, 0, 0, 0};
    int pc = 0;
    for (int steps = 0; steps < 10000; steps++) {
        if (pc < 0 || pc >= len) return -1;
        uint8_t op = code[pc];
        if (op == 0x00) return reg[0];
        if (pc + 2 >= len) return -1;
        uint8_t x = code[pc + 1], y = code[pc + 2];
        pc += 3;
        switch (op) {
        case 0x01: reg[x & 3] = y; break;
        case 0x02: reg[x & 3] += reg[y & 3]; break;
        case 0x03: reg[x & 3] -= y; break;
        case 0x04: if (reg[x & 3] != 0) pc = y; break;
        default: return -1;
        }
    }
    return -1;
}`,
      hints: ['Loop: read op = code[pc]. HALT returns reg[0].', 'Read the two operand bytes, advance pc by 3, then switch on op.', 'JNZ sets pc = y when the register is non-zero.', 'Count steps to stop infinite loops.'],
      tests: [
        { name: '7 + 5', harness: String.raw`#include <stdio.h>
int main(void) { const uint8_t p[] = {0x01,0,7, 0x01,1,5, 0x02,0,1, 0x00}; printf("%d\n", run_program(p, sizeof p)); return 0; }`, expect: '12' },
        { name: '6 x 4 by repeated addition', harness: String.raw`#include <stdio.h>
int main(void) { const uint8_t p[] = {0x01,0,0, 0x01,1,6, 0x01,2,4, 0x02,0,1, 0x03,2,1, 0x04,2,9, 0x00}; printf("%d\n", run_program(p, sizeof p)); return 0; }`, expect: '24' },
        { name: 'sum 1..10', harness: String.raw`#include <stdio.h>
int main(void) { const uint8_t p[] = {0x01,0,0, 0x01,1,10, 0x02,0,1, 0x03,1,1, 0x04,1,6, 0x00}; printf("%d\n", run_program(p, sizeof p)); return 0; }`, expect: '55' },
        { name: 'runaway programs', harness: String.raw`#include <stdio.h>
int main(void) { const uint8_t loop[] = {0x01,0,1, 0x04,0,0}; const uint8_t off[] = {0x01,0,1}; printf("%d %d\n", run_program(loop, sizeof loop), run_program(off, sizeof off)); return 0; }`, expect: '-1 -1' },
      ],
    },
    {
      title: 'Pipeline speed-up', mode: 'function',
      prompt: 'An ideal k-stage pipeline runs n instructions in `k + n − 1` cycles instead of `k × n`. Write `double pipeline_speedup(int k, int n)` returning `(k × n) / (k + n − 1)`.',
      starter: String.raw`double pipeline_speedup(int k, int n)
{
    // TODO
    return 1.0;
}`,
      solution: String.raw`double pipeline_speedup(int k, int n)
{
    return (double)(k * n) / (double)(k + n - 1);
}`,
      hints: ['Convert to double before dividing, otherwise you get integer division.'],
      tests: [{ name: 'speed-ups', harness: String.raw`#include <stdio.h>
int main(void) { printf("%.2f %.2f %.2f\n", pipeline_speedup(3, 1), pipeline_speedup(3, 100), pipeline_speedup(5, 1000)); return 0; }`, expect: '1.00 2.94 4.98' }],
    },
  ],
},
{
  id: 'design', unit: 'Architecture & Design', title: 'Firmware design: state machines & ring buffers', emoji: '🧭', minutes: 18,
  body: [
    ['p', 'Two patterns appear in almost every real firmware project. Master them and you can structure anything from a vending machine to a drone.'],
    ['h', '1. Finite state machines (FSM)'],
    ['p', 'The device is always in exactly one **state**. **Events** (timeouts, button presses, messages) cause **transitions**. An `enum` plus a `switch` makes the logic explicit and testable.'],
    ['code', String.raw`#include "board.h"

typedef enum { ST_IDLE, ST_HEATING, ST_DONE } State;

int main(void)
{
    State st = ST_IDLE;
    uint32_t entered = millis();
    int temperature = 20;

    for (int step = 0; step < 12; step++) {
        switch (st) {
        case ST_IDLE:
            printf("[%4u ms] IDLE, starting heater\n", millis());
            st = ST_HEATING;
            entered = millis();
            break;
        case ST_HEATING:
            temperature += 15;
            printf("[%4u ms] HEATING: %d C\n", millis(), temperature);
            if (temperature >= 80) { st = ST_DONE; entered = millis(); }
            break;
        case ST_DONE:
            printf("[%4u ms] DONE (in state for %u ms)\n", millis(), millis() - entered);
            return 0;
        }
        delay_ms(100);
    }
    return 0;
}`, true],
    ['h', '2. Ring (circular) buffers'],
    ['p', 'An ISR receives bytes faster than main can process them. A **ring buffer** stores them in a fixed array with a **head** (write index) and a **tail** (read index) that wrap around. With one writer (the ISR) and one reader (main) it needs no locks.'],
    ['pre', String.raw`buffer: [ . | A | B | C | . | . | . | . ]
              ^tail       ^head
put(x): buf[head] = x; head = (head + 1) % SIZE
get():  x = buf[tail]; tail = (tail + 1) % SIZE
empty when head == tail`],
    ['tip', 'With a power-of-two SIZE, `% SIZE` becomes `& (SIZE - 1)`, which is faster on small CPUs.'],
  ],
  quiz: [
    { q: 'In a ring buffer, what happens when the head reaches the end of the array?', options: ['The buffer is full', 'It wraps around to index 0', 'It grows with realloc', 'It stops'], answer: 1, explain: 'Indexes wrap with modulo (or a mask).' },
    { q: 'Why is a state machine helpful in firmware?', options: ['It uses less Flash always', 'It makes behavior explicit: one state at a time, clear transitions', 'It avoids interrupts', 'It is required by C'], answer: 1, explain: 'FSMs keep complex behavior predictable and testable.' },
    { q: 'x % 16 can be replaced by…', options: ['x & 15', 'x >> 4', 'x | 16', 'x ^ 16'], answer: 0, explain: 'For powers of two, modulo is a mask of the low bits.' },
  ],
  challenges: [
    {
      title: 'Ring buffer', mode: 'function',
      prompt: 'Complete the ring buffer (capacity 8 bytes, using a `count` field to tell full from empty):\n\n`void rb_init(RingBuf *rb)` — make it empty\n`int rb_put(RingBuf *rb, uint8_t b)` — store b, return 1; return 0 if full\n`int rb_get(RingBuf *rb, uint8_t *out)` — take the oldest byte, return 1; return 0 if empty',
      starter: String.raw`#include <stdint.h>

#define RB_SIZE 8

typedef struct {
    uint8_t buf[RB_SIZE];
    uint8_t head;    // next write position
    uint8_t tail;    // next read position
    uint8_t count;   // bytes stored
} RingBuf;

void rb_init(RingBuf *rb)
{
    // TODO
}

int rb_put(RingBuf *rb, uint8_t b)
{
    // TODO
    return 0;
}

int rb_get(RingBuf *rb, uint8_t *out)
{
    // TODO
    return 0;
}`,
      solution: String.raw`#include <stdint.h>

#define RB_SIZE 8

typedef struct {
    uint8_t buf[RB_SIZE];
    uint8_t head;
    uint8_t tail;
    uint8_t count;
} RingBuf;

void rb_init(RingBuf *rb)
{
    rb->head = rb->tail = rb->count = 0;
}

int rb_put(RingBuf *rb, uint8_t b)
{
    if (rb->count == RB_SIZE) return 0;
    rb->buf[rb->head] = b;
    rb->head = (rb->head + 1) % RB_SIZE;
    rb->count++;
    return 1;
}

int rb_get(RingBuf *rb, uint8_t *out)
{
    if (rb->count == 0) return 0;
    *out = rb->buf[rb->tail];
    rb->tail = (rb->tail + 1) % RB_SIZE;
    rb->count--;
    return 1;
}`,
      hints: ['rb_init sets head, tail and count to 0.', 'put: check full (count == RB_SIZE), write buf[head], advance head with % RB_SIZE, count++.', 'get: check empty, read buf[tail], advance tail, count--.'],
      tests: [{ name: 'FIFO with wrap-around', harness: String.raw`#include <stdio.h>
int main(void) {
  RingBuf rb; rb_init(&rb); uint8_t v;
  printf("%d ", rb_get(&rb, &v));
  for (int i = 1; i <= 9; i++) printf("%d", rb_put(&rb, (uint8_t)(i * 10)));
  printf(" ");
  for (int i = 0; i < 5; i++) { rb_get(&rb, &v); printf("%u,", v); }
  for (int i = 0; i < 4; i++) rb_put(&rb, (uint8_t)(100 + i));
  while (rb_get(&rb, &v)) printf("%u,", v);
  printf(" %d\n", rb_get(&rb, &v));
  return 0; }`, expect: '0 111111110 10,20,30,40,50,60,70,80,100,101,102,103, 0' }],
    },
    {
      title: 'Traffic light FSM', mode: 'program',
      prompt: 'LEDs: **PA0 = red, PA1 = yellow, PA2 = green**. Cycle forever: **RED 3000 ms → GREEN 2000 ms → YELLOW 1000 ms → RED …**, exactly one LED on at a time. Use an `enum` state and a `switch`.',
      starter: String.raw`#include "board.h"

typedef enum { RED, GREEN, YELLOW } Light;

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= (1U << 0) | (1U << 2) | (1U << 4);

    Light state = RED;
    while (1) {
        // TODO: show the light for this state, wait, move to the next state
    }
}`,
      solution: String.raw`#include "board.h"

typedef enum { RED, GREEN, YELLOW } Light;

int main(void)
{
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
    GPIOA->MODER |= (1U << 0) | (1U << 2) | (1U << 4);

    Light state = RED;
    while (1) {
        switch (state) {
        case RED:    GPIOA->ODR = 1U << 0; delay_ms(3000); state = GREEN;  break;
        case GREEN:  GPIOA->ODR = 1U << 2; delay_ms(2000); state = YELLOW; break;
        case YELLOW: GPIOA->ODR = 1U << 1; delay_ms(1000); state = RED;    break;
        }
    }
}`,
      hints: ['In each case: write ODR with only that LED\'s bit, delay, then set the next state.', 'RED → GREEN → YELLOW → RED.'],
      tests: [{ name: 'light sequence', maxTimeMs: 9600, allowTimeout: true, check: r => {
        const want = [[100, 0x01, 'red'], [2900, 0x01, 'red'], [3100, 0x04, 'green'], [4900, 0x04, 'green'], [5100, 0x02, 'yellow'], [6100, 0x01, 'red'], [9100, 0x04, 'green']];
        for (const [t, v, name] of want) {
          const got = MC.ledsAt(r, t);
          if (got !== v) return 'At ' + t + ' ms the light should be ' + name + ' only (0x0' + v + '), but LEDs were 0x' + got.toString(16).toUpperCase().padStart(2, '0') + '.';
        }
        return true;
      } }],
    },
  ],
},
  ]);
})();
