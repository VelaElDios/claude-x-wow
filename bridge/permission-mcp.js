#!/usr/bin/env node
// Servidor MCP mínimo (stdio) que Claude Code usa con --permission-prompt-tool.
// Cada vez que Claude quiere usar una herramienta que no está permitida, llama a
// "approve"; nosotros le preguntamos al puente (HTTP local) y el puente te lo
// pregunta en el juego.
import http from 'node:http';
import readline from 'node:readline';

const PORT = Number(process.env.CXW_PORT);
const TOKEN = process.env.CXW_TOKEN;
const VERSION = '0.3.0';

function send(msg) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
}

function askBridge(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: '/ask', method: 'POST', headers: { 'content-type': 'application/json', 'x-cxw-token': TOKEN } },
      (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve({ behavior: 'deny', message: 'Respuesta inválida del puente de Claude x WoW.' });
          }
        });
      },
    );
    req.on('error', () => resolve({ behavior: 'deny', message: 'No se pudo contactar con el puente de Claude x WoW.' }));
    req.end(data);
  });
}

const TOOL = {
  name: 'approve',
  description: 'Pide al usuario (dentro de World of Warcraft) permiso para usar una herramienta.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
      tool_use_id: { type: 'string' },
    },
    required: ['tool_name', 'input'],
  },
};

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (id === undefined) return; // notificaciones
  switch (method) {
    case 'initialize':
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'claude-x-wow', version: VERSION },
        },
      });
    case 'ping':
      return send({ id, result: {} });
    case 'tools/list':
      return send({ id, result: { tools: [TOOL] } });
    case 'tools/call': {
      const args = params?.arguments ?? {};
      const decision = await askBridge({ tool_name: args.tool_name, input: args.input ?? {}, tool_use_id: args.tool_use_id });
      const result = decision.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: args.input ?? {} }
        : { behavior: 'deny', message: decision.message || 'El usuario ha denegado el permiso.' };
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
    }
    default:
      return send({ id, error: { code: -32601, message: `Método no soportado: ${method}` } });
  }
});
