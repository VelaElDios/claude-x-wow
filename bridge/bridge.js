import fs from 'node:fs';
import { saveConfig } from './config.js';
import path from 'node:path';
import { parseSavedVariables, toLua } from './lua.js';
import { addonDir, savedVariablesFiles, loadState, saveState } from './config.js';
import { runClaudeStream } from './claude.js';
import { markdownToWow, describeTool, describeResult, escapeWow } from './format.js';
import { MOD, slotFor } from './signals.js';
import { PROMPT_TOOL, ruleLabel } from './permissions.js';
import { Follower, isPrompt, listSessions, tailEntries, timeAgo } from './sessions.js';

const LINK = (cmd, n, label) => `|Haddon:cxw:cmd:${cmd}:${n}|h|cff9cdcfe[${label}]|r|h`;

export const MODES = { editar: 'acceptEdits', preguntar: 'default', plan: 'plan' };
const MODE_NAME = Object.fromEntries(Object.entries(MODES).map(([k, v]) => [v, k]));
export const MODELS = ['defecto', 'sonnet', 'opus', 'haiku'];

export const VERSION = '0.4.0';
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
  constructor(cfg, { runner = runClaudeStream, reader = null, slots = null, signals = null, permissions = null, log = defaultLog, now = Date.now } = {}) {
    this.cfg = cfg;
    this.runner = runner;
    this.reader = reader;
    this.slots = slots;
    this.signals = signals;
    this.permissions = permissions;
    if (permissions) {
      permissions.onAsk = ({ id, toolName, input, rule }) => {
        const d = describeTool(toolName, input, this.cfg.projectDir);
        this.log(`  ? Permiso para ${toolName}(${d.detail}): responde en el juego`);
        this.emit({ k: 'ask', id, name: d.name, detail: d.detail, rule: escapeWow(ruleLabel(rule)) });
      };
      permissions.onResolved = ({ id, decision, rule }) => {
        this.emit({ k: 'answered', id, decision, rule: escapeWow(ruleLabel(rule)) });
      };
      permissions.onPersist = (allowed) => {
        this.cfg.allowedTools = [...new Set([...(this.cfg.allowedTools ?? []), allowed])];
        this.saveCfg();
        this.log(`Permiso guardado para siempre: ${allowed}`);
      };
    }
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
        ...this.statusEvent(),
        busy: !!this.current,
        label: this.current ? 'Claude está trabajando' : undefined,
        asks: this.permissions ? [...this.permissions.pending.keys()] : [],
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
    } else if (type === 'C') {
      const { rest } = splitFields(buf, 2);
      this.command(rest.toString('utf8'));
    } else if (type === 'A') {
      const [, reqId, decision] = splitFields(buf, 3).fields;
      this.permissions?.answer(reqId, decision);
    }
  }

  // ---------------------------------------------------------------- salida en directo

  flushLive() {
    const live = this.live;
    if (!live || !this.slots || !this.signals) return;
    const hasAck = live.ack !== null;
    if (!hasAck && live.pending.length === 0) return;
    if (this.now() - live.lastWrite < (hasAck ? 400 : this.liveInterval())) return;
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
    live.used = (live.used ?? 0) + 1;
    live.pending.splice(0, events.length);
    if (hasAck) live.lastAck = this.now();
    live.ack = null;
  }

  // Cada lote gasta un canal. Cuantos más llevamos gastados en esta sesión del
  // juego, más agrupamos los eventos para que el canal dure más.
  liveInterval() {
    const base = Math.max(400, this.cfg.liveIntervalMs ?? 1000);
    const used = (this.live?.used ?? 0) / Math.max(1, this.slots?.size ?? 1);
    if (used < 0.5) return base;
    if (used < 0.8) return base * 2;
    return base * 4;
  }

  // ---------------------------------------------------------------- Claude Code

  onClaude(msg, { quiet = false } = {}) {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return;
    if (msg.type === 'assistant') {
      for (const c of content) {
        if (c.type === 'text' && c.text?.trim()) {
          this.emit({ k: 'text', text: markdownToWow(c.text), ro: quiet || undefined });
        } else if (c.type === 'tool_use') {
          const d = describeTool(c.name, c.input, this.cfg.projectDir);
          if (!quiet) this.log(`  ● ${c.name}(${d.detail})`);
          this.emit({ k: 'tool', name: d.name, detail: d.detail, label: d.label, ro: quiet || undefined });
        }
      }
    } else if (msg.type === 'user') {
      for (const c of content) {
        if (c.type === 'tool_result') {
          this.emit({ k: 'result', text: describeResult(c.content, c.is_error), err: !!c.is_error, ro: quiet || undefined });
        }
      }
    }
  }

  // ---------------------------------------------------------------- sesiones de la terminal

  saveCfg() {
    try {
      saveConfig(this.cfg);
    } catch (err) {
      this.warnOnce(err);
    }
  }

  // Estado que se muestra en la barra de la terminal.
  statusEvent() {
    return {
      k: 'status',
      project: path.basename(this.cfg.projectDir),
      model: this.cfg.model || 'defecto',
      mode: MODE_NAME[this.cfg.permissionMode] ?? this.cfg.permissionMode,
    };
  }

  // Carpetas hermanas del proyecto actual (y las que ya se hayan usado).
  projectCandidates() {
    const parent = path.dirname(this.cfg.projectDir);
    let dirs = [];
    try {
      dirs = fs
        .readdirSync(parent, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => path.join(parent, d.name));
    } catch {
      // sin permisos
    }
    const all = [...new Set([...(this.cfg.projects ?? []), ...dirs])].filter((d) => fs.existsSync(d));
    return all.sort((a, b) => path.basename(a).localeCompare(path.basename(b))).slice(0, 20);
  }

  switchProject(dir) {
    const sessions = (this.state.sessionsByProject ??= {});
    sessions[this.cfg.projectDir] = this.state.sessionId;
    this.cfg.projectDir = dir;
    this.cfg.projects = [...new Set([...(this.cfg.projects ?? []), dir])];
    this.state.sessionId = sessions[dir] ?? null;
    this.follow = null;
    this.lastList = null;
    this.saveCfg();
    this.dirty = true;
    this.log(`Proyecto: ${dir}`);
  }

  pickSession(arg) {
    const n = Number(arg) || 1;
    const list = this.lastList ?? listSessions(this.cfg.projectDir);
    return list[n - 1] ?? null;
  }

  renderEntry(e) {
    if (!e || e.isSidechain || e.isMeta) return;
    if (isPrompt(e)) {
      this.emit({ k: 'prompt', text: escapeWow(e.message.content) });
    } else if (e.type === 'assistant' || (e.type === 'user' && Array.isArray(e.message?.content))) {
      this.onClaude({ type: e.type, message: e.message }, { quiet: true });
    }
  }

  command(text) {
    const [name = '', arg] = text.trim().toLowerCase().split(/\s+/);
    const project = path.basename(this.cfg.projectDir);
    const info = (t) => this.emit({ k: 'info', text: t });
    if (name === 'sesiones') {
      const list = listSessions(this.cfg.projectDir);
      this.lastList = list;
      if (list.length === 0) return info(`No hay sesiones de Claude Code guardadas para ~/${escapeWow(project)}.`);
      const lines = [`|cffd97757Sesiones de Claude Code en ~/${escapeWow(project)}|r`];
      list.forEach((s, i) => {
        const tags = [timeAgo(this.now() - s.mtime), s.active && 'activa', s.id === this.state.sessionId && 'la del juego']
          .filter(Boolean)
          .join(' · ');
        const title = s.title.replace(/\s+/g, ' ').slice(0, 60);
        lines.push(`${i + 1}. ${escapeWow(title)} |cff8a8a8a(${tags})|r  ${LINK('ver', i + 1, 'ver')} ${LINK('usar', i + 1, 'usar')}`);
      });
      lines.push('|cff8a8a8a/ver N para seguirla en directo · /usar N para continuarla desde el juego|r');
      return this.emit({ k: 'block', text: lines.join('\n') });
    }
    if (name === 'ver') {
      const s = this.pickSession(arg);
      if (!s) return info('Esa sesión no existe. Usa /sesiones para ver la lista.');
      const { entries } = tailEntries(s.file);
      this.emit({ k: 'block', text: `|cffd97757── ${escapeWow(s.title.slice(0, 60))} ──|r\n|cff8a8a8aSesión de la terminal, solo lectura. Últimos mensajes:|r` });
      const shown = entries.filter((e) => isPrompt(e) || e.type === 'assistant' || (e.type === 'user' && Array.isArray(e.message?.content)));
      shown.slice(-15).forEach((e) => this.renderEntry(e));
      this.follow = { id: s.id, follower: new Follower(s.file), lastPoll: 0 };
      this.log(`Siguiendo la sesión ${s.id.slice(0, 8)} de la terminal`);
      return info('Siguiendo en directo. /dejar para parar · /usar ' + (Number(arg) || 1) + ' para continuarla desde aquí.');
    }
    if (name === 'dejar') {
      this.follow = null;
      return info('Has dejado de seguir la sesión de la terminal.');
    }
    if (name === 'usar') {
      const s = this.pickSession(arg);
      if (!s) return info('Esa sesión no existe. Usa /sesiones para ver la lista.');
      if (this.current) return info('Espera a que termine la tarea actual (o usa /stop).');
      this.state.sessionId = s.id;
      this.dirty = true;
      const warn = s.active ? ' Parece abierta en tu terminal: no escribas en las dos a la vez.' : '';
      return info(`Las próximas tareas continúan "${escapeWow(s.title.slice(0, 50))}".${warn}`);
    }
    if (name === 'proyecto') {
      const list = this.projectCandidates();
      if (!arg) {
        const lines = [`|cffd97757Proyectos|r |cff8a8a8a(actual: ~/${escapeWow(project)})|r`];
        list.forEach((d, i) => {
          const mark = d === this.cfg.projectDir ? ' |cff6fcf73← actual|r' : `  ${LINK('proyecto', i + 1, 'usar')}`;
          lines.push(`${i + 1}. ${escapeWow(path.basename(d))}${mark}`);
        });
        lines.push('|cff8a8a8a/proyecto N o /proyecto nombre para cambiar|r');
        return this.emit({ k: 'block', text: lines.join('\n') });
      }
      if (this.current) return info('Espera a que termine la tarea actual (o usa /stop).');
      const target = list[Number(arg) - 1] ?? list.find((d) => path.basename(d).toLowerCase() === arg);
      if (!target) return info(`No encuentro el proyecto "${escapeWow(arg)}". Usa /proyecto para ver la lista.`);
      this.switchProject(target);
      this.emit(this.statusEvent());
      return info(`Ahora trabajas en ~/${escapeWow(path.basename(target))}.` + (this.state.sessionId ? ' Sigues la conversación que tenías allí.' : ''));
    }
    if (name === 'modelo') {
      if (!arg) {
        const links = MODELS.map((m) => LINK('modelo', m, m)).join(' ');
        return this.emit({ k: 'block', text: `|cffd97757Modelo|r: ${escapeWow(this.cfg.model || 'defecto')}\n${links}` });
      }
      if (!MODELS.includes(arg)) return info(`Modelos: ${MODELS.join(', ')}.`);
      this.cfg.model = arg === 'defecto' ? null : arg;
      this.saveCfg();
      this.emit(this.statusEvent());
      return info(`Modelo: ${arg}. Se usa desde la siguiente tarea.`);
    }
    if (name === 'modo') {
      if (!arg) {
        const links = Object.keys(MODES).map((m) => LINK('modo', m, m)).join(' ');
        return this.emit({
          k: 'block',
          text: [
            `|cffd97757Modo|r: ${MODE_NAME[this.cfg.permissionMode] ?? this.cfg.permissionMode}`,
            '|cff8a8a8aeditar: edita archivos sin preguntar · preguntar: te pregunta también las ediciones · plan: solo planifica, no toca nada|r',
            links,
          ].join('\n'),
        });
      }
      if (!MODES[arg]) return info(`Modos: ${Object.keys(MODES).join(', ')}.`);
      this.cfg.permissionMode = MODES[arg];
      this.saveCfg();
      this.emit(this.statusEvent());
      return info(`Modo: ${arg}. Se usa desde la siguiente tarea.`);
    }
    if (name === 'permisos') {
      const saved = this.cfg.allowedTools ?? [];
      const session = [...(this.permissions?.always ?? [])].map(ruleLabel);
      const lines = ['|cffd97757Permisos guardados|r'];
      if (saved.length === 0) lines.push('|cff8a8a8a(ninguno)|r');
      saved.forEach((r, i) => lines.push(`${i + 1}. ${escapeWow(r)}  ${LINK('olvidar', i + 1, 'olvidar')}`));
      if (session.length) lines.push(`|cff8a8a8aSolo esta sesión del puente: ${escapeWow(session.join(', '))}|r`);
      return this.emit({ k: 'block', text: lines.join('\n') });
    }
    if (name === 'olvidar') {
      const saved = this.cfg.allowedTools ?? [];
      const i = Number(arg) - 1;
      if (!saved[i]) return info('Ese permiso no existe. Usa /permisos para ver la lista.');
      const [removed] = saved.splice(i, 1);
      this.permissions?.forget(removed);
      this.saveCfg();
      return info(`Permiso olvidado: ${escapeWow(removed)}. Se aplica desde la siguiente tarea.`);
    }
    return info('Comandos: /sesiones, /ver N, /usar N, /dejar, /proyecto, /modelo, /modo, /permisos.');
  }

  pollFollow() {
    const f = this.follow;
    if (!f || this.now() - f.lastPoll < 1000) return;
    f.lastPoll = this.now();
    const entries = f.follower.poll();
    // Si es la sesión que está ejecutando el propio puente, ya la vemos en directo.
    if (this.current && f.id === this.state.sessionId) return;
    entries.forEach((e) => this.renderEntry(e));
  }

  cancel() {
    this.permissions?.cancelAll();
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
        permissions: this.permissions ? { configPath: this.permissions.configPath, tool: PROMPT_TOOL } : null,
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
      this.pollFollow();
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
    this.permissions?.stop();
  }
}
