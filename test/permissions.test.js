import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

process.env.CLAUDE_X_WOW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cxw-perm-'));
const { PermissionBroker, ruleKey, ruleLabel } = await import('../bridge/permissions.js');

// Lanza el servidor MCP tal y como lo haría Claude Code (con --mcp-config).
function startMcp(configPath) {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.cxw;
  const child = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env } });
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (l) => {
    const msg = JSON.parse(l);
    waiting.get(msg.id)?.(msg);
  });
  let id = 0;
  const call = (method, params) =>
    new Promise((resolve) => {
      const n = ++id;
      waiting.set(n, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  return { call, child };
}

test('ruleKey: simple por programa, compuesto solo exacto', () => {
  assert.equal(ruleKey('Bash', { command: 'npm test -- --watch' }), 'Bash(npm)');
  assert.equal(ruleKey('Bash', { command: 'NODE_ENV=test npm test' }), 'Bash(npm)');
  assert.equal(ruleKey('WebFetch', { url: 'x' }), 'WebFetch');
  const compuesto = 'OUT=$(mktemp -d) && javac -d "$OUT" Noria.java';
  assert.equal(ruleKey('Bash', { command: compuesto }), `Bash(exacto:${compuesto})`);
  for (const peligroso of ['npm test && rm -rf src', 'npm test; rm -rf src', 'npm test | sh', 'cat x > y', 'echo `rm x`', 'a\nrm x']) {
    assert.match(ruleKey('Bash', { command: peligroso }), /^Bash\(exacto:/, peligroso);
  }
  assert.equal(ruleLabel(ruleKey('Bash', { command: compuesto })), 'este comando');
  assert.equal(ruleLabel('Bash(npm)'), 'Bash(npm)');
});

test('"siempre" en un comando compuesto no autoriza otro que empiece igual', async () => {
  const broker = await new PermissionBroker().start();
  let asks = 0;
  broker.onAsk = (q) => {
    asks++;
    setTimeout(() => broker.answer(q.id, asks === 1 ? 'a' : 'n'), 5);
  };
  const first = await broker.ask('Bash', { command: 'OUT=$(mktemp -d) && javac x.java' });
  assert.equal(first.behavior, 'allow');
  const same = await broker.ask('Bash', { command: 'OUT=$(mktemp -d) && javac x.java' });
  assert.equal(same.behavior, 'allow');
  assert.equal(asks, 1, 'el mismo comando exacto ya no pregunta');
  const sneaky = await broker.ask('Bash', { command: 'OUT=$(mktemp -d) && rm -rf src' });
  assert.equal(sneaky.behavior, 'deny');
  assert.equal(asks, 2, 'uno distinto vuelve a preguntar');
  broker.stop();
});

test('el servidor MCP pregunta al puente y devuelve la decisión', async () => {
  const broker = await new PermissionBroker().start();
  const asked = [];
  const decisions = ['y', 'a', 'n'];
  broker.onAsk = (q) => {
    asked.push(q);
    setTimeout(() => broker.answer(q.id, decisions.shift()), 10);
  };
  const resolved = [];
  broker.onResolved = (r) => resolved.push(r);

  const { call, child } = startMcp(broker.configPath);
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.equal(init.result.serverInfo.name, 'claude-x-wow');
  const list = await call('tools/list', {});
  assert.equal(list.result.tools[0].name, 'approve');

  const ask = async (input) => {
    const r = await call('tools/call', { name: 'approve', arguments: { tool_name: 'Bash', input } });
    return JSON.parse(r.result.content[0].text);
  };
  const r1 = await ask({ command: 'ls -la' });
  assert.deepEqual(r1, { behavior: 'allow', updatedInput: { command: 'ls -la' } });
  const r2 = await ask({ command: 'npm test' });
  assert.equal(r2.behavior, 'allow');
  // "Siempre" para Bash(npm): ya no pregunta.
  const r3 = await ask({ command: 'npm run build' });
  assert.equal(r3.behavior, 'allow');
  assert.equal(asked.length, 2);
  const r4 = await ask({ command: 'rm -rf build' });
  assert.equal(r4.behavior, 'deny');
  assert.match(r4.message, /denegado/);
  assert.deepEqual(resolved.map((r) => r.decision), ['y', 'a', 'n']);

  child.kill();
  broker.stop();
});

test('cancelar deniega lo pendiente', async () => {
  const broker = await new PermissionBroker().start();
  broker.onAsk = () => setTimeout(() => broker.cancelAll(), 10);
  const d = await broker.ask('Bash', { command: 'make' });
  assert.equal(d.behavior, 'deny');
  broker.stop();
});
