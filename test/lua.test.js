import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedVariables, toLua } from '../bridge/lua.js';

const SAMPLE = `
ClaudeXWoWDB = {
["outbox"] = {
{
["id"] = "1795000000-1",
["type"] = "prompt",
["text"] = "arregla el \\"bug\\"\\ny añade tests ñ",
["t"] = 1795000000,
}, -- [1]
},
["history"] = {
},
["windowOpen"] = true,
["seen"] = {
["1795000000-0"] = true,
},
}
OtherDB = {
"CENTER",
nil,
-6.99998664855957,
}
`;

test('parsea SavedVariables de WoW', () => {
  const g = parseSavedVariables(SAMPLE);
  const db = g.ClaudeXWoWDB;
  assert.equal(db.outbox.length, 1);
  assert.equal(db.outbox[0].id, '1795000000-1');
  assert.equal(db.outbox[0].text, 'arregla el "bug"\ny añade tests ñ');
  assert.deepEqual(db.history, []);
  assert.equal(db.windowOpen, true);
  assert.equal(db.seen['1795000000-0'], true);
  assert.deepEqual(g.OtherDB, ['CENTER', null, -6.99998664855957]);
});

test('ida y vuelta toLua -> parse', () => {
  const value = {
    version: 1,
    project: 'mi "proyecto"',
    messages: [{ id: 'a-1', status: 'done', text: 'línea 1\nlínea 2\t\\ fin ]] ✓' }],
  };
  const back = parseSavedVariables('X = ' + toLua(value)).X;
  assert.deepEqual(back, value);
});
