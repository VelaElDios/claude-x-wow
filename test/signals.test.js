import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Signals, toGray, fromGray, slotFor, MOD } from '../bridge/signals.js';

test('Gray: ida y vuelta y un solo bit por paso', () => {
  for (let n = 0; n < MOD; n++) {
    assert.equal(fromGray(toGray(n)), n);
    const d = toGray(n) ^ toGray((n + 1) % MOD);
    assert.equal(d & (d - 1), 0);
  }
});

test('ranuras: consecutivas y cíclicas', () => {
  assert.equal(slotFor(1, 300), 1);
  assert.equal(slotFor(300, 300), 300);
  assert.equal(slotFor(301, 300), 1);
  assert.equal(slotFor(0, 300), ((MOD - 1) % 300) + 1);
});

test('el contador en archivos avanza cambiando un solo archivo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-'));
  const s = new Signals(dir);
  s.resetAll();
  assert.equal(s.readK(), 0);
  assert.ok(s.isReset());
  for (let k = 1; k <= 40; k++) {
    const before = new Set(fs.readdirSync(dir));
    const tick = s.exists('t');
    assert.ok(s.advance(k));
    const after = new Set(fs.readdirSync(dir));
    const changedBits = [...new Set([...before, ...after])].filter((f) => f.startsWith('b') && before.has(f) !== after.has(f));
    assert.equal(changedBits.length, 1);
    assert.notEqual(s.exists('t'), tick);
    assert.equal(s.readK(), k);
  }
  s.resetAll();
  assert.equal(s.readK(), 0);
});
