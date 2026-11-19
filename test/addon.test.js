// Ejecuta el addon real (Lua) con una imitación mínima de la API de WoW,
// usando fengari (Lua 5.3 en JS). Comprueba que el Lua y el puente hablan
// exactamente el mismo protocolo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrame, frameColors } from '../bridge/protocol.js';
import { toLua } from '../bridge/lua.js';
import { toGray } from '../bridge/signals.js';

let fengari;
try {
  fengari = (await import('fengari')).default;
} catch {
  fengari = null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const ADDON = path.join(here, '..', 'addon', 'ClaudeXWoW');

const WOW_STUBS = `
local function obj(extra)
  local o = extra or {}
  o.__scripts = {}
  return setmetatable(o, { __index = function(t, k)
    if type(k) == "string" and k:match("^%u") then return function(self, ...) return nil end end
  end })
end
TEXTURES = {}
FRAMES = {}
LOADED = {}
function CreateFrame(kind, name, parent, template)
  local f = obj()
  f.SetScript = function(self, ev, fn) self.__scripts[ev] = fn end
  f.RegisterEvent = function(self, ev) self.__events = self.__events or {}; self.__events[ev] = true end
  f.CreateTexture = function(self)
    local t = obj({ parent = self })
    t.SetColorTexture = function(self, r, g, b) self.r, self.g, self.b = r, g, b end
    table.insert(TEXTURES, t)
    return t
  end
  f.CreateFontString = function(self) return obj({ GetFont = function() return "font" end }) end
  f.GetFont = function() return "font" end
  f.IsShown = function(self) return self.shown end
  f.Show = function(self) self.shown = true end
  f.Hide = function(self) self.shown = false end
  f.SetShown = function(self, v) self.shown = v end
  f.GetPoint = function() return "CENTER", nil, "CENTER", 0, 0 end
  f.GetSize = function() return 680, 440 end
  f.AddMessage = function(self, text) end
  table.insert(FRAMES, f)
  if name then _G[name] = f end
  return f
end
UIParent = CreateFrame("Frame")
Minimap = CreateFrame("Frame")
Minimap.GetWidth = function() return 140 end
Minimap.GetCenter = function() return 100, 100 end
Minimap.GetEffectiveScale = function() return 1 end
GameTooltip = CreateFrame("Frame")
function GetCursorPosition() return 0, 0 end
CHAT = {}
DEFAULT_CHAT_FRAME_MSGS = CHAT
DEFAULT_CHAT_FRAME = CreateFrame("Frame")
DEFAULT_CHAT_FRAME.AddMessage = function(self, text) table.insert(CHAT, text) end
function GetPhysicalScreenSize() return 1920, 1080 end
function GetScreenHeight() return 768 end
function GetTime() return 100 end
function time() return 1795000000 end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
tinsert = table.insert
UISpecialFrames = {}
SlashCmdList = {}
C_Timer = { NewTicker = function() end, After = function() end }
function IsShiftKeyDown() return false end
function ReloadUI() RELOADED = true end
function StopSound() end
-- Simulamos 5 ranuras instaladas y sonido activo.
local slotNames = { "ClaudeXWoW", "ClaudeXWoW_S001", "ClaudeXWoW_S002", "ClaudeXWoW_S003", "ClaudeXWoW_S004", "ClaudeXWoW_S005" }
-- Señales: archivos de sig/ que "existen" (todos al arrancar).
SIGFILES = { on = true, t = true }
for b = 0, 9 do SIGFILES["b" .. b] = true end
function PlaySoundFile(path)
  local name = path:find("sig", 1, true) and path:match("(%w+)%.wav$")
  if name and SIGFILES[name] then return true, 1 end
  return nil
end
C_AddOns = {
  GetNumAddOns = function() return #slotNames end,
  GetAddOnInfo = function(i) return slotNames[i] end,
  LoadAddOn = function(name) table.insert(LOADED, name); local fn = SLOT_DATA[name]; if fn then fn() end; return true end,
}
SLOT_DATA = {}
BackdropTemplateMixin = {}
math.random = math.random or function(a, b) return a end
`;

function makeLua() {
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const run = (code, name = 'chunk') => {
    if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name)) !== 0) {
      throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
    }
    if (lua.lua_pcall(L, 0, 1, 0) !== 0) throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
    const v = lua.lua_isstring(L, -1) ? to_jsstring(lua.lua_tolstring(L, -1)) : null;
    lua.lua_pop(L, 1);
    return v;
  };
  run(WOW_STUBS, 'stubs');
  run('NS = {}');
  const toc = fs.readFileSync(path.join(ADDON, 'ClaudeXWoW.toc'), 'utf8');
  for (const file of toc.split(/\r?\n/).filter((l) => l.trim().endsWith('.lua'))) {
    const src = fs.readFileSync(path.join(ADDON, file.trim()), 'utf8');
    run(`local chunk = assert(load(${luaLong(src)}, "${file}")); chunk("ClaudeXWoW", NS)`, file);
  }
  return run;
}

const luaLong = (s) => `[==========[\n${s}]==========]`;

// Imita al puente: pone el contador K en los archivos de señal y conmuta el tic.
const publish = (k) => {
  const g = toGray(k);
  const bits = [...Array(10).keys()].map((b) => `SIGFILES.b${b} = ${g & (1 << b) ? 'nil' : 'true'}`).join('; ');
  return `${bits}; SIGFILES.t = (not SIGFILES.t) or nil`;
};

const fire = `
local function fire(ev, arg)
  for _, f in ipairs(FRAMES) do
    if f.__events and f.__events[ev] and f.__scripts.OnEvent then f.__scripts.OnEvent(f, ev, arg) end
  end
end
fire("ADDON_LOADED", "ClaudeXWoW")
fire("PLAYER_LOGIN")
`;

test('el addon carga y la tira de píxeles coincide con el protocolo del puente', { skip: !fengari && 'fengari no instalado' }, () => {
  const run = makeLua();
  run(fire);
  assert.equal(run('return tostring(NS.Slots.ok)'), 'true');
  assert.equal(run('return tostring(NS.Slots.pool)'), '5');
  const nonce = Number(run('return tostring(NS.nonce)'));

  // Tras el login el addon muestra la trama de saludo "H|0".
  const expected = frameColors(buildFrame({ nonce, seq: 1, cursor: 0, payload: 'H|0' }));
  const got = JSON.parse(run(`
    local strip = {}
    local n = 0
    for _, t in ipairs(TEXTURES) do
      if t.parent == ClaudeXWoWStrip and n < ${expected.length} then
        n = n + 1
        strip[n] = string.format("[%d,%d,%d]", math.floor(t.r*255+0.5), math.floor(t.g*255+0.5), math.floor(t.b*255+0.5))
      end
    end
    return "[" .. table.concat(strip, ",") .. "]"
  `));
  assert.equal(got.length, expected.length);
  assert.deepEqual(got, expected);
});

test('una ranura escrita por el puente llega a la terminal', { skip: !fengari && 'fengari no instalado' }, () => {
  const run = makeLua();
  run(fire);
  const nonce = Number(run('return tostring(NS.nonce)'));
  const events = [
    { k: 'start', n: 1 },
    { k: 'tool', n: 2, name: 'Read', detail: 'src/Noria.java', label: 'Leyendo' },
    { k: 'result', n: 3, text: 'Read 120 lines', err: false },
    { k: 'text', n: 4, text: '|cffffffffListo|r: la noria "gira" ✓\nsegunda línea' },
    { k: 'done', n: 5, summary: 'Hecho en 12s' },
  ];
  const slotSrc = `ClaudeXWoW_OnSlot(${nonce}, 1, ${toLua(events)})`;
  // Sin publicar nada, el sondeo no carga ninguna ranura.
  run('NS.Slots.Poll()');
  assert.equal(run('return tostring(#LOADED)'), '0');
  run(`SLOT_DATA["ClaudeXWoW_S001"] = assert(load(${luaLong(slotSrc)})); ${publish(1)}`);
  run('NS.Slots.Poll()');
  assert.equal(run('return LOADED[1]'), 'ClaudeXWoW_S001');
  assert.equal(run('return tostring(NS.Slots.k)'), '1');
  run('NS.Slots.Poll()');
  assert.equal(run('return tostring(#LOADED)'), '1', 'no debe cargar dos veces');
  assert.equal(run('return tostring(ClaudeXWoWDB.lastEvent)'), '5');
  const lines = run('return table.concat(ClaudeXWoWDB.lines, "\\n")');
  assert.match(lines, /Read\|r\(\|cff8a8a8asrc\/Noria\.java/);
  assert.match(lines, /la noria "gira" ✓/);
  assert.match(lines, /Hecho en 12s/);
  // El acuse (seq 1 = saludo) vacía la cola y oculta la tira.
  assert.equal(run('return tostring(ClaudeXWoWStrip.shown)'), 'false');

  // Si el puente publica 3 lotes de golpe, se cargan los 3 en orden.
  run(`${publish(2)}; ${publish(3)}; ${publish(4)}`);
  run('NS.Slots.Poll()');
  assert.equal(run('return table.concat(LOADED, ",")'), 'ClaudeXWoW_S001,ClaudeXWoW_S002,ClaudeXWoW_S003,ClaudeXWoW_S004');

  // Enviar un mensaje largo lo trocea en tramas.
  run('NS.Send(string.rep("á", 400))');
  assert.equal(run('return tostring(ClaudeXWoWStrip.shown)'), 'true');
  assert.equal(run('return tostring(#ClaudeXWoWDB.outbox)'), '1');
});

test('peticiones de permiso: se ven en la terminal y se responden escribiendo o con clic', { skip: !fengari && 'fengari no instalado' }, () => {
  const run = makeLua();
  run(fire);
  const nonce = Number(run('return tostring(NS.nonce)'));
  const events = [{ k: 'ask', n: 1, id: '7', name: 'Bash', detail: 'npm test', rule: 'Bash(npm)' }];
  run(`SLOT_DATA["ClaudeXWoW_S001"] = assert(load(${luaLong(`ClaudeXWoW_OnSlot(${nonce}, 1, ${toLua(events)})`)})); ${publish(1)}`);
  run('NS.Slots.Poll()');
  const lines = run('return table.concat(ClaudeXWoWDB.lines, "\\n")');
  assert.match(lines, /Claude quiere usar Bash/);
  assert.match(lines, /\|Haddon:cxw:y:7\|h/);
  assert.equal(run('return tostring(ClaudeXWoWDB.asks["7"])'), 'true');
  // Escribir "s" en la terminal responde "sí" (trama A|7|y).
  run('NS.Answer("7", "y")');
  assert.equal(run('return tostring(ClaudeXWoWStrip.shown)'), 'true');
  // Llega la confirmación del puente.
  const done = [{ k: 'answered', n: 2, id: '7', decision: 'y', rule: 'Bash(npm)' }];
  run(`SLOT_DATA["ClaudeXWoW_S002"] = assert(load(${luaLong(`ClaudeXWoW_OnSlot(${nonce}, 2, ${toLua(done)})`)})); ${publish(2)}`);
  run('NS.Slots.Poll()');
  assert.equal(run('return tostring(ClaudeXWoWDB.asks["7"])'), 'nil');
  assert.match(run('return ClaudeXWoWDB.lines[#ClaudeXWoWDB.lines]'), /Permitido/);
});

test('sesiones: bloques, prompts de la terminal y enlaces clicables', { skip: !fengari && 'fengari no instalado' }, () => {
  const run = makeLua();
  run(fire);
  run(`NS.Term.Event({ k = "block", text = "1. explica |Haddon:cxw:cmd:ver:1|h[ver]|h" })`);
  run(`NS.Term.Event({ k = "prompt", text = "y ahora con monitores" })`);
  const lines = run('return table.concat(ClaudeXWoWDB.lines, "\\\\n")');
  assert.match(lines, /1\. explica/);
  assert.match(lines, /❯\|r \|cffffffffy ahora con monitores/);
  // Acusamos el saludo para que la siguiente trama sea la del comando.
  const nonce = Number(run('return tostring(NS.nonce)'));
  run('SHOWN = {}; local orig = NS.Pixel.Show; NS.Pixel.Show = function(...) table.insert(SHOWN, (select(4, ...))); return orig(...) end');
  run(`SLOT_DATA["ClaudeXWoW_S001"] = assert(load("ClaudeXWoW_OnSlot(${nonce}, 1, {})")); ${publish(1)}`);
  run('NS.Slots.Poll()');
  // Clic en [ver] -> manda el comando "ver 1" al puente.
  run(`for _, f in ipairs(FRAMES) do local h = rawget(f, "__scripts").OnHyperlinkClick; if h then h(f, "addon:cxw:cmd:ver:1") end end`);
  assert.match(run('return SHOWN[#SHOWN]'), /^C\|\d+-\d+\|ver 1$/);
});

test('los mensajes de sesiones de la terminal no encienden el indicador de "Pensando"', { skip: !fengari && 'fengari no instalado' }, () => {
  const run = makeLua();
  run(fire);
  run('BUSY = {}; local orig = NS.Term.SetBusy; NS.Term.SetBusy = function(l) table.insert(BUSY, tostring(l)); return orig(l) end');
  run('NS.Term.Event({ k = "tool", name = "Read", detail = "x", ro = true })');
  run('NS.Term.Event({ k = "result", text = "ok", ro = true })');
  assert.equal(run('return tostring(#BUSY)'), '0');
  run('NS.Term.Event({ k = "result", text = "ok" })');
  assert.equal(run('return BUSY[1]'), 'Pensando');
});

test('aviso al terminar con la terminal cerrada, botón del minimapa y atajo', { skip: !fengari && 'fengari no instalado' }, () => {
  const run = makeLua();
  run(fire);
  assert.equal(run('return tostring(ClaudeXWoWMinimapButton ~= nil)'), 'true');
  assert.equal(run('return type(ClaudeXWoW_Toggle)'), 'function');
  assert.equal(run('return BINDING_NAME_CLAUDEXWOW_TOGGLE'), 'Abrir/cerrar la terminal');
  // Terminal cerrada: al terminar avisa por el chat.
  run('ClaudeXWoWTerminal:Hide(); CHAT = {}; DEFAULT_CHAT_FRAME.AddMessage = function(self, t) table.insert(CHAT, t) end');
  run('NS.Term.Event({ k = "done", summary = "Hecho en 3s" })');
  assert.match(run('return table.concat(CHAT, "\\n")'), /Claude ha terminado \(Hecho en 3s\)/);
  // Terminal abierta: no molesta.
  run('ClaudeXWoWTerminal:Show(); CHAT = {}');
  run('NS.Term.Event({ k = "done", summary = "Hecho en 3s" })');
  assert.equal(run('return tostring(#CHAT)'), '0');
  // /claude minimapa lo oculta.
  run('SlashCmdList.CLAUDEXWOW("minimapa")');
  assert.equal(run('return tostring(ClaudeXWoWDB.minimap.hidden)'), 'true');
});

test('comandos del puente desde la terminal y respuesta "siempre"', { skip: !fengari && 'fengari no instalado' }, () => {
  const run = makeLua();
  run(fire);
  assert.equal(run('return tostring(NS.IsBridgeCommand("proyecto tfg"))'), 'true');
  assert.equal(run('return tostring(NS.IsBridgeCommand("modelo"))'), 'true');
  assert.equal(run('return tostring(NS.IsBridgeCommand("explica esto"))'), 'false');
  run('NS.Term.Event({ k = "status", project = "TFG", model = "opus", mode = "plan" })');
  run('NS.Term.Event({ k = "ask", id = "4", name = "Bash", detail = "npm test", rule = "Bash(npm)" })');
  const lines = run('return table.concat(ClaudeXWoWDB.lines, "\\n")');
  assert.match(lines, /\|Haddon:cxw:p:4\|h/);
  assert.match(lines, /Esta sesión/);
  run('ANS = {}; NS.Answer = function(id, d) table.insert(ANS, id .. "=" .. d) end');
  run('NS.Term.Event({ k = "answered", id = "99", decision = "p" })');
  assert.match(run('return ClaudeXWoWDB.lines[#ClaudeXWoWDB.lines]'), /guardado/);
});

test('aviso al 80% del canal con botón para reiniciarlo', { skip: !fengari && 'fengari no instalado' }, () => {
  const run = makeLua();
  run(fire);
  // 5 canales: el aviso sale al cargar el 4º (80%).
  for (let k = 1; k <= 4; k++) run(`SLOT_DATA["ClaudeXWoW_S00${k}"] = function() end; ${publish(k)}; NS.Slots.Poll()`);
  const lines = run('return table.concat(ClaudeXWoWDB.lines, "\\n")');
  assert.match(lines, /Canal en directo al 80%/);
  assert.match(lines, /\|Haddon:cxw:reload:0\|h/);
  run(`for _, f in ipairs(FRAMES) do local h = rawget(f, "__scripts").OnHyperlinkClick; if h then h(f, "addon:cxw:reload:0") end end`);
  assert.equal(run('return tostring(RELOADED)'), 'true');
});
