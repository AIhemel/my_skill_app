// Embedded C curriculum, part 1: C foundations, arrays & strings, pointers.
// Body blocks: ['p', text] ['h', text] ['code', src, runnable] ['ul'|'ol', items] ['note'|'warn'|'tip', text] ['pre', text] ['table', rows]
// Text supports `code`, **bold**, *italic*.
// Challenge tests: { name, harness?, stdin?, input?, expect?, contains?, check?(result) => true | 'message' }
window.LESSONS = (window.LESSONS || []).concat([
{
  id: 'hello', unit: 'C Foundations', title: 'Hello, C — how a program runs', emoji: '👋', minutes: 10,
  body: [
    ['p', 'Every C program starts at a function called `main()`. On your laptop the operating system calls it. On a microcontroller there is no OS: after reset, a small piece of *startup code* copies initial values into RAM, zeroes the rest, and then jumps to `main()`.'],
    ['code', String.raw`#include <stdio.h>   // gives us printf

int main(void)        // execution starts here
{
    printf("Hello, embedded world!\n");
    return 0;         // 0 means "success"
}`, true],
    ['h', 'From source code to a running chip'],
    ['ol', [
      '**Preprocessor** handles lines starting with `#`: it pastes in header files and expands `#define` macros.',
      '**Compiler** turns each `.c` file into machine code (an *object file*).',
      '**Linker** joins object files and libraries, and decides addresses: code and constants go to **Flash**, variables go to **RAM**.',
      '**Flashing** writes the final image into the chip. On reset, the CPU starts executing it.',
    ]],
    ['note', 'This app compiles and runs your C code on a simulated 32-bit ARM Cortex-M microcontroller — right on your phone. Like a real Cortex-M: `int` and pointers are 4 bytes, RAM starts at `0x20000000` and Flash at `0x08000000`.'],
    ['h', 'printf in one minute'],
    ['table', [['Format', 'Prints', 'Example'], ['%d', 'signed int', '-42'], ['%u', 'unsigned int', '42'], ['%x / %X', 'hex', '2a / 2A'], ['%c', 'one character', 'A'], ['%s', 'string', 'hello'], ['%f', 'float/double', '3.140000'], ['%p', 'pointer (address)', '0x2001fff8'], ['%%', 'a literal %', '%']]],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    int temp = 23;
    unsigned int id = 0xBEEF;
    printf("Temperature: %d C\n", temp);
    printf("Device id: 0x%04X\n", id);
    printf("[%5d] right-aligned, [%-5d] left-aligned\n", 42, 42);
    printf("Pi is about %.2f\n", 3.14159);
    return 0;
}`, true],
    ['tip', 'On real boards, `printf` is often redirected ("retargeted") to a UART so the text shows up in a serial terminal on your PC. You will do that yourself in the UART lesson.'],
  ],
  quiz: [
    { q: 'Where does a C program start executing?', options: ['At the first line of the file', 'In main()', 'In the first function defined', 'In the #include line'], answer: 1, explain: 'Execution always begins in main(). On an MCU, startup code runs first and then calls main().' },
    { q: 'Which tool decides that code goes into Flash and variables into RAM?', options: ['Preprocessor', 'Compiler', 'Linker', 'Debugger'], answer: 2, explain: 'The linker places sections (code, data, bss) at addresses, usually guided by a linker script.' },
    { q: 'What does printf("%d", 5 + 2) print?', options: ['52', '7', '5 + 2', '%d'], answer: 1, explain: 'The expression 5 + 2 is evaluated first; %d prints the int 7.' },
    { q: 'What does return 0; from main() conventionally mean?', options: ['An error happened', 'Success', 'Restart the program', 'Nothing at all'], answer: 1, explain: 'Zero means success. On an MCU, main() usually never returns — it loops forever.' },
  ],
  challenges: [
    {
      title: 'Introduce yourself', mode: 'program',
      prompt: 'Print exactly these two lines:\n\n`Hello, embedded world!`\n`I am learning C.`',
      starter: String.raw`#include <stdio.h>

int main(void)
{
    // TODO: print the two lines
    return 0;
}`,
      solution: String.raw`#include <stdio.h>

int main(void)
{
    printf("Hello, embedded world!\n");
    printf("I am learning C.\n");
    return 0;
}`,
      hints: ['Use printf twice.', 'End each line with \\n so the next text starts on a new line.'],
      tests: [{ name: 'prints both lines', expect: 'Hello, embedded world!\nI am learning C.\n' }],
    },
    {
      title: 'Format a sensor report', mode: 'program',
      prompt: 'Using the variables in the starter code and **printf format specifiers** (not hard-coded numbers), print:\n\n`Sensor 0x1F: 23 C, 45%`\n`Battery: 3.70 V`',
      starter: String.raw`#include <stdio.h>

int main(void)
{
    unsigned int id = 0x1F;
    int temp = 23;
    int humidity = 45;
    float battery = 3.7f;
    // TODO: print the report
    return 0;
}`,
      solution: String.raw`#include <stdio.h>

int main(void)
{
    unsigned int id = 0x1F;
    int temp = 23;
    int humidity = 45;
    float battery = 3.7f;
    printf("Sensor 0x%X: %d C, %d%%\n", id, temp, humidity);
    printf("Battery: %.2f V\n", battery);
    return 0;
}`,
      hints: ['Hex in capitals: %X. Prefix the 0x yourself.', 'A literal percent sign is written %%.', '%.2f prints a float with two decimals.'],
      tests: [{ name: 'report is formatted', expect: 'Sensor 0x1F: 23 C, 45%\nBattery: 3.70 V\n' }],
    },
  ],
},
{
  id: 'types', unit: 'C Foundations', title: 'Variables, types & sizes', emoji: '📦', minutes: 12,
  body: [
    ['p', 'A variable is a named piece of memory. Its **type** decides how many bytes it uses and how those bits are interpreted.'],
    ['table', [['Type', 'Size on Cortex-M', 'Range / notes'], ['char', '1 byte', '-128..127 (here); 0..255 if unsigned'], ['short', '2 bytes', '-32768..32767'], ['int', '4 bytes', 'about ±2.1 billion'], ['long', '4 bytes', 'same as int on 32-bit ARM'], ['long long', '8 bytes', 'about ±9.2×10^18'], ['float', '4 bytes', '~7 significant digits'], ['double', '8 bytes', '~15 significant digits'], ['any pointer', '4 bytes', '32-bit address']]],
    ['warn', 'Sizes are NOT the same everywhere. On a 64-bit PC, `long` and pointers are 8 bytes; on an 8-bit AVR, `int` is only 2 bytes! That is why embedded code uses the fixed-width types below.'],
    ['h', 'Fixed-width types: stdint.h'],
    ['p', '`uint8_t`, `int16_t`, `uint32_t`… say exactly how many bits you get. Use them for registers, protocols and anything that must match hardware.'],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

int main(void)
{
    printf("char=%zu short=%zu int=%zu long=%zu\n", sizeof(char), sizeof(short), sizeof(int), sizeof(long));
    printf("long long=%zu float=%zu double=%zu pointer=%zu\n", sizeof(long long), sizeof(float), sizeof(double), sizeof(void *));

    uint8_t small = 255;
    small = small + 1;          // wraps around!
    printf("255 + 1 in a uint8_t = %u\n", small);
    return 0;
}`, true],
    ['h', 'Integer division surprise'],
    ['p', 'When both operands are integers, `/` throws away the fraction: `7 / 2` is `3`. Make at least one operand floating point to get `3.5`.'],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    int a = 7, b = 2;
    printf("%d\n", a / b);              // 3
    printf("%.1f\n", (float)a / b);     // 3.5  (cast first, then divide)
    printf("%.1f\n", (float)(a / b));   // 3.0  (too late: already 3)
    return 0;
}`, true],
    ['h', 'Uninitialized means garbage'],
    ['p', 'Global and `static` variables start at 0. Local variables start with whatever bytes were left in that stack memory. Always initialize locals!'],
    ['code', String.raw`#include <stdio.h>

int global_counter;            // starts at 0 (lives in .bss)

int main(void)
{
    int local;                 // NOT initialized: garbage
    printf("global = %d\n", global_counter);
    printf("local  = %d  (random leftover bits!)\n", local);
    return 0;
}`, true],
    ['tip', '`const` makes a variable read-only. A `const` global table is usually stored in Flash, which saves precious RAM on a microcontroller.'],
  ],
  quiz: [
    { q: 'sizeof(int) on a 32-bit ARM Cortex-M is…', options: ['2', '4', '8', 'It depends on the value'], answer: 1, explain: 'Cortex-M uses the ILP32 model: int, long and pointers are 32 bits (4 bytes).' },
    { q: 'What range does uint8_t hold?', options: ['-128..127', '0..255', '0..65535', '-255..255'], answer: 1, explain: '8 unsigned bits: 0 to 2^8 - 1 = 255.' },
    { q: 'What is 5 / 2 when both are int?', options: ['2.5', '2', '3', '2.0'], answer: 1, explain: 'Integer division truncates toward zero.' },
    { q: 'What value does an uninitialized local int have?', options: ['0', '-1', 'Whatever was left in memory', 'A compile error'], answer: 2, explain: 'Local variables live on the stack and are not cleared. Reading one before assigning it is a bug.' },
  ],
  challenges: [
    {
      title: 'Average of three readings', mode: 'function',
      prompt: 'Write `float average3(int a, int b, int c)` that returns the exact average (with the fraction). Watch out for integer division!',
      starter: String.raw`float average3(int a, int b, int c)
{
    // TODO
    return 0;
}`,
      solution: String.raw`float average3(int a, int b, int c)
{
    return (a + b + c) / 3.0f;
}`,
      hints: ['(a + b + c) / 3 is integer division — the fraction is lost.', 'Divide by 3.0f, or cast the sum to float first.'],
      tests: [
        { name: 'average3(10, 15, 20)', harness: String.raw`#include <stdio.h>
int main(void) { printf("%.2f\n", average3(10, 15, 20)); return 0; }`, expect: '15.00' },
        { name: 'average3(1, 2, 2)', harness: String.raw`#include <stdio.h>
int main(void) { printf("%.2f\n", average3(1, 2, 2)); return 0; }`, expect: '1.67' },
        { name: 'average3(-3, 0, 4)', harness: String.raw`#include <stdio.h>
int main(void) { printf("%.2f\n", average3(-3, 0, 4)); return 0; }`, expect: '0.33' },
      ],
    },
    {
      title: 'Celsius to Fahrenheit table', mode: 'program',
      prompt: 'Print a table from 0 to 100 °C in steps of 20 using F = C × 9/5 + 32 with one decimal:\n\n`0 C = 32.0 F`\n`20 C = 68.0 F`\n…\n`100 C = 212.0 F`',
      starter: String.raw`#include <stdio.h>

int main(void)
{
    // TODO: loop from 0 to 100, step 20
    return 0;
}`,
      solution: String.raw`#include <stdio.h>

int main(void)
{
    for (int c = 0; c <= 100; c += 20) {
        float f = c * 9.0f / 5.0f + 32.0f;
        printf("%d C = %.1f F\n", c, f);
    }
    return 0;
}`,
      hints: ['A for loop: for (int c = 0; c <= 100; c += 20)', 'Use 9.0f / 5.0f so the math is done in floating point.'],
      tests: [{ name: 'table is correct', expect: '0 C = 32.0 F\n20 C = 68.0 F\n40 C = 104.0 F\n60 C = 140.0 F\n80 C = 176.0 F\n100 C = 212.0 F\n' }],
    },
  ],
},
{
  id: 'operators', unit: 'C Foundations', title: 'Operators & expressions', emoji: '➗', minutes: 12,
  body: [
    ['p', 'C has a rich set of operators. Knowing their exact behavior avoids many classic bugs.'],
    ['table', [['Kind', 'Operators'], ['Arithmetic', '+  -  *  /  %'], ['Increment', 'x++  ++x  x--  --x'], ['Compound', '+=  -=  *=  /=  %=  &=  |=  ^=  <<=  >>='], ['Comparison', '==  !=  <  <=  >  >='], ['Logical', '&&  ||  !'], ['Bitwise', '&  |  ^  ~  <<  >>  (see the Bits unit)'], ['Other', 'cond ? a : b   sizeof   (type)cast']]],
    ['h', 'Modulo % — the remainder'],
    ['p', '`17 % 5` is `2`. It is great for wrapping around: `index = (index + 1) % SIZE` cycles 0, 1, …, SIZE-1, 0, …'],
    ['h', 'x++ versus ++x'],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    int x = 5;
    int a = x++;   // a gets the OLD value (5), then x becomes 6
    int b = ++x;   // x becomes 7 first, then b gets 7
    printf("a=%d b=%d x=%d\n", a, b, x);

    int seconds = 125;
    printf("%d min %d s\n", seconds / 60, seconds % 60);

    int n = 7;
    printf("%d is %s\n", n, (n % 2 == 0) ? "even" : "odd");
    return 0;
}`, true],
    ['h', 'Precedence (who goes first)'],
    ['p', '`*` `/` `%` bind tighter than `+` `-`, which bind tighter than comparisons, which bind tighter than `&&`, then `||`, then `=`. When in doubt, add parentheses — they are free.'],
    ['warn', 'The most famous bug: `if (x = 5)` *assigns* 5 to x and is always true. Comparison is `==`. This compiler warns you when you do this.'],
    ['h', 'Short-circuit evaluation'],
    ['p', 'In `a && b`, if `a` is false, `b` is never evaluated. That makes `if (p != NULL && *p == 3)` safe: the pointer is only read when it is not NULL.'],
  ],
  quiz: [
    { q: 'What is 23 % 4?', options: ['5', '3', '5.75', '0'], answer: 1, explain: '23 = 5×4 + 3, so the remainder is 3.' },
    { q: 'What is 2 + 3 * 4?', options: ['20', '14', '24', '9'], answer: 1, explain: 'Multiplication first: 3*4 = 12, then 2 + 12 = 14.' },
    { q: 'int x = 3; int y = x++; — what are x and y?', options: ['x=4, y=4', 'x=4, y=3', 'x=3, y=4', 'x=3, y=3'], answer: 1, explain: 'Post-increment returns the old value (3) and then increments x to 4.' },
    { q: 'What does (5 > 3) && (2 > 4) evaluate to?', options: ['1', '0', 'true', '5'], answer: 1, explain: 'The second comparison is false, so && gives 0.' },
  ],
  challenges: [
    {
      title: 'Seconds to h:m:s', mode: 'program',
      prompt: 'Read a number of seconds with `scanf` and print it as hours, minutes and seconds, e.g. input `3725` → `1h 2m 5s`.',
      starter: String.raw`#include <stdio.h>

int main(void)
{
    int total;
    scanf("%d", &total);
    // TODO: compute hours, minutes, seconds
    return 0;
}`,
      solution: String.raw`#include <stdio.h>

int main(void)
{
    int total;
    scanf("%d", &total);
    int h = total / 3600;
    int m = (total % 3600) / 60;
    int s = total % 60;
    printf("%dh %dm %ds\n", h, m, s);
    return 0;
}`,
      hints: ['Hours: total / 3600.', 'Minutes: the remainder after hours, divided by 60: (total % 3600) / 60.', 'Seconds: total % 60.'],
      tests: [
        { name: 'input 3725', stdin: '3725', expect: '1h 2m 5s' },
        { name: 'input 59', stdin: '59', expect: '0h 0m 59s' },
        { name: 'input 86399', stdin: '86399', expect: '23h 59m 59s' },
      ],
    },
    {
      title: 'Clamp a value', mode: 'function',
      prompt: 'Sensors sometimes return out-of-range values. Write `int clamp(int x, int lo, int hi)` that returns `lo` if x < lo, `hi` if x > hi, otherwise x. Try using the `?:` operator.',
      starter: String.raw`int clamp(int x, int lo, int hi)
{
    // TODO
    return x;
}`,
      solution: String.raw`int clamp(int x, int lo, int hi)
{
    return x < lo ? lo : (x > hi ? hi : x);
}`,
      hints: ['Two comparisons are enough.', 'x < lo ? lo : (x > hi ? hi : x)'],
      tests: [{ name: 'several values', harness: String.raw`#include <stdio.h>
int main(void) { printf("%d %d %d %d\n", clamp(5, 0, 10), clamp(-3, 0, 10), clamp(42, 0, 10), clamp(10, 0, 10)); return 0; }`, expect: '5 0 10 10' }],
    },
  ],
},
{
  id: 'control', unit: 'C Foundations', title: 'Control flow: if, switch & loops', emoji: '🔀', minutes: 14,
  body: [
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    int battery = 18;

    if (battery > 50) {
        printf("OK\n");
    } else if (battery > 15) {
        printf("Low\n");
    } else {
        printf("Critical!\n");
    }

    for (int i = 0; i < 3; i++) {       // init; condition; step
        printf("for: %d\n", i);
    }

    int n = 3;
    while (n > 0) {                     // check first
        printf("while: %d\n", n);
        n--;
    }

    do {                                // runs at least once
        printf("do-while runs once\n");
    } while (0);
    return 0;
}`, true],
    ['h', 'switch: choosing between many values'],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    char cmd = 'R';
    switch (cmd) {
    case 'G': printf("green\n");  break;
    case 'Y': printf("yellow\n"); break;
    case 'R': printf("red\n");    break;   // forgetting break "falls through"
    default:  printf("unknown\n");
    }
    return 0;
}`, true],
    ['warn', 'Forgetting `break` in a switch makes execution "fall through" into the next case. Sometimes intentional, usually a bug.'],
    ['h', 'break and continue'],
    ['p', '`break` leaves the loop immediately. `continue` skips the rest of this iteration and moves on to the next one.'],
    ['h', 'The firmware superloop'],
    ['p', 'Most bare-metal firmware looks like this: initialize once, then loop forever. `main()` never returns because there is nothing to return to.'],
    ['code', String.raw`int main(void)
{
    // init_clocks(); init_gpio(); ...
    while (1) {
        // read_sensors();
        // update_outputs();
    }
}`, false],
  ],
  quiz: [
    { q: 'Which loop always runs its body at least once?', options: ['for', 'while', 'do-while', 'none'], answer: 2, explain: 'do-while checks the condition after the body.' },
    { q: 'What happens if you forget break in a switch case?', options: ['Compile error', 'It falls through to the next case', 'The switch restarts', 'Nothing'], answer: 1, explain: 'Execution continues into the following case labels.' },
    { q: 'What does continue do inside a for loop?', options: ['Exits the loop', 'Skips to the next iteration (runs the step expression)', 'Restarts the loop from 0', 'Pauses'], answer: 1, explain: 'In a for loop, continue jumps to the step expression and condition check.' },
    { q: 'Why does firmware often use while (1)?', options: ['It is faster', 'main() should never return on an MCU', 'It saves RAM', 'It is required by C'], answer: 1, explain: 'There is no OS to return to, so firmware loops forever handling events.' },
  ],
  challenges: [
    {
      title: 'FizzBuzz', mode: 'program',
      prompt: 'Print the numbers 1 to 15, one per line. For multiples of 3 print `Fizz`, multiples of 5 print `Buzz`, and multiples of both print `FizzBuzz`.',
      starter: String.raw`#include <stdio.h>

int main(void)
{
    for (int i = 1; i <= 15; i++) {
        // TODO
    }
    return 0;
}`,
      solution: String.raw`#include <stdio.h>

int main(void)
{
    for (int i = 1; i <= 15; i++) {
        if (i % 15 == 0) printf("FizzBuzz\n");
        else if (i % 3 == 0) printf("Fizz\n");
        else if (i % 5 == 0) printf("Buzz\n");
        else printf("%d\n", i);
    }
    return 0;
}`,
      hints: ['Check the "both" case (i % 15 == 0) first.', 'Use if / else if / else so only one line prints per number.'],
      tests: [{ name: '1..15', expect: '1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz\n' }],
    },
    {
      title: 'Digit sum', mode: 'function',
      prompt: 'Write `unsigned int digit_sum(unsigned int n)` that returns the sum of the decimal digits of n. Example: `digit_sum(4096)` = 4+0+9+6 = 19.',
      starter: String.raw`unsigned int digit_sum(unsigned int n)
{
    unsigned int sum = 0;
    // TODO: use % 10 and / 10 in a loop
    return sum;
}`,
      solution: String.raw`unsigned int digit_sum(unsigned int n)
{
    unsigned int sum = 0;
    while (n > 0) {
        sum += n % 10;
        n /= 10;
    }
    return sum;
}`,
      hints: ['n % 10 gives the last digit.', 'n / 10 removes the last digit. Loop while n > 0.'],
      tests: [{ name: 'values', harness: String.raw`#include <stdio.h>
int main(void) { printf("%u %u %u %u\n", digit_sum(4096), digit_sum(0), digit_sum(7), digit_sum(4294967295u)); return 0; }`, expect: '19 0 7 57' }],
    },
  ],
},
{
  id: 'functions', unit: 'C Foundations', title: 'Functions, scope & static', emoji: '🧩', minutes: 14,
  body: [
    ['p', 'Functions break a program into named, testable pieces. A **prototype** (declaration) tells the compiler a function exists; the **definition** contains the body.'],
    ['code', String.raw`#include <stdio.h>

int square(int x);                 // prototype (often in a .h file)

int main(void)
{
    printf("%d\n", square(7));
    return 0;
}

int square(int x)                  // definition
{
    return x * x;
}`, true],
    ['h', 'Arguments are passed by value'],
    ['p', 'The function receives a **copy**. Changing the parameter does not change the caller\'s variable. (To change the caller\'s variable you pass a pointer — coming soon.)'],
    ['code', String.raw`#include <stdio.h>

void try_to_change(int v) { v = 100; }

int main(void)
{
    int a = 1;
    try_to_change(a);
    printf("a is still %d\n", a);
    return 0;
}`, true],
    ['h', 'Scope and lifetime'],
    ['ul', [
      '**Local** variables live only while the function runs (on the stack).',
      '**Global** variables live for the whole program and are visible to every function in the file.',
      'A **static local** keeps its value between calls — it lives in RAM like a global, but only its function can see it.',
      'A **static function** or **static global** is private to its `.c` file — good for hiding helper code in drivers.',
    ]],
    ['code', String.raw`#include <stdio.h>

int count_calls(void)
{
    static int calls = 0;   // initialized once, remembered forever
    calls++;
    return calls;
}

int main(void)
{
    count_calls();
    count_calls();
    printf("called %d times\n", count_calls());
    return 0;
}`, true],
    ['warn', 'Recursion works, but every call uses stack. Microcontrollers have small stacks (often 1–8 KB), so firmware avoids deep recursion.'],
  ],
  quiz: [
    { q: 'What is a function prototype?', options: ['A first draft', 'A declaration of name, parameters and return type', 'A macro', 'A test'], answer: 1, explain: 'It lets the compiler check calls before the definition appears.' },
    { q: 'void f(int v) { v = 9; } — after f(x), x is…', options: ['9', 'unchanged', 'undefined', '0'], answer: 1, explain: 'C passes a copy of x, so the caller\'s x is unchanged.' },
    { q: 'A static local variable…', options: ['is recreated on every call', 'keeps its value between calls', 'is visible to all files', 'is stored in Flash'], answer: 1, explain: 'It has static storage duration but local scope.' },
    { q: 'Why is deep recursion risky on an MCU?', options: ['C forbids it', 'Each call uses stack, which is small', 'It is slow to compile', 'It disables interrupts'], answer: 1, explain: 'A stack overflow silently corrupts memory or causes a HardFault.' },
  ],
  challenges: [
    {
      title: 'Is it prime?', mode: 'function',
      prompt: 'Write `int is_prime(int n)` that returns 1 if n is a prime number and 0 otherwise. Numbers less than 2 are not prime.',
      starter: String.raw`int is_prime(int n)
{
    // TODO
    return 0;
}`,
      solution: String.raw`int is_prime(int n)
{
    if (n < 2) return 0;
    for (int d = 2; d * d <= n; d++) {
        if (n % d == 0) return 0;
    }
    return 1;
}`,
      hints: ['Handle n < 2 first.', 'Try divisors d from 2 while d * d <= n. If n % d == 0, it is not prime.'],
      tests: [
        { name: 'small numbers', harness: String.raw`#include <stdio.h>
int main(void) { for (int i = -1; i <= 12; i++) printf("%d", is_prime(i)); printf("\n"); return 0; }`, expect: '00011010100010' },
        { name: 'bigger numbers', harness: String.raw`#include <stdio.h>
int main(void) { printf("%d %d %d %d\n", is_prime(97), is_prime(91), is_prime(7919), is_prime(10007 * 3)); return 0; }`, expect: '1 0 1 0' },
      ],
    },
    {
      title: 'Unique IDs with static', mode: 'function',
      prompt: 'Write `int next_id(void)` that returns 1 the first time it is called, 2 the second time, and so on. Do **not** use a global variable — use a `static` local.',
      starter: String.raw`int next_id(void)
{
    // TODO
    return 0;
}`,
      solution: String.raw`int next_id(void)
{
    static int id = 0;
    return ++id;
}`,
      hints: ['static int id = 0; is only initialized once.', 'Return ++id.'],
      tests: [{ name: 'counts up', harness: String.raw`#include <stdio.h>
int main(void) { int a = next_id(); int b = next_id(); int c = next_id(); printf("%d %d %d\n", a, b, c); return 0; }`, expect: '1 2 3' }],
    },
  ],
},
{
  id: 'arrays', unit: 'Arrays & Strings', title: 'Arrays', emoji: '🧮', minutes: 14,
  body: [
    ['p', 'An array is a fixed number of elements of the same type, stored **next to each other** in memory. Indexes start at 0.'],
    ['code', String.raw`#include <stdio.h>

#define ARRAY_SIZE(a) (sizeof(a) / sizeof((a)[0]))

int main(void)
{
    int readings[5] = {12, 15, 11, 19, 14};
    int zeros[8] = {0};                 // all eight are 0
    int partial[4] = {7, 8};            // {7, 8, 0, 0}

    int sum = 0;
    for (size_t i = 0; i < ARRAY_SIZE(readings); i++) {
        sum += readings[i];
    }
    printf("count=%zu sum=%d first=%d last=%d\n", ARRAY_SIZE(readings), sum, readings[0], readings[4]);
    printf("zeros[7]=%d partial[3]=%d\n", zeros[7], partial[3]);
    return 0;
}`, true],
    ['h', 'Memory layout'],
    ['pre', String.raw`int readings[5];   (4 bytes each, 20 bytes total)

address:  0x20000100 0x20000104 0x20000108 0x2000010C 0x20000110
index:       [0]        [1]        [2]        [3]        [4]
value:        12         15         11         19         14`],
    ['warn', 'C does **not** check bounds. `readings[5]` reads whatever lives after the array, and writing there silently corrupts other variables. This is one of the most common firmware bugs.'],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    int arr[3] = {1, 2, 3};
    int guard = 1234;                // happens to live right after arr
    for (int i = 0; i <= 3; i++) {   // BUG: should be i < 3
        arr[i] = 0;
    }
    printf("guard = %d (was 1234?)\n", guard);
    return 0;
}`, true],
    ['h', 'Arrays and functions'],
    ['p', 'When you pass an array to a function, it **decays** to a pointer to its first element. The function cannot know the length, so you pass it separately. `sizeof` inside the function gives the pointer size (4), not the array size.'],
    ['code', String.raw`#include <stdio.h>

int sum(const int arr[], int n)      // same as: const int *arr
{
    int s = 0;
    for (int i = 0; i < n; i++) s += arr[i];
    return s;
}

int main(void)
{
    int data[] = {1, 2, 3, 4};       // size inferred: 4
    printf("sum=%d\n", sum(data, 4));
    return 0;
}`, true],
  ],
  quiz: [
    { q: 'int a[10]; What is the last valid index?', options: ['10', '9', '11', '0'], answer: 1, explain: 'Indexes run from 0 to N-1.' },
    { q: 'int a[6]; sizeof(a) / sizeof(a[0]) equals…', options: ['24', '6', '4', '1'], answer: 1, explain: '24 bytes / 4 bytes per int = 6 elements.' },
    { q: 'What does C do if you write past the end of an array?', options: ['Throws an exception', 'Grows the array', 'Nothing stops it — memory gets corrupted', 'Prints a warning at runtime'], answer: 2, explain: 'There is no bounds checking in C. It is undefined behavior.' },
    { q: 'Inside void f(int arr[]), sizeof(arr) on Cortex-M is…', options: ['The array size', '4', '0', 'Compile error'], answer: 1, explain: 'arr is really a pointer, which is 4 bytes on a 32-bit MCU.' },
  ],
  challenges: [
    {
      title: 'Find the maximum', mode: 'function',
      prompt: 'Write `int array_max(const int *a, int n)` that returns the largest of the n elements (n ≥ 1). Values can be negative!',
      starter: String.raw`int array_max(const int *a, int n)
{
    // TODO
    return 0;
}`,
      solution: String.raw`int array_max(const int *a, int n)
{
    int best = a[0];
    for (int i = 1; i < n; i++) {
        if (a[i] > best) best = a[i];
    }
    return best;
}`,
      hints: ['Start with best = a[0], not 0 — all values might be negative.', 'Loop from index 1 and keep the larger value.'],
      tests: [
        { name: 'mixed values', harness: String.raw`#include <stdio.h>
int main(void) { int a[] = {3, 17, -2, 9, 17, 4}; printf("%d\n", array_max(a, 6)); return 0; }`, expect: '17' },
        { name: 'all negative', harness: String.raw`#include <stdio.h>
int main(void) { int a[] = {-9, -4, -12}; printf("%d\n", array_max(a, 3)); return 0; }`, expect: '-4' },
        { name: 'one element', harness: String.raw`#include <stdio.h>
int main(void) { int a[] = {42}; printf("%d\n", array_max(a, 1)); return 0; }`, expect: '42' },
      ],
    },
    {
      title: 'Reverse in place', mode: 'function',
      prompt: 'Write `void reverse(int *a, int n)` that reverses the array **in place** (no second array). `{1,2,3,4}` becomes `{4,3,2,1}`.',
      starter: String.raw`void reverse(int *a, int n)
{
    // TODO: swap a[i] with a[n - 1 - i]
}`,
      solution: String.raw`void reverse(int *a, int n)
{
    for (int i = 0; i < n / 2; i++) {
        int tmp = a[i];
        a[i] = a[n - 1 - i];
        a[n - 1 - i] = tmp;
    }
}`,
      hints: ['Only loop over the first half: i < n / 2.', 'Swap with a temporary variable.'],
      tests: [
        { name: 'even length', harness: String.raw`#include <stdio.h>
int main(void) { int a[] = {1, 2, 3, 4}; reverse(a, 4); for (int i = 0; i < 4; i++) printf("%d ", a[i]); printf("\n"); return 0; }`, expect: '4 3 2 1' },
        { name: 'odd length', harness: String.raw`#include <stdio.h>
int main(void) { int a[] = {5, 6, 7, 8, 9}; reverse(a, 5); for (int i = 0; i < 5; i++) printf("%d ", a[i]); printf("\n"); return 0; }`, expect: '9 8 7 6 5' },
      ],
    },
  ],
},
{
  id: 'strings', unit: 'Arrays & Strings', title: 'Strings are char arrays', emoji: '🔤', minutes: 14,
  body: [
    ['p', 'C has no string type. A string is a `char` array that ends with a **null terminator**: the byte `\'\\0\'` (value 0). Every string function walks the bytes until it finds that 0.'],
    ['pre', String.raw`char name[] = "Ada";

index:   [0]  [1]  [2]  [3]
char:    'A'  'd'  'a'  '\0'
value:    65  100   97    0      sizeof(name) = 4, strlen(name) = 3`],
    ['code', String.raw`#include <stdio.h>
#include <string.h>

int main(void)
{
    char name[16] = "Ada";
    printf("strlen=%zu sizeof=%zu\n", strlen(name), sizeof(name));

    strcat(name, " L.");                 // append (must fit in 16 bytes!)
    printf("%s\n", name);

    if (strcmp(name, "Ada L.") == 0) {    // compare contents, not pointers
        printf("same text\n");
    }

    for (int i = 0; name[i] != '\0'; i++) {
        printf("%c=%d ", name[i], name[i]);
    }
    printf("\n");
    return 0;
}`, true],
    ['h', 'Literal vs array'],
    ['p', '`char *p = "hi";` points to a **string literal**, which the linker puts in read-only Flash. `char a[] = "hi";` makes a **copy** in RAM that you may modify. Try running this:'],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    char copy[] = "hello";     // RAM copy: OK to change
    copy[0] = 'H';
    printf("%s\n", copy);

    char *lit = "hello";       // points into Flash
    lit[0] = 'H';              // HardFault on a real MCU!
    printf("%s\n", lit);
    return 0;
}`, true],
    ['warn', 'Use `==` on strings and you compare **addresses**, not text. Use `strcmp`. And always make sure the destination buffer is big enough — buffer overflows are a classic security hole. Prefer `snprintf` and `strncpy`.'],
  ],
  quiz: [
    { q: 'How many bytes does char s[] = "GRE"; occupy?', options: ['3', '4', '2', '8'], answer: 1, explain: 'Three characters plus the \\0 terminator.' },
    { q: 'How should you compare two C strings for equality?', options: ['a == b', 'strcmp(a, b) == 0', 'a.equals(b)', 'sizeof(a) == sizeof(b)'], answer: 1, explain: '== compares pointers. strcmp compares characters.' },
    { q: 'Where does a string literal usually live on an MCU?', options: ['Stack', 'Heap', 'Read-only Flash', 'A register'], answer: 2, explain: 'Literals are constant data placed in Flash (.rodata).' },
    { q: 'What does strlen("hi\\0there") return?', options: ['8', '2', '9', '0'], answer: 1, explain: 'strlen stops at the first \\0.' },
  ],
  challenges: [
    {
      title: 'Write your own strlen', mode: 'function',
      prompt: 'Without using `<string.h>`, write `int my_strlen(const char *s)` that counts characters before the `\\0`.',
      starter: String.raw`int my_strlen(const char *s)
{
    int n = 0;
    // TODO
    return n;
}`,
      solution: String.raw`int my_strlen(const char *s)
{
    int n = 0;
    while (s[n] != '\0') n++;
    return n;
}`,
      hints: ['Loop while s[n] != \'\\0\' and count.'],
      tests: [{ name: 'lengths', harness: String.raw`#include <stdio.h>
int main(void) { printf("%d %d %d\n", my_strlen("embedded"), my_strlen(""), my_strlen("a b c")); return 0; }`, expect: '8 0 5' }],
    },
    {
      title: 'Shout it! (to upper case)', mode: 'function',
      prompt: 'Write `void to_upper(char *s)` that converts lowercase letters to uppercase **in place**. Other characters stay the same. Hint: in ASCII, `\'a\' - \'A\'` is 32.',
      starter: String.raw`void to_upper(char *s)
{
    // TODO
}`,
      solution: String.raw`void to_upper(char *s)
{
    for (; *s; s++) {
        if (*s >= 'a' && *s <= 'z') *s -= 'a' - 'A';
    }
}`,
      hints: ['Check if (s[i] >= \'a\' && s[i] <= \'z\').', 'Subtract 32 (or \'a\' - \'A\') from lowercase letters.'],
      tests: [{ name: 'converts', harness: String.raw`#include <stdio.h>
int main(void) { char a[] = "Hello, MCU 42!"; to_upper(a); printf("%s\n", a); return 0; }`, expect: 'HELLO, MCU 42!' }],
    },
  ],
},
{
  id: 'tables', unit: 'Arrays & Strings', title: '2D arrays & lookup tables', emoji: '🗂️', minutes: 12,
  body: [
    ['p', 'A 2D array is an array of arrays, stored **row by row** (row-major order). `int m[2][3]` is two rows of three ints, 24 bytes in a row.'],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    int m[2][3] = {
        {1, 2, 3},
        {4, 5, 6},
    };
    for (int r = 0; r < 2; r++) {
        for (int c = 0; c < 3; c++) {
            printf("%d ", m[r][c]);
        }
        printf("\n");
    }
    printf("m[1][2] = %d, sizeof m = %zu\n", m[1][2], sizeof m);
    return 0;
}`, true],
    ['h', 'Lookup tables: trade memory for speed'],
    ['p', 'Embedded code often replaces calculations with a precomputed table. Classic example: a 7-segment display, where each digit needs a pattern of segments a–g.'],
    ['pre', String.raw`   aaa        bit:  7 6 5 4 3 2 1 0
  f   b              - g f e d c b a
   ggg
  e   c       digit 1 = segments b,c   = 0b00000110 = 0x06
   ddd        digit 8 = all a..g      = 0b01111111 = 0x7F`],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

static const uint8_t SEG7[10] = {      // const: stored in Flash, not RAM
    0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F
};

int main(void)
{
    for (int d = 0; d < 10; d++) {
        printf("%d -> 0x%02X\n", d, SEG7[d]);
    }
    return 0;
}`, true],
    ['tip', 'Marking a table `static const` lets the linker keep it in Flash. RAM on small MCUs is precious (an STM32F0 has 4–32 KB), Flash is much larger.'],
  ],
  quiz: [
    { q: 'In int m[3][4], how many ints are there?', options: ['7', '12', '3', '4'], answer: 1, explain: '3 rows × 4 columns = 12.' },
    { q: 'C stores 2D arrays…', options: ['column by column', 'row by row', 'randomly', 'as pointers to rows'], answer: 1, explain: 'Row-major: m[0][0], m[0][1], … then m[1][0], …' },
    { q: 'Why mark a lookup table const?', options: ['It runs faster always', 'It can live in Flash and save RAM', 'It is required for arrays', 'So it can be modified'], answer: 1, explain: 'Constant data is placed in read-only memory (Flash) on MCUs.' },
  ],
  challenges: [
    {
      title: '7-segment encoder', mode: 'function',
      prompt: 'Complete `uint8_t seg7(int digit)` using a lookup table. Return the pattern for digits 0–9 (see the lesson), and `0x00` (all segments off) for anything else.',
      starter: String.raw`#include <stdint.h>

uint8_t seg7(int digit)
{
    // TODO: a static const table of 10 patterns
    return 0;
}`,
      solution: String.raw`#include <stdint.h>

uint8_t seg7(int digit)
{
    static const uint8_t table[10] = {
        0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F
    };
    if (digit < 0 || digit > 9) return 0x00;
    return table[digit];
}`,
      hints: ['Copy the table from the lesson.', 'Check the range before indexing — never read outside the table.'],
      tests: [{ name: 'all digits + invalid', harness: String.raw`#include <stdio.h>
int main(void) { for (int d = -1; d <= 10; d++) printf("%02X ", seg7(d)); printf("\n"); return 0; }`, expect: '00 3F 06 5B 4F 66 6D 7D 07 7F 6F 00' }],
    },
    {
      title: 'Matrix trace', mode: 'function',
      prompt: 'Write `int trace(int m[3][3])` that returns the sum of the main diagonal: `m[0][0] + m[1][1] + m[2][2]`.',
      starter: String.raw`int trace(int m[3][3])
{
    // TODO
    return 0;
}`,
      solution: String.raw`int trace(int m[3][3])
{
    int t = 0;
    for (int i = 0; i < 3; i++) t += m[i][i];
    return t;
}`,
      hints: ['The diagonal is where row == column.'],
      tests: [{ name: 'trace', harness: String.raw`#include <stdio.h>
int main(void) { int m[3][3] = {{1,2,3},{4,5,6},{7,8,9}}; int z[3][3] = {{-1,0,0},{0,-1,0},{0,0,10}}; printf("%d %d\n", trace(m), trace(z)); return 0; }`, expect: '15 8' }],
    },
  ],
},
{
  id: 'pointers', unit: 'Pointers', title: 'Pointers 101', emoji: '👉', minutes: 15,
  body: [
    ['p', 'Memory is a long row of numbered bytes. A **pointer** is a variable that holds one of those numbers — an **address**. On a 32-bit MCU, every address is 32 bits, so every pointer is 4 bytes.'],
    ['ul', [
      '`&x` — "address of x"',
      '`int *p` — "p is a pointer to an int"',
      '`*p` — "the int that p points to" (dereference)',
    ]],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    int x = 42;
    int *p = &x;          // p holds the address of x

    printf("x lives at %p\n", (void *)p);
    printf("value via pointer: %d\n", *p);

    *p = 99;              // write through the pointer
    printf("x is now %d\n", x);
    return 0;
}`, true],
    ['pre', String.raw`        address        value
x:   0x2001FFF4  ->    99
p:   0x2001FFF0  ->    0x2001FFF4   (points to x)`],
    ['h', 'Why pointers matter in embedded'],
    ['ul', [
      'Hardware registers are just addresses. Writing to a pointer like `*(volatile uint32_t *)0x40020014` turns an LED on.',
      'Functions can modify the caller\'s variables (output parameters).',
      'Large structs can be passed by address instead of copying them.',
      'Buffers for UART, SPI and DMA are passed as pointers.',
    ]],
    ['h', 'NULL and wild pointers'],
    ['p', '`NULL` (address 0) means "points to nothing". Dereferencing NULL crashes. An uninitialized pointer is even worse: it holds a random address. Try it:'],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    int *p = NULL;
    if (p != NULL) {
        printf("%d\n", *p);
    } else {
        printf("p is NULL, not dereferencing\n");
    }
    *p = 5;    // crash: NULL pointer dereference (HardFault on an MCU)
    return 0;
}`, true],
  ],
  quiz: [
    { q: 'If int x = 5; int *p = &x; then *p is…', options: ['The address of x', '5', 'The address of p', '0'], answer: 1, explain: '*p dereferences the pointer: it is the int stored at that address.' },
    { q: 'sizeof(char *) on a 32-bit Cortex-M is…', options: ['1', '2', '4', '8'], answer: 2, explain: 'All data pointers are 32-bit addresses here, regardless of the type they point to.' },
    { q: 'What does &x give you?', options: ['The value of x', 'The address of x', 'A copy of x', 'x squared'], answer: 1, explain: '& is the address-of operator.' },
    { q: 'What happens when you dereference NULL on an MCU?', options: ['Returns 0', 'A fault / crash', 'Nothing', 'It is fixed by the compiler'], answer: 1, explain: 'Address 0 is not valid RAM; the CPU raises a fault (or reads garbage on MCUs without protection).' },
  ],
  challenges: [
    {
      title: 'Swap', mode: 'function',
      prompt: 'Write `void swap(int *a, int *b)` that exchanges the two integers the pointers point to.',
      starter: String.raw`void swap(int *a, int *b)
{
    // TODO
}`,
      solution: String.raw`void swap(int *a, int *b)
{
    int t = *a;
    *a = *b;
    *b = t;
}`,
      hints: ['Save *a in a temporary int first.', 'Then *a = *b; *b = temp;'],
      tests: [{ name: 'swaps', harness: String.raw`#include <stdio.h>
int main(void) { int x = 3, y = -8; swap(&x, &y); printf("%d %d\n", x, y); swap(&x, &x); printf("%d\n", x); return 0; }`, expect: '-8 3\n-8' }],
    },
    {
      title: 'Saturate through a pointer', mode: 'function',
      prompt: 'Write `int limit(int *value, int max)`. If `*value` is greater than `max`, set it to `max` and return 1. Otherwise leave it alone and return 0. If `value` is NULL, return -1 without touching memory.',
      starter: String.raw`#include <stddef.h>

int limit(int *value, int max)
{
    // TODO
    return 0;
}`,
      solution: String.raw`#include <stddef.h>

int limit(int *value, int max)
{
    if (value == NULL) return -1;
    if (*value > max) {
        *value = max;
        return 1;
    }
    return 0;
}`,
      hints: ['Check for NULL first!', 'Compare *value with max, and assign through the pointer.'],
      tests: [{ name: 'limits', harness: String.raw`#include <stdio.h>
int main(void) { int a = 120, b = 50; int r1 = limit(&a, 100); int r2 = limit(&b, 100); int r3 = limit(NULL, 100); printf("%d %d %d %d %d\n", r1, a, r2, b, r3); return 0; }`, expect: '1 100 0 50 -1' }],
    },
  ],
},
{
  id: 'ptr-arith', unit: 'Pointers', title: 'Pointer arithmetic & arrays', emoji: '➕', minutes: 15,
  body: [
    ['p', 'Adding 1 to a pointer moves it to the **next element**, not the next byte. For an `int *` (4 bytes) that is +4 bytes; for a `uint8_t *` it is +1 byte.'],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

int main(void)
{
    int nums[3] = {10, 20, 30};
    int *p = nums;                 // same as &nums[0]

    printf("p     = %p -> %d\n", (void *)p, *p);
    printf("p + 1 = %p -> %d\n", (void *)(p + 1), *(p + 1));
    printf("nums[2] == *(nums + 2): %d\n", nums[2] == *(nums + 2));

    uint8_t bytes[3] = {1, 2, 3};
    uint8_t *b = bytes;
    printf("byte pointer step: %u bytes\n", (unsigned)((uint8_t *)(b + 1) - (uint8_t *)b));
    printf("int pointer step:  %u bytes\n", (unsigned)((uint8_t *)(p + 1) - (uint8_t *)p));
    return 0;
}`, true],
    ['note', '`a[i]` is defined as `*(a + i)`. That is why array indexing and pointer arithmetic are the same thing in C.'],
    ['h', 'Walking a buffer'],
    ['p', 'Embedded code often walks a buffer with a pointer, especially for strings and received data:'],
    ['code', String.raw`#include <stdio.h>

int count_spaces(const char *s)
{
    int n = 0;
    while (*s) {             // until the '\0'
        if (*s == ' ') n++;
        s++;                 // move to the next char
    }
    return n;
}

int main(void)
{
    printf("%d\n", count_spaces("a b  c"));
    return 0;
}`, true],
    ['h', 'Pointer difference'],
    ['p', 'Subtracting two pointers into the same array gives the number of **elements** between them (type `ptrdiff_t`).'],
    ['h', 'Looking at the bytes of an int'],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

int main(void)
{
    uint32_t value = 0x11223344;
    uint8_t *b = (uint8_t *)&value;      // view the same memory as bytes
    for (int i = 0; i < 4; i++) {
        printf("byte %d at %p = 0x%02X\n", i, (void *)(b + i), b[i]);
    }
    // ARM is little-endian: the lowest byte (0x44) comes first.
    return 0;
}`, true],
  ],
  quiz: [
    { q: 'int *p points to 0x20000100. What address is p + 2?', options: ['0x20000102', '0x20000108', '0x20000104', '0x20000110'], answer: 1, explain: '2 elements × 4 bytes = 8 bytes further.' },
    { q: 'a[i] is exactly the same as…', options: ['&a + i', '*(a + i)', '*a + i', 'a + *i'], answer: 1, explain: 'Indexing is defined as pointer addition followed by dereference.' },
    { q: 'If p = &arr[1] and q = &arr[4], then q - p is…', options: ['12', '3', '4', '-3'], answer: 1, explain: 'Pointer difference counts elements, not bytes.' },
  ],
  challenges: [
    {
      title: 'Sum with a pointer walk', mode: 'function',
      prompt: 'Write `int sum_range(const int *begin, const int *end)` that adds every element from `begin` up to (but **not** including) `end`. Do not use indexes — move a pointer.',
      starter: String.raw`int sum_range(const int *begin, const int *end)
{
    int sum = 0;
    // TODO
    return sum;
}`,
      solution: String.raw`int sum_range(const int *begin, const int *end)
{
    int sum = 0;
    for (const int *p = begin; p < end; p++) sum += *p;
    return sum;
}`,
      hints: ['for (const int *p = begin; p < end; p++)', 'Add *p each time.'],
      tests: [{ name: 'ranges', harness: String.raw`#include <stdio.h>
int main(void) { int a[] = {1, 2, 3, 4, 5}; printf("%d %d %d\n", sum_range(a, a + 5), sum_range(a + 1, a + 3), sum_range(a, a)); return 0; }`, expect: '15 5 0' }],
    },
    {
      title: 'Find a character', mode: 'function',
      prompt: 'Write `const char *find_char(const char *s, char c)` that returns a pointer to the first `c` in s, or `NULL` if it is not there.',
      starter: String.raw`#include <stddef.h>

const char *find_char(const char *s, char c)
{
    // TODO
    return NULL;
}`,
      solution: String.raw`#include <stddef.h>

const char *find_char(const char *s, char c)
{
    while (*s) {
        if (*s == c) return s;
        s++;
    }
    return NULL;
}`,
      hints: ['Walk the string until *s == \'\\0\'.', 'Return s as soon as *s == c.'],
      tests: [{ name: 'finds', harness: String.raw`#include <stdio.h>
int main(void) { const char *msg = "temp=23;hum=40"; const char *p = find_char(msg, '='); const char *q = find_char(msg, '#'); printf("%s | %s | %d\n", p, find_char(p + 1, '=') , q == NULL); return 0; }`, expect: '=23;hum=40 | =40 | 1' }],
    },
  ],
},
]);
