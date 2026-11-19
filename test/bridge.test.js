import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('circuito completo con Claude simulado', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxw-'));
  process.env.CLAUDE_X_WOW_HOME = path.join(tmp, 'home');
  const { Bridge } = await import('../bridge/bridge.js');
  const { parseSavedVariables } = await import('../bridge/lua.js');

  const wow = path.join(tmp, '_forever_');
  const svDir = path.join(wow, 'WTF', 'Account', 'ACC#1', 'SavedVariables');
  fs.mkdirSync(svDir, { recursive: true });
  const project = path.join(tmp, 'proj');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(svDir, 'ClaudeXWoW.lua'), `ClaudeXWoWDB = {
["outbox"] = {
{ ["id"] = "1-1", ["type"] = "prompt", ["text"] = "hola", },
{ ["id"] = "1-2", ["type"] = "reset", },
{ ["id"] = "1-3", ["type"] = "prompt", ["text"] = "segunda", },
},
}`);

  const calls = [];
  const runner = async ({ prompt, sessionId, cwd }) => {
    calls.push({ prompt, sessionId, cwd });
    return { ok: true, text: `eco: ${prompt}`, sessionId: 'sess-' + calls.length };
  };
  const cfg = { wowPath: wow, projectDir: project, permissionMode: 'acceptEdits', maxReplyChars: 6000, pollMs: 50, timeoutMinutes: 1 };
  const bridge = new Bridge(cfg, { runner });
  bridge.poll();
  await new Promise((r) => setTimeout(r, 100));
  bridge.poll(); // no debe repetir

  assert.equal(calls.length, 2);
  assert.equal(calls[0].sessionId, null);
  assert.equal(calls[1].sessionId, null, 'reset debe borrar la sesión');
  assert.equal(calls[0].cwd, project);

  const inbox = parseSavedVariables(fs.readFileSync(path.join(wow, 'Interface', 'AddOns', 'ClaudeXWoW', 'Inbox.lua'))).ClaudeXWoW_Inbox;
  assert.equal(inbox.project, 'proj');
  const byId = Object.fromEntries(inbox.messages.map((m) => [m.id, m]));
  assert.equal(byId['1-1'].text, 'eco: hola');
  assert.equal(byId['1-2'].status, 'done');
  assert.equal(byId['1-3'].text, 'eco: segunda');
  assert.equal(bridge.busy, null);
});
