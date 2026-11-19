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

export function markdownToWow(md) {
  const out = [];
  let inCode = false;
  for (const raw of String(md ?? '').replace(/\r/g, '').split('\n')) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(`${C.block}${escapeWow(raw).replace(/\t/g, '  ')}|r`);
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
