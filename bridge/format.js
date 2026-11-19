// Conversión de la salida de Claude Code a texto con colores de WoW.
import path from 'node:path';

const C = {
  bold: '|cffffffff',
  code: '|cff9cdcfe',
  block: '|cffa6d189',
  head: '|cffd97757',
  dim: '|cff8a8a8a',
};

// En WoW "|" inicia un código; se escribe "||" para mostrarlo.
export const escapeWow = (s) => String(s ?? '').replace(/\|/g, '||');

function inline(line) {
  return escapeWow(line)
    .replace(/`([^`]+)`/g, `${C.code}$1|r`)
    .replace(/\*\*([^*]+)\*\*/g, `${C.bold}$1|r`)
    .replace(/__([^_]+)__/g, `${C.bold}$1|r`)
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, `$1 ${C.dim}($2)|r`);
}

// Quita el Markdown en línea para medir el ancho visible de un texto.
const plain = (s) =>
  String(s)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1');

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// Tabla Markdown -> columnas alineadas (la terminal usa fuente monoespaciada).
function renderTable(rows, maxWidth = 110) {
  const data = rows.map(cells);
  const cols = Math.max(...data.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...data.map((r) => plain(r[c] ?? '').length)));
  // Si no cabe, recortamos las columnas más anchas.
  const sep = 3;
  while (widths.reduce((a, b) => a + b, 0) + sep * (cols - 1) > maxWidth) {
    const i = widths.indexOf(Math.max(...widths));
    if (widths[i] <= 8) break;
    widths[i]--;
  }
  const fit = (text, w) => {
    const p = plain(text);
    if (p.length > w) return escapeWow(p.slice(0, w - 1) + '…');
    return inline(text) + ' '.repeat(w - p.length);
  };
  const line = (r, head) =>
    r.length === 0
      ? ''
      : widths.map((w, c) => (head ? `${C.bold}${fit(plain(r[c] ?? ''), w)}|r` : fit(r[c] ?? '', w))).join(`${C.dim} │ |r`);
  const out = [line(data[0], true), `${C.dim}${widths.map((w) => '─'.repeat(w)).join('─┼─')}|r`];
  for (const r of data.slice(1)) out.push(line(r, false));
  return out;
}

export function markdownToWow(md) {
  const out = [];
  let inCode = false;
  const lines = String(md ?? '').replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(`${C.block}${escapeWow(raw).replace(/\t/g, '  ')}|r`);
      continue;
    }
    // Tabla: cabecera + separador + filas.
    if (isTableRow(raw) && isTableSep(lines[i + 1] ?? '')) {
      const rows = [raw];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
      i--;
      out.push(...renderTable(rows));
      continue;
    }
    const h = raw.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      out.push(`${C.head}${inline(h[1]).replace(/\|r/g, `|r${C.head}`)}|r`);
      continue;
    }
    const b = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (b) {
      out.push(`${b[1]}• ${inline(b[2])}`);
      continue;
    }
    if (/^\s*([-*_])\1\1+\s*$/.test(raw)) {
      out.push(`${C.dim}────────────|r`);
      continue;
    }
    out.push(inline(raw));
  }
  return out.join('\n').trim();
}

const short = (s, n = 80) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// Nombre y detalle de una llamada a herramienta, como los muestra Claude Code.
export function describeTool(name, input = {}, cwd = '') {
  const rel = (p) => {
    if (!p) return '';
    const r = cwd ? path.relative(cwd, p) : p;
    return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : p;
  };
  const labels = {
    Read: 'Leyendo', Write: 'Escribiendo', Edit: 'Editando', MultiEdit: 'Editando', NotebookEdit: 'Editando',
    Bash: 'Ejecutando', Grep: 'Buscando', Glob: 'Buscando', LS: 'Listando', WebFetch: 'Leyendo web',
    WebSearch: 'Buscando en la web', Task: 'Delegando', Agent: 'Delegando', TodoWrite: 'Planificando',
  };
  let detail;
  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit':
      detail = rel(input.file_path); break;
    case 'NotebookEdit': detail = rel(input.notebook_path); break;
    case 'Bash': detail = short(input.command, 90); break;
    case 'Grep': detail = `"${short(input.pattern, 50)}"${input.path ? ' en ' + rel(input.path) : ''}`; break;
    case 'Glob': detail = short(input.pattern, 60); break;
    case 'LS': detail = rel(input.path); break;
    case 'WebFetch': detail = short(input.url, 70); break;
    case 'WebSearch': detail = short(input.query, 70); break;
    case 'Task': case 'Agent': detail = short(input.description, 60); break;
    case 'TodoWrite': detail = `${input.todos?.length ?? 0} tareas`; break;
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string');
      detail = first ? short(first, 60) : '';
    }
  }
  const pretty = name.startsWith('mcp__') ? name.split('__').slice(1).join(':') : name;
  return { name: pretty, detail: escapeWow(detail), label: `${labels[name] ?? 'Usando ' + pretty}` };
}

// Resumen de un resultado de herramienta (primeras líneas, como Claude Code).
export function describeResult(content, isError) {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) text = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
  text = text.replace(/\r/g, '').replace(/^\s*\d+→/gm, '').trim();
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return isError ? 'Error' : '(sin salida)';
  const max = isError ? 4 : 3;
  const shown = lines.slice(0, max).map((l) => escapeWow(short(l, 110)));
  if (lines.length > max) shown.push(`… +${lines.length - max} líneas`);
  return shown.join('\n');
}
