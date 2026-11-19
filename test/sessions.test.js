import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxw-ses-'));
process.env.CLAUDE_X_WOW_HOME = path.join(tmp, 'home');
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
const { listSessions, sessionsDir, Follower } = await import('../bridge/sessions.js');
const { Bridge } = await import('../bridge/bridge.js');

const project = path.join(tmp, 'Practicas');
fs.mkdirSync(project);
const dir = path.join(tmp, 'claude', 'projects', path.resolve(project).replace(/[^a-zA-Z0-9]/g, '-'));
fs.mkdirSync(dir, { recursive: true });

const line = (o) => JSON.stringify({ cwd: project, isSidechain: false, ...o }) + '\n';
const user = (text) => line({ type: 'user', message: { role: 'user', content: text } });
const assistant = (content) => line({ type: 'assistant', message: { role: 'assistant', content } });

const old = path.join(dir, 'aaaa-old.jsonl');
fs.writeFileSync(old, user('<command-name>/clear</command-name>') + user('arregla la noria') + assistant([{ type: 'text', text: 'Hecho' }]));
fs.utimesSync(old, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
const live = path.join(dir, 'bbbb-live.jsonl');
fs.writeFileSync(
  live,
  user('explica los semáforos') +
    assistant([{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(project, 'NoriaSemaforos.java') } }]) +
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'class NoriaSemaforos {}' }] } }) +
    assistant([{ type: 'text', text: 'Usa **Semaphore** para las plazas.' }]),
);

test('encuentra y lista las sesiones del proyecto', () => {
  assert.equal(sessionsDir(project), dir);
  const list = listSessions(project);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'bbbb-live');
  assert.equal(list[0].title, 'explica los semáforos');
  assert.equal(list[0].active, true);
  assert.equal(list[1].title, 'arregla la noria', 'ignora los mensajes de comandos');
  assert.equal(list[1].active, false);
});

test('Follower devuelve solo lo nuevo y aguanta líneas a medias', () => {
  const f = new Follower(live);
  assert.deepEqual(f.poll(), []);
  const next = user('y ahora con monitores');
  fs.appendFileSync(live, next.slice(0, 20));
  assert.deepEqual(f.poll(), []);
  fs.appendFileSync(live, next.slice(20));
  const got = f.poll();
  assert.equal(got.length, 1);
  assert.equal(got[0].message.content, 'y ahora con monitores');
});

test('comandos /sesiones, /ver, seguir en directo y /usar desde el juego', () => {
  const slots = { size: 10, writes: [], write(i, src) { this.writes.push(src); return true; } };
  const signals = { k: 0, readK: () => 0, advance(k) { this.k = k; return true; } };
  const cfg = { wowPath: path.join(tmp, 'wow'), projectDir: project, permissionMode: 'acceptEdits', liveIntervalMs: 0 };
  const bridge = new Bridge(cfg, { runner: () => ({ promise: new Promise(() => {}), cancel() {} }), slots, signals, log: () => {} });
  const frame = (seq, payload) => ({ nonce: 1, seq, cursor: 0, payload: Buffer.from(payload) });
  bridge.onFrame(frame(1, 'H|0'));

  bridge.onFrame(frame(2, 'C|x-1|sesiones'));
  const block = bridge.state.events.at(-1);
  assert.equal(block.k, 'block');
  assert.match(block.text, /1\. explica los semáforos/);
  assert.match(block.text, /activa/);
  assert.match(block.text, /\|Haddon:cxw:cmd:ver:1\|h/);

  bridge.onFrame(frame(3, 'C|x-2|ver 1'));
  const kinds = bridge.state.events.map((e) => e.k);
  assert.ok(kinds.includes('prompt'));
  assert.ok(bridge.state.events.some((e) => e.k === 'tool' && e.detail === 'NoriaSemaforos.java'));
  assert.ok(bridge.state.events.some((e) => e.k === 'text' && /\|cffffffffSemaphore\|r/.test(e.text)));

  // Lo que escribas en la terminal aparece en el juego.
  const before = bridge.state.events.length;
  fs.appendFileSync(live, assistant([{ type: 'text', text: 'Nueva respuesta en Warp' }]));
  bridge.follow.lastPoll = 0;
  bridge.pollFollow();
  assert.ok(bridge.state.events.slice(before).some((e) => e.k === 'text' && /Nueva respuesta en Warp/.test(e.text)));

  bridge.onFrame(frame(4, 'C|x-3|usar 2'));
  assert.equal(bridge.state.sessionId, 'aaaa-old');
  assert.match(bridge.state.events.at(-1).text, /continúan "arregla la noria"/);

  bridge.onFrame(frame(5, 'C|x-4|dejar'));
  assert.equal(bridge.follow, null);
  bridge.stop();
});
