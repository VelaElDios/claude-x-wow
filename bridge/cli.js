#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ADDON_NAME, CONFIG_PATH, STATE_PATH, addonDir, detectWowClients, loadConfig, loadState, saveConfig, saveState,
} from './config.js';
import { Bridge, VERSION } from './bridge.js';
import { PixelReader } from './capture.js';
import { SlotPool } from './slots.js';
import { Signals } from './signals.js';
import { PermissionBroker } from './permissions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ADDON_SRC = path.join(here, '..', 'addon', ADDON_NAME);

const HELP = `
Claude x WoW ${VERSION} - tu Claude Code dentro de World of Warcraft (no oficial)

Uso:
  claude-x-wow setup [--wow <carpeta del cliente>] [--project <carpeta>]
  claude-x-wow start            Arranca el puente (déjalo abierto mientras juegas)
  claude-x-wow status           Muestra la configuración
  claude-x-wow install-addon    Copia o actualiza el addon en tu carpeta AddOns
  claude-x-wow reset            Olvida la sesión actual de Claude Code

Ejemplo:
  claude-x-wow setup --project C:\\Users\\yo\\workspace\\mi-proyecto
`;

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function requireConfig() {
  const cfg = loadConfig();
  if (!cfg.wowPath || !cfg.projectDir) fail('Falta configurar. Ejecuta: claude-x-wow setup --project <carpeta>');
  if (!fs.existsSync(cfg.wowPath)) fail(`No existe la carpeta del WoW: ${cfg.wowPath}`);
  if (!fs.existsSync(cfg.projectDir)) fail(`No existe la carpeta del proyecto: ${cfg.projectDir}`);
  return cfg;
}

function interfaceVersion() {
  const toc = fs.readFileSync(path.join(ADDON_SRC, `${ADDON_NAME}.toc`), 'utf8');
  return toc.match(/^## Interface:\s*(.+)$/m)?.[1].trim() ?? '16001';
}

function slotPool(cfg) {
  return new SlotPool(path.join(cfg.wowPath, 'Interface', 'AddOns'), cfg.slotPool, interfaceVersion());
}

function installAddon(cfg) {
  const dest = addonDir(cfg);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(ADDON_SRC, dest, {
    recursive: true,
    // No pisamos el Inbox.lua si el puente ya lo ha escrito.
    filter: (src) => !(path.basename(src) === 'Inbox.lua' && fs.existsSync(path.join(dest, 'Inbox.lua'))),
  });
  console.log(`✔ Addon instalado en ${dest}`);
  if (cfg.live) {
    const created = slotPool(cfg).ensure();
    if (created) console.log(`✔ ${created} canales en directo creados/actualizados (ClaudeXWoW_S###). Cierra y abre el WoW para que los detecte.`);
  }
}

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: { wow: { type: 'string' }, project: { type: 'string' } },
  allowPositionals: true,
});

switch (command) {
  case 'setup': {
    const cfg = loadConfig();
    if (values.wow) {
      cfg.wowPath = path.resolve(values.wow);
    } else if (!cfg.wowPath) {
      const clients = detectWowClients();
      if (clients.length === 0) fail('No encuentro el WoW. Pásalo a mano: --wow "C:\\...\\World of Warcraft\\_forever_"');
      cfg.wowPath = clients[0];
      if (clients.length > 1) console.log(`Encontrados varios clientes, uso ${clients[0]} (cámbialo con --wow):\n  ${clients.join('\n  ')}`);
    }
    cfg.projectDir = path.resolve(values.project ?? cfg.projectDir ?? process.cwd());
    if (!fs.existsSync(cfg.projectDir)) fail(`No existe la carpeta del proyecto: ${cfg.projectDir}`);
    cfg.projects = [...new Set([...(cfg.projects ?? []), cfg.projectDir])];
    saveConfig(cfg);
    console.log(`✔ WoW:      ${cfg.wowPath}`);
    console.log(`✔ Proyecto: ${cfg.projectDir}`);
    console.log(`✔ Permisos: ${cfg.permissionMode} (edita ${CONFIG_PATH} para cambiarlos)`);
    installAddon(cfg);
    console.log('\nSiguiente paso: claude-x-wow start');
    break;
  }
  case 'start': {
    const cfg = requireConfig();
    installAddon(cfg); // mantiene el addon al día con esta versión del puente
    const slots = cfg.live ? slotPool(cfg) : null;
    const reader = cfg.live ? new PixelReader() : null;
    if (cfg.live && !reader.available) console.log('(El canal en directo solo funciona en Windows; usando modo /reload.)');
    console.log(`\nClaude x WoW ${VERSION} escuchando. Proyecto: ${cfg.projectDir}`);
    console.log('En el juego: /claude. Ctrl+C para salir.\n');
    if (slots) slots.size = Math.min(cfg.slotPool, slots.installed());
    const signals = cfg.live ? new Signals(path.join(addonDir(cfg), 'sig')) : null;
    if (signals && !fs.existsSync(signals.file('on'))) {
      signals.resetAll();
      console.log('✔ Señales del canal creadas. Cierra y abre el WoW para que las detecte.');
    }
    console.log('Consejo: abre el puente ANTES que el WoW, así el canal en directo arranca limpio.');
    const permissions = cfg.askPermissions ? await new PermissionBroker().start() : null;
    const bridge = new Bridge(cfg, { reader, slots, signals, permissions });
    process.on('uncaughtException', (err) => console.error('Error inesperado (el puente sigue funcionando):', err.message));
    bridge.start();
    process.on('SIGINT', () => {
      bridge.stop();
      process.exit(0);
    });
    break;
  }
  case 'status': {
    const cfg = loadConfig();
    const state = loadState();
    console.log(`Versión:  ${VERSION}`);
    console.log(`Config:   ${CONFIG_PATH}`);
    console.log(`WoW:      ${cfg.wowPath ?? '(sin configurar)'}`);
    console.log(`Proyecto: ${cfg.projectDir ?? '(sin configurar)'}`);
    console.log(`Permisos: ${cfg.permissionMode}  allowed=${JSON.stringify(cfg.allowedTools)}`);
    if (cfg.wowPath) console.log(`Canales:  ${slotPool(cfg).installed()}/${cfg.slotPool} instalados`);
    console.log(`Sesión:   ${state.sessionId ?? '(ninguna)'}`);
    console.log(`Estado:   ${STATE_PATH}`);
    if (state.sessionId) console.log(`\nPara seguir esta conversación en la terminal:\n  cd "${cfg.projectDir}" && claude --resume ${state.sessionId}`);
    break;
  }
  case 'install-addon':
    installAddon(requireConfig());
    break;
  case 'reset': {
    const state = loadState();
    state.sessionId = null;
    saveState(state);
    console.log('✔ Sesión olvidada. La próxima tarea empieza conversación nueva.');
    break;
  }
  default:
    console.log(HELP);
}
