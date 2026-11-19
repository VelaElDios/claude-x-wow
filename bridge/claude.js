import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';

// Busca el ejecutable de Claude Code. En Windows preferimos claude.exe para
// lanzarlo sin pasar por cmd.exe (más seguro y sin líos de comillas).
function resolveClaude() {
  if (process.env.CLAUDE_BIN) return { cmd: process.env.CLAUDE_BIN, shell: false };
  if (process.platform !== 'win32') return { cmd: 'claude', shell: false };
  try {
    const out = execFileSync('where', ['claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const exe = lines.find((l) => l.toLowerCase().endsWith('.exe'));
    if (exe) return { cmd: exe, shell: false };
    if (lines[0]) return { cmd: lines[0], shell: true };
  } catch {
    // no está en el PATH
  }
  return { cmd: 'claude', shell: true };
}

const quoteCmd = (a) => `"${String(a).replace(/"/g, '""')}"`;

function kill(child) {
  if (process.platform === 'win32' && child.pid) {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // ya terminó
    }
  }
  child.kill();
}

// Lanza Claude Code en modo no interactivo con salida en streaming.
// onMessage recibe cada mensaje JSON (system, assistant, user, result).
// Devuelve { promise, cancel }.
export function runClaudeStream({ prompt, cwd, sessionId, cfg, onMessage, permissions }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', cfg.permissionMode];
  if (sessionId) args.push('--resume', sessionId);
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.allowedTools?.length) args.push('--allowedTools', cfg.allowedTools.join(','));
  if (cfg.disallowedTools?.length) args.push('--disallowedTools', cfg.disallowedTools.join(','));
  // Lo que no esté permitido se pregunta en el juego (ver permissions.js).
  if (permissions) args.push('--mcp-config', permissions.configPath, '--permission-prompt-tool', permissions.tool);

  const { cmd, shell } = resolveClaude();
  let child;
  let cancelled = false;

  const promise = new Promise((resolve) => {
    child = shell
      ? spawn(quoteCmd(cmd), args.map(quoteCmd), { cwd, shell: true, windowsHide: true })
      : spawn(cmd, args, { cwd, windowsHide: true });

    let stderr = '';
    let result = null;
    let session = sessionId;
    const timer = setTimeout(() => {
      stderr += `\nTiempo agotado (${cfg.timeoutMinutes} min).`;
      kill(child);
    }, cfg.timeoutMinutes * 60_000);

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.session_id) session = msg.session_id;
      if (msg.type === 'result') result = msg;
      try {
        onMessage?.(msg);
      } catch (e) {
        console.error(e);
      }
    });
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `No se pudo lanzar Claude Code (${err.message}). ¿Está instalado y en el PATH?` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (cancelled) return resolve({ ok: false, cancelled: true, sessionId: session });
      if (result) {
        return resolve({
          ok: !result.is_error,
          sessionId: result.session_id ?? session,
          cost: result.total_cost_usd,
          durationMs: result.duration_ms,
          turns: result.num_turns,
          denials: result.permission_denials ?? [],
          error: result.is_error ? String(result.result || result.subtype || 'Error de Claude Code') : null,
        });
      }
      resolve({ ok: false, sessionId: session, error: (stderr || `Claude Code terminó con código ${code}`).trim() });
    });

    child.stdin.end(prompt);
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      if (child) kill(child);
    },
  };
}
