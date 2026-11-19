import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME_DIR } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROMPT_TOOL = 'mcp__cxw__approve';

// Clave de "permitir siempre (esta sesión)": para Bash, el primer comando
// (p. ej. "npm"); para el resto, el nombre de la herramienta.
export function ruleKey(toolName, input = {}) {
  if (toolName === 'Bash') {
    const first = String(input.command ?? '').trim().split(/\s+/)[0] ?? '';
    return `Bash(${first})`;
  }
  return toolName;
}

// Recibe las preguntas de permiso del servidor MCP y espera a que respondas.
export class PermissionBroker {
  constructor({ timeoutMs = 10 * 60_000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.token = crypto.randomBytes(16).toString('hex');
    this.pending = new Map();
    this.always = new Set();
    this.seq = 0;
    this.onAsk = () => {};
    this.onResolved = () => {};
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

  // decision: 'y' (sí), 'a' (siempre en esta sesión), 'n' (no), 'timeout', 'cancel'
  answer(id, decision) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    const allow = decision === 'y' || decision === 'a';
    if (decision === 'a') this.always.add(ruleKey(p.toolName, p.input));
    const message = {
      n: 'El usuario ha denegado el permiso desde el juego.',
      timeout: 'Nadie respondió a la petición de permiso a tiempo.',
      cancel: 'La tarea se ha parado.',
    }[decision];
    p.resolve(allow ? { behavior: 'allow' } : { behavior: 'deny', message });
    this.onResolved({ id, decision, toolName: p.toolName, rule: ruleKey(p.toolName, p.input) });
    return true;
  }

  cancelAll() {
    for (const id of [...this.pending.keys()]) this.answer(id, 'cancel');
  }

  stop() {
    this.cancelAll();
    this.server?.close();
  }
}
