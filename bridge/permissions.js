import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME_DIR } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROMPT_TOOL = 'mcp__cxw__approve';

// Clave de "permitir siempre (esta sesión)".
// - Bash simple ("npm test"): el programa, sin asignaciones delante -> Bash(npm).
// - Bash compuesto (&&, ;, |, $(), redirecciones...): solo ese comando exacto,
//   para que "siempre" no deje colar otra cosa detrás.
// - Resto de herramientas: el nombre de la herramienta.
const SHELL_OPERATORS = /&&|\|\||[;|&<>`\n]|\$\(/;

export function ruleKey(toolName, input = {}) {
  if (toolName !== 'Bash') return toolName;
  const command = String(input.command ?? '').trim();
  if (SHELL_OPERATORS.test(command)) return `Bash(exacto:${command})`;
  const words = command.split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  return `Bash(${words[0] ?? ''})`;
}

// Regla equivalente para --allowedTools de Claude Code (para guardarla en config.json).
export function ruleToAllowed(rule) {
  if (rule.startsWith('Bash(exacto:')) return `Bash(${rule.slice('Bash(exacto:'.length, -1)})`;
  const m = rule.match(/^Bash\((.+)\)$/);
  if (m) return `Bash(${m[1]}:*)`;
  return rule;
}

// Texto corto para el botón "Siempre ..." del juego.
export function ruleLabel(rule) {
  return rule.startsWith('Bash(exacto:') ? 'este comando' : rule;
}

// Recibe las preguntas de permiso del servidor MCP y espera a que respondas.
export class PermissionBroker {
  constructor({ timeoutMs = 10 * 60_000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.token = crypto.randomBytes(16).toString('hex');
    this.pending = new Map();
    this.always = new Set();
    this.persisted = new Map(); // regla guardada en allowedTools -> clave de 'siempre'
    this.seq = 0;
    this.onAsk = () => {};
    this.onResolved = () => {};
    this.onPersist = () => {};
  }

  async start() {
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/ask' || req.headers['x-cxw-token'] !== this.token) {
        res.writeHead(403).end();
        return;
      }
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', async () => {
        let q;
        try {
          q = JSON.parse(body);
        } catch {
          res.writeHead(400).end();
          return;
        }
        const decision = await this.ask(q.tool_name, q.input ?? {});
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(decision));
      });
    });
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = this.server.address().port;
    this.configPath = path.join(HOME_DIR, 'mcp-permissions.json');
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(
      this.configPath,
      JSON.stringify({
        mcpServers: {
          cxw: {
            command: process.execPath,
            args: [path.join(here, 'permission-mcp.js')],
            env: { CXW_PORT: String(this.port), CXW_TOKEN: this.token },
          },
        },
      }, null, 2),
    );
    return this;
  }

  ask(toolName, input) {
    if (this.always.has(ruleKey(toolName, input))) return Promise.resolve({ behavior: 'allow' });
    const id = String(++this.seq);
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.answer(id, 'timeout'), this.timeoutMs);
      this.pending.set(id, { toolName, input, resolve, timer });
      this.onAsk({ id, toolName, input, rule: ruleKey(toolName, input) });
    });
  }

  // decision: 'y' (sí), 'a' (esta sesión del puente), 'p' (siempre, se guarda), 'n' (no), 'timeout', 'cancel'
  answer(id, decision) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    const allow = decision === 'y' || decision === 'a' || decision === 'p';
    if (decision === 'a' || decision === 'p') this.always.add(ruleKey(p.toolName, p.input));
    if (decision === 'p') {
      const key = ruleKey(p.toolName, p.input);
      this.persisted.set(ruleToAllowed(key), key);
      this.onPersist(ruleToAllowed(key));
    }
    const message = {
      n: 'El usuario ha denegado el permiso desde el juego.',
      timeout: 'Nadie respondió a la petición de permiso a tiempo.',
      cancel: 'La tarea se ha parado.',
    }[decision];
    p.resolve(allow ? { behavior: 'allow' } : { behavior: 'deny', message });
    this.onResolved({ id, decision, toolName: p.toolName, rule: ruleKey(p.toolName, p.input) });
    return true;
  }

  // Quita una regla guardada también de lo permitido en esta sesión.
  forget(allowed) {
    const key = this.persisted.get(allowed);
    if (key) this.always.delete(key);
    this.persisted.delete(allowed);
  }

  cancelAll() {
    for (const id of [...this.pending.keys()]) this.answer(id, 'cancel');
  }

  stop() {
    this.cancelAll();
    this.server?.close();
  }
}
