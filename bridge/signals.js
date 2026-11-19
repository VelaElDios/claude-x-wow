import fs from 'node:fs';
import path from 'node:path';

// Señales PC -> juego por existencia de archivos.
//
// Lo que hemos medido en el cliente:
//  - PlaySoundFile(ruta) devuelve true si el archivo existía al arrancar el
//    WoW y sigue existiendo; nil si se ha borrado (o no existía al arrancar).
//  - Los archivos vacíos (0 bytes) no se cachean: borrar/recrear se nota en caliente.
//  - Los wav válidos que llegan a sonar se quedan en caché (no sirven de señal).
//
// Por eso: todos los archivos de señal son de 0 bytes y deben EXISTIR cuando
// arranca el WoW (el puente los restaura cuando el juego no está abierto).
// Un contador K de 10 bits en código Gray (bit=1 <=> archivo borrado) dice
// cuántos lotes ha publicado el puente; "t.wav" cambia en cada publicación
// para que el addon solo tenga que leer un archivo en cada sondeo.

export const BITS = 10;
export const MOD = 1 << BITS;
const EMPTY = Buffer.alloc(0);

export const toGray = (n) => n ^ (n >> 1);
export function fromGray(g) {
  let n = g;
  for (let s = g >> 1; s > 0; s >>= 1) n ^= s;
  return n;
}

// Ranura (1..pool) que corresponde al lote número k.
export const slotFor = (k, pool) => (((k === 0 ? MOD : k) - 1) % pool) + 1;

export class Signals {
  constructor(dir) {
    this.dir = dir;
  }

  file(name) {
    return path.join(this.dir, `${name}.wav`);
  }

  exists(name) {
    return fs.existsSync(this.file(name));
  }

  set(name, present) {
    const f = this.file(name);
    try {
      if (present) fs.writeFileSync(f, EMPTY);
      else fs.rmSync(f, { force: true });
      return true;
    } catch (err) {
      if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) return false;
      throw err;
    }
  }

  // Estado de arranque: todo presente (K = 0). Hacerlo con el WoW cerrado.
  resetAll() {
    fs.mkdirSync(this.dir, { recursive: true });
    let ok = this.set('on', true) && this.set('t', true);
    for (let b = 0; b < BITS; b++) ok = this.set(`b${b}`, true) && ok;
    return ok;
  }

  // Lee K de los archivos (para continuar donde se quedó).
  readK() {
    let g = 0;
    for (let b = 0; b < BITS; b++) if (!this.exists(`b${b}`)) g |= 1 << b;
    return fromGray(g);
  }

  isReset() {
    return this.readK() === 0 && this.exists('t') && this.exists('on');
  }

  // Pasa de k-1 a k (en Gray solo cambia un bit) y conmuta el tic.
  advance(k) {
    const prev = toGray((k - 1 + MOD) % MOD);
    const next = toGray(k);
    const diff = prev ^ next;
    for (let b = 0; b < BITS; b++) {
      if (diff & (1 << b) && !this.set(`b${b}`, !(next & (1 << b)))) return false;
    }
    this.set('t', !this.exists('t'));
    return true;
  }
}
