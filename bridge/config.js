import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME_DIR = process.env.CLAUDE_X_WOW_HOME || path.join(os.homedir(), '.claude-x-wow');
export const CONFIG_PATH = path.join(HOME_DIR, 'config.json');
export const STATE_PATH = path.join(HOME_DIR, 'state.json');
export const ADDON_NAME = 'ClaudeXWoW';

export const DEFAULT_CONFIG = {
  wowPath: null, // carpeta del cliente, p. ej. ...\World of Warcraft\_forever_
  projectDir: null, // carpeta donde trabaja Claude Code
  permissionMode: 'acceptEdits', // default | acceptEdits | plan
  askPermissions: true, // preguntar en el juego lo que no esté permitido (si no, se deniega)
  allowedTools: [], // p. ej. ["Bash(npm test:*)"]
  disallowedTools: [],
  model: null,
  timeoutMinutes: 15,
  pollMs: 1000,
  live: true, // canal en directo (píxeles + ranuras). false = solo modo /reload
  slotPool: 300, // ranuras PC -> juego por sesión del juego
  liveIntervalMs: 1000, // cada cuánto se manda un lote de eventos en directo
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function loadConfig() {
  return { ...DEFAULT_CONFIG, ...readJson(CONFIG_PATH, {}) };
}

export function saveConfig(cfg) {
  writeJson(CONFIG_PATH, cfg);
}

export function loadState() {
  return { sessionId: null, processed: [], events: [], eventSeq: 0, received: [], ...readJson(STATE_PATH, {}) };
}

export function saveState(state) {
  writeJson(STATE_PATH, state);
}

const FLAVORS = ['_forever_', '_retail_', '_classic_era_', '_classic_', '_anniversary_', '_ptr_', '_beta_'];

function candidateRoots() {
  if (process.platform === 'win32') {
    const roots = [];
    for (const drive of ['C', 'D', 'E', 'F']) {
      roots.push(
        `${drive}:\\Program Files (x86)\\World of Warcraft`,
        `${drive}:\\Program Files\\World of Warcraft`,
        `${drive}:\\World of Warcraft`,
        `${drive}:\\Games\\World of Warcraft`,
        `${drive}:\\Juegos\\World of Warcraft`,
      );
    }
    return roots;
  }
  if (process.platform === 'darwin') {
    return ['/Applications/World of Warcraft', path.join(os.homedir(), 'Applications/World of Warcraft')];
  }
  return [path.join(os.homedir(), 'Games/world-of-warcraft/drive_c/Program Files (x86)/World of Warcraft')];
}

// Devuelve las carpetas de cliente encontradas, con _forever_ primero.
export function detectWowClients() {
  const found = [];
  for (const root of candidateRoots()) {
    for (const flavor of FLAVORS) {
      const dir = path.join(root, flavor);
      if (fs.existsSync(path.join(dir, 'Interface')) || fs.existsSync(path.join(dir, 'WTF'))) {
        found.push(dir);
      }
    }
  }
  return found;
}

export function addonDir(cfg) {
  return path.join(cfg.wowPath, 'Interface', 'AddOns', ADDON_NAME);
}

// Todas las rutas posibles del archivo de SavedVariables del addon (una por cuenta).
export function savedVariablesFiles(cfg) {
  const accountsDir = path.join(cfg.wowPath, 'WTF', 'Account');
  let accounts = [];
  try {
    accounts = fs.readdirSync(accountsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  return accounts
    .filter((d) => d.name !== 'SavedVariables')
    .map((d) => path.join(accountsDir, d.name, 'SavedVariables', `${ADDON_NAME}.lua`));
}
