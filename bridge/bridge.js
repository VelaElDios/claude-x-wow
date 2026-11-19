import fs from 'node:fs';
import path from 'node:path';
import { parseSavedVariables, toLua } from './lua.js';
import { addonDir, savedVariablesFiles, loadState, saveState } from './config.js';
import { runClaudeStream } from './claude.js';
import { markdownToWow, describeTool, describeResult, escapeWow } from './format.js';
import { MOD, slotFor } from './signals.js';

export const VERSION = '0.2.0';
const MAX_EVENTS = 400;
const INBOX_EVENTS = 200;
const HEARTBEAT_MS = 15_000;

const defaultLog = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// Divide "A|b|c|resto" en n campos de texto + el resto como Buffer (sin romper UTF-8).
function splitFields(buf, n) {
  const fields = [];
  let start = 0;
  for (let i = 0; i < buf.length && fields.length < n; i++) {
    if (buf[i] === 0x7c) {
      fields.push(buf.subarray(start, i).toString('latin1'));
      start = i + 1;
    }
  }
  if (fields.length < n) {
    fields.push(buf.subarray(start).toString('latin1'));
    start = buf.length;
  }
  return { fields, rest: buf.subarray(start) };
}

export class Bridge {
  constructor(cfg, { runner = runClaudeStream, reader = null, slots = null, signals = null, log = defaultLog, now = Date.now } = {}) {
    this.cfg = cfg;
    this.runner = runner;
    this.reader = reader;
    this.slots = slots;
    this.signals = signals;
    this.k = signals ? signals.readK() : 0;
    this.log = log;
    this.now = now;
    this.state = { events: [], eventSeq: 0, received: [], ...loadState() };
    this.mtimes = new Map();
    this.queue = [];
    this.current = null;
    this.live = null;
    this.timers = [];
    this.dirty = true;
    this.lastInbox = 0;
  }

  // ---------------------------------------------------------------- eventos

  emit(e) {
    e.n = ++this.state.eventSeq;
    this.state.events.push(e);
    if (this.state.events.length > MAX_EVENTS) this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    if (this.live) this.live.pending.push(e);
    this.dirty = true;
  }

  writeInbox() {
    const inbox = {
      version: 2,
      bridge: VERSION,
      updated: Math.floor(this.now() / 1000),
      project: path.basename(this.cfg.projectDir),
      slotPool: this.slots?.size ?? 0,
      busy: !!this.current,
      received: this.state.received.slice(-50),
      events: this.state.events.slice(-INBOX_EVENTS),
    };
    const body = '-- Generado por claude-x-wow. No editar a mano.\nClaudeXWoW_Inbox = ' + toLua(inbox) + '\n';
    const file = path.join(addonDir(this.cfg), 'Inbox.lua');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', body, 'utf8');
    fs.renameSync(file + '.tmp', file);
    saveState(this.state);
    this.lastInbox = this.now();
    this.dirty = false;
  }

  // ---------------------------------------------------------------- entrada

  receive(item) {
    if (!item?.id || this.state.processed.includes(item.id)) return;
    this.state.processed.push(item.id);
    if (this.state.processed.length > 500) this.state.processed.shift();
    this.state.received.push(item.id);
    if (this.state.received.length > 100) this.state.received.shift();
    if (item.type === 'cancel') {
      this.cancel();
      return;
    }
    this.queue.push(item);
    this.dirty = true;
    this.next();
  }

  // Respaldo: mensajes que llegan en las SavedVariables tras un /reload.
  pollSaved() {
    for (const file of savedVariablesFiles(this.cfg)) {
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (this.mtimes.get(file) === stat.mtimeMs) continue;
      this.mtimes.set(file, stat.mtimeMs);
      let db;
      try {
        db = parseSavedVariables(fs.readFileSync(file)).ClaudeXWoWDB;
      } catch (err) {
        this.log('No se pudo leer', file, '-', err.message);
        continue;
      }
      for (const item of db?.outbox ?? []) this.receive(item);
    }
  }

  // Canal en directo: trama leída de la pantalla.
  onFrame(f) {
    if (!this.live || this.live.nonce !== f.nonce) {
      this.live = { nonce: f.nonce, seq: null, ack: null, pending: [], lastWrite: 0, lastAck: 0, parts: new Map() };
      this.log('Juego conectado en directo');
      // f.cursor = el contador que el addon leyó al entrar. Si no coincide, las
      // señales se quedaron a medias al abrir el WoW.
      if (this.signals && f.cursor !== this.k && !this.warnedDesync) {
        this.warnedDesync = true;
        this.log('Aviso: las señales no cuadran con el juego. Cierra el WoW (con el puente abierto) y vuelve a abrirlo.');
      }
    }
    const live = this.live;
    if (f.seq !== live.seq) {
      live.seq = f.seq;
      live.ack = f.seq;
      this.handlePayload(f.payload);
    } else if (live.ack === null && this.now() - live.lastAck > 3000) {
      live.ack = f.seq; // el juego sigue mostrando la trama: reenviamos el acuse
    }
  }

  // El WoW se ha cerrado: dejamos las señales listas para el próximo arranque.
  onGameClosed() {
    this.live = null;
    this.warnedDesync = false;
    if (this.signals && !this.signals.isReset()) {
      if (this.signals.resetAll()) {
        this.k = 0;
        this.log('WoW cerrado: canal preparado para el próximo arranque');
      }
    }
  }

  handlePayload(buf) {
    const type = String.fromCharCode(buf[0]);
    if (type === 'H') {
      const { fields } = splitFields(buf, 2);
      const last = Number(fields[1]) || 0;
      this.live.pending = this.state.events.filter((e) => e.n > last).slice(-150);
      this.live.pending.push({
        k: 'status',
        busy: !!this.current,
        label: this.current ? 'Claude está trabajando' : undefined,
        project: path.basename(this.cfg.projectDir),
      });
    } else if (type === 'P') {
      const { fields, rest } = splitFields(buf, 4);
      const [, id, part, total] = fields;
      let entry = this.live.parts.get(id);
      if (!entry) {
        entry = { total: Number(total), chunks: new Map() };
        this.live.parts.set(id, entry);
      }
      entry.chunks.set(Number(part), Buffer.from(rest));
      if (entry.chunks.size === entry.total) {
        this.live.parts.delete(id);
        const text = Buffer.concat([...entry.chunks.keys()].sort((a, b) => a - b).map((k) => entry.chunks.get(k))).toString('utf8');
        this.receive({ id, type: 'prompt', text });
      }
    } else if (type === 'R') {
      this.receive({ id: splitFields(buf, 2).fields[1], type: 'reset' });
    } else if (type === 'X') {
      this.receive({ id: splitFields(buf, 2).fields[1], type: 'cancel' });
    }
  }

  // ---------------------------------------------------------------- salida en directo

  flushLive() {
    const live = this.live;
    if (!live || !this.slots || !this.signals) return;
    const hasAck = live.ack !== null;
    if (!hasAck && live.pending.length === 0) return;
    const minGap = hasAck ? 400 : Math.max(400, this.cfg.liveIntervalMs ?? 1000);
    if (this.now() - live.lastWrite < minGap) return;
    live.lastWrite = this.now();

    const k = (this.k + 1) % MOD;
    const events = live.pending.slice(0, 200);
    const src = `ClaudeXWoW_OnSlot(${live.nonce}, ${live.ack ?? 0}, ${toLua(events)})\n`;
    // Primero el contenido, luego la señal: el juego solo lo carga cuando ya está escrito.
    if (!this.slots.write(slotFor(k, this.slots.size), src) || !this.signals.advance(k)) {
      if (!live.busyWarned) this.log('Canal ocupado por Windows, reintentando...');
      live.busyWarned = true;
      return;
    }
    this.k = k;
    live.pending.splice(0, events.length);
    if (hasAck) live.lastAck = this.now();
    live.ack = null;
  }

  // ---------------------------------------------------------------- Claude Code

  onClaude(msg) {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return;
    if (msg.type === 'assistant') {
      for (const c of content) {
        if (c.type === 'text' && c.text?.trim()) {
          this.emit({ k: 'text', text: markdownToWow(c.text) });
        } else if (c.type === 'tool_use') {
          const d = describeTool(c.name, c.input, this.cfg.projectDir);
          this.log(`  ● ${c.name}(${d.detail})`);
          this.emit({ k: 'tool', name: d.name, detail: d.detail, label: d.label });
        }
      }
    } else if (msg.type === 'user') {
      for (const c of content) {
        if (c.type === 'tool_result') {
          this.emit({ k: 'result', text: describeResult(c.content, c.is_error), err: !!c.is_error });
        }
      }
    }
  }

  cancel() {
    if (this.current) {
      this.log('Parando la tarea actual');
      this.current.handle.cancel();
    }
  }

  async run(item) {
    const start = this.now();
    const exec = () => {
      const handle = this.runner({
        prompt: String(item.text ?? ''),
        cwd: this.cfg.projectDir,
        sessionId: this.state.sessionId,
        cfg: this.cfg,
        onMessage: (m) => this.onClaude(m),
      });
      this.current = { item, handle };
      return handle.promise;
    };
    let res = await exec();
    if (!res.ok && !res.cancelled && this.state.sessionId && /no conversation found/i.test(res.error || '')) {
      this.emit({ k: 'info', text: 'La sesión anterior ya no existe; empiezo una nueva.' });
      this.state.sessionId = null;
      res = await exec();
    }
    if (res.sessionId) this.state.sessionId = res.sessionId;

    const secs = Math.round((res.durationMs ?? this.now() - start) / 1000);
    if (res.cancelled) {
      this.emit({ k: 'done', id: item.id, summary: `Parado tras ${secs}s` });
    } else if (res.ok) {
      const cost = res.cost ? ` · $${res.cost.toFixed(3)}` : '';
      this.emit({ k: 'done', id: item.id, summary: `Hecho en ${secs}s${cost}` });
      this.log('<< Hecho', `${secs}s${cost}`);
    } else {
      this.emit({ k: 'error', id: item.id, text: escapeWow(res.error) });
      this.log('<< Error:', res.error);
    }
    const denied = [...new Set((res.denials ?? []).map((d) => d.tool_name).filter(Boolean))];
    if (denied.length) {
      this.emit({
        k: 'info',
        text: `Sin permiso para: ${escapeWow(denied.join(', '))}. Puedes permitirlo en allowedTools de ~/.claude-x-wow/config.json`,
      });
    }
  }

  async next() {
    if (this.current || this.busyStarting || this.queue.length === 0) return;
    const item = this.queue.shift();
    if (item.type === 'reset') {
      this.state.sessionId = null;
      this.emit({ k: 'info', text: 'Conversación nueva. La siguiente tarea empieza de cero.' });
      this.log('Conversación reiniciada');
      return this.next();
    }
    const text = String(item.text ?? '');
    this.log('>> Tarea:', text.length > 80 ? text.slice(0, 80) + '…' : text);
    this.busyStarting = true;
    this.emit({ k: 'start', id: item.id });
    try {
      await this.run(item);
    } catch (err) {
      this.emit({ k: 'error', id: item.id, text: escapeWow(err.message) });
    } finally {
      this.current = null;
      this.busyStarting = false;
      this.dirty = true;
    }
    this.next();
  }

  // ---------------------------------------------------------------- bucle

  tick() {
    try {
      this.flushLive();
      if ((this.dirty && this.now() - this.lastInbox > 1000) || this.now() - this.lastInbox > HEARTBEAT_MS) {
        this.writeInbox();
      }
    } catch (err) {
      this.warnOnce(err);
    }
  }

  warnOnce(err) {
    const key = err.code || err.message;
    if (this.lastWarn === key) return;
    this.lastWarn = key;
    this.log('Aviso:', err.message);
  }

  async readLoop() {
    while (!this.stopped) {
      try {
        const frame = await this.reader.read();
        if (frame) this.onFrame(frame);
        if (this.reader.status === 'nowow') {
          this.noWowSince ??= this.now();
          if (this.now() - this.noWowSince > 3000) this.onGameClosed();
        } else {
          this.noWowSince = null;
        }
      } catch (err) {
        this.warnOnce(err);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  start() {
    this.writeInbox();
    this.pollSaved();
    this.timers.push(setInterval(() => {
      try {
        this.pollSaved();
      } catch (err) {
        this.warnOnce(err);
      }
    }, this.cfg.pollMs ?? 1000));
    this.timers.push(setInterval(() => this.tick(), 100));
    if (this.reader?.available) {
      this.reader.start();
      this.readLoop();
    }
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    this.reader?.stop();
    this.cancel();
  }
}
