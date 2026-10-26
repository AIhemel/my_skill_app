/*
 * MiniC — a small C compiler + virtual microcontroller that runs in the browser.
 * Part 1: errors, lexer and preprocessor.
 */
(function (MC) {
  'use strict';

  class CError extends Error {
    constructor(kind, msg, line) {
      super(msg);
      this.kind = kind; // 'compile' | 'runtime'
      this.line = line || 0;
    }
  }
  MC.CError = CError;

  function fail(tok, msg) {
    throw new CError('compile', msg, tok ? tok.line : 0);
  }
  MC.fail = fail;

  // ------------------------------------------------------------------ lexer

  const PUNCTS = [
    '...', '<<=', '>>=',
    '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '##',
  ];
  const SINGLE = '[](){}.&*+-~!/%<>^|?:;=,#';

  function utf8(cp, out) {
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }

  // Reads one (possibly escaped) character starting at src[i]; returns [byte-or-codepoint, nextIndex, isRawCodepoint]
  function readChar(src, i, line) {
    const c = src[i];
    if (c !== '\\') {
      const cp = src.codePointAt(i);
      return [cp, i + (cp > 0xffff ? 2 : 1), cp > 127];
    }
    const e = src[i + 1];
    const simple = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '\\': 92, "'": 39, '"': 34, '?': 63, e: 27 };
    if (e in simple) return [simple[e], i + 2, false];
    if (e >= '0' && e <= '7') {
      let j = i + 1, v = 0, n = 0;
      while (n < 3 && src[j] >= '0' && src[j] <= '7') { v = v * 8 + (src.charCodeAt(j) - 48); j++; n++; }
      return [v & 0xff, j, false];
    }
    if (e === 'x') {
      let j = i + 2, v = 0, n = 0;
      while (/[0-9a-fA-F]/.test(src[j] || '')) { v = (v * 16 + parseInt(src[j], 16)) & 0xff; j++; n++; }
      if (!n) throw new CError('compile', '\\x used with no following hex digits', line);
      return [v, j, false];
    }
    throw new CError('compile', 'unknown escape sequence \\' + e, line);
  }

  function tokenize(src, firstLine) {
    const toks = [];
    let i = 0, line = firstLine || 1, bol = true, space = false;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; bol = true; space = true; continue; }
      if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) {
        i += src[i + 1] === '\r' ? 3 : 2; line++; space = true; continue;
      }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; space = true; continue; }
      if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
        space = true; continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) throw new CError('compile', 'unterminated /* comment', line);
        for (let j = i; j < end; j++) if (src[j] === '\n') line++;
        i = end + 2; space = true; continue;
      }
      const tok = { k: '', v: null, line, bol, space, text: '' };
      bol = false; space = false;
      const start = i;
      if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        const isHex = c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X');
        i++;
        while (i < n) {
          const d = src[i], prev = src[i - 1];
          if ((d === '+' || d === '-') && (prev === 'p' || prev === 'P' || (!isHex && (prev === 'e' || prev === 'E')))) { i++; continue; }
          if (/[0-9a-zA-Z_.]/.test(d)) { i++; continue; }
          break;
        }
        tok.k = 'num';
        tok.v = src.slice(start, i);
      } else if (/[A-Za-z_$]/.test(c)) {
        while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++;
        tok.k = 'id';
        tok.v = src.slice(start, i);
      } else if (c === '"') {
        i++;
        const bytes = [];
        while (src[i] !== '"') {
          if (i >= n || src[i] === '\n') throw new CError('compile', 'missing terminating " character', line);
          const [v, j, raw] = readChar(src, i, line);
          if (raw) utf8(v, bytes); else bytes.push(v);
          i = j;
        }
        i++;
        tok.k = 'str';
        tok.v = bytes;
      } else if (c === "'") {
        i++;
        if (src[i] === "'") throw new CError('compile', 'empty character constant', line);
        const [v, j, raw] = readChar(src, i, line);
        i = j;
        if (src[i] !== "'") throw new CError('compile', 'missing terminating \' character (use double quotes for strings)', line);
        i++;
        tok.k = 'char';
        tok.v = raw ? v : (v > 127 ? v - 256 : v); // plain char is signed
      } else {
        let p = PUNCTS.find(s => src.startsWith(s, i));
        if (!p) {
          if (SINGLE.indexOf(c) < 0) throw new CError('compile', "stray '" + c + "' in program", line);
          p = c;
        }
        i += p.length;
        tok.k = 'op';
        tok.v = p;
      }
      tok.text = src.slice(start, i);
      toks.push(tok);
    }
    toks.push({ k: 'eof', v: null, line, bol: true, space: true, text: '' });
    return toks;
  }
  MC.tokenize = tokenize;

  // ------------------------------------------------------------ preprocessor

  function cloneTok(t, extra) {
    const c = Object.assign({}, t);
    if (extra) Object.assign(c, extra);
    return c;
  }

  function stringize(tokens, line) {
    let s = '';
    tokens.forEach((t, idx) => {
      if (idx && t.space) s += ' ';
      s += t.text;
    });
    const bytes = [];
    for (const ch of s) utf8(ch.codePointAt(0), bytes);
    return { k: 'str', v: bytes, text: JSON.stringify(s), line, space: false, bol: false };
  }

  class Preprocessor {
    constructor(opts) {
      this.macros = new Map();
      this.includes = opts.includes || {};
      this.included = new Set();
      this.warnings = opts.warnings || [];
      for (const [name, body] of Object.entries(opts.defines || {})) {
        this.macros.set(name, { params: null, body: tokenize(body, 0).filter(t => t.k !== 'eof') });
      }
    }

    run(toks) {
      const out = [];
      const cond = [];
      const active = () => cond.length === 0 || cond[cond.length - 1].active;
      let seg = [];
      const flush = () => {
        if (seg.length) { this.expand(seg, out); seg = []; }
      };
      let i = 0;
      while (i < toks.length) {
        const t = toks[i];
        if (t.k === 'eof') break;
        if (t.k === 'op' && t.v === '#' && t.bol) {
          // collect directive line
          let j = i + 1;
          const line = [];
          while (j < toks.length && !toks[j].bol && toks[j].k !== 'eof') line.push(toks[j++]);
          i = j;
          flush();
          this.directive(t, line, cond, active, out);
          continue;
        }
        if (active()) seg.push(t);
        i++;
      }
      flush();
      if (cond.length) fail(cond[cond.length - 1].tok, 'unterminated #if / #ifdef (missing #endif)');
      out.push({ k: 'eof', v: null, line: toks.length ? toks[toks.length - 1].line : 1, bol: true, text: '' });
      return out;
    }

    directive(hash, line, cond, active, out) {
      const name = line.length ? line[0].v : '';
      const rest = line.slice(1);
      const top = cond[cond.length - 1];
      switch (name) {
        case 'ifdef':
        case 'ifndef': {
          const parent = active();
          if (!rest.length || rest[0].k !== 'id') fail(hash, 'no macro name given in #' + name);
          let v = this.macros.has(rest[0].v);
          if (name === 'ifndef') v = !v;
          cond.push({ tok: hash, parent, active: parent && v, done: v });
          return;
        }
        case 'if': {
          const parent = active();
          const v = parent ? this.evalIf(hash, rest) : false;
          cond.push({ tok: hash, parent, active: parent && v, done: v });
          return;
        }
        case 'elif': {
          if (!top) fail(hash, '#elif without #if');
          if (top.done) { top.active = false; return; }
          const v = top.parent ? this.evalIf(hash, rest) : false;
          top.active = top.parent && v;
          top.done = v;
          return;
        }
        case 'else':
          if (!top) fail(hash, '#else without #if');
          top.active = top.parent && !top.done;
          top.done = true;
          return;
        case 'endif':
          if (!top) fail(hash, '#endif without #if');
          cond.pop();
          return;
      }
      if (!active()) return;
      switch (name) {
        case '':
          return; // null directive
        case 'define': {
          if (!rest.length || rest[0].k !== 'id') fail(hash, 'macro names must be identifiers');
          const mname = rest[0].v;
          let body = rest.slice(1), params = null, variadic = false;
          if (body.length && body[0].v === '(' && !body[0].space) {
            params = [];
            let k = 1;
            while (k < body.length && body[k].v !== ')') {
              if (body[k].v === ',') { k++; continue; }
              if (body[k].v === '...') { variadic = true; k++; continue; }
              if (body[k].k !== 'id') fail(body[k], 'expected parameter name in macro');
              params.push(body[k].v);
              k++;
            }
            if (k >= body.length) fail(hash, "missing ')' in macro parameter list");
            body = body.slice(k + 1);
          }
          if (body.length) body[0] = cloneTok(body[0], { space: false });
          this.macros.set(mname, { params, variadic, body });
          return;
        }
        case 'undef':
          if (rest.length) this.macros.delete(rest[0].v);
          return;
        case 'include': {
          if (!rest.length) fail(hash, '#include expects "FILENAME" or <FILENAME>');
          let file;
          if (rest[0].k === 'str') file = String.fromCharCode.apply(null, rest[0].v);
          else if (rest[0].v === '<') file = rest.slice(1, -1).map(t => t.text).join('');
          else fail(hash, '#include expects "FILENAME" or <FILENAME>');
          if (Object.prototype.hasOwnProperty.call(this.includes, file)) {
            if (this.included.has(file)) return;
            this.included.add(file);
            const sub = new Preprocessor({ includes: this.includes, warnings: this.warnings });
            sub.macros = this.macros;
            sub.included = this.included;
            const toks = tokenize(this.includes[file], 0).map(t => cloneTok(t, { line: 0 }));
            const res = sub.run(toks);
            res.pop(); // eof
            for (const t of res) out.push(t);
            return;
          }
          if (rest[0].k === 'str' && !/\.h$/.test(file) ) fail(hash, "cannot include '" + file + "'");
          if (rest[0].k === 'str' && !KNOWN_HEADERS.has(file)) {
            fail(hash, "'" + file + "' not found. Available: standard headers and \"board.h\" (put your code in one file)");
          }
          return; // standard headers are built in
        }
        case 'pragma':
        case 'line':
        case 'ident':
          return;
        case 'error':
          fail(hash, '#error ' + rest.map(t => t.text).join(' '));
          return;
        case 'warning':
          this.warnings.push({ line: hash.line, msg: '#warning ' + rest.map(t => t.text).join(' ') });
          return;
        default:
          fail(hash, 'invalid preprocessing directive #' + name);
      }
    }

    evalIf(hash, toks) {
      // replace defined X / defined(X)
      const pre = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.k === 'id' && t.v === 'defined') {
          let name;
          if (toks[i + 1] && toks[i + 1].v === '(') { name = toks[i + 2]; i += 3; } else { name = toks[i + 1]; i += 1; }
          if (!name || name.k !== 'id') fail(hash, 'operator "defined" requires an identifier');
          pre.push({ k: 'num', v: this.macros.has(name.v) ? '1' : '0', text: '', line: t.line });
        } else pre.push(t);
      }
      const expanded = [];
      this.expand(pre, expanded);
      const final = expanded.map(t => (t.k === 'id' ? { k: 'num', v: '0', text: '0', line: t.line } : t));
      if (!final.length) fail(hash, '#if with no expression');
      final.push({ k: 'eof', line: hash.line, bol: true, text: '' });
      const v = MC.evalPreprocessorExpr(final);
      return v !== 0 && v !== 0n;
    }

    // Macro expansion using hide-sets (Prosser's algorithm, simplified).
    expand(tokens, out) {
      const stack = tokens.slice().reverse();
      while (stack.length) {
        const t = stack.pop();
        if (t.k !== 'id') { out.push(t); continue; }
        if (t.v === '__LINE__') { out.push(cloneTok(t, { k: 'num', v: String(t.line), text: String(t.line) })); continue; }
        if (t.v === '__FILE__') { out.push(cloneTok(stringize([{ text: 'main.c' }], t.line), { space: t.space })); continue; }
        const m = this.macros.get(t.v);
        if (!m || (t.hide && t.hide.has(t.v))) { out.push(t); continue; }
        const hide = new Set(t.hide || []);
        hide.add(t.v);
        if (!m.params) {
          const body = this.paste(m.body.map(b => cloneTok(b, { line: t.line, hide })));
          if (body.length) body[0] = cloneTok(body[0], { space: t.space });
          for (let k = body.length - 1; k >= 0; k--) stack.push(body[k]);
          continue;
        }
        // function-like: needs '('
        if (!stack.length || stack[stack.length - 1].v !== '(') { out.push(t); continue; }
        stack.pop();
        const args = [[]];
        let depth = 0;
        for (;;) {
          if (!stack.length) fail(t, "unterminated argument list invoking macro '" + t.v + "'");
          const a = stack.pop();
          if (a.v === '(' && a.k === 'op') depth++;
          if (a.v === ')' && a.k === 'op') {
            if (depth === 0) break;
            depth--;
          }
          if (a.v === ',' && a.k === 'op' && depth === 0 && !(m.variadic && args.length > m.params.length)) {
            args.push([]);
            continue;
          }
          args[args.length - 1].push(a);
        }
        if (m.params.length === 0 && args.length === 1 && args[0].length === 0) args.length = 0;
        if (args.length < m.params.length || (!m.variadic && args.length > m.params.length)) {
          fail(t, "macro '" + t.v + "' expects " + m.params.length + ' argument(s), got ' + args.length);
        }
        const body = this.substitute(m, args, t);
        const result = this.paste(body).map(b => cloneTok(b, { line: t.line, hide: new Set([...(b.hide || []), ...hide]) }));
        if (result.length) result[0] = cloneTok(result[0], { space: t.space });
        for (let k = result.length - 1; k >= 0; k--) stack.push(result[k]);
      }
    }

    substitute(m, args, call) {
      const res = [];
      const argOf = name => {
        if (name === '__VA_ARGS__' && m.variadic) {
          const va = args.slice(m.params.length);
          const joined = [];
          va.forEach((a, i) => {
            if (i) joined.push({ k: 'op', v: ',', text: ',', line: call.line });
            joined.push(...a);
          });
          return joined;
        }
        const idx = m.params.indexOf(name);
        return idx >= 0 ? args[idx] : null;
      };
      const body = m.body;
      for (let i = 0; i < body.length; i++) {
        const b = body[i];
        if (b.v === '#' && b.k === 'op' && body[i + 1] && body[i + 1].k === 'id' && argOf(body[i + 1].v)) {
          res.push(cloneTok(stringize(argOf(body[i + 1].v), call.line), { space: b.space }));
          i++;
          continue;
        }
        const arg = b.k === 'id' ? argOf(b.v) : null;
        if (arg) {
          const nearPaste = (body[i - 1] && body[i - 1].v === '##') || (body[i + 1] && body[i + 1].v === '##');
          let toks;
          if (nearPaste) toks = arg.slice();
          else { toks = []; this.expand(arg, toks); }
          if (toks.length) toks[0] = cloneTok(toks[0], { space: b.space });
          if (!toks.length && nearPaste) toks = [{ k: 'placemarker', v: '', text: '', line: call.line }];
          res.push(...toks);
          continue;
        }
        res.push(b);
      }
      return res;
    }

    paste(toks) {
      if (!toks.some(t => t.v === '##' && t.k === 'op')) return toks.filter(t => t.k !== 'placemarker');
      const out = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.v === '##' && t.k === 'op' && out.length && i + 1 < toks.length) {
          const left = out.pop();
          const right = toks[++i];
          const text = (left.text || '') + (right.text || '');
          if (!text) continue;
          const re = tokenize(text, left.line).filter(x => x.k !== 'eof');
          if (re.length !== 1) fail(left, "pasting \"" + left.text + "\" and \"" + right.text + "\" does not give a valid token");
          out.push(cloneTok(re[0], { line: left.line, space: left.space, hide: left.hide }));
          continue;
        }
        out.push(t);
      }
      return out.filter(t => t.k !== 'placemarker');
    }
  }

  const KNOWN_HEADERS = new Set([
    'stdio.h', 'stdlib.h', 'string.h', 'stdint.h', 'stdbool.h', 'stddef.h', 'math.h', 'ctype.h',
    'limits.h', 'assert.h', 'stdarg.h', 'time.h', 'inttypes.h', 'float.h', 'errno.h', 'unistd.h',
  ]);

  MC.Preprocessor = Preprocessor;
})(typeof window !== 'undefined' ? (window.MiniC = window.MiniC || {}) : (global.MiniC = global.MiniC || {}));
