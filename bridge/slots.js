import fs from 'node:fs';
import path from 'node:path';

export const SLOT_PREFIX = 'ClaudeXWoW_S';

// WAV PCM 16 bits mono, 22050 Hz, 50 ms de silencio.
export function silentWav(ms = 50) {
  const rate = 22050;
  const samples = Math.floor((rate * ms) / 1000);
  const dataLen = samples * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + dataLen, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(dataLen, 40);
  return b;
}


export const slotName = (i) => `${SLOT_PREFIX}${String(i).padStart(3, '0')}`;

export class SlotPool {
  constructor(addonsDir, size, interfaceVersion) {
    this.addonsDir = addonsDir;
    this.size = size;
    this.interfaceVersion = interfaceVersion;
  }

  dir(i) {
    return path.join(this.addonsDir, slotName(i));
  }

  tocText(i) {
    return [
      `## Interface: ${this.interfaceVersion}`,
      `## Title: |cff7f7f7fClaude x WoW - canal ${String(i).padStart(3, '0')}|r`,
      '## Notes: Canal interno de Claude x WoW. Déjalo activado.',
      '## LoadOnDemand: 1',
      '## Dependencies: ClaudeXWoW',
      '',
      'Data.lua',
      '',
    ].join('\n');
  }

  // Crea las ranuras que falten (o actualiza su .toc). Devuelve cuántas ha
  // tocado: si es > 0 hay que reiniciar el WoW para que las detecte.
  ensure() {
    let changed = 0;
    for (let i = 1; i <= this.size; i++) {
      const d = this.dir(i);
      const toc = path.join(d, `${slotName(i)}.toc`);
      const text = this.tocText(i);
      let current = null;
      try {
        current = fs.readFileSync(toc, 'utf8');
      } catch {
        // no existe
      }
      if (current === text) continue;
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(toc, text);
      if (!fs.existsSync(path.join(d, 'Data.lua'))) fs.writeFileSync(path.join(d, 'Data.lua'), '-- vacío\n');
      changed++;
    }
    return changed;
  }

  installed() {
    let n = 0;
    while (n < 2000 && fs.existsSync(path.join(this.dir(n + 1), 'Data.lua'))) n++;
    return n;
  }

  // Escribe el contenido de una ranura. false = archivo bloqueado, reintentar.
  write(i, luaSource) {
    return tryWrite(path.join(this.dir(i), 'Data.lua'), Buffer.from(luaSource, 'utf8'));
  }
}

function tryWrite(file, data) {
  try {
    fs.writeFileSync(file, data);
    return true;
  } catch (err) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) return false;
    throw err;
  }
}
