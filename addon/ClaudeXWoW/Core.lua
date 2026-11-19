-- Claude x WoW - núcleo
-- Canales:
--   juego -> PC : tira de píxeles (Pixel.lua), en directo.
--                 Respaldo: ClaudeXWoWDB.outbox en SavedVariables (llega al hacer /reload).
--   PC -> juego : addons ranura (Slots.lua), en directo.
--                 Respaldo: Inbox.lua, que se lee en cada /reload.

local ADDON_NAME, ns = ...

ns.VERSION = "0.4.1"
local floor = math.floor
local CHUNK = 440 -- bytes de texto por trama (deja sitio a la cabecera)
local NO_BRIDGE_AFTER = 12 -- segundos sin acuse = el puente no ve la tira

local db
local queue = {} -- tramas pendientes de enviar
local seq = 0

ns.nonce = floor((GetTime() * 1000 + math.random(1, 100000)) % 65534) + 1

function ns.Info(text)
	if ns.Term then
		ns.Term.Info(text)
	else
		DEFAULT_CHAT_FRAME:AddMessage("|cffd97757Claude x WoW|r " .. text)
	end
end

local function newId()
	db.counter = (db.counter or 0) + 1
	return string.format("%d-%d", time(), db.counter)
end

------------------------------------------------------------------------
-- Cola de tramas (juego -> PC)
------------------------------------------------------------------------

local function showHead()
	local f = queue[1]
	if not f then
		ns.Pixel.Hide()
		return
	end
	if not f.seq then
		seq = seq % 65535 + 1
		f.seq = seq
		f.shownAt = GetTime()
	end
	ns.Pixel.Show(ns.nonce, f.seq, ns.Slots.k, f.payload)
end

function ns.RefreshFrame()
	if queue[1] then
		showHead()
	end
end

local function queueFrame(payload, onAck, quiet)
	table.insert(queue, { payload = payload, onAck = onAck, warned = quiet })
	if #queue == 1 then
		showHead()
	end
end

local function onAck(ack)
	local f = queue[1]
	if f and f.seq == ack then
		table.remove(queue, 1)
		ns.bridgeOk = true
		if f.onAck then
			f.onAck()
		end
		showHead()
	end
end

-- Aviso si el puente no está leyendo la tira.
C_Timer.NewTicker(2, function()
	local f = queue[1]
	if f and f.shownAt and not f.warned and GetTime() - f.shownAt > NO_BRIDGE_AFTER then
		f.warned = true
		if ns.Slots.ok then
			ns.Info("El puente no responde. Comprueba que |cffffffffclaude-x-wow start|r está abierto y que el WoW está en pantalla completa (ventana) sin nada tapando la esquina superior izquierda. Plan B: |cffffffff/claude recargar|r.")
		end
	end
end)

------------------------------------------------------------------------
-- Eventos que llegan del puente (PC -> juego)
------------------------------------------------------------------------

function ns.ApplyEvents(events)
	for _, e in ipairs(events or {}) do
		if not e.n then
			ns.Term.Event(e) -- eventos de estado, sin número
		elseif e.n > db.lastEvent then
			db.lastEvent = e.n
			ns.Term.Event(e)
		end
	end
end

function ns.HandleSlot(nonce, ack, events)
	if nonce ~= ns.nonce then
		return -- de una sesión anterior
	end
	ns.lastSlotAt = GetTime()
	if ack and ack > 0 then
		onAck(ack)
	end
	ns.ApplyEvents(events)
end

local function removeFromOutbox(id)
	for i = #db.outbox, 1, -1 do
		if db.outbox[i].id == id then
			table.remove(db.outbox, i)
		end
	end
end

------------------------------------------------------------------------
-- Acciones
------------------------------------------------------------------------

function ns.LiveAvailable()
	return ns.Slots.ok and not ns.Slots.Exhausted()
end

function ns.Send(text)
	text = strtrim(text or "")
	if text == "" then
		return
	end
	local id = newId()
	table.insert(db.outbox, { id = id, type = "prompt", text = text, t = time() })
	ns.Term.UserLine(text)

	if not ns.LiveAvailable() then
		ns.Info("Enviando en modo lento (recargando la interfaz)...")
		ReloadUI()
		return
	end

	local parts = {}
	for i = 1, #text, CHUNK do
		table.insert(parts, text:sub(i, i + CHUNK - 1))
	end
	ns.Term.SetBusy("Enviando")
	for i, chunk in ipairs(parts) do
		local last = (i == #parts)
		queueFrame(string.format("P|%s|%d|%d|", id, i, #parts) .. chunk, last and function()
			removeFromOutbox(id)
			ns.Term.SetBusy("Esperando a Claude")
		end or nil)
	end
end

function ns.Reset()
	local id = newId()
	if ns.LiveAvailable() then
		queueFrame("R|" .. id)
	else
		table.insert(db.outbox, { id = id, type = "reset", t = time() })
		ReloadUI()
	end
end

function ns.Cancel()
	if ns.LiveAvailable() then
		queueFrame("X|" .. newId())
	else
		ns.Info("Para parar hace falta el canal en directo. Puedes pulsar Ctrl+C en el puente.")
	end
end

-- Respuesta a una petición de permiso: y (sí), a (siempre), n (no).
function ns.Answer(id, decision)
	if not ns.LiveAvailable() then
		ns.Info("Para responder hace falta el canal en directo.")
		return
	end
	ns.Term.Info("respondiendo...")
	queueFrame("A|" .. id .. "|" .. decision)
end

-- Comandos que entiende el puente.
local BRIDGE_COMMANDS = {
	sesiones = true, ver = true, dejar = true, usar = true,
	proyecto = true, modelo = true, modo = true, permisos = true, olvidar = true,
}

function ns.IsBridgeCommand(text)
	local name = (text or ""):match("^(%a+)")
	return name ~= nil and BRIDGE_COMMANDS[name] == true
end

function ns.BridgeCommand(text)
	if not ns.LiveAvailable() then
		ns.Info("Ese comando necesita el canal en directo.")
		return
	end
	queueFrame("C|" .. newId() .. "|" .. text)
end

function ns.Status()
	local inbox = ClaudeXWoW_Inbox or {}
	return {
		live = ns.LiveAvailable(),
		bridgeOk = ns.bridgeOk,
		pool = ns.Slots.pool,
		loads = ns.Slots.loads,
		project = inbox.project,
	}
end

------------------------------------------------------------------------
-- Comandos
------------------------------------------------------------------------

local function printHelp()
	ns.Info("v" .. ns.VERSION .. " - comandos:")
	ns.Info("  /claude <texto>   manda una tarea")
	ns.Info("  /claude           abre/cierra la terminal")
	ns.Info("  /claude nuevo     conversación nueva")
	ns.Info("  /claude stop      para la tarea actual")
	ns.Info("  /claude recargar  recarga (modo lento / reiniciar canal)")
	ns.Info("  /claude sesiones  tus sesiones de la terminal (/ver N, /usar N)")
	ns.Info("  /claude proyecto  cambia de carpeta de trabajo")
	ns.Info("  /claude modelo    elige modelo (sonnet, opus, haiku)")
	ns.Info("  /claude modo      editar / preguntar / plan")
	ns.Info("  /claude permisos  permisos guardados (y /olvidar N)")
	ns.Info("  /claude estado    estado de la conexión")
	ns.Info("  /claude minimapa  muestra/oculta el botón del minimapa")
	ns.Info("  Atajo de teclado: Menú > Atajos de teclado > AddOns > Claude x WoW")
end

function ns.Command(msg)
	msg = strtrim(msg or "")
	local cmd = msg:lower():gsub("^/", "")
	if msg == "" then
		ns.Term.Toggle()
	elseif cmd == "nuevo" or cmd == "new" then
		ns.Reset()
	elseif cmd == "stop" or cmd == "parar" then
		ns.Cancel()
	elseif cmd == "recargar" or cmd == "ver" or cmd == "reload" then
		ReloadUI()
	elseif cmd == "clear" or cmd == "limpiar" then
		ns.Term.Clear()
	elseif cmd == "minimapa" then
		ns.Minimap.Toggle()
	elseif ns.IsBridgeCommand(cmd) then
		ns.Term.Show()
		ns.BridgeCommand(cmd)
	elseif cmd == "estado" then
		local s = ns.Status()
		ns.Info(string.format("directo: %s | puente: %s | usados: %d/%d (lista %d, puente %d) | señales: %s | K=%d | proyecto: %s",
			s.live and "sí" or "no", s.bridgeOk and "ok" or "?", s.loads, s.pool,
			ns.Slots.listed or 0, ns.Slots.fromBridge or 0, ns.Slots.signalsOk and "ok" or "no", ns.Slots.k, s.project or "?"))
	elseif cmd == "ayuda" or cmd == "help" then
		ns.Term.Show()
		printHelp()
	else
		ns.Term.Show()
		ns.Send(msg)
	end
end

SLASH_CLAUDEXWOW1 = "/claude"
SLASH_CLAUDEXWOW2 = "/cxw"
SlashCmdList["CLAUDEXWOW"] = ns.Command

------------------------------------------------------------------------
-- Arranque
------------------------------------------------------------------------

local f = CreateFrame("Frame")
f:RegisterEvent("ADDON_LOADED")
f:RegisterEvent("PLAYER_LOGIN")
f:SetScript("OnEvent", function(self, event, arg1)
	if event == "ADDON_LOADED" and arg1 == ADDON_NAME then
		ClaudeXWoWDB = ClaudeXWoWDB or {}
		db = ClaudeXWoWDB
		db.outbox = db.outbox or {}
		db.lines = db.lines or {}
		db.lastEvent = db.lastEvent or 0
		db.inputHistory = db.inputHistory or {}
		db.window = db.window or {}
		db.asks = db.asks or {}
		db.history, db.seen = nil, nil -- restos de la v0.1
		ns.db = db
	elseif event == "PLAYER_LOGIN" then
		ns.Term.Init()
		ns.Minimap.Init()

		-- Lo que llegó mientras recargábamos (respaldo).
		local inbox = ClaudeXWoW_Inbox
		if type(inbox) == "table" then
			for _, id in ipairs(inbox.received or {}) do
				removeFromOutbox(id)
			end
			ns.Term.replaying = true
			ns.ApplyEvents(inbox.events)
			ns.Term.replaying = false
			if inbox.busy then
				ns.Term.SetBusy("Claude está trabajando")
			end
		end

		ns.Slots.Init()
		if ns.Slots.ok then
			-- Saludo: el puente nos reconoce y nos reenvía lo que nos falte.
			-- Sin aviso: tras la pantalla de carga puede tardar unos segundos.
			queueFrame("H|" .. db.lastEvent, function()
				ns.Term.SetConnected(true)
			end, true)
		end
	end
end)
