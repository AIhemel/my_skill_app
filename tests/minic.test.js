// Tests for the MiniC compiler/VM.  Run: node tests/minic.test.js
const MC = require('./load-minic.js');

let pass = 0, failCount = 0;
function check(name, cond, info) {
  if (cond) pass++;
  else { failCount++; console.log('FAIL:', name, info !== undefined ? '\n   ' + info : ''); }
}
function out(name, src, expected, opts) {
  const r = MC.run(src, opts);
  const got = r.errors.length ? 'COMPILE ERROR: ' + r.errors.map(e => e.line + ': ' + e.msg).join('; ')
    : r.runtimeError ? r.stdout + 'RUNTIME ERROR: ' + r.runtimeError.msg : r.stdout;
  check(name, got === expected, 'expected ' + JSON.stringify(expected) + '\n   got      ' + JSON.stringify(got));
  return r;
}
const main = body => '#include <stdio.h>\n#include <stdint.h>\n#include <string.h>\n#include <stdlib.h>\nint main(void) {\n' + body + '\nreturn 0;\n}\n';

// ---------------------------------------------------------------- integers
out('uint8 wraps', main('uint8_t x = 250; x += 10; printf("%u\\n", x);'), '4\n');
out('int8 wraps', main('int8_t x = 127; x++; printf("%d\\n", x);'), '-128\n');
out('promotion in expression', main('uint8_t a = 200, b = 100; int s = a + b; uint8_t c = a + b; printf("%d %u\\n", s, c);'), '300 44\n');
out('signed/unsigned compare trap', main('int a = -1; unsigned int b = 1; printf("%d\\n", a < b);'), '0\n');
out('int division truncates', main('printf("%d %d %d %d\\n", 7/2, -7/2, 7%3, -7%3);'), '3 -3 1 -1\n');
out('unsigned wrap', main('uint32_t x = 0; x--; printf("%u %x\\n", x, x);'), '4294967295 ffffffff\n');
out('int overflow wraps', main('int x = 2147483647; x = x + 1; printf("%d\\n", x);'), '-2147483648\n');
out('mul wrap 32-bit', main('uint32_t a = 0x12345678, b = 0x9abcdef0; printf("%08x\\n", a * b);'), '242d2080\n');
out('shifts', main('uint32_t x = 1u << 31; int y = -16; printf("%u %d %u\\n", x, y >> 2, x >> 31);'), '2147483648 -4 1\n');
out('bit ops', main('uint8_t r = 0; r |= (1 << 3); r |= (1 << 5); r &= ~(1 << 3); r ^= 1; printf("0x%02X %d\\n", r, (r >> 5) & 1);'), '0x21 1\n');
out('char arithmetic', main("char c = 'a'; c = c - 32; printf(\"%c %d\\n\", c, 'Z' - 'A');"), 'A 25\n');
out('64-bit', main('uint64_t big = 1ULL << 40; long long n = -5; big += 3; printf("%llu %lld %llx\\n", big, n * 1000000000000LL, big);'), '1099511627779 -5000000000000 10000000003\n');
out('sizeof types (32-bit ARM)', main('printf("%zu %zu %zu %zu %zu %zu\\n", sizeof(char), sizeof(short), sizeof(int), sizeof(long), sizeof(long long), sizeof(void*));'), '1 2 4 4 8 4\n');
out('hex/octal/binary literals', main('printf("%d %d %d\\n", 0x1F, 017, 0b1010);'), '31 15 10\n');
out('ternary & comma', main('int a = 5, b; b = (a > 3) ? 10 : 20; int c = (a++, a + 1); printf("%d %d %d\\n", b, c, a);'), '10 7 6\n');
out('logical short circuit', main('int n = 0; int *p = NULL; if (p != NULL && *p == 3) n = 1; if (p == NULL || *p) n += 2; printf("%d\\n", n);'), '2\n');
out('pre/post increment', main('int i = 5; int a = i++; int b = ++i; printf("%d %d %d\\n", a, b, i);'), '5 7 7\n');
out('compound assigns', main('int x = 100; x -= 1; x *= 2; x /= 3; x %= 7; x <<= 4; x >>= 1; x |= 1; x &= 0xF; x ^= 3; printf("%d\\n", x);'), '10\n');

// ---------------------------------------------------------------- floats
out('float math', main('float f = 1.0f / 3.0f; double d = 1.0 / 3.0; printf("%.6f %.10f\\n", f, d);'), '0.333333 0.3333333333\n');
out('float precision', main('float f = 0.1f; printf("%.10f\\n", f);'), '0.1000000015\n');
out('int to float', main('int a = 7, b = 2; float r1 = a / b; float r2 = (float)a / b; printf("%.1f %.1f\\n", r1, r2);'), '3.0 3.5\n');
out('float to int truncation', main('double d = -3.9; int i = (int)d; printf("%d %d\\n", i, (int)3.99);'), '-3 3\n');
out('math lib', main('printf("%.3f %.1f %.0f\\n", sqrt(2.0), pow(2, 10), floor(-2.5));').replace('#include <stdlib.h>', '#include <stdlib.h>\n#include <math.h>'), '1.414 1024.0 -3\n');

// ---------------------------------------------------------------- printf
out('printf widths', main('printf("[%5d][%-5d][%05d][%+d][% d]\\n", 42, 42, 42, 42, 42);'), '[   42][42   ][00042][+42][ 42]\n');
out('printf hex', main('printf("%x %X %08X %#x %#o %o\\n", 255, 255, 0xBEEF, 255, 8, 8);'), 'ff FF 0000BEEF 0xff 010 10\n');
out('printf strings', main('printf("[%s][%10s][%-6s][%.3s][%c]\\n", "hi", "right", "left", "abcdef", 65);'), '[hi][     right][left  ][abc][A]\n');
out('printf floats', main('printf("%f %.2f %8.3f %e %g %g %g\\n", 3.14159, 2.5, -1.5, 12345.678, 0.0001, 100000.0, 1e7);'), '3.141590 2.50   -1.500 1.234568e+04 0.0001 100000 1e+07\n');
out('printf percent & hh', main('uint8_t v = 300 - 44; printf("100%% %hhu %hd\\n", v, (short)70000);'), '100% 0 4464\n');
out('printf pointer', main('int x; int *p = &x; printf("%d\\n", (unsigned)p >= 0x20000000u);'), '1\n');
out('sprintf', main('char buf[32]; int n = sprintf(buf, "T=%d.%dC", 23, 5); printf("%s %d %zu\\n", buf, n, strlen(buf));'), 'T=23.5C 7 7\n');
out('snprintf truncates', main('char buf[6]; int n = snprintf(buf, sizeof buf, "%s", "abcdefgh"); printf("%s %d\\n", buf, n);'), 'abcde 8\n');
out('puts putchar', main('puts("hello"); putchar(\'x\'); putchar(\'\\n\');'), 'hello\nx\n');

// ---------------------------------------------------------------- pointers & arrays
out('pointer arithmetic', main('int a[] = {10, 20, 30, 40}; int *p = a + 1; printf("%d %d %d %td\\n", *p, *(p + 2), p[-1], &a[3] - p);'), '20 40 10 2\n');
out('swap via pointers', '#include <stdio.h>\nvoid swap(int *a, int *b) { int t = *a; *a = *b; *b = t; }\nint main(void) { int x = 1, y = 2; swap(&x, &y); printf("%d %d\\n", x, y); return 0; }', '2 1\n');
out('pointer to pointer', main('int v = 5; int *p = &v; int **pp = &p; **pp = 9; printf("%d %d\\n", v, *p == **pp);'), '9 1\n');
out('2D array', main('int m[3][4]; for (int i = 0; i < 3; i++) for (int j = 0; j < 4; j++) m[i][j] = i * 10 + j; printf("%d %d %zu %zu\\n", m[2][3], *(*(m + 1) + 2), sizeof m, sizeof m[0]);'), '23 12 48 16\n');
out('pointer to array', main('int a[2][3] = {{1,2,3},{4,5,6}}; int (*row)[3] = a; row++; printf("%d %d\\n", (*row)[0], row[0][2]);'), '4 6\n');
out('array decay in function', '#include <stdio.h>\nint sum(const int *arr, int n) { int s = 0; for (int i = 0; i < n; i++) s += arr[i]; return s; }\nint size_in(int arr[]) { return sizeof(arr); }\nint main(void) { int a[6] = {1,2,3,4,5,6}; printf("%d %zu %d\\n", sum(a, 6), sizeof a / sizeof a[0], size_in(a)); return 0; }', '21 6 4\n');
out('function pointers', '#include <stdio.h>\nint add(int a, int b) { return a + b; }\nint mul(int a, int b) { return a * b; }\nint apply(int (*op)(int, int), int x, int y) { return op(x, y); }\nint main(void) { int (*ops[2])(int, int) = {add, mul}; printf("%d %d %d\\n", ops[0](3, 4), (*ops[1])(3, 4), apply(mul, 5, 6)); return 0; }', '7 12 30\n');
out('void pointer cast', main('float f = 1.0f; uint32_t bits = *(uint32_t *)&f; void *vp = &f; printf("0x%08X %.1f\\n", bits, *(float *)vp);'), '0x3F800000 1.0\n');
out('endianness via bytes', main('uint32_t x = 0x11223344; uint8_t *b = (uint8_t *)&x; printf("%02X %02X %02X %02X\\n", b[0], b[1], b[2], b[3]);'), '44 33 22 11\n');
out('index commutes', main('int a[3] = {7, 8, 9}; printf("%d\\n", 2[a]);'), '9\n');

// ---------------------------------------------------------------- strings
out('string functions', main('char s[20] = "Hello"; strcat(s, ", C"); char t[20]; strcpy(t, s); printf("%s %zu %d %d\\n", t, strlen(t), strcmp("abc", "abd") < 0, strncmp("abcx", "abcy", 3));'), 'Hello, C 8 1 0\n');
out('char array init', main('char a[] = "hey"; char b[6] = {\'h\', \'i\'}; printf("%zu %s %d\\n", sizeof a, b, b[5]);'), '4 hi 0\n');
out('reverse string in place', '#include <stdio.h>\n#include <string.h>\nvoid rev(char *s) { char *e = s + strlen(s) - 1; while (s < e) { char t = *s; *s++ = *e; *e-- = t; } }\nint main(void) { char w[] = "embedded"; rev(w); printf("%s\\n", w); return 0; }', 'deddebme\n');
out('string literal is read-only', main('char *s = "hello"; s[0] = \'H\'; printf("%s\\n", s);'), 'RUNTIME ERROR: HardFault: tried to write to Flash at 0x08008000. String literals and const data live in read-only Flash — copy into a char array (char s[] = "...") if you need to modify it. (in main())');
out('ctype', main('#include <ctype.h>\nprintf("%c%c %d %d\\n", toupper(\'a\'), tolower(\'Q\'), isdigit(\'7\'), isalpha(\'7\'));'), 'Aq 1 0\n');
out('atoi strtol', main('char *end; printf("%d %ld %ld\\n", atoi("  -42xyz"), strtol("ff", &end, 16), strtol("0x1A", NULL, 0));'), '-42 255 26\n');

// ---------------------------------------------------------------- structs, unions, enums
out('structs', '#include <stdio.h>\ntypedef struct { int x, y; } Point;\nstruct Rect { Point tl, br; };\nint area(const struct Rect *r) { return (r->br.x - r->tl.x) * (r->br.y - r->tl.y); }\nint main(void) { struct Rect r = { {1, 2}, {4, 6} }; Point p = r.br; p.x = 100; printf("%d %d %d\\n", area(&r), r.br.x, p.x); return 0; }', '12 4 100\n');
out('struct return & copy', '#include <stdio.h>\ntypedef struct { int a; char name[8]; } Item;\nItem make(int a) { Item it = { a, "box" }; return it; }\nint main(void) { Item x = make(7); Item y; y = x; y.name[0] = \'f\'; printf("%d %s %s %d\\n", x.a, x.name, y.name, make(3).a); return 0; }', '7 box fox 3\n');
out('struct padding', main('struct A { char c; int i; char d; }; struct B { char c; char d; int i; }; printf("%zu %zu\\n", sizeof(struct A), sizeof(struct B));'), '12 8\n');
out('packed struct', main('struct __attribute__((packed)) P { uint8_t c; uint32_t i; }; printf("%zu\\n", sizeof(struct P));'), '5\n');
out('offsetof', main('#include <stddef.h>\nstruct S { char a; short b; int c; }; printf("%zu %zu %zu\\n", offsetof(struct S, a), offsetof(struct S, b), offsetof(struct S, c));'), '0 2 4\n');
out('designated init', main('struct C { int r, g, b; }; struct C c = { .b = 3, .r = 1 }; int arr[5] = { [1] = 10, [3] = 30 }; printf("%d %d %d | %d %d %d\\n", c.r, c.g, c.b, arr[0], arr[1], arr[3]);'), '1 0 3 | 0 10 30\n');
out('array of structs', main('struct S { const char *name; int v; } tab[] = { {"a", 1}, {"b", 2}, {"c", 3} }; int s = 0; for (size_t i = 0; i < sizeof tab / sizeof tab[0]; i++) s += tab[i].v; printf("%d %s\\n", s, tab[2].name);'), '6 c\n');
out('unions', main('union { uint32_t word; uint8_t bytes[4]; } u; u.word = 0xAABBCCDD; printf("%02X %zu\\n", u.bytes[0], sizeof u);'), 'DD 4\n');
out('bit-fields', main('struct Reg { uint32_t en : 1; uint32_t mode : 2; uint32_t speed : 3; uint32_t : 2; uint32_t val : 8; }; union { struct Reg r; uint32_t raw; } u; u.raw = 0; u.r.en = 1; u.r.mode = 2; u.r.speed = 7; u.r.val = 0xAB; printf("0x%08X %zu %u\\n", u.raw, sizeof(struct Reg), u.r.mode);'), '0x0000AB3D 4 2\n');
out('signed bit-field', main('struct { int v : 3; } s; s.v = 5; printf("%d\\n", s.v);'), '-3\n');
out('enums & switch', '#include <stdio.h>\ntypedef enum { IDLE, RUN = 5, STOP } State;\nconst char *name(State s) { switch (s) { case IDLE: return "idle"; case RUN: return "run"; default: return "other"; } }\nint main(void) { State s = STOP; printf("%d %s %s\\n", s, name(RUN), name(s)); return 0; }', '6 run other\n');
out('switch fallthrough', main('int n = 0; for (int i = 0; i < 4; i++) { switch (i) { case 0: n += 1; case 1: n += 10; break; case 2: { n += 100; break; } default: n += 1000; } } printf("%d\\n", n);'), '1121\n');
out('loops break continue', main('int s = 0; for (int i = 0; i < 10; i++) { if (i % 2) continue; if (i > 6) break; s += i; } int k = 0; do { k++; } while (k < 3); int w = 10; while (w--) if (w == 5) break; printf("%d %d %d\\n", s, k, w);'), '12 3 5\n');

// ---------------------------------------------------------------- memory, scope, recursion
out('recursion', '#include <stdio.h>\nunsigned long long fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }\nint fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\nint main(void) { printf("%llu %d\\n", fact(20), fib(20)); return 0; }', '2432902008176640000 6765\n');
out('static local', '#include <stdio.h>\nint counter(void) { static int c = 0; return ++c; }\nint main(void) { counter(); counter(); printf("%d\\n", counter()); return 0; }', '3\n');
out('globals zeroed', '#include <stdio.h>\nint g; int arr[3]; char *ptr;\nint main(void) { printf("%d %d %d\\n", g, arr[2], ptr == NULL); return 0; }', '0 0 1\n');
out('shadowing', main('int x = 1; { int x = 2; x++; } printf("%d\\n", x);'), '1\n');
out('malloc linked list', '#include <stdio.h>\n#include <stdlib.h>\ntypedef struct Node { int v; struct Node *next; } Node;\nNode *push(Node *h, int v) { Node *n = malloc(sizeof(Node)); n->v = v; n->next = h; return n; }\nint main(void) { Node *h = NULL; for (int i = 1; i <= 4; i++) h = push(h, i * i); for (Node *p = h; p; p = p->next) printf("%d ", p->v); while (h) { Node *n = h->next; free(h); h = n; } printf("\\n"); return 0; }', '16 9 4 1 \n');
const leak = out('heap leak tracking', main('int *p = malloc(40); p[9] = 1; printf("ok\\n");'), 'ok\n');
check('leak counted', leak.heap.blocks === 1 && leak.heap.inUse === 40, JSON.stringify(leak.heap));
{ const r = MC.run(main('int *p = malloc(8); free(p); free(p);')); check('double free', r.runtimeError && /double free detected/.test(r.runtimeError.msg), JSON.stringify(r.runtimeError)); }
out('null deref', main('int *p = NULL; printf("before\\n"); *p = 5;'), 'before\nRUNTIME ERROR: Segmentation fault: tried to write to address 0x00000000 — that is a NULL pointer dereference (on a real MCU: HardFault). Check the pointer is set before you use it. (in main())');
out('div by zero', main('int z = 0; printf("%d\\n", 5 / z);'), 'RUNTIME ERROR: Division by zero (on a Cortex-M this can trigger a UsageFault). (in main())');
out('stack overflow', '#include <stdio.h>\nint f(int n) { return f(n + 1) + 1; }\nint main(void) { printf("%d\\n", f(0)); return 0; }', 'RUNTIME ERROR: Stack overflow while calling f() — the 32 KB stack is full. Deep or endless recursion (missing base case?) or big local arrays use it up. (in f())');
out('exit code', '#include <stdlib.h>\n#include <stdio.h>\nint main(void) { printf("bye\\n"); exit(3); }', 'bye\n');
out('qsort', '#include <stdio.h>\n#include <stdlib.h>\nint cmp(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }\nint main(void) { int v[] = {5, 1, 4, 2, 3}; qsort(v, 5, sizeof(int), cmp); for (int i = 0; i < 5; i++) printf("%d", v[i]); printf("\\n"); return 0; }', '12345\n');
out('const global in flash', '#include <stdio.h>\nconst int table[3] = {1, 2, 3};\nint main(void) { printf("%d %d\\n", table[1], (unsigned)&table[0] < 0x20000000u); return 0; }', '2 1\n');
out('scanf stdin', main('int a, b; char w[16]; scanf("%d %d %s", &a, &b, w); printf("%d %s\\n", a + b, w);'), '7 hey\n', { stdin: '3 4 hey' });

// ---------------------------------------------------------------- preprocessor
out('macros', '#include <stdio.h>\n#define SQ(x) ((x) * (x))\n#define MAX(a, b) ((a) > (b) ? (a) : (b))\n#define BIT(n) (1U << (n))\n#define STR(x) #x\n#define CAT(a, b) a##b\nint main(void) { int CAT(my, var) = 4; printf("%d %d %u %s %d\\n", SQ(3 + 1), MAX(2, 9), BIT(4), STR(hello), myvar); return 0; }', '16 9 16 hello 4\n');
out('ifdef', '#include <stdio.h>\n#define DEBUG 1\n#if DEBUG > 0\n#define LOG(msg) printf("[dbg] %s\\n", msg)\n#else\n#define LOG(msg)\n#endif\n#ifndef FOO\nint foo = 3;\n#endif\nint main(void) { LOG("x"); printf("%d\\n", foo); return 0; }', '[dbg] x\n3\n');
out('multiline macro', '#include <stdio.h>\n#define SWAP(a, b) do { \\\n  int t = (a); \\\n  (a) = (b); \\\n  (b) = t; \\\n} while (0)\nint main(void) { int x = 1, y = 2; SWAP(x, y); printf("%d%d\\n", x, y); return 0; }', '21\n');
out('variadic macro', '#include <stdio.h>\n#define LOGF(fmt, ...) printf("> " fmt "\\n", __VA_ARGS__)\nint main(void) { LOGF("%d+%d", 1, 2); return 0; }', '> 1+2\n');

// ---------------------------------------------------------------- diagnostics
function compileErr(name, src, line, re) {
  const r = MC.run(src);
  const e = r.errors[0];
  check(name, e && e.line === line && re.test(e.msg), JSON.stringify(r.errors));
}
function warns(name, src, re) {
  const r = MC.run(src);
  check(name, r.warnings.some(w => re.test(w.msg)), JSON.stringify(r.warnings) + JSON.stringify(r.errors));
}
compileErr('missing semicolon', '#include <stdio.h>\nint main(void) {\n  int x = 5\n  printf("%d", x);\n  return 0;\n}', 3, /expected ';'/);
compileErr('undeclared with suggestion', 'int main(void) {\n  int count = 0;\n  cout = 3;\n  return 0;\n}', 3, /'cout' undeclared.*did you mean 'count'/);
compileErr('implicit function', 'int main(void) {\n  prnitf("x");\n  return 0;\n}', 2, /implicit declaration.*did you mean 'printf'/);
compileErr('array assignment', 'int main(void) {\n  char s[10];\n  s = "hi";\n  return 0;\n}', 3, /array type/);
compileErr('const assignment', 'int main(void) {\n  const int x = 1;\n  x = 2;\n  return 0;\n}', 3, /read-only variable 'x'/);
compileErr('too few args', 'int f(int a, int b) { return a + b; }\nint main(void) {\n  return f(1);\n}', 3, /too few arguments/);
compileErr('dot on pointer', 'struct P { int x; };\nint main(void) {\n  struct P p, *q = &p;\n  q.x = 1;\n  return 0;\n}', 4, /use '->'/);
compileErr('missing main', 'int helper(void) { return 1; }', 0, /main/);
compileErr('unbalanced brace', 'int main(void) {\n  if (1) {\n  return 0;\n}', 1, /never closed/);
compileErr('undefined function body', 'int f(void);\nint main(void) {\n  return f();\n}', 3, /undefined reference to 'f'/);
warns('assign in condition', 'int main(void) { int x = 0; if (x = 5) return 1; return 0; }', /did you mean '=='/);
warns('narrowing constant', '#include <stdint.h>\nint main(void) { uint8_t v = 300; return v; }', /changes value from 300 to 44/);
warns('format mismatch', '#include <stdio.h>\nint main(void) { double d = 1.5; printf("%d\\n", d); return 0; }', /expects an integer/);
warns('int to pointer', '#include <stdint.h>\nint main(void) { uint32_t *reg = 0x40020014; return reg != 0; }', /pointer from integer/);
warns('unused variable', 'int main(void) { int unused = 3; return 0; }', /unused variable 'unused'/);
warns('sign compare', 'int main(void) { int i = -1; unsigned int n = 3; return i < n; }', /different signs/);

// ---------------------------------------------------------------- limits
const inf = MC.run('int main(void) { while (1) { } }', { maxSteps: 200000 });
check('infinite loop stops', inf.status === 'timeout' && /infinite loop/.test(inf.message), inf.message);

// ---------------------------------------------------------------- constant folding == runtime semantics
{
  const types = ['int', 'unsigned int', 'uint8_t', 'int8_t', 'int16_t', 'uint16_t', 'long long', 'unsigned long long'];
  const ops = ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '<', '==', '>'];
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const vals = ['0', '1', '7', '-1', '-7', '255', '300', '65535', '2147483647', '-2147483647', '123456789', '40000'];
  let consts = '', runs = '';
  for (let i = 0; i < 120; i++) {
    const ta = types[rnd(types.length)], tb = types[rnd(types.length)], op = ops[rnd(ops.length)];
    const va = vals[rnd(vals.length)];
    let vb = vals[rnd(vals.length)];
    if ((op === '/' || op === '%') && (vb === '0')) vb = '3';
    if (op === '<<' || op === '>>') vb = String(rnd(8));
    const expr = `(${ta})(${va}) ${op} (${tb})(${vb})`;
    consts += `printf("%lld\\n", (long long)(${expr}));\n`;
    runs += `{ ${ta} a = (${ta})(${va}); ${tb} b = (${tb})(${vb}); printf("%lld\\n", (long long)(a ${op} b)); }\n`;
  }
  const a = MC.run('#include <stdio.h>\n#include <stdint.h>\nint main(void) {\n' + consts + 'return 0; }');
  const b = MC.run('#include <stdio.h>\n#include <stdint.h>\nint main(void) {\n' + runs + 'return 0; }');
  check('folding matches runtime', a.stdout === b.stdout && a.stdout.length > 100, (a.errors[0] || b.errors[0] || b.runtimeError || {}).msg);
}

// ---------------------------------------------------------------- virtual board
const blink = `#include "board.h"
int main(void) {
  RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
  GPIOA->MODER |= (1U << 10);          /* PA5 output */
  for (int i = 0; i < 6; i++) {
    GPIOA->ODR ^= (1U << 5);
    delay_ms(500);
  }
  return 0;
}`;
const rb = MC.run(blink);
check('blink runs', rb.status === 'ok', JSON.stringify(rb.errors) + JSON.stringify(rb.runtimeError));
check('blink timeline', JSON.stringify(rb.board.ledTimeline.map(e => [e.t / 1000 | 0, e.v])) === JSON.stringify([[0, 0], [0, 32], [500, 0], [1000, 32], [1500, 0], [2000, 32], [2500, 0]]), JSON.stringify(rb.board.ledTimeline));
const noClock = MC.run(blink.replace('RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;', ''));
check('clock gating note', noClock.board.leds === 0 && noClock.board.notes.some(n => /clock is off/.test(n)), JSON.stringify(noClock.board.notes));
const noModer = MC.run(blink.replace('GPIOA->MODER |= (1U << 10);', ''));
check('moder note', noModer.board.notes.some(n => /MODER/.test(n)), JSON.stringify(noModer.board.notes));

const rawPtr = MC.run(`#include <stdint.h>
#define RCC_AHB1ENR (*(volatile uint32_t *)0x40023830)
#define GPIOA_MODER (*(volatile uint32_t *)0x40020000)
#define GPIOA_BSRR  (*(volatile uint32_t *)0x40020018)
int main(void) {
  RCC_AHB1ENR |= 1;
  GPIOA_MODER = 0x5555;          /* PA0..PA7 outputs */
  GPIOA_BSRR = 0x00A5;           /* set 0,2,5,7 */
  GPIOA_BSRR = (1U << (16 + 0)); /* reset 0 */
  return 0;
}`);
check('raw register pointers + BSRR', rawPtr.board.leds === 0xA4, rawPtr.board.leds + ' ' + JSON.stringify(rawPtr.errors) + JSON.stringify(rawPtr.board.notes));

const systick = MC.run(`#include "board.h"
volatile uint32_t ticks = 0;
void SysTick_Handler(void) { ticks++; }
int main(void) {
  SysTick_Config(SystemCoreClock / 1000);   /* 1 ms */
  uint32_t start = ticks;
  while (ticks - start < 250) { }
  printf("%u %u\\n", ticks, millis());
  return 0;
}`);
check('systick interrupt', systick.stdout === '250 250\n' && systick.board.irqCounts.SysTick === 250, systick.stdout + JSON.stringify(systick.runtimeError) + JSON.stringify(systick.errors));

const uart = MC.run(`#include "board.h"
void uart_putc(char c) { while (!(USART2->SR & USART_SR_TXE)) { } USART2->DR = c; }
void uart_puts(const char *s) { while (*s) uart_putc(*s++); }
int main(void) {
  RCC->APB1ENR |= RCC_APB1ENR_USART2EN;
  USART2->BRR = 16000000 / 115200;
  USART2->CR1 = USART_CR1_UE | USART_CR1_TE;
  uart_puts("Hello UART\\r\\n");
  return 0;
}`);
check('uart output', uart.board.uart === 'Hello UART\r\n', JSON.stringify(uart.board.uart) + JSON.stringify(uart.errors) + JSON.stringify(uart.board.notes));

const button = MC.run(`#include "board.h"
volatile int presses = 0;
void EXTI15_10_IRQHandler(void) {
  if (EXTI->PR & EXTI_PR_PR13) { EXTI->PR = EXTI_PR_PR13; presses++; }
}
int main(void) {
  RCC->AHB1ENR |= RCC_AHB1ENR_GPIOCEN;
  EXTI->IMR |= EXTI_IMR_MR13;
  EXTI->RTSR |= EXTI_RTSR_TR13;
  NVIC_EnableIRQ(EXTI15_10_IRQn);
  delay_ms(3000);
  printf("presses=%d\\n", presses);
  return 0;
}`, { input: { button: [[500, 700], [1500, 1600], [2500, 2600]] } });
check('exti button interrupts', button.stdout === 'presses=3\n', button.stdout + JSON.stringify(button.runtimeError));

const storm = MC.run(`#include "board.h"
void EXTI15_10_IRQHandler(void) { }
int main(void) {
  EXTI->IMR |= EXTI_IMR_MR13; EXTI->RTSR |= EXTI_RTSR_TR13; NVIC_EnableIRQ(EXTI15_10_IRQn);
  delay_ms(1000); return 0;
}`, { input: { button: [[100, 200]] } });
check('interrupt storm detected', storm.runtimeError && /storm/.test(storm.runtimeError.msg), JSON.stringify(storm.runtimeError));

const poll = MC.run(`#include "board.h"
int main(void) {
  RCC->AHB1ENR |= RCC_AHB1ENR_GPIOCEN;
  int count = 0, prev = 0;
  for (int i = 0; i < 2000; i++) {
    int now = (GPIOC->IDR >> BUTTON_PIN) & 1;
    if (now && !prev) count++;
    prev = now;
    delay_ms(1);
  }
  printf("%d\\n", count);
  return 0;
}`, { input: { button: [[100, 300], [900, 1000]] } });
check('button polling', poll.stdout === '2\n', poll.stdout + JSON.stringify(poll.runtimeError));

const adc = MC.run(`#include "board.h"
uint16_t read_adc(void) {
  ADC1->CR2 |= ADC_CR2_SWSTART;
  while (!(ADC1->SR & ADC_SR_EOC)) { }
  return (uint16_t)ADC1->DR;
}
int main(void) {
  RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;
  ADC1->CR2 |= ADC_CR2_ADON;
  printf("%u\\n", read_adc());
  return 0;
}`, { input: { pot: 3000 } });
check('adc read', adc.stdout === '3000\n', adc.stdout + JSON.stringify(adc.runtimeError) + JSON.stringify(adc.board.notes));

const tim = MC.run(`#include "board.h"
volatile uint32_t updates = 0;
void TIM2_IRQHandler(void) {
  if (TIM2->SR & TIM_SR_UIF) { TIM2->SR &= ~TIM_SR_UIF; updates++; GPIOA->ODR ^= 1; }
}
int main(void) {
  RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
  GPIOA->MODER |= 1;
  RCC->APB1ENR |= RCC_APB1ENR_TIM2EN;
  TIM2->PSC = 16000 - 1;   /* 1 kHz tick */
  TIM2->ARR = 100 - 1;     /* 100 ms */
  TIM2->DIER |= TIM_DIER_UIE;
  NVIC_EnableIRQ(TIM2_IRQn);
  TIM2->CR1 |= TIM_CR1_CEN;
  while (1) { __WFI(); }
}`, { maxTimeMs: 1050 });
check('tim2 interrupts', tim.status === 'timeout' && tim.board.irqCounts.TIM2 === 10, tim.board.irqCounts.TIM2 + ' ' + JSON.stringify(tim.runtimeError) + tim.message);

const busy = MC.run(`#include "board.h"
int main(void) {
  RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
  GPIOA->MODER |= (1U << 0);
  while (1) {
    GPIOA->ODR ^= 1;
    for (volatile uint32_t i = 0; i < 100000; i++) { }
  }
}`, { maxTimeMs: 1000 });
check('busy-wait blink runs until time limit', busy.status === 'timeout' && busy.board.ledTimeline.length > 3, busy.message + ' ' + busy.board.ledTimeline.length);

console.log(`\n${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
