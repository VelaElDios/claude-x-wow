-- Claude x WoW - núcleo del addon
-- Canal (MVP):
--   juego -> PC : los mensajes se guardan en ClaudeXWoWDB.outbox (SavedVariables)
--                 y se hace /reload para que el juego los escriba a disco.
--   PC -> juego : el puente reescribe Inbox.lua (ClaudeXWoW_Inbox) y el juego lo
--                 lee en el siguiente /reload.

local ADDON_NAME, ns = ...

ns.VERSION = "0.1.0"
local PREFIX = "|cffd97757Claude|r"
local MAX_HISTORY = 100
local BRIDGE_TIMEOUT = 60 -- segundos sin latido = puente caído

local function chatPrint(msg)
	DEFAULT_CHAT_FRAME:AddMessage(PREFIX .. " " .. msg)
end
ns.print = chatPrint

local function newId()
	local db = ClaudeXWoWDB
	db.counter = (db.counter or 0) + 1
	return string.format("%d-%d", time(), db.counter)
end

local function addHistory(role, text, id)
	local h = ClaudeXWoWDB.history
	table.insert(h, { role = role, text = text, id = id, t = time() })
	while #h > MAX_HISTORY do
		table.remove(h, 1)
	end
end

-- Imprime una respuesta larga en el chat, partida en líneas manejables.
function ns.PrintReply(m)
	local color = (m.status == "error") and "|cffff5555" or "|cffffffff"
	chatPrint(m.status == "error" and "|cffff5555error:|r" or "responde:")
	local text = (m.text or ""):gsub("\r", "")
	for line in (text .. "\n"):gmatch("(.-)\n") do
		if line == "" then
			-- salta líneas vacías para no llenar el chat
		else
			while #line > 240 do
				DEFAULT_CHAT_FRAME:AddMessage(color .. line:sub(1, 240) .. "|r")
				line = line:sub(241)
			end
			DEFAULT_CHAT_FRAME:AddMessage(color .. line .. "|r")
		end
	end
end

function ns.Send(text)
	text = strtrim(text or "")
	if text == "" then
		return
	end
	local id = newId()
	table.insert(ClaudeXWoWDB.outbox, { id = id, type = "prompt", text = text, t = time() })
	addHistory("user", text, id)
	chatPrint("enviando... (recargando la interfaz)")
	ReloadUI()
end

function ns.Reset()
	local id = newId()
	table.insert(ClaudeXWoWDB.outbox, { id = id, type = "reset", t = time() })
	addHistory("system", "Nueva conversación", id)
	chatPrint("empezando conversación nueva... (recargando la interfaz)")
	ReloadUI()
end

function ns.Refresh()
	ReloadUI()
end

local function processInbox()
	local db = ClaudeXWoWDB
	local inbox = ClaudeXWoW_Inbox
	if type(inbox) ~= "table" then
		return
	end

	local known = {}
	for _, m in ipairs(inbox.messages or {}) do
		if m.id then
			known[m.id] = m
		end
	end

	-- Lo que el puente ya ha recibido sale de la bandeja de salida.
	local keep = {}
	for _, o in ipairs(db.outbox) do
		if not known[o.id] then
			table.insert(keep, o)
		end
	end
	db.outbox = keep

	-- Respuestas nuevas.
	ns.newReplies = {}
	for _, m in ipairs(inbox.messages or {}) do
		if (m.status == "done" or m.status == "error") and not db.seen[m.id] then
			db.seen[m.id] = true
			addHistory(m.status == "error" and "error" or "claude", m.text or "", m.id)
			table.insert(ns.newReplies, m)
		end
	end

	-- Olvida ids que el puente ya no guarda.
	local seen = {}
	for id in pairs(db.seen) do
		if known[id] then
			seen[id] = true
		end
	end
	db.seen = seen
end

function ns.Status()
	local inbox = ClaudeXWoW_Inbox or {}
	local db = ClaudeXWoWDB
	local status = { pending = #db.outbox, working = 0 }
	for _, m in ipairs(inbox.messages or {}) do
		if m.status == "working" or m.status == "queued" then
			status.working = status.working + 1
		end
	end
	if not inbox.updated then
		status.bridge = "nunca"
	elseif time() - inbox.updated > BRIDGE_TIMEOUT then
		status.bridge = "caido"
	else
		status.bridge = "ok"
	end
	status.project = inbox.project
	return status
end

local function printStatus()
	local s = ns.Status()
	if s.bridge == "nunca" then
		chatPrint("|cffff5555el puente no se ha conectado.|r Abre una terminal y ejecuta: claude-x-wow start")
	elseif s.bridge == "caido" then
		chatPrint("|cffff5555el puente no responde.|r ¿Sigue abierto claude-x-wow start?")
	end
	if s.working > 0 then
		chatPrint("está trabajando... escribe |cffffff00/claude ver|r en un rato para ver la respuesta.")
	elseif s.pending > 0 and s.bridge == "ok" then
		chatPrint("mensaje enviado, esperando al puente. |cffffff00/claude ver|r para comprobar.")
	end
end

local function printHelp()
	chatPrint("v" .. ns.VERSION .. " - comandos:")
	DEFAULT_CHAT_FRAME:AddMessage("  /claude <texto>  - manda una tarea a Claude Code")
	DEFAULT_CHAT_FRAME:AddMessage("  /claude          - abre/cierra la ventana")
	DEFAULT_CHAT_FRAME:AddMessage("  /claude ver      - recarga para ver respuestas nuevas")
	DEFAULT_CHAT_FRAME:AddMessage("  /claude nuevo    - empieza una conversación nueva")
	DEFAULT_CHAT_FRAME:AddMessage("  /claude estado   - estado del puente")
end

SLASH_CLAUDEXWOW1 = "/claude"
SLASH_CLAUDEXWOW2 = "/cxw"
SlashCmdList["CLAUDEXWOW"] = function(msg)
	msg = strtrim(msg or "")
	local cmd = msg:lower()
	if cmd == "" then
		ns.ToggleWindow()
	elseif cmd == "ver" or cmd == "actualizar" then
		ns.Refresh()
	elseif cmd == "nuevo" then
		ns.Reset()
	elseif cmd == "estado" then
		local s = ns.Status()
		chatPrint(string.format("puente: %s | proyecto: %s | pendientes: %d | trabajando: %d",
			s.bridge, s.project or "?", s.pending, s.working))
	elseif cmd == "ayuda" or cmd == "help" then
		printHelp()
	else
		ns.Send(msg)
	end
end

local f = CreateFrame("Frame")
f:RegisterEvent("ADDON_LOADED")
f:RegisterEvent("PLAYER_ENTERING_WORLD")
f:SetScript("OnEvent", function(self, event, arg1)
	if event == "ADDON_LOADED" and arg1 == ADDON_NAME then
		ClaudeXWoWDB = ClaudeXWoWDB or {}
		local db = ClaudeXWoWDB
		db.outbox = db.outbox or {}
		db.history = db.history or {}
		db.seen = db.seen or {}
		processInbox()
	elseif event == "PLAYER_ENTERING_WORLD" then
		self:UnregisterEvent("PLAYER_ENTERING_WORLD")
		for _, m in ipairs(ns.newReplies or {}) do
			ns.PrintReply(m)
		end
		printStatus()
		if ns.RestoreWindow then
			ns.RestoreWindow()
		end
	end
end)
