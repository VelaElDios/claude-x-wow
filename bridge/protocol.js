// Protocolo de la tira de píxeles (juego -> PC). Debe coincidir con addon/ClaudeXWoW/Pixel.lua
//
// Rejilla de COLS x ROWS bloques en la esquina superior izquierda del cliente.
//   Fila 0     : bloques blanco/negro alternos (permite medir el tamaño real del bloque)
//   Fila 1 c0-3: negro, gris1, gris2, blanco (calibración de niveles)
//   Resto      : símbolos de 6 bits (2 bits por canal R,G,B; niveles 0,85,170,255)
// Bytes -> símbolos: cada 3 bytes son 4 símbolos (big-endian, como base64).
// Trama: ver(1) nonce(2) seq(2) cursor(2) len(2) payload(len) fletcher16(2)

export const COLS = 64;
export const ROWS = 12;
export const DATA_START = COLS + 4;
export const SYMBOLS = COLS * ROWS - DATA_START; // 700
export const MAX_BYTES = Math.floor((SYMBOLS * 6) / 8); // 525
export const HEADER = 9;
export const MAX_PAYLOAD = MAX_BYTES - HEADER - 2; // 514
export const VERSION = 1;
export const LEVELS = [0, 85, 170, 255];

export function fletcher16(bytes) {
  let s1 = 0;
  let s2 = 0;
  for (const b of bytes) {
    s1 = (s1 + b) % 255;
    s2 = (s2 + s1) % 255;
  }
  return s2 * 256 + s1;
}

export function buildFrame({ nonce, seq, cursor, payload }) {
  const p = Buffer.from(payload);
  if (p.length > MAX_PAYLOAD) throw new Error('payload demasiado grande');
  const body = Buffer.from([
    VERSION, nonce >> 8, nonce & 255, seq >> 8, seq & 255, cursor >> 8, cursor & 255, p.length >> 8, p.length & 255,
    ...p,
  ]);
  const c = fletcher16(body);
  return Buffer.concat([body, Buffer.from([c >> 8, c & 255])]);
}

export function bytesToSymbols(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out.push((n >> 18) & 63, (n >> 12) & 63, (n >> 6) & 63, n & 63);
  }
  return out;
}

export function symbolsToBytes(symbols) {
  const out = [];
  for (let i = 0; i + 3 < symbols.length; i += 4) {
    const n = (symbols[i] << 18) | (symbols[i + 1] << 12) | (symbols[i + 2] << 6) | symbols[i + 3];
    out.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  return Buffer.from(out);
}

export function parseFrame(bytes) {
  if (bytes[0] !== VERSION) return null;
  const len = (bytes[7] << 8) | bytes[8];
  if (len > MAX_PAYLOAD) return null;
  const body = bytes.subarray(0, HEADER + len);
  const sum = (bytes[HEADER + len] << 8) | bytes[HEADER + len + 1];
  if (fletcher16(body) !== sum) return null;
  return {
    nonce: (bytes[1] << 8) | bytes[2],
    seq: (bytes[3] << 8) | bytes[4],
    cursor: (bytes[5] << 8) | bytes[6],
    payload: Buffer.from(bytes.subarray(HEADER, HEADER + len)),
  };
}

// Colores (RGB) de cada bloque de la rejilla para una trama. Útil para tests.
export function frameColors(frameBytes) {
  const colors = [];
  for (let c = 0; c < COLS; c++) colors.push(c % 2 === 0 ? [255, 255, 255] : [0, 0, 0]);
  colors.push([0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]);
  const syms = bytesToSymbols(frameBytes);
  for (let i = 0; i < SYMBOLS; i++) {
    const s = syms[i] ?? 0;
    colors.push([LEVELS[(s >> 4) & 3], LEVELS[(s >> 2) & 3], LEVELS[s & 3]]);
  }
  return colors;
}

// Decodifica una captura. img = { width, height, data, order: 'bgra' | 'rgba' }
export function decodeImage(img) {
  const { width, height, data } = img;
  const bgra = img.order !== 'rgba';
  const px = (x, y) => {
    x = Math.min(width - 1, Math.max(0, Math.round(x)));
    y = Math.min(height - 1, Math.max(0, Math.round(y)));
    const o = (y * width + x) * 4;
    return bgra ? [data[o + 2], data[o + 1], data[o]] : [data[o], data[o + 1], data[o + 2]];
  };
  const lum = (x, y) => {
    const [r, g, b] = px(x, y);
    return (r + g + b) / 3;
  };

  // 1) Buscar la fila de sincronía y medir el tamaño de bloque.
  let pitch = null;
  for (let y = 0; y < Math.min(height, 16) && pitch === null; y++) {
    if (lum(0, y) < 128) continue;
    const edges = [];
    let bright = true;
    for (let x = 1; x < width && edges.length < COLS - 1; x++) {
      const b = lum(x, y) >= 128;
      if (b !== bright) {
        edges.push(x);
        bright = b;
      }
    }
    if (edges.length < COLS - 1) continue;
    let num = 0;
    let den = 0;
    edges.forEach((e, k) => {
      num += (k + 1) * e;
      den += (k + 1) * (k + 1);
    });
    const p = num / den;
    if (p < 1.5 || p > 32) continue;
    if (edges.every((e, k) => Math.abs(e - (k + 1) * p) < p / 3)) pitch = p;
  }
  if (pitch === null) return null;

  const center = (i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return [(col + 0.5) * pitch - 0.5, (row + 0.5) * pitch - 0.5];
  };
  const sample = (i) => px(...center(i));

  // 2) Calibración.
  const cal = [0, 1, 2, 3].map((k) => sample(COLS + k));
  const thresholds = [0, 1, 2].map((ch) => [
    (cal[0][ch] + cal[1][ch]) / 2,
    (cal[1][ch] + cal[2][ch]) / 2,
    (cal[2][ch] + cal[3][ch]) / 2,
  ]);
  if (cal[3][0] - cal[0][0] < 100) return null;
  const level = (v, ch) => {
    const t = thresholds[ch];
    return v < t[0] ? 0 : v < t[1] ? 1 : v < t[2] ? 2 : 3;
  };

  // 3) Símbolos -> bytes -> trama.
  const needed = Math.min(SYMBOLS, Math.ceil(((HEADER + 2) * 8) / 6 / 4) * 4);
  const readSymbols = (count) => {
    const syms = [];
    for (let i = 0; i < count; i++) {
      const [r, g, b] = sample(DATA_START + i);
      syms.push((level(r, 0) << 4) | (level(g, 1) << 2) | level(b, 2));
    }
    return syms;
  };
  // Leemos la cabecera primero para saber cuánto leer.
  const head = symbolsToBytes(readSymbols(needed + 4));
  if (head[0] !== VERSION) return null;
  const len = (head[7] << 8) | head[8];
  if (len > MAX_PAYLOAD) return null;
  const total = HEADER + len + 2;
  const count = Math.min(SYMBOLS, Math.ceil(total / 3) * 4);
  const frame = parseFrame(symbolsToBytes(readSymbols(count)));
  if (frame) frame.pitch = pitch;
  return frame;
}
