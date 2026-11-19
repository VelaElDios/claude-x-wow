#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ADDON_NAME, CONFIG_PATH, STATE_PATH, addonDir, detectWowClients, loadConfig, loadState, saveConfig, saveState,
} from './config.js';
import { Bridge } from './bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ADDON_SRC = path.join(here, '..', 'addon', ADDON_NAME);

const HELP = `
Claude x WoW - habla con Claude Code desde World of Warcraft (no oficial)

Uso:
  claude-x-wow setup [--wow <carpeta del cliente>] [--project <carpeta>]
  claude-x-wow start            Arranca el puente (déjalo abierto mientras juegas)
  claude-x-wow status           Muestra la configuración
  claude-x-wow install-addon    Copia el addon a tu carpeta AddOns
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

function installAddon(cfg) {
  const dest = addonDir(cfg);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(ADDON_SRC)) {
    // No pisamos el Inbox.lua si el puente ya lo ha escrito.
    if (file === 'Inbox.lua' && fs.existsSync(path.join(dest, file))) continue;
    fs.copyFileSync(path.join(ADDON_SRC, file), path.join(dest, file));
  }
  console.log(`✔ Addon instalado en ${dest}`);
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
    saveConfig(cfg);
    console.log(`✔ WoW:      ${cfg.wowPath}`);
    console.log(`✔ Proyecto: ${cfg.projectDir}`);
    console.log(`✔ Permisos: ${cfg.permissionMode} (edita ${CONFIG_PATH} para cambiarlos)`);
    installAddon(cfg);
    console.log('\nSiguiente paso: claude-x-wow start  (y reinicia el WoW si estaba abierto)');
    break;
  }
  case 'start': {
    const cfg = requireConfig();
    if (!fs.existsSync(addonDir(cfg))) installAddon(cfg);
    console.log(`Claude x WoW escuchando. Proyecto: ${cfg.projectDir}`);
    console.log('En el juego: /claude <tarea>. Ctrl+C para salir.\n');
    const bridge = new Bridge(cfg);
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
    console.log(`Config:   ${CONFIG_PATH}`);
    console.log(`WoW:      ${cfg.wowPath ?? '(sin configurar)'}`);
    console.log(`Proyecto: ${cfg.projectDir ?? '(sin configurar)'}`);
    console.log(`Permisos: ${cfg.permissionMode}  allowed=${JSON.stringify(cfg.allowedTools)}`);
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
