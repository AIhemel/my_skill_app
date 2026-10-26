/*
 * MiniC part 2: types and the parser (produces a fully typed AST).
 * The design follows small one-pass C compilers such as chibicc: scopes,
 * types and implicit conversions are resolved while parsing.
 */
(function (MC) {
  'use strict';
  const { fail, tokenize } = MC;

  // ------------------------------------------------------------------ types

  let structIds = 0;
  function mkInt(size, unsigned, name, rank) {
    return { kind: 'int', size, align: size, unsigned, name, rank };
  }
  const T = {
    void: { kind: 'void', size: 1, align: 1, name: 'void' },
    bool: { kind: 'bool', size: 1, align: 1, unsigned: true, name: '_Bool', rank: 0 },
    char: mkInt(1, false, 'char', 1),
    schar: mkInt(1, false, 'signed char', 1),
    uchar: mkInt(1, true, 'unsigned char', 1),
    short: mkInt(2, false, 'short', 2),
    ushort: mkInt(2, true, 'unsigned short', 2),
    int: mkInt(4, false, 'int', 3),
    uint: mkInt(4, true, 'unsigned int', 3),
    long: mkInt(4, false, 'long', 4),
    ulong: mkInt(4, true, 'unsigned long', 4),
    llong: mkInt(8, false, 'long long', 5),
    ullong: mkInt(8, true, 'unsigned long long', 5),
    float: { kind: 'float', size: 4, align: 4, name: 'float' },
    double: { kind: 'double', size: 8, align: 8, name: 'double' },
  };
  const isInt = t => t.kind === 'int' || t.kind === 'bool';
  const isFlo = t => t.kind === 'float' || t.kind === 'double';
  const isNum = t => isInt(t) || isFlo(t);
  const isPtr = t => t.kind === 'ptr';
  const isArr = t => t.kind === 'array';
  const isFunc = t => t.kind === 'func';
  const isAgg = t => t.kind === 'struct' || t.kind === 'union';
  const hasBase = t => t.kind === 'ptr' || t.kind === 'array';
  const isScalar = t => isNum(t) || isPtr(t);

  function ptrTo(base) { return { kind: 'ptr', base, size: 4, align: 4 }; }
  function arrayOf(base, len) {
    return { kind: 'array', base, len, size: len < 0 ? -1 : base.size * len, align: base.align };
  }
  function funcType(ret, params, variadic, oldStyle) {
    return { kind: 'func', ret, params, variadic: !!variadic, oldStyle: !!oldStyle, size: 1, align: 1 };
  }
  function qualify(t, isConst, isVolatile) {
    if ((!isConst || t.isConst) && (!isVolatile || t.isVolatile)) return t;
    const q = Object.create(t);
    if (isConst) q.isConst = true;
    if (isVolatile) q.isVolatile = true;
    return q;
  }
  function unqual(t) {
    while (t.isConst || t.isVolatile) {
      const p = Object.getPrototypeOf(t);
      if (!p || p === Object.prototype) break;
      t = p;
    }
    return t;
  }
  function promote(t) {
    if (t.kind === 'bool' || (t.kind === 'int' && t.rank < 3)) return T.int;
    return t;
  }
  function unsignedOf(t) {
    return t.rank === 5 ? T.ullong : t.rank === 4 ? T.ulong : T.uint;
  }
  function commonType(a, b) {
    if (a.kind === 'double' || b.kind === 'double') return T.double;
    if (a.kind === 'float' || b.kind === 'float') return T.float;
    a = promote(a);
    b = promote(b);
    if (a.unsigned === b.unsigned) return a.rank >= b.rank ? unqual(a) : unqual(b);
    const u = a.unsigned ? a : b, s = a.unsigned ? b : a;
    if (u.rank >= s.rank) return unqual(u);
    if (s.size > u.size) return unqual(s);
    return unsignedOf(s);
  }
  function typeName(t) {
    const q = (t.isConst ? 'const ' : '') + (t.isVolatile ? 'volatile ' : '');
    if (t.typedefName) return q + t.typedefName;
    switch (t.kind) {
      case 'ptr': {
        if (t.base.kind === 'func') return typeName(t.base.ret) + ' (*)(' + paramList(t.base) + ')';
        const b = typeName(t.base);
        return b + (b.endsWith('*') ? '*' : ' *') + (t.isConst ? ' const' : '');
      }
      case 'array': return typeName(t.base) + '[' + (t.len < 0 ? '' : t.len) + ']';
      case 'func': return typeName(t.ret) + ' (' + paramList(t) + ')';
      case 'struct':
      case 'union': return q + t.kind + ' ' + (t.tag || '<anonymous>');
      default: return q + t.name;
    }
  }
  function paramList(f) {
    const p = f.params.map(x => typeName(x.ty));
    if (f.variadic) p.push('...');
    return p.length ? p.join(', ') : 'void';
  }
  function sameType(a, b) {
    a = unqual(a); b = unqual(b);
    if (a === b) return true;
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
      case 'int': return a.size === b.size && a.unsigned === b.unsigned;
      case 'ptr': return sameType(a.base, b.base);
      case 'array': return sameType(a.base, b.base) && (a.len < 0 || b.len < 0 || a.len === b.len);
      case 'struct':
      case 'union': return a.id === b.id;
      case 'func':
        return sameType(a.ret, b.ret) && (a.oldStyle || b.oldStyle ||
          (a.params.length === b.params.length && a.params.every((p, i) => sameType(p.ty, b.params[i].ty))));
      default: return true;
    }
  }
  function alignTo(n, a) { return Math.ceil(n / a) * a; }

  // Converts a constant value between types with C semantics.
  function convertValue(v, from, to) {
    if (to.kind === 'void') return 0;
    if (to.kind === 'bool') return (typeof v === 'bigint' ? v !== 0n : v !== 0) ? 1 : 0;
    if (isFlo(to)) {
      const n = typeof v === 'bigint' ? Number(v) : v;
      return to.kind === 'float' ? Math.fround(n) : n;
    }
    const size = to.kind === 'ptr' ? 4 : to.size;
    const uns = to.kind === 'ptr' ? true : to.unsigned;
    let x = v;
    if (typeof x !== 'bigint' && from && isFlo(from)) {
      x = Math.trunc(x);
      if (!isFinite(x)) x = 0;
    }
    if (size === 8) {
      const b = typeof x === 'bigint' ? x : BigInt(Math.trunc(x));
      return uns ? BigInt.asUintN(64, b) : BigInt.asIntN(64, b);
    }
    if (typeof x === 'bigint') x = Number(BigInt.asUintN(32, x));
    switch (size) {
      case 1: return uns ? x & 0xff : (x << 24) >> 24;
      case 2: return uns ? x & 0xffff : (x << 16) >> 16;
      default: return uns ? x >>> 0 : x | 0;
    }
  }

  // Binary operator semantics on already-converted operands of type ty.
  // Returns undefined on division by zero.
  function evalBinop(op, a, b, ty) {
    if (isFlo(ty)) {
      let r;
      switch (op) {
        case '+': r = a + b; break;
        case '-': r = a - b; break;
        case '*': r = a * b; break;
        case '/': r = a / b; break;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        default: return undefined;
      }
      return ty.kind === 'float' ? Math.fround(r) : r;
    }
    if (ty.size === 8 && ty.kind !== 'ptr') {
      const w = ty.unsigned ? x => BigInt.asUintN(64, x) : x => BigInt.asIntN(64, x);
      const sh = () => BigInt(Number(b) & 63);
      switch (op) {
        case '+': return w(a + b);
        case '-': return w(a - b);
        case '*': return w(a * b);
        case '/': return b === 0n ? undefined : w(a / b);
        case '%': return b === 0n ? undefined : w(a % b);
        case '&': return w(a & b);
        case '|': return w(a | b);
        case '^': return w(a ^ b);
        case '<<': return w(a << sh());
        case '>>': return w(a >> sh());
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
      }
      return undefined;
    }
    const uns = ty.kind === 'ptr' || ty.unsigned;
    const w = uns ? x => x >>> 0 : x => x | 0;
    switch (op) {
      case '+': return w(a + b);
      case '-': return w(a - b);
      case '*': return w(Math.imul(a, b));
      case '/': return b === 0 ? undefined : w(a / b);
      case '%': return b === 0 ? undefined : w(a % b);
      case '&': return w(a & b);
      case '|': return w(a | b);
      case '^': return w(a ^ b);
      case '<<': return w(a << (Number(b) & 31));
      case '>>': return uns ? a >>> (Number(b) & 31) : a >> (Number(b) & 31);
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
    }
    return undefined;
  }

  const isZero = v => (typeof v === 'bigint' ? v === 0n : v === 0);

  Object.assign(MC, {
    T, isInt, isFlo, isNum, isPtr, isArr, isFunc, isAgg, hasBase, isScalar,
    ptrTo, arrayOf, funcType, qualify, unqual, promote, commonType, typeName, sameType,
    convertValue, evalBinop, alignTo, isZero,
  });

  // -------------------------------------------------------------- builtins

  // Library functions the simulator provides (implemented in vm.js).
  MC.BUILTIN_SIGS = {
    printf: 'int printf(const char *format, ...)',
    sprintf: 'int sprintf(char *str, const char *format, ...)',
    snprintf: 'int snprintf(char *str, size_t size, const char *format, ...)',
    fprintf: 'int fprintf(FILE *stream, const char *format, ...)',
    puts: 'int puts(const char *s)',
    putchar: 'int putchar(int c)',
    fputs: 'int fputs(const char *s, FILE *stream)',
    fflush: 'int fflush(FILE *stream)',
    scanf: 'int scanf(const char *format, ...)',
    getchar: 'int getchar(void)',
    strlen: 'size_t strlen(const char *s)',
    strcpy: 'char *strcpy(char *dest, const char *src)',
    strncpy: 'char *strncpy(char *dest, const char *src, size_t n)',
    strcat: 'char *strcat(char *dest, const char *src)',
    strncat: 'char *strncat(char *dest, const char *src, size_t n)',
    strcmp: 'int strcmp(const char *a, const char *b)',
    strncmp: 'int strncmp(const char *a, const char *b, size_t n)',
    strchr: 'char *strchr(const char *s, int c)',
    strrchr: 'char *strrchr(const char *s, int c)',
    strstr: 'char *strstr(const char *haystack, const char *needle)',
    memset: 'void *memset(void *s, int c, size_t n)',
    memcpy: 'void *memcpy(void *dest, const void *src, size_t n)',
    memmove: 'void *memmove(void *dest, const void *src, size_t n)',
    memcmp: 'int memcmp(const void *a, const void *b, size_t n)',
    malloc: 'void *malloc(size_t size)',
    calloc: 'void *calloc(size_t n, size_t size)',
    realloc: 'void *realloc(void *p, size_t size)',
    free: 'void free(void *p)',
    abs: 'int abs(int x)',
    labs: 'long labs(long x)',
    atoi: 'int atoi(const char *s)',
    atol: 'long atol(const char *s)',
    strtol: 'long strtol(const char *s, char **end, int base)',
    strtoul: 'unsigned long strtoul(const char *s, char **end, int base)',
    rand: 'int rand(void)',
    srand: 'void srand(unsigned int seed)',
    exit: 'void exit(int status)',
    abort: 'void abort(void)',
    qsort: 'void qsort(void *base, size_t n, size_t size, int (*cmp)(const void *, const void *))',
    isdigit: 'int isdigit(int c)',
    isalpha: 'int isalpha(int c)',
    isalnum: 'int isalnum(int c)',
    isspace: 'int isspace(int c)',
    isupper: 'int isupper(int c)',
    islower: 'int islower(int c)',
    isxdigit: 'int isxdigit(int c)',
    ispunct: 'int ispunct(int c)',
    isprint: 'int isprint(int c)',
    toupper: 'int toupper(int c)',
    tolower: 'int tolower(int c)',
    sqrt: 'double sqrt(double x)',
    pow: 'double pow(double x, double y)',
    fabs: 'double fabs(double x)',
    floor: 'double floor(double x)',
    ceil: 'double ceil(double x)',
    round: 'double round(double x)',
    sin: 'double sin(double x)',
    cos: 'double cos(double x)',
    tan: 'double tan(double x)',
    atan: 'double atan(double x)',
    atan2: 'double atan2(double y, double x)',
    exp: 'double exp(double x)',
    log: 'double log(double x)',
    log10: 'double log10(double x)',
    log2: 'double log2(double x)',
    fmod: 'double fmod(double x, double y)',
    fmin: 'double fmin(double x, double y)',
    fmax: 'double fmax(double x, double y)',
    sqrtf: 'float sqrtf(float x)',
    fabsf: 'float fabsf(float x)',
    assert: 'void assert(int expression)',
    // embedded / board helpers
    delay_ms: 'void delay_ms(uint32_t ms)',
    delay_us: 'void delay_us(uint32_t us)',
    millis: 'uint32_t millis(void)',
    micros: 'uint32_t micros(void)',
    __NOP: 'void __NOP(void)',
    __WFI: 'void __WFI(void)',
    __enable_irq: 'void __enable_irq(void)',
    __disable_irq: 'void __disable_irq(void)',
    NVIC_EnableIRQ: 'void NVIC_EnableIRQ(int irq)',
    NVIC_DisableIRQ: 'void NVIC_DisableIRQ(int irq)',
    SysTick_Config: 'uint32_t SysTick_Config(uint32_t ticks)',
  };
  const PRINTF_LIKE = { printf: 0, sprintf: 1, snprintf: 2, fprintf: 1 };

  const BUILTIN_TYPEDEFS = `
    typedef signed char int8_t; typedef unsigned char uint8_t;
    typedef short int16_t; typedef unsigned short uint16_t;
    typedef int int32_t; typedef unsigned int uint32_t;
    typedef long long int64_t; typedef unsigned long long uint64_t;
    typedef unsigned int size_t; typedef int ssize_t; typedef int ptrdiff_t;
    typedef int intptr_t; typedef unsigned int uintptr_t;
    typedef int8_t int_least8_t; typedef uint8_t uint_least8_t; typedef int32_t int_fast32_t; typedef uint32_t uint_fast32_t;
    typedef uint8_t uint_fast8_t; typedef uint16_t uint_fast16_t; typedef int16_t int_fast16_t; typedef int8_t int_fast8_t;
    typedef _Bool bool; typedef struct __FILE FILE; typedef long time_t; typedef unsigned int clock_t;
  `;

  const KEYWORDS = new Set(['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
    'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed',
    'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', '_Bool',
    '__attribute__', '_Noreturn', '_Alignas', '__restrict', '_Static_assert']);
  const TYPE_WORDS = new Set(['void', '_Bool', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned',
    'struct', 'union', 'enum', 'typedef', 'static', 'extern', 'inline', 'const', 'volatile', 'register', 'restrict',
    '__restrict', 'auto', '_Noreturn', '__attribute__', '_Alignas']);
  const STORAGE = new Set(['typedef', 'static', 'extern', 'inline', 'register', 'auto', '_Noreturn']);

  function editDistance(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) d[i] = [i];
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  // ----------------------------------------------------------------- parser

  class Parser {
    constructor(toks, opts) {
      opts = opts || {};
      this.toks = toks;
      this.pos = 0;
      this.scopes = [{ vars: new Map(), tags: new Map() }];
      this.globals = [];
      this.functions = [];
      this.warnings = opts.warnings || [];
      this.fn = null;
      this.locals = null;
      this.loops = 0;
      this.breakable = 0;
      this.switches = [];
      this.strCount = 0;
      if (!opts.bare) this.parseInternal(BUILTIN_TYPEDEFS);
      const st = this.findVar('size_t');
      this.sizeT = st && st.typedef ? st.typedef : T.uint;
    }

    // --- token helpers
    get tok() { return this.toks[this.pos]; }
    peek(n) { return this.toks[Math.min(this.pos + (n || 1), this.toks.length - 1)]; }
    is(v, t) {
      t = t || this.tok;
      return (t.k === 'op' || t.k === 'id') && t.v === v;
    }
    peekIs(v) { return this.is(v, this.peek()); }
    consume(v) {
      if (this.is(v)) { this.pos++; return true; }
      return false;
    }
    expect(v, what) {
      if (!this.is(v)) {
        const t = this.tok;
        const shown = t.k === 'eof' ? 'end of input' : "'" + t.text + "'";
        if (v === ';' || v === ')' || v === ']') {
          const prev = this.toks[this.pos - 1] || t;
          throw new MC.CError('compile', "expected '" + v + "'" + (what ? ' ' + what : '') + ' before ' + shown, prev.line);
        }
        fail(t, "expected '" + v + "'" + (what ? ' ' + what : '') + ' before ' + shown);
      }
      return this.toks[this.pos++];
    }
    // In a declarator list: either ',' (another declarator follows) or a missing ';'.
    expectComma() {
      if (this.is(',')) { this.pos++; return; }
      this.expect(';', 'after declaration');
    }
    warn(tok, msg) {
      this.warnings.push({ line: tok ? tok.line : 0, msg });
    }
    ident(what) {
      const t = this.tok;
      if (t.k !== 'id' || KEYWORDS.has(t.v)) fail(t, 'expected ' + (what || 'identifier') + " before '" + (t.text || 'end of input') + "'");
      this.pos++;
      return t;
    }

    // Parses declarations from a string with this parser's global scope.
    parseInternal(src) {
      const saveT = this.toks, saveP = this.pos;
      this.toks = tokenize(src, 0);
      this.pos = 0;
      const out = [];
      while (this.tok.k !== 'eof') {
        const attr = {};
        const base = this.declspec(attr);
        if (attr.isTypedef) { this.parseTypedef(base); continue; }
        out.push(this.declarator(base));
        this.consume(';');
      }
      this.toks = saveT;
      this.pos = saveP;
      return out;
    }

    // --- scopes
    enterScope() { this.scopes.push({ vars: new Map(), tags: new Map() }); }
    leaveScope() {
      const sc = this.scopes.pop();
      for (const [name, e] of sc.vars) {
        if (e.var && e.var.isLocal && !e.var.used && !e.var.isParam && name) this.warn(e.var.tok, "unused variable '" + name + "'");
      }
    }
    get scope() { return this.scopes[this.scopes.length - 1]; }
    findVar(name) {
      for (let i = this.scopes.length - 1; i >= 0; i--) {
        const e = this.scopes[i].vars.get(name);
        if (e) return e;
      }
      return null;
    }
    findTag(name) {
      for (let i = this.scopes.length - 1; i >= 0; i--) {
        const e = this.scopes[i].tags.get(name);
        if (e) return e;
      }
      return null;
    }
    pushVar(name, entry, tok) {
      const prev = this.scope.vars.get(name);
      if (prev && !(prev.typedef && entry.typedef)) {
        if (prev.var && entry.var && prev.var === entry.var) return;
        fail(tok, "redefinition of '" + name + "'" + (prev.var && prev.var.tok && prev.var.tok.line ? ' (first defined on line ' + prev.var.tok.line + ')' : ''));
      }
      this.scope.vars.set(name, entry);
    }
    newLvar(name, ty, tok) {
      const v = { name, ty, isLocal: true, offset: 0, tok };
      this.locals.push(v);
      if (name) this.pushVar(name, { var: v }, tok);
      return v;
    }
    newGvar(name, ty, tok) {
      const v = { name, ty, isLocal: false, tok };
      this.globals.push(v);
      return v;
    }
    isTypename(t) {
      t = t || this.tok;
      if (t.k !== 'id') return false;
      if (TYPE_WORDS.has(t.v)) return true;
      const e = this.findVar(t.v);
      return !!(e && e.typedef);
    }

    // --- top level
    program() {
      while (this.tok.k !== 'eof') {
        if (this.consume(';')) continue;
        if (this.is('_Static_assert')) { this.staticAssert(); continue; }
        const attr = {};
        const base = this.declspec(attr);
        if (attr.isTypedef) { this.parseTypedef(base); continue; }
        if (this.consume(';')) continue; // e.g. "struct point { ... };"
        if (this.isFunctionDecl()) { this.functionDef(base, attr); continue; }
        this.globalVars(base, attr);
      }
      return { globals: this.globals, functions: this.functions, warnings: this.warnings };
    }

    staticAssert() {
      const t = this.tok;
      this.pos++;
      this.expect('(');
      const v = this.constExpr();
      let msg = 'static assertion failed';
      if (this.consume(',')) msg = 'static assertion failed: "' + String.fromCharCode.apply(null, this.tok.v) + '"', this.pos++;
      this.expect(')');
      this.expect(';');
      if (isZero(v)) fail(t, msg);
    }

    isFunctionDecl() {
      if (this.is(';')) return false;
      const save = this.pos;
      const d = this.declarator(T.int);
      this.pos = save;
      return d.ty.kind === 'func';
    }

    declareFunction(d, attr) {
      const prev = this.scopes[0].vars.get(d.name);
      if (prev && prev.var && prev.var.isFunction) {
        if (!sameType(prev.var.ty, d.ty)) fail(d.tok, "conflicting types for '" + d.name + "'");
        if (this.scope !== this.scopes[0]) this.scope.vars.set(d.name, prev);
        return prev.var;
      }
      if (prev) fail(d.tok, "'" + d.name + "' redeclared as a different kind of symbol");
      const fn = { name: d.name, ty: d.ty, isFunction: true, isStatic: !!attr.isStatic, isDefinition: false, tok: d.tok, isLocal: false };
      this.scopes[0].vars.set(d.name, { var: fn });
      if (this.scope !== this.scopes[0]) this.scope.vars.set(d.name, { var: fn });
      this.functions.push(fn);
      return fn;
    }

    functionDef(base, attr) {
      const d = this.declarator(base);
      if (!d.name) fail(d.tok, 'function definition has no name');
      const fn = this.declareFunction(d, attr);
      if (this.consume(';')) return;
      if (fn.isDefinition) fail(d.tok, "redefinition of '" + d.name + "'");
      if (!this.is('{')) fail(this.tok, "expected '{' to start the body of '" + d.name + "' (or ';' for a prototype)");
      fn.isDefinition = true;
      fn.ty = d.ty;
      fn.tok = d.tok;
      this.fn = fn;
      this.locals = [];
      this.enterScope();
      fn.params = d.ty.params.map(p => {
        if (!p.name) fail(p.tok, "parameter name omitted in definition of '" + d.name + "'");
        const v = this.newLvar(p.name, p.ty, p.tok);
        v.isParam = true;
        return v;
      });
      this.pos++; // '{'
      fn.body = this.compoundStmt();
      this.leaveScope();
      fn.locals = this.locals;
      let off = 0;
      for (const v of fn.locals) {
        off = alignTo(off, Math.max(v.ty.align, 1));
        v.offset = off;
        off += Math.max(v.ty.size, 0);
      }
      fn.frameSize = alignTo(off, 8);
      if (fn.ty.ret.kind !== 'void' && d.name !== 'main' && !this.endsWithReturn(fn.body)) {
        this.warn(this.toks[this.pos - 1], "control reaches end of non-void function '" + d.name + "' (missing return?)");
      }
      this.fn = null;
      this.locals = null;
    }

    endsWithReturn(s) {
      if (!s) return false;
      if (s.k === 'return') return true;
      if (s.k === 'block') return s.body.length > 0 && this.endsWithReturn(s.body[s.body.length - 1]);
      if (s.k === 'if') return !!s.els && this.endsWithReturn(s.then) && this.endsWithReturn(s.els);
      if (s.k === 'for' && !s.cond) return true; // for(;;) / while(1)
      if (s.k === 'for' && s.cond.k === 'num' && !isZero(s.cond.val)) return true;
      if (s.k === 'expr' && s.e.k === 'call' && s.e.fn.k === 'var' && (s.e.fn.obj.name === 'exit' || s.e.fn.obj.name === 'abort')) return true;
      if (s.k === 'switch') return true; // be lenient
      return false;
    }

    globalVars(base, attr) {
      let first = true;
      while (!this.consume(';')) {
        if (!first) this.expectComma();
        first = false;
        const d = this.declarator(base);
        if (!d.name) fail(d.tok, 'expected a variable name');
        if (isFunc(d.ty)) { this.declareFunction(d, attr); continue; }
        if (d.ty.kind === 'void') fail(d.tok, "variable '" + d.name + "' declared void");
        let gv;
        const prev = this.scopes[0].vars.get(d.name);
        if (prev && prev.var && !prev.var.isFunction && (prev.var.isExtern || attr.isExtern || !prev.var.initNode)) {
          gv = prev.var;
          if (!sameType(gv.ty, d.ty)) fail(d.tok, "conflicting types for '" + d.name + "'");
          if (!attr.isExtern) { gv.isExtern = false; gv.ty = d.ty.size >= 0 ? d.ty : gv.ty; }
        } else {
          gv = this.newGvar(d.name, d.ty, d.tok);
          gv.isExtern = !!attr.isExtern;
          gv.isStatic = !!attr.isStatic;
          this.pushVar(d.name, { var: gv }, d.tok);
        }
        if (this.is('=')) {
          const eq = this.tok;
          this.pos++;
          if (gv.initNode) fail(eq, "redefinition of '" + d.name + "'");
          gv.isExtern = false;
          gv.initNode = this.gvarInitializer(gv, eq);
        }
        if (gv.ty.size < 0 && !gv.isExtern) fail(d.tok, "array size missing in '" + d.name + "'");
      }
    }

    parseTypedef(base) {
      let first = true;
      while (!this.consume(';')) {
        if (!first) this.expect(',');
        first = false;
        const d = this.declarator(base);
        if (!d.name) fail(d.tok, 'typedef name omitted');
        const t = Object.create(d.ty);
        t.typedefName = d.name;
        this.pushVar(d.name, { typedef: t }, d.tok);
      }
    }

    // --- declaration specifiers
    declspec(attr) {
      const VOID = 1, BOOL = 4, CHAR = 16, SHORT = 64, INT = 256, LONG = 1024, FLOAT = 4096, DOUBLE = 16384,
        OTHER = 65536, SIGNED = 131072, UNSIGNED = 262144;
      let ty = T.int, counter = 0, isConst = false, isVolatile = false, seen = false;
      const start = this.tok;
      while (this.isTypename()) {
        const t = this.tok, v = t.v;
        if (STORAGE.has(v)) {
          if (!attr) fail(t, "storage class '" + v + "' is not allowed here");
          if (v === 'typedef') attr.isTypedef = true;
          else if (v === 'static') attr.isStatic = true;
          else if (v === 'extern') attr.isExtern = true;
          else if (v === 'inline') attr.isInline = true;
          if (attr.isTypedef && (attr.isStatic || attr.isExtern)) fail(t, 'typedef cannot be combined with static or extern');
          this.pos++;
          seen = true;
          continue;
        }
        if (v === 'const') { isConst = true; this.pos++; seen = true; continue; }
        if (v === 'volatile') { isVolatile = true; this.pos++; seen = true; continue; }
        if (v === 'restrict' || v === '__restrict') { this.pos++; continue; }
        if (v === '__attribute__') { this.attribute(attr); continue; }
        if (v === '_Alignas') { this.pos++; this.skipParens(); continue; }
        const e = this.findVar(v);
        if (v === 'struct' || v === 'union' || v === 'enum' || (e && e.typedef)) {
          if (counter) break;
          this.pos++;
          if (v === 'struct') ty = this.structDecl(false);
          else if (v === 'union') ty = this.structDecl(true);
          else if (v === 'enum') ty = this.enumSpecifier();
          else ty = e.typedef;
          counter += OTHER;
          continue;
        }
        switch (v) {
          case 'void': counter += VOID; break;
          case '_Bool': counter += BOOL; break;
          case 'char': counter += CHAR; break;
          case 'short': counter += SHORT; break;
          case 'int': counter += INT; break;
          case 'long': counter += LONG; break;
          case 'float': counter += FLOAT; break;
          case 'double': counter += DOUBLE; break;
          case 'signed': counter |= SIGNED; break;
          case 'unsigned': counter |= UNSIGNED; break;
        }
        this.pos++;
        switch (counter) {
          case VOID: ty = T.void; break;
          case BOOL: ty = T.bool; break;
          case CHAR: ty = T.char; break;
          case SIGNED + CHAR: ty = T.schar; break;
          case UNSIGNED + CHAR: ty = T.uchar; break;
          case SHORT: case SHORT + INT: case SIGNED + SHORT: case SIGNED + SHORT + INT: ty = T.short; break;
          case UNSIGNED + SHORT: case UNSIGNED + SHORT + INT: ty = T.ushort; break;
          case INT: case SIGNED: case SIGNED + INT: ty = T.int; break;
          case UNSIGNED: case UNSIGNED + INT: ty = T.uint; break;
          case LONG: case LONG + INT: case SIGNED + LONG: case SIGNED + LONG + INT: ty = T.long; break;
          case UNSIGNED + LONG: case UNSIGNED + LONG + INT: ty = T.ulong; break;
          case LONG + LONG: case LONG + LONG + INT: case SIGNED + LONG + LONG: case SIGNED + LONG + LONG + INT: ty = T.llong; break;
          case UNSIGNED + LONG + LONG: case UNSIGNED + LONG + LONG + INT: ty = T.ullong; break;
          case FLOAT: ty = T.float; break;
          case DOUBLE: case LONG + DOUBLE: ty = T.double; break;
          default: fail(t, "invalid combination of type specifiers ('" + v + "')");
        }
      }
      if (!counter) {
        if (seen) fail(this.tok, "type specifier missing (did you mean 'int'?)");
        fail(start, 'expected a type');
      }
      return qualify(ty, isConst, isVolatile);
    }

    skipParens() {
      this.expect('(');
      let depth = 1;
      while (depth > 0) {
        if (this.tok.k === 'eof') fail(this.tok, "missing ')'");
        if (this.is('(')) depth++;
        if (this.is(')')) depth--;
        this.pos++;
      }
    }

    attribute(attr) {
      while (this.is('__attribute__')) {
        this.pos++;
        const start = this.pos;
        this.skipParens();
        const words = this.toks.slice(start, this.pos).filter(t => t.k === 'id').map(t => t.v);
        if (attr && (words.includes('packed') || words.includes('__packed__'))) attr.packed = true;
      }
    }

    structDecl(isUnion) {
      const kw = this.toks[this.pos - 1];
      const kind = isUnion ? 'union' : 'struct';
      const attr = {};
      this.attribute(attr);
      let tag = null;
      if (this.tok.k === 'id' && !KEYWORDS.has(this.tok.v)) { tag = this.tok.v; this.pos++; }
      if (tag && !this.is('{')) {
        const found = this.findTag(tag);
        if (found) {
          if (found.kind !== kind) fail(kw, "'" + tag + "' defined as wrong kind of tag");
          return found;
        }
        const ty = { kind, tag, id: ++structIds, members: [], size: -1, align: 1, complete: false };
        this.scope.tags.set(tag, ty);
        return ty;
      }
      if (!tag && !this.is('{')) fail(this.tok, "expected '{' or a name after '" + kind + "'");
      this.pos++; // '{'
      let ty = tag ? this.scope.tags.get(tag) : null;
      if (ty && ty.kind === kind) {
        if (ty.complete) fail(kw, 'redefinition of ' + kind + " '" + tag + "'");
      } else {
        ty = { kind, tag, id: ++structIds, members: [], size: -1, align: 1, complete: false };
        if (tag) this.scope.tags.set(tag, ty);
      }
      const members = [];
      while (!this.consume('}')) {
        if (this.tok.k === 'eof') fail(kw, "missing '}' at end of " + kind);
        const mt = this.tok;
        const base = this.declspec(null);
        if (isAgg(base) && this.is(';')) {
          this.pos++;
          members.push({ name: null, ty: base, tok: mt });
          continue;
        }
        let first = true;
        while (!this.consume(';')) {
          if (!first) this.expectComma();
          first = false;
          const d = this.is(':') ? { ty: base, name: null, tok: this.tok } : this.declarator(base);
          if (isFunc(d.ty)) fail(d.tok, "field '" + d.name + "' declared as a function");
          const mem = { name: d.name, ty: d.ty, tok: d.tok };
          if (this.consume(':')) {
            if (!isInt(d.ty)) fail(d.tok, "bit-field '" + (d.name || '') + "' has invalid type");
            const w = Number(this.constExpr());
            if (w < 0 || w > d.ty.size * 8) fail(d.tok, "width of bit-field '" + (d.name || '') + "' exceeds its type");
            if (w === 0 && d.name) fail(d.tok, "zero width for bit-field '" + d.name + "'");
            mem.bitWidth = w;
          }
          if (d.ty.size < 0 && !(isArr(d.ty) && d.ty.len < 0)) fail(d.tok, "field '" + d.name + "' has incomplete type");
          members.push(mem);
        }
      }
      this.attribute(attr);
      this.layout(ty, members, isUnion, attr.packed);
      return ty;
    }

    layout(ty, members, isUnion, packed) {
      let bits = 0, align = 1, size = 0;
      for (const m of members) {
        const msize = Math.max(m.ty.size, 0);
        if (isUnion) {
          m.offset = 0;
          if (m.bitWidth !== undefined) m.bitOffset = 0;
          size = Math.max(size, msize);
        } else if (m.bitWidth !== undefined) {
          const unit = m.ty.size * 8;
          if (m.bitWidth === 0) { bits = alignTo(bits, unit); continue; }
          if (Math.floor(bits / unit) !== Math.floor((bits + m.bitWidth - 1) / unit)) bits = alignTo(bits, unit);
          m.offset = Math.floor(bits / unit) * m.ty.size;
          m.bitOffset = bits - m.offset * 8;
          bits += m.bitWidth;
        } else {
          bits = alignTo(bits, (packed ? 1 : m.ty.align) * 8);
          m.offset = bits / 8;
          bits += msize * 8;
        }
        if (!packed) align = Math.max(align, m.ty.align);
      }
      if (!isUnion) size = Math.ceil(bits / 8);
      ty.members = members;
      ty.align = align;
      ty.size = alignTo(size, align);
      ty.complete = true;
      ty.packed = !!packed;
    }

    findMember(ty, name) {
      for (const m of ty.members) {
        if (m.name === name) return { mem: m, offset: m.offset };
        if (!m.name && isAgg(m.ty)) {
          const inner = this.findMember(m.ty, name);
          if (inner) return { mem: inner.mem, offset: m.offset + inner.offset };
        }
      }
      return null;
    }

    enumSpecifier() {
      let tag = null;
      if (this.tok.k === 'id' && !KEYWORDS.has(this.tok.v)) { tag = this.tok.v; this.pos++; }
      if (tag && !this.is('{')) {
        const f = this.findTag(tag);
        if (f) return f;
        const ty = Object.create(T.int);
        ty.typedefName = 'enum ' + tag;
        this.scope.tags.set(tag, ty);
        return ty;
      }
      this.expect('{');
      const ty = Object.create(T.int);
      ty.typedefName = 'enum ' + (tag || '<anonymous>');
      let val = 0;
      while (!this.consume('}')) {
        const t = this.ident('enumerator name');
        if (this.consume('=')) val = Number(this.constExpr());
        this.pushVar(t.v, { enumVal: val | 0, ty }, t);
        val++;
        if (!this.consume(',')) { this.expect('}', 'at end of enum'); break; }
      }
      if (tag) this.scope.tags.set(tag, ty);
      return ty;
    }

    // --- declarators
    pointers(ty) {
      while (this.consume('*')) {
        ty = ptrTo(ty);
        for (;;) {
          if (this.consume('const')) ty = qualify(ty, true, false);
          else if (this.consume('volatile')) ty = qualify(ty, false, true);
          else if (this.consume('restrict') || this.consume('__restrict')) continue;
          else break;
        }
      }
      return ty;
    }

    declarator(ty) {
      ty = this.pointers(ty);
      if (this.is('(')) {
        const n = this.peek();
        const nested = this.is('*', n) || this.is('(', n) || this.is('[', n) ||
          (n.k === 'id' && !KEYWORDS.has(n.v) && !this.isTypename(n));
        if (nested) {
          const start = this.pos + 1;
          this.pos = start;
          this.declarator(T.int);
          this.expect(')');
          ty = this.typeSuffix(ty);
          const end = this.pos;
          this.pos = start;
          const d = this.declarator(ty);
          this.pos = end;
          return d;
        }
      }
      const tok = this.tok;
      let name = null;
      if (tok.k === 'id' && !KEYWORDS.has(tok.v)) {
        name = tok.v;
        this.pos++;
      }
      this.attribute(null);
      ty = this.typeSuffix(ty);
      this.attribute(null);
      return { ty, name, tok };
    }

    typeSuffix(ty) {
      if (this.consume('(')) return this.funcParams(ty);
      if (this.consume('[')) return this.arrayDims(ty);
      return ty;
    }

    funcParams(ret) {
      const t0 = this.toks[this.pos - 1];
      if (isArr(ret)) fail(t0, 'functions cannot return arrays (return a pointer, or wrap it in a struct)');
      if (isFunc(ret)) fail(t0, 'functions cannot return functions');
      if (this.is('void') && this.peekIs(')')) { this.pos += 2; return funcType(ret, [], false); }
      if (this.consume(')')) return funcType(ret, [], false, true);
      const params = [];
      let variadic = false;
      for (;;) {
        if (this.consume('...')) { variadic = true; this.expect(')'); break; }
        const pt = this.tok;
        const base = this.declspec({});
        let { ty, name, tok } = this.declarator(base);
        if (isArr(ty)) ty = ptrTo(ty.base);
        else if (isFunc(ty)) ty = ptrTo(ty);
        if (ty.kind === 'void') fail(pt, "parameter has type 'void'");
        params.push({ ty, name, tok });
        if (this.consume(')')) break;
        this.expect(',', 'between parameters');
      }
      return funcType(ret, params, variadic);
    }

    arrayDims(ty) {
      while (this.consume('static') || this.consume('const') || this.consume('volatile') || this.consume('restrict')) { /* skip */ }
      let len = -1;
      if (!this.consume(']')) {
        const t = this.tok;
        const n = this.conditional();
        if (n.k !== 'num') {
          fail(t, 'array size must be a compile-time constant (use a number or #define, variable-length arrays are not supported)');
        }
        len = Number(n.val);
        if (len < 0) fail(t, 'size of array is negative');
        this.expect(']');
      }
      const base = this.typeSuffix(ty);
      if (base.size < 0) fail(this.tok, 'array has incomplete element type');
      return arrayOf(base, len);
    }

    typename() {
      const base = this.declspec(null);
      const d = this.declarator(base);
      if (d.name) fail(d.tok, "unexpected name '" + d.name + "' in type");
      return d.ty;
    }

    // --- statements
    compoundStmt() {
      const t = this.toks[this.pos - 1];
      const body = [];
      this.enterScope();
      while (!this.is('}')) {
        if (this.tok.k === 'eof') fail(t, "missing '}' — the '{' on line " + t.line + ' is never closed');
        if (this.is('_Static_assert')) { this.staticAssert(); continue; }
        if (this.isTypename() && !this.peekIs(':')) {
          const attr = {};
          const base = this.declspec(attr);
          if (attr.isTypedef) { this.parseTypedef(base); continue; }
          if (this.consume(';')) continue;
          body.push(this.declaration(base, attr));
          continue;
        }
        body.push(this.stmt());
      }
      this.pos++;
      this.leaveScope();
      return { k: 'block', line: t.line, body };
    }

    declaration(base, attr) {
      const t0 = this.tok;
      const nodes = [];
      let first = true;
      while (!this.consume(';')) {
        if (!first) this.expectComma();
        first = false;
        const d = this.declarator(base);
        if (!d.name) fail(d.tok, 'expected a variable name');
        if (d.ty.kind === 'void') fail(d.tok, "variable '" + d.name + "' declared void");
        if (isFunc(d.ty)) { this.declareFunction(d, attr); continue; }
        if (attr.isExtern) {
          const g = this.scopes[0].vars.get(d.name);
          let gv = g && g.var;
          if (!gv) { gv = this.newGvar(d.name, d.ty, d.tok); gv.isExtern = true; this.scopes[0].vars.set(d.name, { var: gv }); }
          this.pushVar(d.name, { var: gv }, d.tok);
          continue;
        }
        if (attr.isStatic) {
          const gv = this.newGvar(this.fn.name + '.' + d.name, d.ty, d.tok);
          gv.displayName = d.name;
          this.pushVar(d.name, { var: gv }, d.tok);
          if (this.is('=')) { const eq = this.tok; this.pos++; gv.initNode = this.gvarInitializer(gv, eq); }
          if (gv.ty.size < 0) fail(d.tok, "array size missing in '" + d.name + "'");
          continue;
        }
        const v = this.newLvar(d.name, d.ty, d.tok);
        if (this.is('=')) {
          const eq = this.tok;
          this.pos++;
          nodes.push({ k: 'expr', line: eq.line, e: this.lvarInitializer(v, eq) });
        }
        if (v.ty.size < 0) {
          fail(d.tok, isArr(v.ty) ? "array size missing in '" + d.name + "' (give a size or an initializer)" : "storage size of '" + d.name + "' isn't known (is the struct defined?)");
        }
      }
      return { k: 'block', line: t0.line, body: nodes, isDecl: true };
    }

    condition(e, tok, what) {
      if (isAgg(e.ty)) fail(tok, 'used struct type value where a true/false condition is required');
      if (e.ty.kind === 'void') fail(tok, 'void value used as a condition');
      if (e.k === 'assign' && !e.paren) this.warn(tok, "assignment '=' used as a condition in " + what + " — did you mean '=='?");
      return e;
    }

    stmt() {
      const t = this.tok;
      if (t.k === 'id' && !KEYWORDS.has(t.v) && this.peekIs(':') && !this.switches.length) {
        fail(t, 'labels and goto are not supported here — use loops and break/continue instead');
      }
      if (t.k !== 'id' && !this.is('{') && !this.is(';')) return this.exprStmt();
      switch (t.v) {
        case 'return': {
          this.pos++;
          const ret = this.fn.ty.ret;
          if (this.consume(';')) {
            if (ret.kind !== 'void') this.warn(t, "'return' with no value in function returning '" + typeName(ret) + "'");
            return { k: 'return', line: t.line, e: null };
          }
          let e = this.expr();
          this.expect(';', 'after return value');
          if (ret.kind === 'void') {
            if (e.ty.kind !== 'void') fail(t, "'return' with a value in function '" + this.fn.name + "' returning void");
            return { k: 'return', line: t.line, e };
          }
          e = this.convertForAssign(e, ret, t, 'returning');
          return { k: 'return', line: t.line, e };
        }
        case 'if': {
          this.pos++;
          this.expect('(', "after 'if'");
          const cond = this.condition(this.expr(), t, "'if'");
          this.expect(')', 'after if condition');
          if (this.is(';')) this.warn(this.tok, "empty body in 'if' (stray ';' after the condition?)");
          const then = this.stmt();
          let els = null;
          if (this.consume('else')) els = this.stmt();
          return { k: 'if', line: t.line, cond, then, els };
        }
        case 'switch': {
          this.pos++;
          this.expect('(', "after 'switch'");
          let cond = this.expr();
          this.expect(')');
          if (!isInt(cond.ty)) fail(t, 'switch quantity is not an integer');
          cond = this.cast(cond, promote(cond.ty), t);
          const sw = { k: 'switch', line: t.line, cond, cases: [], def: null, body: null };
          this.switches.push(sw);
          this.breakable++;
          sw.body = this.stmt();
          this.switches.pop();
          this.breakable--;
          return sw;
        }
        case 'case': {
          const sw = this.switches[this.switches.length - 1];
          if (!sw) fail(t, "'case' label not within a switch statement");
          this.pos++;
          const v = this.constExpr();
          this.expect(':', 'after case label');
          const val = convertValue(v, null, sw.cond.ty);
          if (sw.cases.some(c => c.val === val)) fail(t, 'duplicate case value ' + val);
          const node = { k: 'case', line: t.line, val, body: null };
          sw.cases.push(node);
          node.body = this.is('}') ? { k: 'null', line: t.line } : this.stmt();
          return node;
        }
        case 'default': {
          const sw = this.switches[this.switches.length - 1];
          if (!sw) fail(t, "'default' label not within a switch statement");
          if (sw.def) fail(t, "multiple 'default' labels in one switch");
          this.pos++;
          this.expect(':', "after 'default'");
          const node = { k: 'default', line: t.line, body: null };
          sw.def = node;
          node.body = this.is('}') ? { k: 'null', line: t.line } : this.stmt();
          return node;
        }
        case 'for': {
          this.pos++;
          this.expect('(', "after 'for'");
          this.enterScope();
          let init = null, cond = null, inc = null;
          if (this.isTypename()) {
            const attr = {};
            const base = this.declspec(attr);
            init = this.declaration(base, attr);
          } else if (!this.consume(';')) {
            init = { k: 'expr', line: t.line, e: this.expr() };
            this.expect(';', "in 'for'");
          }
          if (!this.is(';')) cond = this.condition(this.expr(), t, "'for'");
          this.expect(';', "in 'for'");
          if (!this.is(')')) inc = this.expr();
          this.expect(')', "in 'for'");
          if (this.is(';') && this.peek().line === t.line) this.warn(this.tok, "empty body in 'for' loop (stray ';'?)");
          this.loops++; this.breakable++;
          const body = this.stmt();
          this.loops--; this.breakable--;
          this.leaveScope();
          return { k: 'for', line: t.line, init, cond, inc, body };
        }
        case 'while': {
          this.pos++;
          this.expect('(', "after 'while'");
          const cond = this.condition(this.expr(), t, "'while'");
          this.expect(')', 'after while condition');
          this.loops++; this.breakable++;
          const body = this.stmt();
          this.loops--; this.breakable--;
          return { k: 'for', line: t.line, init: null, cond, inc: null, body };
        }
        case 'do': {
          this.pos++;
          this.loops++; this.breakable++;
          const body = this.stmt();
          this.loops--; this.breakable--;
          if (!this.is('while')) fail(this.tok, "expected 'while' after 'do' body");
          this.pos++;
          this.expect('(', "after 'while'");
          const cond = this.condition(this.expr(), t, "'do-while'");
          this.expect(')');
          this.expect(';', "after do-while");
          return { k: 'do', line: t.line, body, cond };
        }
        case 'break':
          this.pos++;
          if (!this.breakable) fail(t, "'break' statement not within a loop or switch");
          this.expect(';', "after 'break'");
          return { k: 'break', line: t.line };
        case 'continue':
          this.pos++;
          if (!this.loops) fail(t, "'continue' statement not within a loop");
          this.expect(';', "after 'continue'");
          return { k: 'continue', line: t.line };
        case 'goto':
          fail(t, "'goto' is not supported here — use loops and break/continue instead");
          break;
        case 'else':
          fail(t, "'else' without a previous 'if' (check your braces and semicolons)");
          break;
      }
      if (this.is('{')) { this.pos++; return this.compoundStmt(); }
      if (this.consume(';')) return { k: 'null', line: t.line };
      return this.exprStmt();
    }

    exprStmt() {
      const t = this.tok;
      const e = this.expr();
      this.expect(';', 'after expression');
      return { k: 'expr', line: t.line, e };
    }

    // --- initializers
    newInitializer(ty, flexible) {
      const init = { ty, expr: null, children: null, flexible: false };
      if (isArr(ty)) {
        if (ty.len < 0) {
          if (flexible) { init.flexible = true; return init; }
          init.children = [];
          return init;
        }
        init.children = [];
        for (let i = 0; i < ty.len; i++) init.children.push(this.newInitializer(ty.base, false));
      } else if (isAgg(ty)) {
        init.children = ty.members.map(m => this.newInitializer(m.ty, false));
      }
      return init;
    }

    isEnd() { return this.is('}') || (this.is(',') && this.peekIs('}')); }
    consumeEnd() {
      if (this.consume('}')) return true;
      if (this.is(',') && this.peekIs('}')) { this.pos += 2; return true; }
      return false;
    }

    skipExcess() {
      if (this.consume('{')) {
        let first = true;
        while (!this.consumeEnd()) { if (!first) this.expect(','); first = false; this.skipExcess(); }
        return;
      }
      this.assign();
    }

    initializer2(init) {
      const t = this.tok;
      if (isArr(init.ty) && t.k === 'str') { this.stringInitializer(init); return; }
      if (isArr(init.ty)) {
        if (this.is('{')) this.arrayInitializer1(init);
        else this.arrayInitializer2(init, 0);
        return;
      }
      if (init.ty.kind === 'struct') {
        if (this.is('{')) { this.structInitializer1(init); return; }
        const save = this.pos;
        const e = this.assign();
        if (isAgg(e.ty)) { init.expr = e; init.tok = t; return; }
        this.pos = save;
        this.structInitializer2(init, 0);
        return;
      }
      if (init.ty.kind === 'union') {
        if (this.consume('{')) {
          if (this.is('.')) {
            this.pos++;
            const nt = this.ident('field name');
            const idx = init.ty.members.findIndex(m => m.name === nt.v);
            if (idx < 0) fail(nt, "unknown field '" + nt.v + "' in union initializer");
            init.unionIdx = idx;
            this.designation(init.children[idx]);
          } else {
            init.unionIdx = 0;
            if (init.children.length) this.initializer2(init.children[0]);
          }
          this.consume(',');
          this.expect('}');
          return;
        }
        const save = this.pos;
        const e = this.assign();
        if (isAgg(e.ty)) { init.expr = e; init.tok = t; return; }
        this.pos = save;
        init.unionIdx = 0;
        this.initializer2(init.children[0]);
        return;
      }
      if (this.consume('{')) {
        this.initializer2(init);
        this.consume(',');
        this.expect('}', 'after scalar initializer');
        return;
      }
      init.tok = t;
      init.expr = this.assign();
    }

    stringInitializer(init) {
      const t = this.tok;
      let bytes = [];
      while (this.tok.k === 'str') { bytes = bytes.concat(this.tok.v); this.pos++; }
      if (init.ty.base.size !== 1) fail(t, 'array of inappropriate type initialized from string constant');
      if (init.flexible) Object.assign(init, this.newInitializer(arrayOf(init.ty.base, bytes.length + 1), false));
      if (bytes.length > init.ty.len) this.warn(t, 'initializer-string for array of ' + init.ty.len + ' chars is too long');
      const n = Math.min(init.ty.len, bytes.length);
      for (let i = 0; i < n; i++) {
        init.children[i].expr = { k: 'num', line: t.line, val: convertValue(bytes[i], null, init.ty.base), ty: init.ty.base };
        init.children[i].tok = t;
      }
    }

    countArrayInitElements(ty) {
      const save = this.pos;
      let i = 0, max = 0, first = true;
      while (!this.consumeEnd()) {
        if (this.tok.k === 'eof') fail(this.tok, "missing '}' in initializer");
        if (!first) this.expect(',');
        first = false;
        const dummy = this.newInitializer(ty.base, false);
        if (this.consume('[')) {
          i = Number(this.constExpr());
          this.expect(']');
          this.designation(dummy);
        } else {
          this.initializer2(dummy);
        }
        i++;
        max = Math.max(max, i);
      }
      this.pos = save;
      return max;
    }

    designation(init) {
      if (this.is('[')) {
        const t = this.tok;
        if (!isArr(init.ty)) fail(t, 'array index in non-array initializer');
        this.pos++;
        const i = Number(this.constExpr());
        if (i < 0 || i >= init.ty.len) fail(t, 'array index ' + i + ' in initializer exceeds array bounds');
        this.expect(']');
        this.designation(init.children[i]);
        return;
      }
      if (this.is('.') && init.ty.kind === 'struct') {
        this.pos++;
        const nt = this.ident('field name');
        const idx = init.ty.members.findIndex(m => m.name === nt.v);
        if (idx < 0) fail(nt, "unknown field '" + nt.v + "' specified in initializer");
        this.designation(init.children[idx]);
        return;
      }
      this.expect('=', 'in designated initializer');
      this.initializer2(init);
    }

    arrayInitializer1(init) {
      this.expect('{');
      if (init.flexible) {
        const len = this.countArrayInitElements(init.ty);
        Object.assign(init, this.newInitializer(arrayOf(init.ty.base, len), false));
      }
      let first = true;
      for (let i = 0; !this.consumeEnd(); i++) {
        if (this.tok.k === 'eof') fail(this.tok, "missing '}' in initializer");
        if (!first) this.expect(',', 'between initializer elements');
        first = false;
        if (this.is('[')) {
          const t = this.tok;
          this.pos++;
          i = Number(this.constExpr());
          if (i < 0 || i >= init.ty.len) fail(t, 'array index ' + i + ' in initializer exceeds array bounds');
          this.expect(']');
          this.designation(init.children[i]);
          continue;
        }
        if (i < init.ty.len) this.initializer2(init.children[i]);
        else {
          if (i === init.ty.len) this.warn(this.tok, 'excess elements in array initializer (array has ' + init.ty.len + ' elements)');
          this.skipExcess();
        }
      }
    }

    arrayInitializer2(init, i) {
      if (init.flexible) {
        fail(this.tok, "array initializer needs braces: { ... }");
      }
      for (; i < init.ty.len && !this.isEnd(); i++) {
        const start = this.pos;
        if (i > 0) this.expect(',');
        if (this.is('[') || this.is('.')) { this.pos = start; return; }
        this.initializer2(init.children[i]);
      }
    }

    structInitializer1(init) {
      this.expect('{');
      const members = init.ty.members;
      let mi = 0, first = true;
      while (!this.consumeEnd()) {
        if (this.tok.k === 'eof') fail(this.tok, "missing '}' in initializer");
        if (!first) this.expect(',', 'between initializer elements');
        first = false;
        if (this.is('.')) {
          this.pos++;
          const nt = this.ident('field name');
          mi = members.findIndex(m => m.name === nt.v);
          if (mi < 0) fail(nt, "unknown field '" + nt.v + "' specified in initializer");
          this.designation(init.children[mi]);
          mi++;
          continue;
        }
        while (mi < members.length && !members[mi].name && members[mi].bitWidth !== undefined) mi++;
        if (mi < members.length) { this.initializer2(init.children[mi]); mi++; }
        else { this.warn(this.tok, 'excess elements in struct initializer'); this.skipExcess(); }
      }
    }

    structInitializer2(init, mi) {
      let first = true;
      const members = init.ty.members;
      for (; mi < members.length && !this.isEnd(); mi++) {
        const start = this.pos;
        if (!first) this.expect(',');
        first = false;
        if (this.is('[') || this.is('.')) { this.pos = start; return; }
        this.initializer2(init.children[mi]);
      }
    }

    initAssigns(init, lv, out) {
      if (isArr(init.ty) && init.children) {
        init.children.forEach((c, i) => {
          if (!this.hasInit(c)) return;
          const addr = { k: 'ptradd', line: lv.line, ptr: lv, idx: { k: 'num', val: i, ty: T.int, line: lv.line }, scale: init.ty.base.size, ty: ptrTo(init.ty.base) };
          this.initAssigns(c, { k: 'deref', line: lv.line, e: addr, ty: init.ty.base }, out);
        });
        return;
      }
      if (init.expr) {
        out.push(this.newAssign(lv, init.expr, init.tok || { line: lv.line }, true));
        return;
      }
      if (isAgg(init.ty) && init.children) {
        init.ty.members.forEach((m, i) => {
          if (init.ty.kind === 'union' && i !== (init.unionIdx || 0)) return;
          if (!this.hasInit(init.children[i])) return;
          this.initAssigns(init.children[i], this.memberNode(lv, m, m.offset, { line: lv.line }), out);
        });
      }
    }

    hasInit(init) {
      if (init.expr) return true;
      return !!(init.children && init.children.some(c => this.hasInit(c)));
    }

    lvarInitializer(v, tok) {
      const init = this.newInitializer(v.ty, true);
      this.initializer2(init);
      v.ty = init.ty;
      const lv = { k: 'var', line: tok.line, obj: v, ty: v.ty };
      const assigns = [];
      this.initAssigns(init, lv, assigns);
      if (isScalar(v.ty) && assigns.length === 1) return assigns[0];
      return { k: 'initblk', line: tok.line, obj: v, zero: true, assigns, ty: T.void };
    }

    gvarInitializer(gv, tok) {
      const init = this.newInitializer(gv.ty, true);
      this.initializer2(init);
      gv.ty = init.ty;
      const lv = { k: 'var', line: tok.line, obj: gv, ty: gv.ty };
      const assigns = [];
      this.initAssigns(init, lv, assigns);
      return { k: 'initblk', line: tok.line, obj: gv, zero: false, assigns, ty: T.void };
    }

    // --- expressions
    num(val, ty, tok) {
      return { k: 'num', line: tok ? tok.line : 0, val, ty };
    }

    constExpr() {
      const t = this.tok;
      const n = this.conditional();
      if (n.k !== 'num') fail(t, 'expression must be a compile-time constant');
      return n.val;
    }

    expr() {
      const n = this.assign();
      if (this.is(',')) {
        const t = this.tok;
        this.pos++;
        const rhs = this.expr();
        return { k: 'comma', line: t.line, lhs: n, rhs, ty: rhs.ty };
      }
      return n;
    }

    assign() {
      const lhs = this.conditional();
      const t = this.tok;
      if (t.k !== 'op') return lhs;
      if (t.v === '=') { this.pos++; return this.newAssign(lhs, this.assign(), t); }
      const ops = ['+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='];
      if (ops.includes(t.v)) { this.pos++; return this.newOpAssign(t.v.slice(0, -1), lhs, this.assign(), t); }
      return lhs;
    }

    isLvalue(n) {
      return n.k === 'var' || n.k === 'deref' || n.k === 'member';
    }

    checkLvalue(n, tok, what) {
      if (isArr(n.ty) && this.isLvalue(n)) {
        fail(tok, 'assignment to expression with array type — arrays can\'t be assigned with =; copy element by element, or use strcpy()/memcpy()');
      }
      if (!this.isLvalue(n) || isFunc(n.ty)) fail(tok, 'lvalue required as ' + what + ' (you can only assign to a variable, array element, *pointer or struct member)');
      if (n.ty.isConst) {
        fail(tok, n.k === 'var' ? "assignment of read-only variable '" + (n.obj.displayName || n.obj.name) + "' (it is const)" : 'assignment of read-only location (it is const)');
      }
    }

    newAssign(lhs, rhs, tok, isInit) {
      if (!isInit) this.checkLvalue(lhs, tok, 'left operand of assignment');
      const r = this.convertForAssign(rhs, lhs.ty, tok, isInit ? 'initializing' : 'assigning to');
      return { k: 'assign', line: tok.line, lhs, rhs: r, ty: unqual(lhs.ty) };
    }

    newOpAssign(op, lhs, rhs, tok) {
      this.checkLvalue(lhs, tok, 'left operand of ' + op + '=');
      const cur = { k: 'cur', line: tok.line, ty: unqual(lhs.ty) };
      let val;
      if (op === '+') val = this.newAdd(cur, rhs, tok);
      else if (op === '-') val = this.newSub(cur, rhs, tok);
      else if (op === '<<' || op === '>>') val = this.newShift(op, cur, rhs, tok);
      else val = this.newBinary(op, cur, rhs, tok);
      val = this.cast(val, lhs.ty, tok);
      return { k: 'opassign', line: tok.line, lhs, expr: val, cur, post: false, ty: unqual(lhs.ty) };
    }

    newIncDec(lhs, delta, post, tok) {
      const op = delta > 0 ? '++' : '--';
      this.checkLvalue(lhs, tok, 'operand of ' + op);
      if (!isScalar(lhs.ty)) fail(tok, 'wrong type argument to ' + op);
      const cur = { k: 'cur', line: tok.line, ty: unqual(lhs.ty) };
      const val = this.cast(this.newAdd(cur, this.num(delta, T.int, tok), tok), lhs.ty, tok);
      return { k: 'opassign', line: tok.line, lhs, expr: val, cur, post, ty: unqual(lhs.ty) };
    }

    conditional() {
      const cond = this.logor();
      if (!this.is('?')) return cond;
      const t = this.tok;
      this.pos++;
      this.condition(cond, t, "'?:'");
      let then = this.expr();
      this.expect(':', 'in conditional expression');
      let els = this.conditional();
      let ty;
      const a = then.ty, b = els.ty;
      if (isNum(a) && isNum(b)) {
        ty = commonType(a, b);
        then = this.cast(then, ty, t);
        els = this.cast(els, ty, t);
      } else if (a.kind === 'void' || b.kind === 'void') {
        ty = T.void;
      } else if (isAgg(a) || isAgg(b)) {
        if (!isAgg(a) || !isAgg(b) || a.id !== b.id) fail(t, 'type mismatch in conditional expression');
        ty = a;
      } else {
        const pa = hasBase(a) || isFunc(a), pb = hasBase(b) || isFunc(b);
        if (pa && pb) ty = isFunc(a) ? ptrTo(a) : ptrTo(a.base);
        else if (pa) { ty = isFunc(a) ? ptrTo(a) : ptrTo(a.base); if (!(els.k === 'num' && isZero(els.val))) this.warn(t, 'pointer/integer type mismatch in conditional expression'); els = this.cast(els, ty, t); }
        else { ty = isFunc(b) ? ptrTo(b) : ptrTo(b.base); if (!(then.k === 'num' && isZero(then.val))) this.warn(t, 'pointer/integer type mismatch in conditional expression'); then = this.cast(then, ty, t); }
      }
      if (cond.k === 'num') return isZero(cond.val) ? els : then;
      return { k: 'cond', line: t.line, cond, then, els, ty };
    }

    logor() {
      let n = this.logand();
      while (this.is('||')) {
        const t = this.tok;
        this.pos++;
        const r = this.logand();
        this.condition(n, t, "'||'"); this.condition(r, t, "'||'");
        n = this.fold({ k: 'logor', line: t.line, lhs: n, rhs: r, ty: T.int });
      }
      return n;
    }

    logand() {
      let n = this.bitor();
      while (this.is('&&')) {
        const t = this.tok;
        this.pos++;
        const r = this.bitor();
        this.condition(n, t, "'&&'"); this.condition(r, t, "'&&'");
        n = this.fold({ k: 'logand', line: t.line, lhs: n, rhs: r, ty: T.int });
      }
      return n;
    }

    bitor() {
      let n = this.bitxor();
      while (this.is('|')) { const t = this.tok; this.pos++; n = this.newBinary('|', n, this.bitxor(), t); }
      return n;
    }
    bitxor() {
      let n = this.bitand();
      while (this.is('^')) { const t = this.tok; this.pos++; n = this.newBinary('^', n, this.bitand(), t); }
      return n;
    }
    bitand() {
      let n = this.equality();
      while (this.is('&')) { const t = this.tok; this.pos++; n = this.newBinary('&', n, this.equality(), t); }
      return n;
    }
    equality() {
      let n = this.relational();
      for (;;) {
        const t = this.tok;
        if (this.consume('==')) n = this.newCompare('==', n, this.relational(), t);
        else if (this.consume('!=')) n = this.newCompare('!=', n, this.relational(), t);
        else return n;
      }
    }
    relational() {
      let n = this.shift();
      for (;;) {
        const t = this.tok;
        let op = null;
        for (const o of ['<', '<=', '>', '>=']) if (this.is(o)) op = o;
        if (!op) return n;
        this.pos++;
        n = this.newCompare(op, n, this.shift(), t);
      }
    }
    shift() {
      let n = this.add();
      for (;;) {
        const t = this.tok;
        if (this.consume('<<')) n = this.newShift('<<', n, this.add(), t);
        else if (this.consume('>>')) n = this.newShift('>>', n, this.add(), t);
        else return n;
      }
    }
    add() {
      let n = this.mul();
      for (;;) {
        const t = this.tok;
        if (this.consume('+')) n = this.newAdd(n, this.mul(), t);
        else if (this.consume('-')) n = this.newSub(n, this.mul(), t);
        else return n;
      }
    }
    mul() {
      let n = this.castExpr();
      for (;;) {
        const t = this.tok;
        let op = null;
        if (this.is('*')) op = '*'; else if (this.is('/')) op = '/'; else if (this.is('%')) op = '%';
        if (!op) return n;
        this.pos++;
        n = this.newBinary(op, n, this.castExpr(), t);
      }
    }

    badOperands(op, l, r, tok) {
      fail(tok, 'invalid operands to binary ' + op + " (have '" + typeName(l.ty) + "' and '" + typeName(r.ty) + "')");
    }

    newBinary(op, lhs, rhs, tok) {
      if (!isNum(lhs.ty) || !isNum(rhs.ty)) this.badOperands(op, lhs, rhs, tok);
      if ('%&|^'.includes(op) && (!isInt(lhs.ty) || !isInt(rhs.ty))) this.badOperands(op, lhs, rhs, tok);
      const ty = commonType(lhs.ty, rhs.ty);
      const l = this.cast(lhs, ty, tok), r = this.cast(rhs, ty, tok);
      if ((op === '/' || op === '%') && r.k === 'num' && isZero(r.val) && isInt(ty)) this.warn(tok, 'division by zero');
      return this.fold({ k: 'binop', line: tok.line, op, lhs: l, rhs: r, ty, opTy: ty });
    }

    newShift(op, lhs, rhs, tok) {
      if (!isInt(lhs.ty) || !isInt(rhs.ty)) this.badOperands(op, lhs, rhs, tok);
      const l = this.cast(lhs, promote(lhs.ty), tok);
      const r = this.cast(rhs, promote(rhs.ty), tok);
      if (r.k === 'num') {
        const c = Number(r.val);
        if (c < 0) this.warn(tok, 'shift count is negative');
        else if (c >= l.ty.size * 8) this.warn(tok, 'shift count (' + c + ") >= width of type '" + typeName(l.ty) + "' (" + l.ty.size * 8 + ' bits)');
      }
      return this.fold({ k: 'binop', line: tok.line, op, lhs: l, rhs: r, ty: l.ty, opTy: l.ty });
    }

    newCompare(op, lhs, rhs, tok) {
      const a = lhs.ty, b = rhs.ty;
      if (isNum(a) && isNum(b)) {
        const ct = commonType(a, b);
        if (isInt(ct) && ct.unsigned && ct.size >= 4) {
          const signedSide = !promote(a).unsigned ? lhs : !promote(b).unsigned ? rhs : null;
          if (signedSide && !(signedSide.k === 'num' && signedSide.val >= 0)) {
            this.warn(tok, "comparison of integers of different signs ('" + typeName(a) + "' and '" + typeName(b) + "'): the signed value is converted to unsigned");
          }
        }
        return this.fold({ k: 'binop', line: tok.line, op, lhs: this.cast(lhs, ct, tok), rhs: this.cast(rhs, ct, tok), ty: T.int, opTy: ct });
      }
      const pa = hasBase(a) || isFunc(a), pb = hasBase(b) || isFunc(b);
      if (pa && pb) return { k: 'binop', line: tok.line, op, lhs, rhs, ty: T.int, opTy: T.uint };
      if ((pa && isInt(b)) || (pb && isInt(a))) {
        const intSide = pa ? rhs : lhs;
        if (!(intSide.k === 'num' && isZero(intSide.val))) this.warn(tok, 'comparison between pointer and integer');
        return {
          k: 'binop', line: tok.line, op,
          lhs: pa ? lhs : this.cast(lhs, T.uint, tok), rhs: pb ? rhs : this.cast(rhs, T.uint, tok), ty: T.int, opTy: T.uint,
        };
      }
      this.badOperands(op, lhs, rhs, tok);
    }

    newAdd(lhs, rhs, tok) {
      if (isNum(lhs.ty) && isNum(rhs.ty)) return this.newBinary('+', lhs, rhs, tok);
      if (hasBase(lhs.ty) && hasBase(rhs.ty)) fail(tok, 'invalid operands to binary + (cannot add two pointers)');
      if (!hasBase(lhs.ty) && hasBase(rhs.ty)) { const tmp = lhs; lhs = rhs; rhs = tmp; }
      if (!hasBase(lhs.ty) || !isInt(rhs.ty)) this.badOperands('+', lhs, rhs, tok);
      return this.ptrAdd(lhs, rhs, false, tok);
    }

    ptrAdd(ptr, idx, neg, tok) {
      const base = ptr.ty.base;
      if (base.size < 0) fail(tok, 'arithmetic on a pointer to an incomplete type');
      if (idx.ty.size === 8) idx = this.cast(idx, T.int, tok);
      const scale = base.kind === 'void' || base.kind === 'func' ? 1 : base.size;
      return { k: 'ptradd', line: tok.line, ptr, idx, neg, scale, ty: ptrTo(base) };
    }

    newSub(lhs, rhs, tok) {
      if (isNum(lhs.ty) && isNum(rhs.ty)) return this.newBinary('-', lhs, rhs, tok);
      if (hasBase(lhs.ty) && isInt(rhs.ty)) return this.ptrAdd(lhs, rhs, true, tok);
      if (hasBase(lhs.ty) && hasBase(rhs.ty)) {
        if (lhs.ty.base.size !== rhs.ty.base.size) fail(tok, 'invalid operands to binary - (pointers to different types)');
        return { k: 'ptrsub', line: tok.line, lhs, rhs, scale: Math.max(lhs.ty.base.size, 1), ty: T.int };
      }
      this.badOperands('-', lhs, rhs, tok);
    }

    fold(n) {
      switch (n.k) {
        case 'binop':
          if (n.lhs.k === 'num' && n.rhs.k === 'num') {
            const v = evalBinop(n.op, n.lhs.val, n.rhs.val, n.opTy);
            if (v !== undefined) return this.num(v, n.ty, n);
          }
          break;
        case 'neg':
          if (n.e.k === 'num') return this.num(convertValue(typeof n.e.val === 'bigint' ? -n.e.val : -n.e.val, n.ty, n.ty), n.ty, n);
          break;
        case 'bitnot':
          if (n.e.k === 'num') return this.num(convertValue(typeof n.e.val === 'bigint' ? ~n.e.val : ~n.e.val, n.ty, n.ty), n.ty, n);
          break;
        case 'not':
          if (n.e.k === 'num') return this.num(isZero(n.e.val) ? 1 : 0, T.int, n);
          break;
        case 'logand':
          if (n.lhs.k === 'num' && isZero(n.lhs.val)) return this.num(0, T.int, n);
          if (n.lhs.k === 'num' && n.rhs.k === 'num') return this.num(isZero(n.rhs.val) ? 0 : 1, T.int, n);
          break;
        case 'logor':
          if (n.lhs.k === 'num' && !isZero(n.lhs.val)) return this.num(1, T.int, n);
          if (n.lhs.k === 'num' && n.rhs.k === 'num') return this.num(isZero(n.rhs.val) ? 0 : 1, T.int, n);
          break;
      }
      return n;
    }

    cast(e, ty, tok) {
      const from = e.ty;
      if (e.k === 'num' && (isNum(ty) || isPtr(ty)) && (isNum(from) || isPtr(from))) {
        return { k: 'num', line: e.line, val: convertValue(e.val, from, ty), ty };
      }
      return { k: 'cast', line: tok ? tok.line : e.line, e, ty };
    }

    convertForAssign(e, ty, tok, ctx) {
      const et = e.ty;
      const tyName = typeName(ty);
      if (ty.kind === 'void') return e;
      if (et.kind === 'void') fail(tok, 'void value not ignored as it ought to be (the function returns nothing)');
      if (isAgg(ty) || isAgg(et)) {
        if (!isAgg(ty) || !isAgg(et) || unqual(ty).id !== unqual(et).id) {
          fail(tok, "incompatible types when " + ctx + " type '" + tyName + "' from type '" + typeName(et) + "'");
        }
        return e;
      }
      if (isPtr(ty)) {
        if (hasBase(et) || isFunc(et)) {
          const from = isFunc(et) ? et : et.base;
          const fromPtr = isFunc(et) ? ptrTo(et) : isArr(et) ? ptrTo(et.base) : et;
          if (from.kind !== 'void' && ty.base.kind !== 'void' && !sameType(ty.base, from)) {
            this.warn(tok, "incompatible pointer types " + ctx + " '" + tyName + "' from '" + typeName(fromPtr) + "'");
          } else if (from.isConst && !ty.base.isConst) {
            this.warn(tok, ctx + " '" + tyName + "' discards 'const' qualifier from pointer target type");
          }
        } else if (isInt(et)) {
          if (!(e.k === 'num' && isZero(e.val))) {
            this.warn(tok, ctx + " '" + tyName + "' makes pointer from integer without a cast — write (" + tyName + ") in front if you really mean an address");
          }
        } else {
          fail(tok, "incompatible types when " + ctx + " type '" + tyName + "' from type '" + typeName(et) + "'");
        }
      } else if (isInt(ty) && ty.kind !== 'bool' && (hasBase(et) || isFunc(et))) {
        this.warn(tok, ctx + " '" + tyName + "' makes integer from pointer without a cast");
      } else if (isFlo(ty) && !isNum(et)) {
        fail(tok, "incompatible types when " + ctx + " type '" + tyName + "' from type '" + typeName(et) + "'");
      } else if (isArr(ty)) {
        fail(tok, 'arrays cannot be assigned');
      }
      if (e.k === 'num' && isInt(ty) && isInt(et) && ty.kind !== 'bool') {
        const nv = convertValue(e.val, et, ty);
        if (nv != e.val && (ty.size < et.size || (!et.unsigned && !ty.unsigned) || (e.val >= 0 && ty.size <= et.size))) {
          this.warn(tok, "conversion from '" + typeName(et) + "' to '" + tyName + "' changes value from " + e.val + ' to ' + nv + ' (it does not fit in ' + ty.size * 8 + ' bits)');
        }
      }
      if (e.k === 'num' && isInt(ty) && isFlo(et)) {
        if (Math.trunc(e.val) !== e.val) this.warn(tok, "conversion from '" + typeName(et) + "' to '" + tyName + "' drops the fractional part (" + e.val + ' becomes ' + convertValue(e.val, et, ty) + ')');
      }
      return this.cast(e, ty, tok);
    }

    castExpr() {
      if (this.is('(') && this.isTypename(this.peek())) {
        const t = this.tok;
        this.pos++;
        const ty = this.typename();
        this.expect(')', 'after type in cast');
        if (this.is('{')) fail(t, 'compound literals are not supported');
        const e = this.castExpr();
        if (isAgg(ty) || isArr(ty)) fail(t, "cannot cast to '" + typeName(ty) + "'");
        if (isAgg(e.ty) && ty.kind !== 'void') fail(t, 'cannot cast a struct to a scalar type');
        if (isFlo(ty) && hasBase(e.ty)) fail(t, 'cannot cast a pointer to a floating type');
        if (isPtr(ty) && isFlo(e.ty)) fail(t, 'cannot cast a floating value to a pointer');
        return this.cast(e, ty, t);
      }
      return this.unary();
    }

    newDeref(e, tok) {
      if (isFunc(e.ty)) return e;
      if (!hasBase(e.ty)) fail(tok, "invalid type argument of unary '*' (have '" + typeName(e.ty) + "') — you can only dereference a pointer");
      if (e.ty.base.kind === 'void') fail(tok, "dereferencing 'void *' pointer — cast it to a real pointer type first");
      if (isFunc(e.ty.base)) return { k: 'deref', line: tok.line, e, ty: e.ty.base };
      return { k: 'deref', line: tok.line, e, ty: e.ty.base };
    }

    unary() {
      const t = this.tok;
      if (t.k === 'op') {
        switch (t.v) {
          case '+': {
            this.pos++;
            const e = this.castExpr();
            if (!isNum(e.ty)) fail(t, "wrong type argument to unary plus");
            return this.cast(e, isInt(e.ty) ? promote(e.ty) : e.ty, t);
          }
          case '-': {
            this.pos++;
            const e = this.castExpr();
            if (!isNum(e.ty)) fail(t, "wrong type argument to unary minus");
            const ty = isInt(e.ty) ? promote(e.ty) : unqual(e.ty);
            return this.fold({ k: 'neg', line: t.line, e: this.cast(e, ty, t), ty });
          }
          case '&': {
            this.pos++;
            const e = this.castExpr();
            if (e.k === 'member' && e.mem.bitWidth !== undefined) fail(t, 'cannot take address of bit-field');
            if (!this.isLvalue(e) && !isFunc(e.ty) && !(e.k === 'call' && isAgg(e.ty))) fail(t, "lvalue required as unary '&' operand (you can only take the address of a variable, element or member)");
            if (e.k === 'var' && e.obj.isFunction) return { k: 'addr', line: t.line, e, ty: ptrTo(e.ty) };
            if (e.k === 'var') e.obj.addressTaken = true;
            return { k: 'addr', line: t.line, e, ty: ptrTo(e.ty) };
          }
          case '*': {
            this.pos++;
            return this.newDeref(this.castExpr(), t);
          }
          case '!': {
            this.pos++;
            const e = this.castExpr();
            this.condition(e, t, "'!'");
            return this.fold({ k: 'not', line: t.line, e, ty: T.int });
          }
          case '~': {
            this.pos++;
            const e = this.castExpr();
            if (!isInt(e.ty)) fail(t, "wrong type argument to bit-complement '~'");
            const ty = promote(e.ty);
            return this.fold({ k: 'bitnot', line: t.line, e: this.cast(e, ty, t), ty });
          }
          case '++': this.pos++; return this.newIncDec(this.unary(), 1, false, t);
          case '--': this.pos++; return this.newIncDec(this.unary(), -1, false, t);
        }
      }
      if (this.is('sizeof')) {
        this.pos++;
        let ty;
        if (this.is('(') && this.isTypename(this.peek())) {
          this.pos++;
          ty = this.typename();
          this.expect(')');
        } else {
          ty = this.unary().ty;
        }
        if (ty.size < 0) fail(t, "invalid application of 'sizeof' to incomplete type '" + typeName(ty) + "'");
        if (isFunc(ty)) fail(t, "invalid application of 'sizeof' to a function type");
        return this.num(ty.size, this.sizeT, t);
      }
      return this.postfix();
    }

    memberNode(e, mem, offset, tok) {
      let ty = mem.ty;
      if (e.ty.isConst || e.ty.isVolatile) ty = qualify(ty, e.ty.isConst, e.ty.isVolatile);
      return { k: 'member', line: tok.line, e, mem, offset, ty };
    }

    structRef(e, tok, arrow) {
      if (!isAgg(e.ty)) {
        if (!arrow && hasBase(e.ty) && isAgg(e.ty.base)) fail(tok, "'" + typeName(e.ty) + "' is a pointer — use '->' instead of '.' to reach the member");
        fail(tok, "request for member in something that is not a struct or union (type '" + typeName(e.ty) + "')");
      }
      if (!e.ty.complete) fail(tok, "dereferencing pointer to incomplete type '" + typeName(e.ty) + "'");
      const nt = this.ident('member name');
      const found = this.findMember(e.ty, nt.v);
      if (!found) fail(nt, "'" + typeName(e.ty) + "' has no member named '" + nt.v + "'");
      return this.memberNode(e, found.mem, found.offset, nt);
    }

    postfix() {
      let n = this.primary();
      for (;;) {
        const t = this.tok;
        if (t.k !== 'op') return n;
        if (this.consume('[')) {
          const idx = this.expr();
          this.expect(']', 'after array index');
          if (!hasBase(n.ty) && !hasBase(idx.ty)) fail(t, "subscripted value is neither an array nor a pointer (type '" + typeName(n.ty) + "')");
          if (!isInt(idx.ty) && !isInt(n.ty)) fail(t, 'array subscript is not an integer');
          if (idx.k === 'num' && isArr(n.ty) && n.ty.len >= 0 && (idx.val < 0 || idx.val >= n.ty.len)) {
            this.warn(t, 'array index ' + idx.val + ' is past the end of the array (valid indexes are 0..' + (n.ty.len - 1) + ')');
          }
          n = this.newDeref(this.newAdd(n, idx, t), t);
          continue;
        }
        if (this.consume('.')) { n = this.structRef(n, t, false); continue; }
        if (this.consume('->')) {
          if (!hasBase(n.ty)) {
            if (isAgg(n.ty)) fail(t, "'" + typeName(n.ty) + "' is not a pointer — use '.' instead of '->'");
            fail(t, "invalid type argument of '->' (have '" + typeName(n.ty) + "')");
          }
          n = this.structRef(this.newDeref(n, t), t, true);
          continue;
        }
        if (this.consume('++')) { n = this.newIncDec(n, 1, true, t); continue; }
        if (this.consume('--')) { n = this.newIncDec(n, -1, true, t); continue; }
        if (this.consume('(')) { n = this.funcall(n, t); continue; }
        return n;
      }
    }

    funcall(fn, t) {
      let fty;
      if (isFunc(fn.ty)) fty = fn.ty;
      else if (isPtr(fn.ty) && isFunc(fn.ty.base)) fty = fn.ty.base;
      else fail(t, "called object is not a function or function pointer (type '" + typeName(fn.ty) + "')");
      const name = fn.k === 'var' ? fn.obj.name : 'function pointer';
      const args = [];
      if (!this.consume(')')) {
        do { args.push(this.assign()); } while (this.consume(','));
        this.expect(')', 'after function arguments');
      }
      const params = fty.params;
      if (!fty.oldStyle) {
        if (args.length < params.length) fail(t, "too few arguments to function '" + name + "' (expected " + params.length + ', got ' + args.length + ')');
        if (args.length > params.length && !fty.variadic) fail(t, "too many arguments to function '" + name + "' (expected " + params.length + ', got ' + args.length + ')');
      }
      const conv = args.map((a, i) => {
        if (i < params.length) return this.convertForAssign(a, params[i].ty, t, 'passing argument ' + (i + 1) + " of '" + name + "' as");
        return this.defaultPromote(a, t);
      });
      if (fn.k === 'var' && fn.obj.isBuiltin && PRINTF_LIKE[name] !== undefined) this.checkFormat(name, args, PRINTF_LIKE[name], t);
      const node = { k: 'call', line: t.line, fn, args: conv, fty, ty: fty.ret };
      if (isAgg(fty.ret)) {
        if (!this.fn) fail(t, 'function calls are not allowed in global initializers');
        node.retBuf = this.newLvar('', fty.ret, t);
      }
      return node;
    }

    defaultPromote(a, t) {
      if (a.ty.kind === 'float') return this.cast(a, T.double, t);
      if (isInt(a.ty)) return this.cast(a, promote(a.ty), t);
      if (isArr(a.ty)) return this.cast(a, ptrTo(a.ty.base), t);
      if (isFunc(a.ty)) return this.cast(a, ptrTo(a.ty), t);
      return a;
    }

    checkFormat(name, args, fmtIndex, t) {
      const f = args[fmtIndex];
      if (!f || f.k !== 'var' || !f.obj.bytes) return;
      const fmt = String.fromCharCode.apply(null, f.obj.bytes.slice(0, -1));
      const re = /%[-+ #0]*(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|z|j|t|L)?([a-zA-Z%])/g;
      let m, ai = fmtIndex + 1;
      while ((m = re.exec(fmt))) {
        const conv = m[4], len = m[3] || '';
        if (conv === '%') continue;
        if (m[1] === '*') ai++;
        if (m[2] === '*') ai++;
        const a = args[ai++];
        if (!a) { this.warn(t, "format '" + m[0] + "' expects a matching argument, but there are too few arguments"); return; }
        const at = a.ty;
        const bad = expected => this.warn(t, "format '" + m[0] + "' expects " + expected + ", but argument " + (ai) + " has type '" + typeName(at) + "'");
        if ('dic'.includes(conv) || 'uxXo'.includes(conv)) {
          if (!isInt(at)) bad(len === 'll' ? "'long long'" : "an integer");
          else if (len === 'll' && at.size !== 8 && conv !== 'c') bad("'long long' (use %d for int)");
          else if (len !== 'll' && at.size === 8) bad("'int' (use %lld / %llu for 64-bit values)");
        } else if ('fFeEgGaA'.includes(conv)) {
          if (!isFlo(at)) bad("'double' (use %d for integers)");
        } else if (conv === 's') {
          if (!(hasBase(at) && at.base.size === 1)) bad("'char *' (a string)");
        } else if (conv === 'p') {
          if (!hasBase(at) && !isFunc(at)) bad("a pointer");
        } else if (conv !== 'n') {
          this.warn(t, "unknown conversion type character '" + conv + "' in format");
        }
      }
      if (ai < args.length) this.warn(t, 'too many arguments for format string');
    }

    stringLiteral(bytes, tok) {
      const ty = arrayOf(T.char, bytes.length + 1);
      const gv = this.newGvar('.str.' + this.strCount++, ty, tok);
      gv.bytes = bytes.concat([0]);
      gv.rodata = true;
      return { k: 'var', line: tok.line, obj: gv, ty };
    }

    builtinDecl(name) {
      if (!Object.prototype.hasOwnProperty.call(MC.BUILTIN_SIGS, name)) return null;
      const [d] = this.parseInternal(MC.BUILTIN_SIGS[name] + ';');
      const fn = { name, ty: d.ty, isFunction: true, isBuiltin: true, isDefinition: true, isLocal: false };
      this.scopes[0].vars.set(name, { var: fn });
      this.functions.push(fn);
      return fn;
    }

    suggest(name) {
      const names = new Set(Object.keys(MC.BUILTIN_SIGS));
      for (const sc of this.scopes) for (const k of sc.vars.keys()) names.add(k);
      let best = null, bestD = 3;
      for (const n of names) {
        if (n.startsWith('.') || n.includes('.')) continue;
        const d = editDistance(name.toLowerCase(), n.toLowerCase());
        if (d < bestD && Math.abs(n.length - name.length) <= 2) { best = n; bestD = d; }
      }
      return best ? " — did you mean '" + best + "'?" : '';
    }

    parseNumber(t) {
      const s = t.v;
      const lower = s.toLowerCase();
      const isHex = /^0x/.test(lower);
      if ((isHex && /[.p]/.test(lower)) || (!isHex && /[.e]/.test(lower))) {
        let body = lower, ty = T.double;
        if (/f$/.test(body)) { ty = T.float; body = body.slice(0, -1); } else if (/l$/.test(body)) body = body.slice(0, -1);
        const v = Number(body);
        if (isNaN(v)) fail(t, "invalid floating constant '" + s + "'");
        return this.num(ty.kind === 'float' ? Math.fround(v) : v, ty, t);
      }
      const m = /^(0x[0-9a-f]+|0b[01]+|[0-9]+)([ul]*)$/.exec(lower);
      if (!m) fail(t, "invalid integer constant '" + s + "'");
      const digits = m[1], suf = m[2];
      if (!/^(u?l{0,2}|l{0,2}u?)$/.test(suf) || suf === 'lul') fail(t, "invalid suffix '" + s.slice(digits.length) + "' on integer constant");
      let v;
      if (/^0x/.test(digits)) v = BigInt(digits);
      else if (/^0b/.test(digits)) v = BigInt(digits);
      else if (digits.length > 1 && digits[0] === '0') {
        if (/[89]/.test(digits)) fail(t, "invalid digit in octal constant '" + s + "' (numbers starting with 0 are octal!)");
        v = BigInt('0o' + digits.slice(1));
      } else v = BigInt(digits);
      const u = suf.includes('u'), l = (suf.match(/l/g) || []).length;
      const decimal = !/^0[xb]/.test(digits) && !(digits.length > 1 && digits[0] === '0');
      let cands;
      if (l === 2) cands = u ? [T.ullong] : decimal ? [T.llong] : [T.llong, T.ullong];
      else if (l === 1) cands = u ? [T.ulong, T.ullong] : decimal ? [T.long, T.llong] : [T.long, T.ulong, T.llong, T.ullong];
      else cands = u ? [T.uint, T.ulong, T.ullong] : decimal ? [T.int, T.long, T.llong] : [T.int, T.uint, T.long, T.ulong, T.llong, T.ullong];
      for (const c of cands) {
        const max = c.unsigned ? (1n << BigInt(c.size * 8)) - 1n : (1n << BigInt(c.size * 8 - 1)) - 1n;
        if (v <= max) return this.num(c.size === 8 ? (c.unsigned ? BigInt.asUintN(64, v) : BigInt.asIntN(64, v)) : Number(v), c, t);
      }
      this.warn(t, "integer constant '" + s + "' is too large");
      return this.num(BigInt.asUintN(64, v), T.ullong, t);
    }

    primary() {
      const t = this.tok;
      if (this.is('(')) {
        this.pos++;
        const e = this.expr();
        this.expect(')', "to match the '('");
        if (e.k === 'assign') return Object.assign({}, e, { paren: true });
        return e;
      }
      if (t.k === 'num') { this.pos++; return this.parseNumber(t); }
      if (t.k === 'char') { this.pos++; return this.num(t.v, T.int, t); }
      if (t.k === 'str') {
        let bytes = [];
        while (this.tok.k === 'str') { bytes = bytes.concat(this.tok.v); this.pos++; }
        return this.stringLiteral(bytes, t);
      }
      if (t.k === 'id') {
        if (KEYWORDS.has(t.v)) fail(t, "expected an expression before '" + t.v + "'");
        this.pos++;
        if (t.v === '__func__' || t.v === '__FUNCTION__') {
          const name = this.fn ? this.fn.name : '';
          return this.stringLiteral(Array.from(name).map(c => c.charCodeAt(0)), t);
        }
        const e = this.findVar(t.v);
        if (e) {
          if (e.var) { e.var.used = true; return { k: 'var', line: t.line, obj: e.var, ty: e.var.ty }; }
          if (e.enumVal !== undefined) return this.num(e.enumVal, T.int, t);
          if (e.typedef) fail(t, "unexpected type name '" + t.v + "' (expected an expression)");
        }
        const b = this.builtinDecl(t.v);
        if (b) return { k: 'var', line: t.line, obj: b, ty: b.ty };
        if (this.is('(')) fail(t, "implicit declaration of function '" + t.v + "' — define it (or declare a prototype) before calling it" + this.suggest(t.v));
        fail(t, "'" + t.v + "' undeclared (first use here)" + this.suggest(t.v));
      }
      if (t.k === 'eof') fail(t, 'unexpected end of input (missing code or a closing brace?)');
      fail(t, "expected an expression before '" + t.text + "'");
    }
  }

  MC.Parser = Parser;
  MC.SIZE_T = T.uint;

  MC.evalPreprocessorExpr = function (toks) {
    const p = new Parser(toks, { bare: true });
    const n = p.conditional();
    if (n.k !== 'num') fail(toks[0], '#if expression must be constant');
    return n.val;
  };
})(typeof window !== 'undefined' ? (window.MiniC = window.MiniC || {}) : (global.MiniC = global.MiniC || {}));
