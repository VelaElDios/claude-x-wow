import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxw-'));
process.env.CLAUDE_X_WOW_HOME = path.join(tmp, 'home');
const { Bridge } = await import('../bridge/bridge.js');
const { parseSavedVariables } = await import('../bridge/lua.js');

function setup(name) {
  const wow = path.join(tmp, name, '_forever_');
  const svDir = path.join(wow, 'WTF', 'Account', 'ACC#1', 'SavedVariables');
  fs.mkdirSync(svDir, { recursive: true });
  const project = path.join(tmp, name, 'proj');
  fs.mkdirSync(project, { recursive: true });
  const cfg = { wowPath: wow, projectDir: project, permissionMode: 'acceptEdits', pollMs: 50, timeoutMinutes: 1, liveIntervalMs: 0 };
  return { wow, svDir, project, cfg };
}

// Claude Code simulado: emite mensajes como stream-json.
function fakeRunner(calls) {
  return ({ prompt, sessionId, cwd, onMessage }) => {
    calls.push({ prompt, sessionId, cwd });
    let cancel;
    const promise = new Promise((resolve) => {
      cancel = () => resolve({ ok: false, cancelled: true, sessionId: 's1' });
      setTimeout(() => {
        onMessage({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(cwd, 'src', 'Noria.java') } }] } });
        onMessage({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '1→class Noria {}\n2→' }] } });
        onMessage({ type: 'assistant', message: { content: [{ type: 'text', text: `**Hecho**: ${prompt} con \`código\` | barra` }] } });
        resolve({ ok: true, sessionId: 'sess-' + calls.length, cost: 0.0123, durationMs: 2000, denials: [{ tool_name: 'Bash' }] });
      }, 20);
    });
    return { promise, cancel: () => cancel() };
  };
}

function fakeSlots() {
  return {
    size: 10,
    writes: [],
    write(i, src) {
      this.writes.push({ i, src });
      return true;
    },
  };
}

function fakeSignals() {
  return {
    k: 0,
    resets: 0,
    readK() {
      return this.k;
    },
    advance(k) {
      this.k = k;
      return true;
    },
    isReset() {
      return this.k === 0;
    },
    resetAll() {
      this.k = 0;
      this.resets++;
      return true;
    },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (nonce, seq, cursor, payload) => ({ nonce, seq, cursor, payload: Buffer.from(payload) });

test('canal en directo: saludo, tarea troceada, streaming y acuses', async () => {
  const { cfg, project } = setup('live');
  const calls = [];
  const slots = fakeSlots();
  const signals = fakeSignals();
  const bridge = new Bridge(cfg, { runner: fakeRunner(calls), slots, signals, log: () => {} });

  bridge.onFrame(frame(500, 1, 0, 'H|0'));
  bridge.flushLive();
  assert.equal(signals.k, 1);
  assert.equal(slots.writes.length, 1);
  assert.match(slots.writes[0].src, /^ClaudeXWoW_OnSlot\(500, 1, /);
  assert.match(slots.writes[0].src, /k = "status"/);

  // Mensaje en dos trozos con UTF-8 partido por la mitad.
  const text = Buffer.from('arregla la noria ñ');
  const cut = text.indexOf(0xc3) + 1;
  bridge.onFrame(frame(500, 2, 2, Buffer.concat([Buffer.from('P|9-1|1|2|'), text.subarray(0, cut)])));
  bridge.onFrame(frame(500, 2, 2, Buffer.concat([Buffer.from('P|9-1|1|2|'), text.subarray(0, cut)]))); // repetida: se ignora
  bridge.onFrame(frame(500, 3, 2, Buffer.concat([Buffer.from('P|9-1|2|2|'), text.subarray(cut)])));
  await wait(100);
  bridge.live.lastWrite = 0;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'arregla la noria ñ');
  assert.equal(calls[0].cwd, project);

  bridge.flushLive();
  const last = slots.writes.at(-1).src;
  assert.equal(slots.writes.at(-1).i, 2);
  assert.match(last, /ClaudeXWoW_OnSlot\(500, 3, /);
  assert.match(last, /name = "Read"/);
  assert.match(last, /detail = "src\/Noria.java"/);
  assert.match(last, /class Noria \{\}/);
  assert.match(last, /\|cffffffffHecho\|r: arregla la noria ñ con \|cff9cdcfecódigo\|r \|\| barra/);
  assert.match(last, /Hecho en 2s · \$0.012/);
  assert.match(last, /Sin permiso para: Bash/);
  assert.equal(bridge.state.sessionId, 'sess-1');

  // Nueva sesión del juego (/reload): se reenvía lo que le falte.
  bridge.onFrame(frame(777, 1, signals.k, 'H|2'));
  bridge.live.lastWrite = 0;
  bridge.flushLive();
  const resend = slots.writes.at(-1).src;
  assert.match(resend, /ClaudeXWoW_OnSlot\(777, 1, /);
  assert.doesNotMatch(resend, /n = 1,/);
  assert.match(resend, /n = 3,/);
  bridge.stop();
});

test('cancelar con X para la tarea', async () => {
  const { cfg } = setup('cancel');
  const calls = [];
  const slots = fakeSlots();
  const slow = ({ onMessage }) => {
    calls.push(1);
    let done;
    const promise = new Promise((r) => (done = r));
    return { promise, cancel: () => done({ ok: false, cancelled: true }) };
  };
  const bridge = new Bridge(cfg, { runner: slow, slots, signals: fakeSignals(), log: () => {} });
  bridge.onFrame(frame(1, 1, 1, 'H|0'));
  bridge.onFrame(frame(1, 2, 1, 'P|a-1|1|1|tarea larga'));
  await wait(10);
  assert.ok(bridge.current);
  bridge.onFrame(frame(1, 3, 1, 'X|a-2'));
  await wait(10);
  assert.equal(bridge.current, null);
  assert.ok(bridge.state.events.some((e) => e.k === 'done' && /Parado/.test(e.summary)));
  bridge.stop();
});

test('respaldo por SavedVariables + Inbox.lua', async () => {
  const { cfg, svDir, wow } = setup('fallback');
  fs.writeFileSync(path.join(svDir, 'ClaudeXWoW.lua'), `ClaudeXWoWDB = {
["outbox"] = {
{ ["id"] = "1-1", ["type"] = "prompt", ["text"] = "hola", },
{ ["id"] = "1-2", ["type"] = "reset", },
},
}`);
  const calls = [];
  const bridge = new Bridge(cfg, { runner: fakeRunner(calls), log: () => {} });
  bridge.pollSaved();
  await wait(100);
  bridge.pollSaved();
  assert.equal(calls.length, 1);
  bridge.writeInbox();
  const inbox = parseSavedVariables(fs.readFileSync(path.join(wow, 'Interface', 'AddOns', 'ClaudeXWoW', 'Inbox.lua'))).ClaudeXWoW_Inbox;
  assert.deepEqual(inbox.received, ['1-1', '1-2']);
  assert.equal(inbox.project, 'proj');
  assert.ok(inbox.events.some((e) => e.k === 'done'));
  assert.ok(inbox.events.some((e) => e.k === 'info' && /Conversación nueva/.test(e.text)));
  bridge.stop();
});

test('si Windows bloquea una ranura, se reintenta sin perder eventos ni caerse', () => {
  const { cfg } = setup('busy');
  const slots = fakeSlots();
  let fail = 2;
  const realWrite = slots.write.bind(slots);
  slots.write = (i, src) => (fail-- > 0 ? false : realWrite(i, src));
  const signals = fakeSignals();
  const bridge = new Bridge(cfg, { runner: fakeRunner([]), slots, signals, log: () => {} });
  bridge.onFrame(frame(9, 1, 0, 'H|0'));
  bridge.emit({ k: 'info', text: 'uno' });
  for (let t = 0; t < 3; t++) {
    bridge.live.lastWrite = 0;
    bridge.tick();
  }
  assert.equal(slots.writes.length, 1);
  assert.equal(slots.writes[0].i, 1);
  assert.match(slots.writes[0].src, /ClaudeXWoW_OnSlot\(9, 1, /);
  assert.match(slots.writes[0].src, /text = "uno"/);
  assert.equal(signals.k, 1);
  bridge.stop();
});

test('al cerrar el WoW se restauran las señales', () => {
  const { cfg } = setup('closed');
  const signals = fakeSignals();
  signals.k = 37;
  const bridge = new Bridge(cfg, { runner: fakeRunner([]), slots: fakeSlots(), signals, log: () => {} });
  bridge.onGameClosed();
  assert.equal(signals.resets, 1);
  assert.equal(bridge.k, 0);
  bridge.stop();
});

test('permisos: la pregunta llega al juego y la respuesta A|id|y la desbloquea', async () => {
  const { cfg } = setup('perm');
  const { PermissionBroker } = await import('../bridge/permissions.js');
  const permissions = await new PermissionBroker().start();
  const slots = fakeSlots();
  const bridge = new Bridge(cfg, { runner: fakeRunner([]), slots, signals: fakeSignals(), permissions, log: () => {} });
  bridge.onFrame(frame(3, 1, 0, 'H|0'));
  const pending = permissions.ask('Bash', { command: 'npm test' });
  const ask = bridge.state.events.find((e) => e.k === 'ask');
  assert.equal(ask.name, 'Bash');
  assert.equal(ask.detail, 'npm test');
  bridge.onFrame(frame(3, 2, 0, `A|${ask.id}|y`));
  assert.equal((await pending).behavior, 'allow');
  assert.ok(bridge.state.events.some((e) => e.k === 'answered' && e.decision === 'y'));
  bridge.stop();
});
