// Sesiones de Claude Code guardadas en disco (las que abres en tu terminal).
// Claude Code guarda cada conversación en ~/.claude/projects/<carpeta>/<id>.jsonl,
// una línea JSON por mensaje.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

// Carpeta de transcripciones del proyecto (o null).
export function sessionsDir(projectDir) {
  const root = path.join(claudeDir(), 'projects');
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  const wanted = path.resolve(projectDir).replace(/[^a-zA-Z0-9]/g, '-');
  const exact = dirs.find((d) => d === wanted) ?? dirs.find((d) => d.toLowerCase() === wanted.toLowerCase());
  if (exact) return path.join(root, exact);
  // Plan B: mirar el "cwd" de la primera línea de cada transcripción.
  for (const d of dirs) {
    const dir = path.join(root, d);
    const file = fs.readdirSync(dir).find((f) => f.endsWith('.jsonl'));
    if (!file) continue;
    const cwd = firstEntries(path.join(dir, file), 20).find((e) => e.cwd)?.cwd;
    if (cwd && norm(cwd) === norm(projectDir)) return dir;
  }
  return null;
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // línea a medio escribir
    }
  }
  return out;
}

function firstEntries(file, max) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return parseLines(buf.subarray(0, n).toString('utf8')).slice(0, max);
  } finally {
    fs.closeSync(fd);
  }
}

// Últimas entradas del archivo (lee solo el final).
export function tailEntries(file, bytes = 256 * 1024) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return { entries: parseLines(text), size };
  } finally {
    fs.closeSync(fd);
  }
}

export const isPrompt = (e) =>
  e?.type === 'user' && !e.isMeta && !e.isSidechain && typeof e.message?.content === 'string' && !e.message.content.startsWith('<');

export function listSessions(projectDir, { limit = 8, now = Date.now() } = {}) {
  const dir = sessionsDir(projectDir);
  if (!dir) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const file = path.join(dir, f);
      const stat = fs.statSync(file);
      return { id: f.slice(0, -6), file, mtime: stat.mtimeMs, size: stat.size };
    })
    .filter((s) => s.size > 0)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((s) => {
      const head = firstEntries(s.file, 50);
      const summary = tailEntries(s.file, 64 * 1024).entries.filter((e) => e.type === 'summary').at(-1)?.summary;
      const prompt = head.find(isPrompt)?.message.content;
      return { ...s, title: summary || prompt || '(sin mensajes)', active: now - s.mtime < 120_000 };
    });
}

export function timeAgo(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

// Sigue una transcripción y devuelve las entradas nuevas en cada poll().
export class Follower {
  constructor(file) {
    this.file = file;
    this.offset = fs.statSync(file).size;
    this.partial = '';
  }

  poll() {
    let size;
    try {
      size = fs.statSync(this.file).size;
    } catch {
      return [];
    }
    if (size < this.offset) this.offset = 0; // archivo reescrito
    if (size === this.offset) return [];
    const fd = fs.openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(size - this.offset);
      fs.readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const text = this.partial + buf.toString('utf8');
      const cut = text.lastIndexOf('\n');
      this.partial = cut === -1 ? text : text.slice(cut + 1);
      return parseLines(cut === -1 ? '' : text.slice(0, cut));
    } finally {
      fs.closeSync(fd);
    }
  }
}
