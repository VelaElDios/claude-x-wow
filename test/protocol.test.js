import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, MAX_PAYLOAD, buildFrame, decodeImage, frameColors } from '../bridge/protocol.js';

// Pinta la rejilla como lo haría el juego, con un tamaño de bloque real `pitch`
// (puede ser fraccionario), ruido y una curva de gamma opcional.
function render(frameBytes, { pitch = 4, noise = 0, gamma = 1, extraW = 40, extraH = 20, order = 'bgra' } = {}) {
  const colors = frameColors(frameBytes);
  const width = Math.ceil(COLS * pitch) + extraW;
  const height = Math.ceil(ROWS * pitch) + extraH;
  const data = Buffer.alloc(width * height * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const col = Math.floor((x + 0.5) / pitch);
      const row = Math.floor((y + 0.5) / pitch);
      let rgb = col < COLS && row < ROWS ? colors[row * COLS + col] : [40, 90, 30]; // fondo: escena del juego
      rgb = rgb.map((v) => Math.max(0, Math.min(255, Math.round(255 * Math.pow(v / 255, gamma) + noise * rnd()))));
      const o = (y * width + x) * 4;
      if (order === 'bgra') [data[o + 2], data[o + 1], data[o]] = rgb;
      else [data[o], data[o + 1], data[o + 2]] = rgb;
      data[o + 3] = 255;
    }
  }
  return { width, height, data, order };
}

const payload = 'P|1795000000-3|1|1|' + 'arregla la noria y añade tests ✓ '.repeat(10);

for (const opts of [
  { pitch: 4 },
  { pitch: 3 },
  { pitch: 4.27 },
  { pitch: 5.5, noise: 18 },
  { pitch: 4, gamma: 0.8, noise: 10 },
  { pitch: 4, order: 'rgba' },
]) {
  test(`decodifica trama ${JSON.stringify(opts)}`, () => {
    const bytes = buildFrame({ nonce: 4242, seq: 77, cursor: 13, payload });
    const frame = decodeImage(render(bytes, opts));
    assert.ok(frame, 'no se pudo decodificar');
    assert.equal(frame.nonce, 4242);
    assert.equal(frame.seq, 77);
    assert.equal(frame.cursor, 13);
    assert.equal(frame.payload.toString('utf8'), payload);
  });
}

test('trama de tamaño máximo', () => {
  const big = 'x'.repeat(MAX_PAYLOAD);
  const frame = decodeImage(render(buildFrame({ nonce: 1, seq: 2, cursor: 3, payload: big })));
  assert.equal(frame.payload.toString(), big);
});

test('sin tira o tira corrupta devuelve null', () => {
  const img = render(buildFrame({ nonce: 1, seq: 1, cursor: 1, payload: 'hola' }));
  const blank = { ...img, data: Buffer.alloc(img.data.length, 30) };
  assert.equal(decodeImage(blank), null);
  // Corrompemos un bloque de datos.
  const bad = Buffer.from(img.data);
  for (let y = 4 * 1; y < 4 * 2; y++) for (let x = 4 * 10; x < 4 * 11; x++) bad[(y * img.width + x) * 4 + 1] ^= 0xff;
  assert.equal(decodeImage({ ...img, data: bad }), null);
});
