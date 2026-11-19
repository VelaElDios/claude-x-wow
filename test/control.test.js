import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxw-ctl-'));
process.env.CLAUDE_X_WOW_HOME = path.join(tmp, 'home');
const { Bridge } = await import('../bridge/bridge.js');
const { PermissionBroker, ruleToAllowed } = await import('../bridge/permissions.js');
const { loadConfig } = await import('../bridge/config.js');

const ws = path.join(tmp, 'workspace');
for (const d of ['Practicas', 'TFG', 'PascalFC', '.oculta']) fs.mkdirSync(path.join(ws, d), { recursive: true });

function make(extra = {}) {
  const cfg = { wowPath: path.join(tmp, 'wow'), projectDir: path.join(ws, 'Practicas'), permissionMode: 'acceptEdits', model: null, allowedTools: [], liveIntervalMs: 0 };
  const slots = { size: 10, write: () => true };
  const signals = { k: 0, readK: () => 0, advance: () => true };
  const calls = [];
  const runner = (o) => {
    calls.push(o);
    return { promise: Promise.resolve({ ok: true, sessionId: 'nueva' }), cancel() {} };
  };
  const bridge = new Bridge(cfg, { runner, slots, signals, log: () => {}, ...extra });
  let seq = 0;
  bridge.onFrame({ nonce: 1, seq: ++seq, cursor: 0, payload: Buffer.from('H|0') });
  const cmd = (text) => bridge.onFrame({ nonce: 1, seq: ++seq, cursor: 0, payload: Buffer.from(`C|x-${seq}|${text}`) });
  const last = () => bridge.state.events.at(-1);
  return { bridge, cfg, cmd, last, calls };
}

test('/proyecto lista las carpetas hermanas y cambia de proyecto guardando la sesión', () => {
  const { bridge, cfg, cmd, last } = make();
  bridge.state.sessionId = 'sesion-practicas';
  cmd('proyecto');
  assert.equal(last().k, 'block');
  assert.match(last().text, /Practicas \|cff6fcf73← actual/);
  assert.match(last().text, /TFG/);
  assert.doesNotMatch(last().text, /oculta/);
  cmd('proyecto tfg');
  assert.equal(cfg.projectDir, path.join(ws, 'TFG'));
  assert.equal(bridge.state.sessionId, null);
  assert.ok(bridge.state.events.some((e) => e.k === 'status' && e.project === 'TFG'));
  assert.equal(loadConfig().projectDir, path.join(ws, 'TFG'), 'se guarda en config.json');
  // Al volver, recupera la conversación que tenía.
  cmd('proyecto practicas');
  assert.equal(bridge.state.sessionId, 'sesion-practicas');
  bridge.stop();
});

test('/modelo y /modo cambian la configuración y se usan en la siguiente tarea', () => {
  const { bridge, cfg, cmd, last } = make();
  cmd('modelo opus');
  assert.equal(cfg.model, 'opus');
  cmd('modo plan');
  assert.equal(cfg.permissionMode, 'plan');
  const status = bridge.state.events.filter((e) => e.k === 'status').at(-1);
  assert.equal(status.model, 'opus');
  assert.equal(status.mode, 'plan');
  cmd('modo inventado');
  assert.match(last().text, /Modos: editar, preguntar, plan/);
  cmd('modelo defecto');
  assert.equal(cfg.model, null);
  bridge.stop();
});

test('"Siempre" guarda el permiso en config.json; /permisos y /olvidar', async () => {
  const permissions = await new PermissionBroker().start();
  const { bridge, cfg, cmd, last } = make({ permissions });
  permissions.onAsk = (q) => setTimeout(() => permissions.answer(q.id, 'p'), 5);
  const origAsk = permissions.onAsk;
  // onAsk lo sobrescribe el puente: lo envolvemos para responder solos.
  const bridgeAsk = permissions.onAsk;
  permissions.onAsk = (q) => {
    bridgeAsk(q);
    origAsk(q);
  };
  const d = await permissions.ask('Bash', { command: 'npm test' });
  assert.equal(d.behavior, 'allow');
  assert.deepEqual(cfg.allowedTools, ['Bash(npm:*)']);
  assert.deepEqual(loadConfig().allowedTools, ['Bash(npm:*)']);
  cmd('permisos');
  assert.match(last().text, /1\. Bash\(npm:\*\)/);
  cmd('olvidar 1');
  assert.deepEqual(cfg.allowedTools, []);
  assert.equal(permissions.always.size, 0, 'olvidar también lo quita de esta sesión');
  bridge.stop();
});

test('ruleToAllowed', () => {
  assert.equal(ruleToAllowed('Bash(npm)'), 'Bash(npm:*)');
  assert.equal(ruleToAllowed('Bash(exacto:git status && ls)'), 'Bash(git status && ls)');
  assert.equal(ruleToAllowed('WebFetch'), 'WebFetch');
});
