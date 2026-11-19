import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToWow } from '../bridge/format.js';

// Texto visible (sin códigos de color de WoW).
const visible = (s) => s.replace(/\|c[0-9a-f]{8}/g, '').replace(/\|r/g, '').replace(/\|\|/g, '|');

test('las tablas Markdown salen como columnas alineadas', () => {
  const md = [
    'Comparación:',
    '| Aspecto | Semáforo | Monitor |',
    '|---|:---:|---|',
    '| Nivel | Bajo (primitiva del SO) | Alto |',
    '| Ejemplos | `Semaphore` | **synchronized** |',
    '',
    'Fin',
  ].join('\n');
  const lines = visible(markdownToWow(md)).split('\n');
  assert.equal(lines[0], 'Comparación:');
  const table = lines.slice(1, 5);
  assert.match(table[0], /^Aspecto\s+│ Semáforo\s+│ Monitor/);
  assert.match(table[1], /^─+┼─+┼─+$/);
  // Todas las filas tienen el separador en la misma columna.
  const pos = table.filter((l) => l.includes('│')).map((l) => l.indexOf('│'));
  assert.ok(pos.every((p) => p === pos[0]), JSON.stringify(table));
  assert.ok(table[3].includes('Semaphore') && !table[3].includes('`'));
  assert.equal(lines.at(-1), 'Fin');
});

test('tablas muy anchas se recortan con …', () => {
  const md = ['| a | b |', '|---|---|', `| ${'x'.repeat(200)} | y |`].join('\n');
  const lines = visible(markdownToWow(md)).split('\n');
  assert.ok(lines.every((l) => l.length <= 112));
  assert.match(lines[2], /…/);
});

test('el resto del Markdown no cambia', () => {
  const out = markdownToWow('# Título\n- uno **dos**\n`a|b`');
  assert.match(out, /\|cffd97757Título\|r/);
  assert.match(out, /• uno \|cffffffffdos\|r/);
  assert.match(out, /a\|\|b/);
});
