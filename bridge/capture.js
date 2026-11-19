import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { COLS, ROWS, decodeImage } from './protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Lee la tira de píxeles del juego. Solo Windows (usa PowerShell + System.Drawing).
export class PixelReader {
  constructor({ maxBlock = 8, log = console.log } = {}) {
    this.width = COLS * maxBlock + 16;
    this.height = ROWS * maxBlock + 16;
    this.log = log;
    this.proc = null;
    this.waiting = null;
    this.failed = false;
  }

  get available() {
    return process.platform === 'win32' && !this.failed;
  }

  start() {
    if (!this.available) return;
    this.proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'capture.ps1')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      const w = this.waiting;
      this.waiting = null;
      w?.(line);
    });
    let errText = '';
    this.proc.stderr.on('data', (d) => (errText += d));
    this.proc.on('exit', (code) => {
      if (code) this.log('El lector de píxeles se cerró:', errText.trim().slice(0, 300));
      this.failed = true;
      this.waiting?.('ERR closed');
    });
    this.proc.on('error', (e) => {
      this.failed = true;
      this.log('No se pudo arrancar PowerShell para leer la pantalla:', e.message);
    });
  }

  // Devuelve la trama visible o null.
  read() {
    if (!this.proc || this.failed || this.waiting) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        resolve(null);
      }, 3000);
      this.waiting = (line) => {
        clearTimeout(timer);
        this.status = line === 'NOWOW' ? 'nowow' : line.startsWith('OK ') ? 'ok' : 'other';
        if (!line.startsWith('OK ')) return resolve(null);
        const [, w, h, b64] = line.split(' ');
        try {
          resolve(decodeImage({ width: +w, height: +h, data: Buffer.from(b64, 'base64'), order: 'bgra' }));
        } catch {
          resolve(null);
        }
      };
      this.proc.stdin.write(`cap ${this.width} ${this.height}\n`);
    });
  }

  stop() {
    this.proc?.kill();
  }
}
