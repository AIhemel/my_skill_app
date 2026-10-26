// Embedded C curriculum, part 2: advanced pointers, memory, bits & data layout.
window.LESSONS = (window.LESSONS || []).concat([
{
  id: 'ptr-funcs', unit: 'Pointers', title: 'Pointers & functions: output parameters', emoji: '📤', minutes: 14,
  body: [
    ['p', 'A C function returns only one value. To give back more, the caller passes **addresses** where the function should store results. These are called *output parameters*. Driver APIs use them everywhere: `HAL_StatusTypeDef HAL_I2C_Receive(..., uint8_t *data, ...)` returns a status and writes data through a pointer.'],
    ['code', String.raw`#include <stdio.h>

// Returns 0 on success, -1 on error; results go through the pointers.
int divide(int a, int b, int *quotient, int *remainder)
{
    if (b == 0) return -1;
    *quotient = a / b;
    *remainder = a % b;
    return 0;
}

int main(void)
{
    int q, r;
    if (divide(17, 5, &q, &r) == 0) {
        printf("17 / 5 = %d remainder %d\n", q, r);
    }
    if (divide(1, 0, &q, &r) != 0) {
        printf("division by zero refused\n");
    }
    return 0;
}`, true],
    ['h', 'const correctness'],
    ['table', [['Declaration', 'Meaning'], ['const int *p', 'pointer to const int: you cannot change *p, but p can move'], ['int *const p', 'const pointer: p cannot move, but *p can change'], ['const int *const p', 'neither can change']]],
    ['p', 'Mark input buffers `const` (`const uint8_t *data`). It documents intent, lets the compiler catch mistakes, and allows passing data that lives in Flash.'],
    ['h', 'Never return the address of a local'],
    ['code', String.raw`#include <stdio.h>

int *bad(void)
{
    int local = 42;
    return &local;      // local dies when the function returns!
}

void scribble(void)
{
    volatile int junk[4] = {7, 7, 7, 7};   // reuses the same stack memory
    (void)junk;
}

int main(void)
{
    int *p = bad();
    scribble();
    printf("*p = %d (not 42 — the memory was reused)\n", *p);
    return 0;
}`, true],
    ['warn', 'The returned pointer points into a stack frame that no longer exists. Return the value itself, use a caller-provided buffer, or use `static` storage.'],
  ],
  quiz: [
    { q: 'How can a C function give back two results?', options: ['return a, b;', 'Through pointer (output) parameters', 'It cannot', 'Using two return statements'], answer: 1, explain: 'The caller passes addresses and the function writes through them (or returns a struct).' },
    { q: 'const uint8_t *buf means…', options: ['buf cannot point elsewhere', 'the bytes pointed to cannot be modified through buf', 'buf is in Flash', 'buf is NULL'], answer: 1, explain: 'The const applies to the data, not the pointer.' },
    { q: 'Why is returning &local from a function a bug?', options: ['It is slow', 'The local no longer exists after the function returns', 'Addresses cannot be returned', 'It leaks memory'], answer: 1, explain: 'The stack frame is reused by later calls, so the pointer dangles.' },
  ],
  challenges: [
    {
      title: 'Min and max at once', mode: 'function',
      prompt: 'Write `void min_max(const int *a, int n, int *min, int *max)` that finds both the smallest and the largest of n values (n ≥ 1) in a single pass.',
      starter: String.raw`void min_max(const int *a, int n, int *min, int *max)
{
    // TODO
}`,
      solution: String.raw`void min_max(const int *a, int n, int *min, int *max)
{
    *min = *max = a[0];
    for (int i = 1; i < n; i++) {
        if (a[i] < *min) *min = a[i];
        if (a[i] > *max) *max = a[i];
    }
}`,
      hints: ['Start both at a[0].', 'Write results with *min = …; *max = …;'],
      tests: [{ name: 'readings', harness: String.raw`#include <stdio.h>
int main(void) { int a[] = {512, 498, 530, 489, 501}; int lo, hi; min_max(a, 5, &lo, &hi); printf("%d %d\n", lo, hi); int b[] = {-5}; min_max(b, 1, &lo, &hi); printf("%d %d\n", lo, hi); return 0; }`, expect: '489 530\n-5 -5' }],
    },
    {
      title: 'Parse a number safely', mode: 'function',
      prompt: 'Write `int parse_uint(const char *s, unsigned int *out)`. If s contains only decimal digits (at least one), store the value in `*out` and return 1. Otherwise return 0 and do **not** touch `*out`. Example: "1234" → 1234; "12a" → 0; "" → 0.',
      starter: String.raw`int parse_uint(const char *s, unsigned int *out)
{
    // TODO
    return 0;
}`,
      solution: String.raw`int parse_uint(const char *s, unsigned int *out)
{
    unsigned int v = 0;
    if (*s == '\0') return 0;
    for (; *s; s++) {
        if (*s < '0' || *s > '9') return 0;
        v = v * 10 + (unsigned int)(*s - '0');
    }
    *out = v;
    return 1;
}`,
      hints: ['Build the value in a local variable first.', 'A digit\'s value is c - \'0\'.', 'Only write *out at the very end, when you know the input was valid.'],
      tests: [{ name: 'valid and invalid', harness: String.raw`#include <stdio.h>
int main(void) { unsigned int v = 999; int a = parse_uint("1234", &v); printf("%d %u\n", a, v); int b = parse_uint("12a", &v); printf("%d %u\n", b, v); int c = parse_uint("", &v); printf("%d %u\n", c, v); int d = parse_uint("0007", &v); printf("%d %u\n", d, v); return 0; }`, expect: '1 1234\n0 1234\n0 1234\n1 7' }],
    },
  ],
},
{
  id: 'ptr-ptr', unit: 'Pointers', title: 'Pointers to pointers & arrays of pointers', emoji: '🔗', minutes: 13,
  body: [
    ['p', 'A pointer is a variable too, so it has an address. A `char **` points to a `char *`. You meet them in two places: **arrays of strings** and functions that must **change the caller\'s pointer**.'],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    const char *colors[] = {"red", "green", "blue"};   // array of 3 pointers
    int n = sizeof(colors) / sizeof(colors[0]);
    for (int i = 0; i < n; i++) {
        printf("%d: %s (first letter %c)\n", i, colors[i], colors[i][0]);
    }
    printf("sizeof(colors) = %zu (3 pointers x 4 bytes)\n", sizeof(colors));
    return 0;
}`, true],
    ['pre', String.raw`colors:  [ ptr ][ ptr ][ ptr ]
            |      |      |
            v      v      v
          "red" "green" "blue"   (strings in Flash)`],
    ['h', 'Changing the caller\'s pointer'],
    ['p', 'To make a function move *your* pointer, pass the pointer\'s address. Parsers do this constantly: they consume input and advance the cursor.'],
    ['code', String.raw`#include <stdio.h>

// Reads an unsigned number and advances *cursor past it.
unsigned int read_number(const char **cursor)
{
    unsigned int v = 0;
    while (**cursor >= '0' && **cursor <= '9') {
        v = v * 10 + (unsigned int)(**cursor - '0');
        (*cursor)++;
    }
    return v;
}

int main(void)
{
    const char *p = "128,64,255";
    unsigned int r = read_number(&p); p++;   // skip ','
    unsigned int g = read_number(&p); p++;
    unsigned int b = read_number(&p);
    printf("r=%u g=%u b=%u\n", r, g, b);
    return 0;
}`, true],
    ['tip', '`int main(int argc, char **argv)` uses exactly this: argv is an array of pointers to the command-line strings.'],
  ],
  quiz: [
    { q: 'const char *names[4] is…', options: ['a string of 4 chars', 'an array of 4 pointers to char', 'a pointer to an array', '4 bytes of text'], answer: 1, explain: '[] binds tighter than *, so it is an array of pointers.' },
    { q: 'To let a function change where your pointer p points, you pass…', options: ['p', '*p', '&p', '**p'], answer: 2, explain: 'You pass the pointer\'s address, so the function receives a char ** (or int **).' },
    { q: 'In (*cursor)++, what is incremented?', options: ['cursor itself', 'the pointer that cursor points to', 'the character', 'nothing'], answer: 1, explain: 'The parentheses dereference first, so the pointed-to pointer advances.' },
  ],
  challenges: [
    {
      title: 'Count words by first letter', mode: 'function',
      prompt: 'Write `int count_starting_with(const char *words[], int n, char c)` that counts how many of the n strings start with character c.',
      starter: String.raw`int count_starting_with(const char *words[], int n, char c)
{
    // TODO
    return 0;
}`,
      solution: String.raw`int count_starting_with(const char *words[], int n, char c)
{
    int count = 0;
    for (int i = 0; i < n; i++) {
        if (words[i][0] == c) count++;
    }
    return count;
}`,
      hints: ['words[i] is a string; words[i][0] is its first character.'],
      tests: [{ name: 'counts', harness: String.raw`#include <stdio.h>
int main(void) { const char *w[] = {"spi", "i2c", "uart", "sram", "", "stack"}; printf("%d %d %d\n", count_starting_with(w, 6, 's'), count_starting_with(w, 6, 'u'), count_starting_with(w, 6, 'x')); return 0; }`, expect: '3 1 0' }],
    },
    {
      title: 'Skip whitespace', mode: 'function',
      prompt: 'Write `void skip_spaces(const char **p)` that advances the caller\'s pointer past any spaces or tabs.',
      starter: String.raw`void skip_spaces(const char **p)
{
    // TODO
}`,
      solution: String.raw`void skip_spaces(const char **p)
{
    while (**p == ' ' || **p == '\t') (*p)++;
}`,
      hints: ['**p is the current character.', 'Advance with (*p)++ — note the parentheses.'],
      tests: [{ name: 'skips', harness: String.raw`#include <stdio.h>
int main(void) { const char *s = "   \t  LED ON"; skip_spaces(&s); printf("[%s]\n", s); const char *t = "X"; skip_spaces(&t); printf("[%s]\n", t); return 0; }`, expect: '[LED ON]\n[X]' }],
    },
  ],
},
{
  id: 'func-ptrs', unit: 'Pointers', title: 'Function pointers & callbacks', emoji: '📞', minutes: 15,
  body: [
    ['p', 'Functions live in Flash at an address, so you can point to them too. A **function pointer** lets you choose *at run time* which function to call. This powers callbacks, command dispatchers, state machines — and the interrupt **vector table**.'],
    ['code', String.raw`#include <stdio.h>

int add(int a, int b) { return a + b; }
int sub(int a, int b) { return a - b; }

typedef int (*binop_t)(int, int);     // a type for "pointer to function (int,int)->int"

int main(void)
{
    binop_t op = add;
    printf("add: %d\n", op(7, 3));
    op = sub;
    printf("sub: %d\n", op(7, 3));
    printf("add lives at %p in Flash\n", (void *)add);
    return 0;
}`, true],
    ['h', 'Callbacks'],
    ['p', 'A driver often lets you register a callback: "call this function when the transfer is done". The driver does not need to know anything about your code.'],
    ['code', String.raw`#include <stdio.h>

typedef void (*callback_t)(int value);

static callback_t on_sample = 0;

void sensor_register(callback_t cb) { on_sample = cb; }

void sensor_poll(void)                 // pretend a new reading arrived
{
    static int fake = 500;
    fake += 7;
    if (on_sample) on_sample(fake);
}

void print_sample(int v) { printf("sample = %d\n", v); }

int main(void)
{
    sensor_register(print_sample);
    for (int i = 0; i < 3; i++) sensor_poll();
    return 0;
}`, true],
    ['h', 'The vector table is an array of function pointers'],
    ['pre', String.raw`Flash 0x08000000:  initial stack pointer
       0x08000004:  &Reset_Handler        <- runs after reset
       0x08000008:  &NMI_Handler
       0x0800000C:  &HardFault_Handler
       ...
       0x0800003C:  &SysTick_Handler
       ...          &EXTI15_10_IRQHandler, &TIM2_IRQHandler, ...`],
    ['p', 'When an interrupt fires, the CPU looks up the address in this table and jumps there. On this simulator you just define a function with the right name (e.g. `SysTick_Handler`) — exactly like with CMSIS on a real STM32.'],
  ],
  quiz: [
    { q: 'void (*f)(void) declares…', options: ['a function returning a pointer', 'a pointer to a function taking no args and returning nothing', 'a void pointer', 'a macro'], answer: 1, explain: 'The parentheses around *f make f a pointer to a function.' },
    { q: 'What is the interrupt vector table?', options: ['A list of variables', 'A table of handler addresses the CPU jumps to', 'A math table', 'The stack'], answer: 1, explain: 'Each entry holds the address of an exception or interrupt handler.' },
    { q: 'Why do drivers use callbacks?', options: ['They are faster', 'So the driver can notify your code without knowing about it', 'C requires them', 'To save Flash'], answer: 1, explain: 'Callbacks decouple the driver from the application.' },
  ],
  challenges: [
    {
      title: 'Reduce with a callback', mode: 'function',
      prompt: 'Write `int reduce(const int *a, int n, int (*f)(int, int), int init)`. Start with `acc = init` and for each element do `acc = f(acc, a[i])`. Return acc. With an add function this is a sum; with max it is a maximum.',
      starter: String.raw`int reduce(const int *a, int n, int (*f)(int, int), int init)
{
    // TODO
    return init;
}`,
      solution: String.raw`int reduce(const int *a, int n, int (*f)(int, int), int init)
{
    int acc = init;
    for (int i = 0; i < n; i++) acc = f(acc, a[i]);
    return acc;
}`,
      hints: ['Call the function pointer like a normal function: f(acc, a[i]).'],
      tests: [{ name: 'sum, max, product', harness: String.raw`#include <stdio.h>
int add(int x, int y) { return x + y; }
int max(int x, int y) { return x > y ? x : y; }
int mul(int x, int y) { return x * y; }
int main(void) { int a[] = {3, 9, 2, 5}; printf("%d %d %d %d\n", reduce(a, 4, add, 0), reduce(a, 4, max, -1000), reduce(a, 4, mul, 1), reduce(a, 0, add, 77)); return 0; }`, expect: '19 9 270 77' }],
    },
    {
      title: 'Command dispatcher', mode: 'function',
      prompt: 'Complete `int dispatch(char cmd, int arg)`. Use a **table of function pointers** indexed by command: `\'+\'` calls `inc`, `\'-\'` calls `dec`, `\'*\'` calls `dbl`. Unknown commands return -1. The three functions are provided.',
      starter: String.raw`int inc(int x) { return x + 1; }
int dec(int x) { return x - 1; }
int dbl(int x) { return x * 2; }

int dispatch(char cmd, int arg)
{
    // TODO: struct { char cmd; int (*fn)(int); } table[] = { ... };
    return -1;
}`,
      solution: String.raw`int inc(int x) { return x + 1; }
int dec(int x) { return x - 1; }
int dbl(int x) { return x * 2; }

int dispatch(char cmd, int arg)
{
    static const struct { char cmd; int (*fn)(int); } table[] = {
        {'+', inc}, {'-', dec}, {'*', dbl},
    };
    for (unsigned i = 0; i < sizeof table / sizeof table[0]; i++) {
        if (table[i].cmd == cmd) return table[i].fn(arg);
    }
    return -1;
}`,
      hints: ['An array of structs, each holding a char and a function pointer.', 'Loop over the table and call table[i].fn(arg) when the command matches.'],
      tests: [{ name: 'commands', harness: String.raw`#include <stdio.h>
int main(void) { printf("%d %d %d %d\n", dispatch('+', 41), dispatch('-', 0), dispatch('*', 21), dispatch('?', 5)); return 0; }`, expect: '42 -1 42 -1' }],
    },
  ],
},
{
  id: 'memory', unit: 'Pointers', title: 'Memory: stack, heap & static', emoji: '🧠', minutes: 15,
  body: [
    ['p', 'A running program uses three kinds of storage. Knowing which is which is a core embedded skill, because RAM is tiny (this simulated MCU has 128 KB; many have 4–20 KB).'],
    ['table', [['Region', 'What lives there', 'Lifetime'], ['.data / .bss (static)', 'globals and static variables', 'whole program'], ['Stack', 'local variables, function arguments, return addresses', 'until the function returns'], ['Heap', 'malloc / calloc blocks', 'until you call free'], ['Flash (.text/.rodata)', 'code, string literals, const tables', 'forever (read-only)']]],
    ['pre', String.raw`0x20020000  +----------------+  <- stack starts here, grows DOWN
            |     stack      |
            |       v        |
            |                |
            |       ^        |
            |     heap       |  <- grows UP as you malloc
            +----------------+
            |  .bss / .data  |  globals & statics
0x20000000  +----------------+`],
    ['code', String.raw`#include <stdio.h>
#include <stdlib.h>

int counter = 5;                 // .data

int main(void)
{
    int local = 1;               // stack
    int *block = malloc(4 * sizeof(int));   // heap
    if (block == NULL) {
        printf("out of memory!\n");
        return 1;
    }
    printf("global at %p\n", (void *)&counter);
    printf("heap   at %p\n", (void *)block);
    printf("stack  at %p\n", (void *)&local);
    free(block);                 // give it back
    block = NULL;                // avoid a dangling pointer
    return 0;
}`, true],
    ['h', 'Why firmware often avoids malloc'],
    ['ul', [
      '**Fragmentation**: after many malloc/free cycles, free memory is split into small holes and a big allocation fails even though enough bytes are free in total.',
      '**Non-determinism**: allocation time varies — bad for real-time code.',
      '**Leaks**: a forgotten `free` slowly eats RAM until the device crashes after days or weeks.',
      'Common rule: allocate everything at startup, or use static buffers and fixed-size pools.',
    ]],
    ['code', String.raw`#include <stdio.h>
#include <stdlib.h>

int main(void)
{
    int *p = malloc(sizeof(int));
    *p = 5;
    free(p);
    free(p);          // double free: corrupts the heap. The simulator catches it.
    return 0;
}`, true],
  ],
  quiz: [
    { q: 'Where is a local variable stored?', options: ['Heap', 'Stack', 'Flash', '.bss'], answer: 1, explain: 'Locals live in the current function\'s stack frame.' },
    { q: 'What should you always check after malloc?', options: ['That it returned NULL or not', 'Its size', 'The stack', 'Nothing'], answer: 0, explain: 'malloc returns NULL when it cannot allocate memory.' },
    { q: 'What is heap fragmentation?', options: ['A hardware fault', 'Free memory split into small pieces so big allocations fail', 'A memory leak', 'Stack overflow'], answer: 1, explain: 'Total free memory may be large, but no single hole is big enough.' },
    { q: 'Global variables without an initializer live in…', options: ['.bss and start at 0', 'the stack', 'Flash', 'the heap'], answer: 0, explain: 'The startup code zeroes the .bss section.' },
  ],
  challenges: [
    {
      title: 'Allocate a range', mode: 'function',
      prompt: 'Write `int *make_range(int n)` that allocates an array of n ints containing 0, 1, …, n-1 and returns it. Return `NULL` if n ≤ 0. The tests free the memory and check for leaks.',
      starter: String.raw`#include <stdlib.h>

int *make_range(int n)
{
    // TODO
    return NULL;
}`,
      solution: String.raw`#include <stdlib.h>

int *make_range(int n)
{
    if (n <= 0) return NULL;
    int *a = malloc((size_t)n * sizeof(int));
    if (a == NULL) return NULL;
    for (int i = 0; i < n; i++) a[i] = i;
    return a;
}`,
      hints: ['malloc(n * sizeof(int))', 'Check the result for NULL before using it.'],
      tests: [
        { name: 'values and no leak', harness: String.raw`#include <stdio.h>
#include <stdlib.h>
int main(void) { int *a = make_range(5); for (int i = 0; i < 5; i++) printf("%d ", a[i]); printf("\n"); free(a); printf("%d\n", make_range(0) == NULL); return 0; }`, expect: '0 1 2 3 4\n1', check: r => r.heap.blocks === 0 || 'Memory leak: ' + r.heap.blocks + ' block(s) were never freed.' },
      ],
    },
    {
      title: 'Duplicate a string', mode: 'function',
      prompt: 'Write `char *dup_string(const char *s)` that returns a **new** heap copy of s (like POSIX `strdup`). Remember the space for `\\0`!',
      starter: String.raw`#include <stdlib.h>
#include <string.h>

char *dup_string(const char *s)
{
    // TODO
    return NULL;
}`,
      solution: String.raw`#include <stdlib.h>
#include <string.h>

char *dup_string(const char *s)
{
    size_t n = strlen(s) + 1;
    char *copy = malloc(n);
    if (copy == NULL) return NULL;
    memcpy(copy, s, n);
    return copy;
}`,
      hints: ['Allocate strlen(s) + 1 bytes.', 'Copy with memcpy or strcpy.'],
      tests: [{ name: 'independent copy', harness: String.raw`#include <stdio.h>
#include <stdlib.h>
int main(void) { char src[] = "sensor"; char *c = dup_string(src); src[0] = 'X'; printf("%s %s %d\n", src, c, c != src); free(c); return 0; }`, expect: 'Xensor sensor 1', check: r => r.heap.blocks === 0 || 'Memory leak detected.' }],
    },
  ],
},
{
  id: 'bitwise', unit: 'Bits & Bytes', title: 'Binary, hex & bitwise operators', emoji: '🔢', minutes: 15,
  body: [
    ['p', 'Hardware speaks in bits. Each hex digit is exactly 4 bits, which is why embedded engineers love hex.'],
    ['table', [['Dec', 'Hex', 'Binary'], ['0', '0x0', '0000'], ['5', '0x5', '0101'], ['9', '0x9', '1001'], ['10', '0xA', '1010'], ['15', '0xF', '1111'], ['255', '0xFF', '1111 1111'], ['4096', '0x1000', '0001 0000 0000 0000']]],
    ['h', 'The operators'],
    ['table', [['Op', 'Name', 'Example (8-bit)'], ['a & b', 'AND', '1100 & 1010 = 1000'], ['a | b', 'OR', '1100 | 1010 = 1110'], ['a ^ b', 'XOR', '1100 ^ 1010 = 0110'], ['~a', 'NOT', '~0000 1111 = 1111 0000'], ['a << n', 'shift left', '0000 0011 << 2 = 0000 1100'], ['a >> n', 'shift right', '1000 0000 >> 3 = 0001 0000']]],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

void print_bits(uint8_t v)
{
    for (int i = 7; i >= 0; i--) {
        putchar((v >> i) & 1 ? '1' : '0');
        if (i == 4) putchar(' ');
    }
    putchar('\n');
}

int main(void)
{
    uint8_t a = 0xC5, b = 0x3C;
    printf("a      = "); print_bits(a);
    printf("b      = "); print_bits(b);
    printf("a & b  = "); print_bits(a & b);
    printf("a | b  = "); print_bits(a | b);
    printf("a ^ b  = "); print_bits(a ^ b);
    printf("~a     = "); print_bits((uint8_t)~a);
    printf("a << 1 = "); print_bits((uint8_t)(a << 1));
    printf("a >> 4 = "); print_bits(a >> 4);
    printf("5 << 3 = %d (x8), 200 >> 2 = %d (/4)\n", 5 << 3, 200 >> 2);
    return 0;
}`, true],
    ['note', 'Shifting left by n multiplies by 2^n; shifting an unsigned value right by n divides by 2^n. Compilers use this trick for fast math.'],
    ['warn', 'Use unsigned types for bit work. Right-shifting a negative signed number and shifting into the sign bit have surprising or undefined behavior. `1 << 31` overflows an int — write `1U << 31`.'],
    ['h', 'Handy tricks'],
    ['ul', ['`x & 1` → is x odd?', '`x & (x - 1)` → clears the lowest set bit', '`x ^ x` → always 0 (XOR is its own inverse)', '`(x >> n) & 1` → read bit n']],
  ],
  quiz: [
    { q: '0x3C in binary is…', options: ['0011 1100', '0011 1010', '1100 0011', '0010 1100'], answer: 0, explain: '3 = 0011, C = 1100.' },
    { q: '0xF0 & 0x3C equals…', options: ['0xFC', '0x30', '0xCC', '0x0C'], answer: 1, explain: '1111 0000 AND 0011 1100 = 0011 0000 = 0x30.' },
    { q: 'What is 1 << 4?', options: ['4', '5', '16', '8'], answer: 2, explain: 'Shifting 1 left by 4 gives binary 1 0000 = 16.' },
    { q: 'Which operator flips only the bits where the mask is 1?', options: ['&', '|', '^', '~'], answer: 2, explain: 'XOR with 1 toggles a bit; XOR with 0 leaves it unchanged.' },
  ],
  challenges: [
    {
      title: 'Count the 1 bits', mode: 'function',
      prompt: 'Write `int count_ones(uint32_t x)` that returns how many bits are 1 (a.k.a. *popcount* or *Hamming weight*). Example: 0xF0 → 4.',
      starter: String.raw`#include <stdint.h>

int count_ones(uint32_t x)
{
    int n = 0;
    // TODO
    return n;
}`,
      solution: String.raw`#include <stdint.h>

int count_ones(uint32_t x)
{
    int n = 0;
    while (x) {
        x &= x - 1;   // clear lowest set bit
        n++;
    }
    return n;
}`,
      hints: ['Check the lowest bit with x & 1, then shift x right by 1, until x is 0.', 'Faster: x &= x - 1 clears one set bit per loop.'],
      tests: [{ name: 'values', harness: String.raw`#include <stdio.h>
int main(void) { printf("%d %d %d %d %d\n", count_ones(0), count_ones(0xF0), count_ones(0xFFFFFFFFu), count_ones(0x80000001u), count_ones(0x12345678)); return 0; }`, expect: '0 4 32 2 13' }],
    },
    {
      title: 'Power of two?', mode: 'function',
      prompt: 'Write `int is_power_of_two(uint32_t x)` returning 1 for 1, 2, 4, 8, … and 0 otherwise (0 is not a power of two). Try the one-line bit trick!',
      starter: String.raw`#include <stdint.h>

int is_power_of_two(uint32_t x)
{
    // TODO
    return 0;
}`,
      solution: String.raw`#include <stdint.h>

int is_power_of_two(uint32_t x)
{
    return x != 0 && (x & (x - 1)) == 0;
}`,
      hints: ['A power of two has exactly one bit set.', 'x & (x - 1) clears the lowest set bit — the result is 0 only if there was a single 1.'],
      tests: [{ name: 'values', harness: String.raw`#include <stdio.h>
int main(void) { uint32_t v[] = {0, 1, 2, 3, 64, 96, 1024, 0x80000000u, 0xFFFFFFFFu}; for (int i = 0; i < 9; i++) printf("%d", is_power_of_two(v[i])); printf("\n"); return 0; }`, expect: '011010110' }],
    },
  ],
},
{
  id: 'bit-manip', unit: 'Bits & Bytes', title: 'Set, clear, toggle: register bit fields', emoji: '🎛️', minutes: 16,
  body: [
    ['p', 'Peripheral registers pack many settings into one 32-bit word. You must change **only your bits** and leave the others alone. Memorize these four idioms — you will use them every day:'],
    ['table', [['Goal', 'Code'], ['Set bit n', 'reg |= (1U << n);'], ['Clear bit n', 'reg &= ~(1U << n);'], ['Toggle bit n', 'reg ^= (1U << n);'], ['Test bit n', 'if (reg & (1U << n)) { ... }']]],
    ['h', 'Multi-bit fields'],
    ['p', 'Many settings use 2+ bits. For example, an STM32 GPIO pin\'s mode uses 2 bits in `MODER` (00 input, 01 output, 10 alternate function, 11 analog). Pin 5 uses bits 11:10. To write a field you **clear it, then set it**:'],
    ['pre', String.raw`MODER bit:  31 ... 11 10  9  8 ...  1  0
pin:         15 ...  pin 5   pin 4 ... pin 0

mask  = 0x3 << (5 * 2)          = 0x00000C00
moder = (moder & ~mask) | (0x1 << (5 * 2));   // pin 5 = output`],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

#define BIT(n)            (1U << (n))
#define FIELD_MASK(pos, w) (((1U << (w)) - 1U) << (pos))

int main(void)
{
    uint32_t reg = 0x000000F0;
    reg |= BIT(0);            // set bit 0
    reg &= ~BIT(4);           // clear bit 4
    reg ^= BIT(31);           // toggle bit 31
    printf("reg = 0x%08X, bit 5 is %u\n", reg, (reg >> 5) & 1U);

    uint32_t moder = 0xFFFFFFFF;
    int pin = 5;
    moder = (moder & ~FIELD_MASK(pin * 2, 2)) | (0x1U << (pin * 2));
    printf("moder = 0x%08X (pin 5 mode = %u)\n", moder, (moder >> (pin * 2)) & 0x3U);
    return 0;
}`, true],
    ['warn', '`reg = (1 << 5);` (plain `=`) sets bit 5 but **clears all other bits** — a classic bug that silently turns off other pins or features. Use `|=` to set and `&= ~` to clear.'],
    ['note', 'Read-modify-write (`reg |= x`) is three steps: read, modify, write. If an interrupt changes the same register in between, an update can be lost. That is why STM32 GPIO has the **BSRR** register: one write sets or resets pins atomically.'],
  ],
  quiz: [
    { q: 'How do you clear bit 3 of reg?', options: ['reg &= (1 << 3);', 'reg &= ~(1U << 3);', 'reg |= ~(1 << 3);', 'reg ^= 3;'], answer: 1, explain: 'AND with a mask that has a 0 only at bit 3.' },
    { q: 'reg = (1U << 2); is dangerous because…', options: ['It does not compile', 'It clears all other bits', 'It sets bit 1', 'It is slow'], answer: 1, explain: 'Plain assignment replaces the whole register.' },
    { q: 'For a 2-bit field at position 6, the mask is…', options: ['0x03', '0x0C', '0xC0', '0x60'], answer: 2, explain: '0b11 << 6 = 0b1100 0000 = 0xC0.' },
  ],
  challenges: [
    {
      title: 'Field read & write', mode: 'function',
      prompt: 'Write two helpers:\n\n`uint32_t get_field(uint32_t reg, int pos, int width)` → returns the `width`-bit value starting at bit `pos`.\n\n`uint32_t set_field(uint32_t reg, int pos, int width, uint32_t value)` → returns reg with that field replaced by `value` (other bits unchanged). Assume width is 1–31.',
      starter: String.raw`#include <stdint.h>

uint32_t get_field(uint32_t reg, int pos, int width)
{
    // TODO
    return 0;
}

uint32_t set_field(uint32_t reg, int pos, int width, uint32_t value)
{
    // TODO
    return reg;
}`,
      solution: String.raw`#include <stdint.h>

uint32_t get_field(uint32_t reg, int pos, int width)
{
    uint32_t mask = (1U << width) - 1U;
    return (reg >> pos) & mask;
}

uint32_t set_field(uint32_t reg, int pos, int width, uint32_t value)
{
    uint32_t mask = ((1U << width) - 1U) << pos;
    return (reg & ~mask) | ((value << pos) & mask);
}`,
      hints: ['The width-bit mask is (1U << width) - 1U.', 'Get: shift right by pos, then AND with the mask.', 'Set: clear with & ~(mask << pos), then OR in (value << pos).'],
      tests: [
        { name: 'get_field', harness: String.raw`#include <stdio.h>
int main(void) { printf("%u %u %u\n", get_field(0x00000C00, 10, 2), get_field(0xABCD1234, 16, 8), get_field(0xFFFFFFFF, 31, 1)); return 0; }`, expect: '3 205 1' },
        { name: 'set_field', harness: String.raw`#include <stdio.h>
int main(void) { printf("0x%08X 0x%08X 0x%08X\n", set_field(0xFFFFFFFF, 10, 2, 1), set_field(0x00000000, 4, 4, 0xA), set_field(0x12345678, 0, 8, 0x1FF)); return 0; }`, expect: '0xFFFFF7FF 0x000000A0 0x123456FF' },
      ],
    },
    {
      title: 'Configure GPIO modes', mode: 'function',
      prompt: 'An STM32 MODER register has 2 bits per pin. Write `uint32_t gpio_set_mode(uint32_t moder, int pin, uint32_t mode)` that sets pin `pin` (0–15) to `mode` (0–3) without disturbing other pins.',
      starter: String.raw`#include <stdint.h>

uint32_t gpio_set_mode(uint32_t moder, int pin, uint32_t mode)
{
    // TODO
    return moder;
}`,
      solution: String.raw`#include <stdint.h>

uint32_t gpio_set_mode(uint32_t moder, int pin, uint32_t mode)
{
    moder &= ~(0x3U << (pin * 2));
    moder |= (mode & 0x3U) << (pin * 2);
    return moder;
}`,
      hints: ['The field for pin n starts at bit n * 2 and is 2 bits wide.', 'Clear with &= ~(0x3U << (pin * 2)), then OR in the mode.'],
      tests: [{ name: 'modes', harness: String.raw`#include <stdio.h>
int main(void) { printf("0x%08X 0x%08X 0x%08X\n", gpio_set_mode(0, 5, 1), gpio_set_mode(0xFFFFFFFF, 0, 0), gpio_set_mode(0x0C000000, 13, 2)); return 0; }`, expect: '0x00000400 0xFFFFFFFC 0x08000000' }],
    },
  ],
},
{
  id: 'fixed-width', unit: 'Bits & Bytes', title: 'Fixed-width integers & overflow', emoji: '🌊', minutes: 14,
  body: [
    ['p', 'Integers have a fixed number of bits, so they can **overflow**. Unsigned types wrap around (well-defined). Signed overflow is *undefined behavior* in C — the compiler may assume it never happens.'],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

int main(void)
{
    uint8_t u = 250;
    u += 10;                    // 260 does not fit: wraps to 4
    printf("uint8_t: 250 + 10 = %u\n", u);

    uint16_t ticks = 65535;
    ticks++;
    printf("uint16_t: 65535 + 1 = %u\n", ticks);

    uint32_t now = 5, then = 4294967290u;   // timer wrapped around
    printf("elapsed = %u (unsigned subtraction handles wrap!)\n", now - then);
    return 0;
}`, true],
    ['tip', 'That last trick is how firmware measures time: `if ((uint32_t)(millis() - start) >= 500)` works even when the millisecond counter wraps around after 49 days.'],
    ['h', 'Integer promotion'],
    ['p', 'Before arithmetic, types smaller than `int` (char, short, uint8_t, uint16_t) are promoted to `int`. So `uint8_t a = 200, b = 100;` then `a + b` is the int 300 — it only wraps if you store it back into a uint8_t.'],
    ['h', 'Signed vs unsigned comparison trap'],
    ['code', String.raw`#include <stdio.h>

int main(void)
{
    int temperature = -5;
    unsigned int limit = 10;
    if (temperature < limit) {
        printf("below limit\n");
    } else {
        printf("SURPRISE: -5 is not less than 10u?!\n");   // -5 converts to 4294967291
    }
    return 0;
}`, true],
    ['warn', 'When a signed and an unsigned int meet, the signed value is converted to unsigned. Keep comparisons between the same signedness, or cast deliberately.'],
  ],
  quiz: [
    { q: 'uint8_t x = 255; x++; x is now…', options: ['256', '0', '-1', 'undefined'], answer: 1, explain: 'Unsigned types wrap around modulo 2^8.' },
    { q: 'What is int8_t x = 127; x + 1 when stored back in x on typical hardware?', options: ['128', '-128', '0', '127'], answer: 1, explain: 'It wraps to -128 on two\'s-complement hardware (technically implementation-defined when converting).' },
    { q: '(uint32_t)(5u - 4294967290u) equals…', options: ['11', '-4294967285', '0', 'overflow error'], answer: 0, explain: 'Unsigned subtraction wraps, giving the correct elapsed count of 11.' },
    { q: 'Before computing a + b with two uint8_t values, C converts them to…', options: ['uint8_t', 'int', 'unsigned long', 'float'], answer: 1, explain: 'Integer promotion converts small types to int.' },
  ],
  challenges: [
    {
      title: 'Saturating 8-bit add', mode: 'function',
      prompt: 'Audio and PWM code often **saturates** instead of wrapping. Write `uint8_t sat_add_u8(uint8_t a, uint8_t b)` that returns a + b, but 255 if the true sum is larger than 255.',
      starter: String.raw`#include <stdint.h>

uint8_t sat_add_u8(uint8_t a, uint8_t b)
{
    // TODO
    return a + b;
}`,
      solution: String.raw`#include <stdint.h>

uint8_t sat_add_u8(uint8_t a, uint8_t b)
{
    unsigned int sum = (unsigned int)a + b;
    return sum > 255 ? 255 : (uint8_t)sum;
}`,
      hints: ['Compute the sum in a wider type (int or unsigned int) — thanks to promotion, a + b already is an int.', 'If it is greater than 255, return 255.'],
      tests: [{ name: 'values', harness: String.raw`#include <stdio.h>
int main(void) { printf("%u %u %u %u\n", sat_add_u8(100, 100), sat_add_u8(200, 100), sat_add_u8(255, 255), sat_add_u8(0, 0)); return 0; }`, expect: '200 255 255 0' }],
    },
    {
      title: 'Saturating signed 16-bit add', mode: 'function',
      prompt: 'Write `int16_t sat_add_i16(int16_t a, int16_t b)` that clamps the result to the int16 range: -32768 … 32767.',
      starter: String.raw`#include <stdint.h>

int16_t sat_add_i16(int16_t a, int16_t b)
{
    // TODO
    return a + b;
}`,
      solution: String.raw`#include <stdint.h>

int16_t sat_add_i16(int16_t a, int16_t b)
{
    int32_t s = (int32_t)a + b;
    if (s > INT16_MAX) return INT16_MAX;
    if (s < INT16_MIN) return INT16_MIN;
    return (int16_t)s;
}`,
      hints: ['Add in int32_t so nothing overflows.', 'Compare with INT16_MAX and INT16_MIN.'],
      tests: [{ name: 'values', harness: String.raw`#include <stdio.h>
int main(void) { printf("%d %d %d %d\n", sat_add_i16(30000, 3000), sat_add_i16(-30000, -3000), sat_add_i16(100, -200), sat_add_i16(32767, 0)); return 0; }`, expect: '32767 -32768 -100 32767' }],
    },
  ],
},
{
  id: 'structs', unit: 'Bits & Bytes', title: 'Structs, unions, padding & bit-fields', emoji: '🧱', minutes: 16,
  body: [
    ['p', 'A `struct` groups related data. The compiler may insert **padding** so each member is aligned to its natural boundary (a `uint32_t` at an address divisible by 4). This matters when structs map to hardware or to bytes sent over a wire.'],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

typedef struct {
    uint8_t  id;        // offset 0, then 3 bytes padding
    uint32_t value;     // offset 4
    uint8_t  flags;     // offset 8, then 3 bytes padding
} Messy;                // 12 bytes

typedef struct {
    uint32_t value;     // offset 0
    uint8_t  id;        // offset 4
    uint8_t  flags;     // offset 5, then 2 bytes padding
} Tidy;                 // 8 bytes

int main(void)
{
    printf("Messy: %zu bytes, Tidy: %zu bytes\n", sizeof(Messy), sizeof(Tidy));
    Tidy t = { .value = 1000, .id = 7, .flags = 0x01 };
    Tidy *p = &t;
    p->value += 24;                 // -> is (*p).value
    printf("id=%u value=%u\n", t.id, t.value);
    return 0;
}`, true],
    ['tip', 'Order members from largest to smallest to minimize padding. `__attribute__((packed))` removes padding entirely, but unaligned access can be slow (or fault on some CPUs).'],
    ['h', 'Unions: one memory, many views'],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

typedef union {
    uint32_t word;
    uint8_t  bytes[4];
} Word;

int main(void)
{
    Word w;
    w.word = 0xA1B2C3D4;
    printf("bytes: %02X %02X %02X %02X\n", w.bytes[0], w.bytes[1], w.bytes[2], w.bytes[3]);
    printf("sizeof = %zu (the size of the largest member)\n", sizeof(Word));
    return 0;
}`, true],
    ['h', 'Bit-fields: naming bits inside a register'],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

typedef union {
    struct {
        uint32_t enable : 1;   // bit 0
        uint32_t mode   : 2;   // bits 2:1
        uint32_t        : 5;   // reserved, bits 7:3
        uint32_t prescaler : 8;// bits 15:8
    } bits;
    uint32_t raw;
} CtrlReg;

int main(void)
{
    CtrlReg c = { .raw = 0 };
    c.bits.enable = 1;
    c.bits.mode = 2;
    c.bits.prescaler = 0x3F;
    printf("raw = 0x%08X\n", c.raw);
    return 0;
}`, true],
    ['warn', 'Bit-field layout is implementation-defined (it depends on the compiler and endianness). Vendor headers usually use masks and shifts instead for portability.'],
  ],
  quiz: [
    { q: 'Why might sizeof(struct) be larger than the sum of its members?', options: ['Compiler bug', 'Alignment padding', 'Hidden pointers', 'Debug info'], answer: 1, explain: 'Padding keeps each member at its natural alignment.' },
    { q: 'p->x is the same as…', options: ['*p.x', '(*p).x', '&p.x', 'p.x'], answer: 1, explain: '-> dereferences the pointer, then selects the member.' },
    { q: 'The size of a union is…', options: ['the sum of its members', 'the size of its largest member (plus padding)', 'always 4', '1'], answer: 1, explain: 'All members share the same memory.' },
  ],
  challenges: [
    {
      title: 'Shrink the struct', mode: 'program',
      prompt: 'The `Packet` struct wastes RAM. **Reorder its members** (do not change types, do not use `packed`) so that `sizeof(Packet)` becomes 8. Keep the main() as it is.',
      starter: String.raw`#include <stdio.h>
#include <stdint.h>

typedef struct {
    uint8_t  type;
    uint32_t timestamp;
    uint8_t  channel;
    uint16_t value;
} Packet;

int main(void)
{
    Packet p = { .type = 1, .timestamp = 123456, .channel = 3, .value = 512 };
    printf("size=%zu type=%u ts=%u ch=%u val=%u\n", sizeof(Packet), p.type, p.timestamp, p.channel, p.value);
    return 0;
}`,
      solution: String.raw`#include <stdio.h>
#include <stdint.h>

typedef struct {
    uint32_t timestamp;
    uint16_t value;
    uint8_t  type;
    uint8_t  channel;
} Packet;

int main(void)
{
    Packet p = { .type = 1, .timestamp = 123456, .channel = 3, .value = 512 };
    printf("size=%zu type=%u ts=%u ch=%u val=%u\n", sizeof(Packet), p.type, p.timestamp, p.channel, p.value);
    return 0;
}`,
      hints: ['Put the 4-byte member first, then the 2-byte one, then the 1-byte ones.'],
      tests: [{ name: 'size is 8 and values intact', expect: 'size=8 type=1 ts=123456 ch=3 val=512', check: r => !/packed/.test(r.src) || 'Do not use packed — reorder the members.' }],
    },
    {
      title: 'Find the hottest sensor', mode: 'function',
      prompt: 'Given `typedef struct { char name[8]; int16_t temp; } Sensor;` write `const Sensor *hottest(const Sensor *list, int n)` that returns a pointer to the sensor with the highest temperature (the first one if tied), or NULL if n is 0.',
      starter: String.raw`#include <stddef.h>
#include <stdint.h>

typedef struct { char name[8]; int16_t temp; } Sensor;

const Sensor *hottest(const Sensor *list, int n)
{
    // TODO
    return NULL;
}`,
      solution: String.raw`#include <stddef.h>
#include <stdint.h>

typedef struct { char name[8]; int16_t temp; } Sensor;

const Sensor *hottest(const Sensor *list, int n)
{
    if (n <= 0) return NULL;
    const Sensor *best = &list[0];
    for (int i = 1; i < n; i++) {
        if (list[i].temp > best->temp) best = &list[i];
    }
    return best;
}`,
      hints: ['Keep a pointer to the best element so far: const Sensor *best = &list[0];', 'Compare list[i].temp with best->temp.'],
      tests: [{ name: 'finds hottest', harness: String.raw`#include <stdio.h>
int main(void) { Sensor s[] = {{"cpu", 61}, {"gpu", 74}, {"ssd", 40}, {"vrm", 74}}; const Sensor *h = hottest(s, 4); printf("%s %d %d\n", h->name, h->temp, (int)(h - s)); printf("%d\n", hottest(s, 0) == NULL); return 0; }`, expect: 'gpu 74 1\n1' }],
    },
  ],
},
{
  id: 'endianness', unit: 'Bits & Bytes', title: 'Endianness & byte streams', emoji: '🔁', minutes: 14,
  body: [
    ['p', 'Multi-byte values must be split into bytes to travel over UART, SPI, I2C or the network. **Endianness** is the order of those bytes.'],
    ['pre', String.raw`value 0x12345678
                 addr+0  addr+1  addr+2  addr+3
little-endian:    78      56      34      12     (ARM Cortex-M, x86)
big-endian:       12      34      56      78     ("network order", many sensors)`],
    ['p', 'The portable way to read and write a multi-byte value is with **shifts**, which work the same on any CPU:'],
    ['code', String.raw`#include <stdio.h>
#include <stdint.h>

uint16_t read_be16(const uint8_t *p) { return (uint16_t)((p[0] << 8) | p[1]); }

void write_le32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v);
    p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16);
    p[3] = (uint8_t)(v >> 24);
}

int main(void)
{
    // A temperature sensor sends its 16-bit reading big-endian: 0x01 0x9A
    uint8_t rx[2] = {0x01, 0x9A};
    printf("reading = %u\n", read_be16(rx));     // 410

    uint8_t tx[4];
    write_le32(tx, 0xCAFEBABE);
    printf("tx bytes: %02X %02X %02X %02X\n", tx[0], tx[1], tx[2], tx[3]);
    return 0;
}`, true],
    ['h', 'Checksums'],
    ['p', 'Serial data can get corrupted, so protocols add a checksum. GPS receivers send NMEA sentences like `$GPGLL,4916.45,N,12311.12,W,225444,A*31` where `31` is the **XOR of every character between `$` and `*`**, in hex.'],
    ['warn', 'Casting a byte buffer to `uint32_t *` and dereferencing it depends on the CPU\'s endianness *and* may break on unaligned addresses. Shifts are safe everywhere.'],
  ],
  quiz: [
    { q: 'On a little-endian CPU, which byte of 0xAABBCCDD is stored at the lowest address?', options: ['AA', 'BB', 'CC', 'DD'], answer: 3, explain: 'Little-endian stores the least significant byte first.' },
    { q: 'Bytes 0x02 0x10 as big-endian 16-bit are…', options: ['0x1002', '0x0210', '528', 'Both B and C'], answer: 3, explain: '0x0210 = 2×256 + 16 = 528.' },
    { q: 'Why build values with shifts instead of pointer casts?', options: ['It is portable and alignment-safe', 'It is required by C', 'It uses less Flash always', 'Casts are illegal'], answer: 0, explain: 'Shifts do not depend on CPU byte order or alignment.' },
  ],
  challenges: [
    {
      title: 'Decode a sensor frame', mode: 'function',
      prompt: 'Write `uint32_t read_le32(const uint8_t *p)` (little-endian) and `uint16_t read_be16(const uint8_t *p)` (big-endian) using shifts.',
      starter: String.raw`#include <stdint.h>

uint32_t read_le32(const uint8_t *p)
{
    // TODO
    return 0;
}

uint16_t read_be16(const uint8_t *p)
{
    // TODO
    return 0;
}`,
      solution: String.raw`#include <stdint.h>

uint32_t read_le32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

uint16_t read_be16(const uint8_t *p)
{
    return (uint16_t)((p[0] << 8) | p[1]);
}`,
      hints: ['Little-endian: p[0] is the lowest byte → no shift; p[3] shifts by 24.', 'Cast to uint32_t before shifting by 24 to avoid signed overflow.'],
      tests: [{ name: 'frame', harness: String.raw`#include <stdio.h>
int main(void) { uint8_t f[] = {0x78, 0x56, 0x34, 0x12, 0x01, 0x9A, 0xFF, 0xFF, 0xFF, 0xFF}; printf("0x%08X %u 0x%08X %u\n", read_le32(f), read_be16(f + 4), read_le32(f + 6), read_be16(f + 8)); return 0; }`, expect: '0x12345678 410 0xFFFFFFFF 65535' }],
    },
    {
      title: 'GPS checksum', mode: 'function',
      prompt: 'Write `uint8_t nmea_checksum(const char *s)` that XORs every character **after** the leading `$` and **before** the `*` (or the end of the string). For `"$GPGLL,4916.45,N,12311.12,W,225444,A*31"` it must return 0x31.',
      starter: String.raw`#include <stdint.h>

uint8_t nmea_checksum(const char *s)
{
    uint8_t sum = 0;
    // TODO
    return sum;
}`,
      solution: String.raw`#include <stdint.h>

uint8_t nmea_checksum(const char *s)
{
    uint8_t sum = 0;
    if (*s == '$') s++;
    while (*s && *s != '*') {
        sum ^= (uint8_t)*s;
        s++;
    }
    return sum;
}`,
      hints: ['Skip the first character if it is \'$\'.', 'Loop until \'*\' or \'\\0\', doing sum ^= *s.'],
      tests: [{ name: 'real GPS sentences', harness: String.raw`#include <stdio.h>
int main(void) { printf("%02X %02X %02X\n", nmea_checksum("$GPGLL,4916.45,N,12311.12,W,225444,A*31"), nmea_checksum("$GPGGA,092750.000,5321.6802,N,00630.3372,W,1,8,1.03,61.7,M,55.2,M,,*76"), nmea_checksum("$")); return 0; }`, expect: '31 76 00' }],
    },
  ],
},
{
  id: 'preproc', unit: 'Bits & Bytes', title: 'Macros, const & volatile', emoji: '⚙️', minutes: 15,
  body: [
    ['p', 'The preprocessor rewrites your source **before** compilation. `#define` does pure text substitution — powerful, but it ignores C\'s rules.'],
    ['code', String.raw`#include <stdio.h>

#define BAD_SQUARE(x)  x * x
#define SQUARE(x)      ((x) * (x))
#define LED_COUNT      8

int main(void)
{
    printf("BAD_SQUARE(2 + 1) = %d\n", BAD_SQUARE(2 + 1));   // 2 + 1 * 2 + 1 = 5
    printf("SQUARE(2 + 1)     = %d\n", SQUARE(2 + 1));       // 9
    printf("%d LEDs\n", LED_COUNT);
    return 0;
}`, true],
    ['ul', [
      'Wrap every macro parameter **and** the whole body in parentheses.',
      'Beware double evaluation: `SQUARE(i++)` increments i twice.',
      'Multi-statement macros use `do { ... } while (0)` so they behave like one statement.',
      'Prefer `static inline` functions and `const` variables when you can — they have types.',
    ]],
    ['h', 'Include guards and configuration'],
    ['code', String.raw`#ifndef LED_DRIVER_H     // include guard: the body is only
#define LED_DRIVER_H     // processed once, even if included twice

#define USE_DEBUG_UART 1

#if USE_DEBUG_UART
  #define LOG(msg) printf("[log] %s\n", msg)
#else
  #define LOG(msg)       // compiles to nothing in release builds
#endif

#endif`, false],
    ['h', 'volatile: "this can change behind your back"'],
    ['p', '`volatile` tells the compiler that a variable can change outside the normal program flow — by **hardware** (a status register) or by an **interrupt handler**. Without it, an optimizing compiler may read the value once and loop forever:'],
    ['code', String.raw`#include <stdint.h>

volatile uint32_t tick_count;           // updated by an interrupt

void wait_ticks(uint32_t n)
{
    uint32_t start = tick_count;
    while ((tick_count - start) < n) {
        // without volatile, the compiler could cache tick_count
        // in a register and this loop would never end
    }
}

#define GPIOA_IDR (*(volatile uint32_t *)0x40020010)  // hardware register`, false],
    ['note', 'Rule of thumb: use `volatile` for memory-mapped registers and for variables shared between an ISR and the main loop. `volatile` does **not** make operations atomic.'],
  ],
  quiz: [
    { q: 'With #define DOUBLE(x) x + x, what is 3 * DOUBLE(2)?', options: ['12', '8', '6', '10'], answer: 1, explain: 'It expands to 3 * 2 + 2 = 8. Parentheses would fix it.' },
    { q: 'What does volatile tell the compiler?', options: ['Store it in Flash', 'The value may change unexpectedly, so always read/write memory', 'Make it atomic', 'It is constant'], answer: 1, explain: 'It prevents the compiler from caching or removing accesses.' },
    { q: 'What is an include guard for?', options: ['Security', 'Preventing a header from being processed twice', 'Speed', 'Hiding variables'], answer: 1, explain: '#ifndef/#define/#endif stops duplicate definitions.' },
    { q: 'Which variable should be volatile?', options: ['A loop counter in main', 'A flag set inside an interrupt handler and read in main', 'A const lookup table', 'A function parameter'], answer: 1, explain: 'Data shared with an ISR must be volatile.' },
  ],
  challenges: [
    {
      title: 'Fix the macros', mode: 'program',
      prompt: 'These macros are broken. **Only change the #define lines** so the program prints:\n\n`MAX: 9`\n`DIFF*2: 8`\n`CLAMP: 0 5 10`',
      starter: String.raw`#include <stdio.h>

#define MAX(a, b)        a > b ? a : b
#define DIFF(a, b)       a - b
#define CLAMP(x, lo, hi) x < lo ? lo : x > hi ? hi : x

int main(void)
{
    printf("MAX: %d\n", MAX(4, 9));
    printf("DIFF*2: %d\n", DIFF(10, 6) * 2);
    printf("CLAMP: %d %d %d\n", CLAMP(-3, 0, 10), CLAMP(5, 0, 10), CLAMP(20, 0, 10));
    return 0;
}`,
      solution: String.raw`#include <stdio.h>

#define MAX(a, b)        ((a) > (b) ? (a) : (b))
#define DIFF(a, b)       ((a) - (b))
#define CLAMP(x, lo, hi) ((x) < (lo) ? (lo) : (x) > (hi) ? (hi) : (x))

int main(void)
{
    printf("MAX: %d\n", MAX(4, 9));
    printf("DIFF*2: %d\n", DIFF(10, 6) * 2);
    printf("CLAMP: %d %d %d\n", CLAMP(-3, 0, 10), CLAMP(5, 0, 10), CLAMP(20, 0, 10));
    return 0;
}`,
      hints: ['Put parentheses around every parameter use and around the whole macro body.', 'DIFF(10, 6) * 2 expands to 10 - 6 * 2 without parentheses.'],
      tests: [{ name: 'output', expect: 'MAX: 9\nDIFF*2: 8\nCLAMP: 0 5 10' }],
    },
    {
      title: 'Write utility macros', mode: 'function', starterIncomplete: true,
      prompt: 'Define three macros used by the test code:\n\n`ARRAY_SIZE(a)` — number of elements of an array\n`BIT(n)` — an unsigned value with only bit n set\n`IS_SET(reg, n)` — 1 if bit n of reg is set, else 0',
      starter: String.raw`// TODO: #define ARRAY_SIZE(a) ...
// TODO: #define BIT(n) ...
// TODO: #define IS_SET(reg, n) ...
`,
      solution: String.raw`#define ARRAY_SIZE(a)   (sizeof(a) / sizeof((a)[0]))
#define BIT(n)          (1U << (n))
#define IS_SET(reg, n)  ((((reg) >> (n)) & 1U) ? 1 : 0)
`,
      hints: ['ARRAY_SIZE: sizeof the whole array divided by sizeof one element.', 'BIT(n): (1U << (n)).', 'IS_SET: ((reg) >> (n)) & 1U.'],
      tests: [{ name: 'macros work', harness: String.raw`#include <stdio.h>
#include <stdint.h>
int main(void) { uint16_t buf[12]; char name[] = "uart"; uint32_t r = BIT(3) | BIT(31); printf("%zu %zu 0x%08X %d %d %d\n", ARRAY_SIZE(buf), ARRAY_SIZE(name), r, IS_SET(r, 3), IS_SET(r, 4), IS_SET(r, 1 + 30)); return 0; }`, expect: '12 5 0x80000008 1 0 1' }],
    },
  ],
},
]);
