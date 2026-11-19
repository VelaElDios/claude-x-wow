import { spawn, execFileSync } from 'node:child_process';

// Busca el ejecutable de Claude Code. En Windows preferimos claude.exe para
// poder lanzarlo sin pasar por cmd.exe (más seguro y sin líos de comillas).
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

function runOnce({ prompt, cwd, sessionId, cfg }) {
  const args = ['-p', '--output-format', 'json', '--permission-mode', cfg.permissionMode];
  if (sessionId) args.push('--resume', sessionId);
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.allowedTools?.length) args.push('--allowedTools', cfg.allowedTools.join(','));
  if (cfg.disallowedTools?.length) args.push('--disallowedTools', cfg.disallowedTools.join(','));

  const { cmd, shell } = resolveClaude();
  return new Promise((resolve) => {
    const child = shell
      ? spawn(quoteCmd(cmd), args.map(quoteCmd), { cwd, shell: true, windowsHide: true })
      : spawn(cmd, args, { cwd, windowsHide: true });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      stderr += `\nTiempo agotado (${cfg.timeoutMinutes} min).`;
      child.kill();
    }, cfg.timeoutMinutes * 60_000);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `No se pudo lanzar Claude Code (${err.message}). ¿Está instalado y en el PATH?` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // La salida JSON es un único objeto; cogemos la última línea que parsee.
      const lines = stdout.trim().split(/\r?\n/).reverse();
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          return resolve({
            ok: !data.is_error,
            text: data.result ?? '',
            sessionId: data.session_id ?? sessionId,
            cost: data.total_cost_usd,
            error: data.is_error ? data.result || data.subtype || 'Error de Claude Code' : null,
            code,
          });
        } catch {
          // sigue buscando
        }
      }
      resolve({ ok: false, code, error: (stderr || stdout || `Claude Code terminó con código ${code}`).trim() });
    });

    child.stdin.end(prompt);
  });
}

export async function runClaude({ prompt, cwd, sessionId, cfg }) {
  let res = await runOnce({ prompt, cwd, sessionId, cfg });
  // Si la sesión ya no existe, empezamos una nueva.
  if (!res.ok && sessionId && /no conversation found|session/i.test(res.error || '')) {
    res = await runOnce({ prompt, cwd, sessionId: null, cfg });
    if (res.ok) res.newSession = true;
  }
  return res;
}
