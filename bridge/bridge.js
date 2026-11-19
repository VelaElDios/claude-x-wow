import fs from 'node:fs';
import path from 'node:path';
import { parseSavedVariables, toLua } from './lua.js';
import { addonDir, savedVariablesFiles, loadState, saveState } from './config.js';
import { runClaude } from './claude.js';

const VERSION = '0.1.0';
const MAX_MESSAGES = 30; // respuestas que se guardan en Inbox.lua
const MAX_PROCESSED = 500;
const HEARTBEAT_MS = 15_000;

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

export class Bridge {
  constructor(cfg, { runner = runClaude } = {}) {
    this.cfg = cfg;
    this.runner = runner;
    this.state = loadState();
    this.mtimes = new Map();
    this.queue = [];
    this.busy = null;
    this.timers = [];
  }

  inboxPath() {
    return path.join(addonDir(this.cfg), 'Inbox.lua');
  }

  writeInbox() {
    const inbox = {
      version: 1,
      bridge: VERSION,
      updated: Math.floor(Date.now() / 1000),
      project: path.basename(this.cfg.projectDir),
      busy: this.busy,
      messages: this.state.messages,
    };
    const body = '-- Generado por claude-x-wow. No editar a mano.\nClaudeXWoW_Inbox = ' + toLua(inbox) + '\n';
    const file = this.inboxPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
  }

  setMessage(id, fields) {
    const msgs = this.state.messages;
    let m = msgs.find((x) => x.id === id);
    if (!m) {
      m = { id };
      msgs.push(m);
    }
    Object.assign(m, fields, { t: Math.floor(Date.now() / 1000) });
    while (msgs.length > MAX_MESSAGES) msgs.shift();
  }

  persist() {
    saveState(this.state);
    this.writeInbox();
  }

  // Lee las SavedVariables de cada cuenta y encola mensajes nuevos.
  poll() {
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
        log('No se pudo leer', file, '-', err.message);
        continue;
      }
      for (const item of db?.outbox ?? []) {
        if (!item?.id || this.state.processed.includes(item.id)) continue;
        if (this.queue.some((q) => q.id === item.id)) continue;
        this.state.processed.push(item.id);
        if (this.state.processed.length > MAX_PROCESSED) this.state.processed.shift();
        this.queue.push(item);
        this.setMessage(item.id, { status: 'queued' });
      }
      this.persist();
    }
    this.next();
  }

  async next() {
    if (this.busy || this.queue.length === 0) return;
    const item = this.queue.shift();
    this.busy = item.id;

    if (item.type === 'reset') {
      this.state.sessionId = null;
      this.setMessage(item.id, { status: 'done', text: 'Conversación nueva. La siguiente tarea empieza de cero.' });
      log('Conversación reiniciada');
      this.busy = null;
      this.persist();
      return this.next();
    }

    const text = String(item.text ?? '');
    log('>> Tarea:', text.length > 80 ? text.slice(0, 80) + '…' : text);
    this.setMessage(item.id, { status: 'working' });
    this.persist();

    const res = await this.runner({
      prompt: text,
      cwd: this.cfg.projectDir,
      sessionId: this.state.sessionId,
      cfg: this.cfg,
    });

    if (res.sessionId) this.state.sessionId = res.sessionId;
    let reply = res.ok ? res.text : res.error;
    if (reply.length > this.cfg.maxReplyChars) {
      reply = reply.slice(0, this.cfg.maxReplyChars) + '\n\n[...respuesta recortada; mírala completa en la terminal]';
    }
    if (res.newSession) reply = '(La sesión anterior no existía; he empezado una nueva.)\n\n' + reply;
    this.setMessage(item.id, { status: res.ok ? 'done' : 'error', text: reply });
    log(res.ok ? '<< Respuesta lista' : '<< Error', res.cost ? `($${res.cost.toFixed(4)})` : '');
    if (!res.ok) log(res.error);

    this.busy = null;
    this.persist();
    this.next();
  }

  start() {
    this.writeInbox();
    this.poll();
    this.timers.push(setInterval(() => this.poll(), this.cfg.pollMs));
    this.timers.push(setInterval(() => this.writeInbox(), HEARTBEAT_MS));
  }

  stop() {
    this.timers.forEach(clearInterval);
  }
}
