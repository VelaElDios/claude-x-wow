// Parser y serializador mínimos para el formato de SavedVariables de WoW.
// Solo soporta lo que WoW escribe: asignaciones globales con tablas, strings,
// números, booleanos y nil. No ejecuta nada.

export function parseSavedVariables(source) {
  // Leemos como bytes (latin1) para respetar escapes \ddd y luego
  // convertimos cada string a UTF-8.
  const src = Buffer.isBuffer(source) ? source.toString('latin1') : Buffer.from(source, 'utf8').toString('latin1');
  let i = 0;
  const len = src.length;

  const fail = (msg) => {
    throw new Error(`Lua parse error en posición ${i}: ${msg}`);
  };

  function skipWs() {
    for (;;) {
      while (i < len && /\s/.test(src[i])) i++;
      if (src.startsWith('--', i)) {
        i += 2;
        const long = src.slice(i).match(/^\[(=*)\[/);
        if (long) {
          const end = `]${long[1]}]`;
          const j = src.indexOf(end, i);
          i = j === -1 ? len : j + end.length;
        } else {
          while (i < len && src[i] !== '\n') i++;
        }
        continue;
      }
      return;
    }
  }

  function readIdent() {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 256));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  }

  function expect(ch) {
    skipWs();
    if (src[i] !== ch) fail(`se esperaba '${ch}'`);
    i++;
  }

  function parseString() {
    const quote = src[i++];
    let out = '';
    while (i < len) {
      const c = src[i++];
      if (c === quote) return Buffer.from(out, 'latin1').toString('utf8');
      if (c === '\\') {
        const n = src[i++];
        switch (n) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case 'a': out += '\x07'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'v': out += '\v'; break;
          case '\n': out += '\n'; break;
          case '\\': case '"': case "'": out += n; break;
          default:
            if (/[0-9]/.test(n)) {
              let digits = n;
              while (digits.length < 3 && /[0-9]/.test(src[i])) digits += src[i++];
              out += String.fromCharCode(parseInt(digits, 10) & 0xff);
            } else {
              out += n;
            }
        }
      } else {
        out += c;
      }
    }
    fail('string sin cerrar');
  }

  function parseLongString() {
    const m = /^\[(=*)\[/.exec(src.slice(i));
    const end = `]${m[1]}]`;
    i += m[0].length;
    if (src[i] === '\n') i++;
    const j = src.indexOf(end, i);
    if (j === -1) fail('string largo sin cerrar');
    const s = src.slice(i, j);
    i = j + end.length;
    return Buffer.from(s, 'latin1').toString('utf8');
  }

  function parseNumber() {
    const m = /^-?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|inf|nan)/.exec(src.slice(i, i + 64));
    if (!m) fail('número inválido');
    i += m[0].length;
    return Number(m[0]);
  }

  function parseTable() {
    i++; // {
    const entries = [];
    let n = 0;
    for (;;) {
      skipWs();
      if (src[i] === '}') { i++; break; }
      let key;
      let value;
      if (src[i] === '[' && src[i + 1] !== '[' && src[i + 1] !== '=') {
        i++;
        skipWs();
        key = parseValue();
        expect(']');
        expect('=');
        skipWs();
        value = parseValue();
      } else {
        const save = i;
        const ident = readIdent();
        skipWs();
        if (ident && src[i] === '=' && src[i + 1] !== '=') {
          i++;
          skipWs();
          key = ident;
          value = parseValue();
        } else {
          i = save;
          key = ++n;
          value = parseValue();
        }
      }
      entries.push([key, value]);
      skipWs();
      if (src[i] === ',' || src[i] === ';') i++;
    }
    const isArray = entries.every(([k], idx) => k === idx + 1);
    if (isArray) return entries.map(([, v]) => v);
    const obj = {};
    for (const [k, v] of entries) if (v !== null) obj[k] = v;
    return obj;
  }

  function parseValue() {
    skipWs();
    const c = src[i];
    if (c === '{') return parseTable();
    if (c === '"' || c === "'") return parseString();
    if (c === '[') return parseLongString();
    if (c === '-' || c === '.' || /[0-9]/.test(c)) return parseNumber();
    const ident = readIdent();
    if (ident === 'true') return true;
    if (ident === 'false') return false;
    if (ident === 'nil') return null;
    fail(`valor inesperado '${ident ?? c}'`);
  }

  const globals = {};
  skipWs();
  while (i < len) {
    const name = readIdent();
    if (!name) fail('se esperaba un nombre de variable');
    expect('=');
    globals[name] = parseValue();
    skipWs();
  }
  return globals;
}

export function luaString(s) {
  let out = '"';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 32 || code === 127) out += '\\' + String(code).padStart(3, '0');
    else out += ch;
  }
  return out + '"';
}

export function toLua(value, indent = '') {
  const next = indent + '\t';
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'string') return luaString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    if (value.length === 0) return '{}';
    return '{\n' + value.map((v) => next + toLua(v, next) + ',\n').join('') + indent + '}';
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined && value[k] !== null);
  if (keys.length === 0) return '{}';
  return '{\n' + keys.map((k) => {
    const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `[${luaString(k)}]`;
    return `${next}${key} = ${toLua(value[k], next)},\n`;
  }).join('') + indent + '}';
}
