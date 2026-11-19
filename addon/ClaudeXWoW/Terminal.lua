-- Claude x WoW - terminal estilo Claude Code
local ADDON_NAME, ns = ...

local Term = {}
ns.Term = Term

local FONT = "Interface\\AddOns\\ClaudeXWoW\\Fonts\\JetBrainsMono-Regular.ttf"
local FONT_BOLD = "Interface\\AddOns\\ClaudeXWoW\\Fonts\\JetBrainsMono-Bold.ttf"
local SIZE = 12
local MAX_LINES = 600

local ORANGE = "|cffd97757"
local GRAY = "|cff8a8a8a"
local DIM = "|cff5f5f5f"
local WHITE = "|cffffffff"
local GREEN = "|cff6fcf73"
local RED = "|cffff6b6b"
local YELLOW = "|cffffd166"
local BASE = { 0.85, 0.85, 0.85 }

local SPINNER = { "·", "•", "●", "•" }

local frame, out, input, busyText, footer, statusDot
local busy, busyLabel, busyStart
local histIndex

local function db()
	return ns.db
end

------------------------------------------------------------------------
-- Salida
------------------------------------------------------------------------

local function addLine(text, persist)
	if out then
		out:AddMessage(text, BASE[1], BASE[2], BASE[3])
	end
	if persist ~= false then
		local lines = db().lines
		table.insert(lines, text)
		while #lines > MAX_LINES do
			table.remove(lines, 1)
		end
	end
end

local function addBlock(text, firstPrefix, restPrefix, color)
	local first = true
	text = (text or ""):gsub("\r", "")
	for line in (text .. "\n"):gmatch("(.-)\n") do
		addLine((first and firstPrefix or restPrefix) .. (color or "") .. line .. (color and "|r" or ""))
		first = false
	end
end

local function esc(s)
	return (tostring(s or ""):gsub("|", "||"))
end

function Term.UserLine(text)
	addLine(" ")
	addBlock(esc(text), DIM .. "❯|r ", "  ", WHITE)
end

function Term.Info(text)
	addLine(DIM .. "·|r " .. GRAY .. text .. "|r")
end

function Term.Clear()
	if out then
		out:Clear()
	end
	wipe(db().lines)
end

-- Eventos del puente. El texto ya viene con colores de WoW (el puente
-- convierte el Markdown), así que no se escapa.
function Term.Event(e)
	local k = e.k
	if k == "start" then
		Term.SetBusy("Pensando")
	elseif k == "text" then
		addLine(" ")
		addBlock(e.text, WHITE .. "●|r ", "  ")
	elseif k == "tool" then
		addLine(" ")
		local detail = (e.detail and e.detail ~= "") and ("(" .. GRAY .. e.detail .. "|r)") or ""
		addLine(GREEN .. "●|r " .. WHITE .. esc(e.name) .. "|r" .. detail)
		if not e.ro then
			Term.SetBusy(e.label or ("Usando " .. esc(e.name)))
		end
	elseif k == "result" then
		addBlock(e.text, "  " .. DIM .. "└|r ", "    ", e.err and RED or GRAY)
		if not e.ro then
			Term.SetBusy("Pensando")
		end
	elseif k == "done" then
		Term.SetBusy(nil)
		addLine(" ")
		addLine(ORANGE .. "✶|r " .. GRAY .. (e.summary or "Hecho") .. "|r")
		Term.Notify("Claude ha terminado (" .. (e.summary or "hecho") .. "). Abre la terminal con /claude.")
	elseif k == "error" then
		Term.SetBusy(nil)
		addLine(" ")
		addBlock(e.text, RED .. "● Error:|r ", "  ", RED)
		Term.Notify("Claude ha tenido un error. Abre la terminal con /claude.")
	elseif k == "info" then
		Term.Info(e.text)
	elseif k == "prompt" then
		addLine(" ")
		addBlock(e.text, DIM .. "❯|r ", "  ", WHITE)
	elseif k == "block" then
		addLine(" ")
		addBlock(e.text, "  ", "  ")
	elseif k == "ask" then
		local asks = db().asks
		asks[e.id] = true
		addLine(" ")
		addLine(YELLOW .. "?|r " .. WHITE .. "Claude quiere usar " .. esc(e.name) .. "|r" .. GRAY .. "(" .. (e.detail or "") .. ")|r")
		local function link(d, label, color)
			return "|Haddon:cxw:" .. d .. ":" .. e.id .. "|h" .. color .. "[ " .. label .. " ]|r|h"
		end
		addLine("  " .. link("y", "Sí", GREEN) .. "  " .. link("a", "Esta sesión", GREEN) .. "  "
			.. link("p", "Siempre: " .. (e.rule or ""), GREEN) .. "  " .. link("n", "No", RED))
		addLine("  " .. DIM .. "o escribe s / sesion / siempre / n|r")
		Term.SetBusy("Esperando tu permiso")
		Term.Alert("Claude necesita tu permiso para usar " .. esc(e.name) .. ".")
	elseif k == "answered" then
		db().asks[e.id] = nil
		local text = ({
			y = GREEN .. "✓ Permitido|r",
			a = GREEN .. "✓ Permitido " .. (e.rule or "") .. " mientras el puente siga abierto|r",
			p = GREEN .. "✓ Permitido siempre " .. (e.rule or "") .. " (guardado; /permisos para verlo)|r",
			n = RED .. "✗ Denegado|r",
			timeout = RED .. "✗ Sin respuesta a tiempo: denegado|r",
			cancel = GRAY .. "✗ Cancelado|r",
		})[e.decision] or e.decision
		addLine("  " .. DIM .. "└|r " .. text)
		if e.decision == "y" or e.decision == "a" then
			Term.SetBusy("Pensando")
		end
	elseif k == "status" then
		Term.SetBusy(e.busy and (e.label or "Claude está trabajando") or nil)
		if e.project then
			Term.SetProject(e.project, e.model, e.mode)
		end
		if e.asks then
			wipe(db().asks)
			for _, id in ipairs(e.asks) do
				db().asks[id] = true
			end
		end
	end
end

------------------------------------------------------------------------
-- Estado
------------------------------------------------------------------------

-- Llama la atención aunque la terminal esté cerrada.
function Term.Alert(text)
	if frame and not frame:IsShown() then
		frame:Show()
	end
	DEFAULT_CHAT_FRAME:AddMessage(ORANGE .. "Claude x WoW:|r " .. text)
	if PlaySound and SOUNDKIT and SOUNDKIT.TELL_MESSAGE then
		pcall(PlaySound, SOUNDKIT.TELL_MESSAGE)
	end
end

-- Aviso discreto (chat + sonido) solo si la terminal está cerrada.
function Term.Notify(text)
	if frame and frame:IsShown() then
		return
	end
	if Term.replaying then
		return
	end
	DEFAULT_CHAT_FRAME:AddMessage(ORANGE .. "Claude x WoW:|r " .. text)
	if PlaySound and SOUNDKIT and SOUNDKIT.TELL_MESSAGE then
		pcall(PlaySound, SOUNDKIT.TELL_MESSAGE)
	end
	if ns.Minimap then
		ns.Minimap.Pulse()
	end
end

-- Última petición de permiso sin responder (o nil).
function Term.PendingAsk()
	local last
	for id in pairs(db().asks) do
		if not last or tonumber(id) > tonumber(last) then
			last = id
		end
	end
	return last
end

function Term.SetBusy(label)
	busy = label ~= nil
	busyLabel = label
	if busy and not busyStart then
		busyStart = GetTime()
	elseif not busy then
		busyStart = nil
	end
	if busyText and not busy then
		busyText:SetText("")
	end
end

function Term.SetConnected(ok)
	if statusDot then
		statusDot:SetText(ok and (GREEN .. "● conectado|r") or (RED .. "● sin conexión|r"))
	end
end

function Term.SetProject(name, model, mode)
	if frame then
		local extra = ""
		if model and model ~= "defecto" then
			extra = extra .. DIM .. " · |r" .. GRAY .. esc(model) .. "|r"
		end
		if mode and mode ~= "editar" then
			extra = extra .. DIM .. " · |r" .. YELLOW .. "modo " .. esc(mode) .. "|r"
		end
		frame.project:SetText(GRAY .. "~/" .. esc(name) .. "|r" .. extra)
	end
end

------------------------------------------------------------------------
-- Ventana
------------------------------------------------------------------------

local function setFont(fs, size, bold)
	fs:SetFont(bold and FONT_BOLD or FONT, size, "")
	if not fs:GetFont() then
		fs:SetFont("Fonts\\ARIALN.TTF", size, "")
	end
end

local function savePosition()
	local w = db().window
	local point, _, rel, x, y = frame:GetPoint()
	w.point, w.rel, w.x, w.y = point, rel, x, y
	w.width, w.height = frame:GetSize()
end

local function submit(text)
	text = strtrim(text or "")
	input:SetText("")
	histIndex = nil
	if text == "" then
		return
	end
	local h = db().inputHistory
	if h[#h] ~= text then
		table.insert(h, text)
		while #h > 50 do
			table.remove(h, 1)
		end
	end
	local cmd = text:lower()
	local ask = Term.PendingAsk()
	local answer = ask and ({ s = "y", ["si"] = "y", ["sí"] = "y", y = "y", yes = "y",
		sesion = "a", ["sesión"] = "a", siempre = "p", always = "p", n = "n", no = "n" })[cmd]
	if answer then
		ns.Answer(ask, answer)
	elseif cmd == "/clear" or cmd == "/limpiar" then
		Term.Clear()
	elseif cmd == "/nuevo" or cmd == "/new" then
		ns.Reset()
	elseif cmd == "/stop" or cmd == "/parar" then
		ns.Cancel()
	elseif cmd == "/recargar" or cmd == "/reload" then
		ReloadUI()
	elseif ns.IsBridgeCommand(cmd:sub(2)) then
		ns.BridgeCommand(cmd:sub(2))
	elseif cmd == "/estado" or cmd == "/ayuda" or cmd == "/help" then
		ns.Command(cmd)
	else
		ns.Send(text)
	end
end

local function build()
	local w = db().window
	frame = CreateFrame("Frame", "ClaudeXWoWTerminal", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
	frame:SetSize(w.width or 680, w.height or 440)
	frame:SetPoint(w.point or "CENTER", UIParent, w.rel or "CENTER", w.x or 0, w.y or 0)
	frame:SetFrameStrata("HIGH")
	frame:SetClampedToScreen(true)
	frame:SetMovable(true)
	frame:SetResizable(true)
	if frame.SetResizeBounds then
		frame:SetResizeBounds(420, 260)
	elseif frame.SetMinResize then
		frame:SetMinResize(420, 260)
	end
	frame:EnableMouse(true)
	frame:SetBackdrop({
		bgFile = "Interface\\Buttons\\WHITE8X8",
		edgeFile = "Interface\\Buttons\\WHITE8X8",
		edgeSize = 1,
	})
	frame:SetBackdropColor(0.075, 0.075, 0.085, 0.96)
	frame:SetBackdropBorderColor(0.85, 0.47, 0.34, 0.8)
	frame:Hide()
	tinsert(UISpecialFrames, "ClaudeXWoWTerminal")

	-- Barra de título (arrastrable).
	local bar = CreateFrame("Frame", nil, frame)
	bar:SetPoint("TOPLEFT", 1, -1)
	bar:SetPoint("TOPRIGHT", -1, -1)
	bar:SetHeight(26)
	bar:EnableMouse(true)
	bar:RegisterForDrag("LeftButton")
	bar:SetScript("OnDragStart", function()
		frame:StartMoving()
	end)
	bar:SetScript("OnDragStop", function()
		frame:StopMovingOrSizing()
		savePosition()
	end)
	local barBg = bar:CreateTexture(nil, "BACKGROUND")
	barBg:SetAllPoints()
	barBg:SetColorTexture(0.11, 0.11, 0.125, 1)

	local title = bar:CreateFontString(nil, "OVERLAY")
	setFont(title, 13, true)
	title:SetPoint("LEFT", 10, 0)
	title:SetText(ORANGE .. "✶|r " .. WHITE .. "Claude Code|r " .. DIM .. "· WoW|r")

	frame.project = bar:CreateFontString(nil, "OVERLAY")
	setFont(frame.project, 11)
	frame.project:SetPoint("LEFT", title, "RIGHT", 12, 0)

	statusDot = bar:CreateFontString(nil, "OVERLAY")
	setFont(statusDot, 11)
	statusDot:SetPoint("RIGHT", -34, 0)

	local close = CreateFrame("Button", nil, bar)
	close:SetSize(24, 24)
	close:SetPoint("RIGHT", -4, 0)
	local closeText = close:CreateFontString(nil, "OVERLAY")
	setFont(closeText, 14)
	closeText:SetPoint("CENTER")
	closeText:SetText(GRAY .. "×|r")
	close:SetScript("OnClick", function()
		frame:Hide()
	end)

	-- Salida.
	out = CreateFrame("ScrollingMessageFrame", nil, frame)
	out:SetPoint("TOPLEFT", 12, -34)
	out:SetPoint("BOTTOMRIGHT", -12, 76)
	setFont(out, SIZE)
	out:SetJustifyH("LEFT")
	out:SetFading(false)
	out:SetMaxLines(MAX_LINES)
	out:SetSpacing(2)
	out:SetInsertMode(SCROLLING_MESSAGE_FRAME_INSERT_MODE_BOTTOM or "BOTTOM")
	out:SetHyperlinksEnabled(true)
	out:SetScript("OnHyperlinkClick", function(_, link)
		link = tostring(link)
		local c, n = link:match("^addon:cxw:cmd:(%a+):([%w%-]+)$")
		if c then
			ns.BridgeCommand(c .. " " .. n)
			return
		end
		local d, id = link:match("^addon:cxw:(%a):(%d+)$")
		if d and db().asks[id] then
			ns.Answer(id, d)
		end
	end)
	out:EnableMouseWheel(true)
	out:SetScript("OnMouseWheel", function(self, delta)
		local n = IsShiftKeyDown() and 10 or 3
		for _ = 1, n do
			if delta > 0 then
				self:ScrollUp()
			else
				self:ScrollDown()
			end
		end
	end)

	-- Línea de "trabajando".
	busyText = frame:CreateFontString(nil, "OVERLAY")
	setFont(busyText, SIZE)
	busyText:SetPoint("BOTTOMLEFT", 12, 58)
	busyText:SetJustifyH("LEFT")

	local tick, i = 0, 1
	frame:SetScript("OnUpdate", function(_, elapsed)
		if not busy then
			return
		end
		tick = tick + elapsed
		if tick < 0.15 then
			return
		end
		tick = 0
		i = i % #SPINNER + 1
		local secs = busyStart and math.floor(GetTime() - busyStart) or 0
		busyText:SetText(ORANGE .. SPINNER[i] .. " " .. busyLabel .. "…|r " .. DIM .. "(" .. secs .. "s · /stop para parar)|r")
	end)

	-- Caja de entrada.
	local box = CreateFrame("Frame", nil, frame, BackdropTemplateMixin and "BackdropTemplate" or nil)
	box:SetPoint("BOTTOMLEFT", 10, 24)
	box:SetPoint("BOTTOMRIGHT", -10, 24)
	box:SetHeight(30)
	box:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
	box:SetBackdropColor(0.05, 0.05, 0.06, 1)
	box:SetBackdropBorderColor(0.35, 0.35, 0.38, 1)

	local prompt = box:CreateFontString(nil, "OVERLAY")
	setFont(prompt, 13, true)
	prompt:SetPoint("LEFT", 10, 0)
	prompt:SetText(ORANGE .. "❯|r")

	input = CreateFrame("EditBox", nil, box)
	input:SetPoint("LEFT", prompt, "RIGHT", 8, 0)
	input:SetPoint("RIGHT", -8, 0)
	input:SetHeight(26)
	setFont(input, 13)
	input:SetTextColor(1, 1, 1)
	input:SetAutoFocus(false)
	input:SetMaxLetters(4000)
	input:SetAltArrowKeyMode(false)
	input:SetScript("OnEnterPressed", function(self)
		submit(self:GetText())
	end)
	input:SetScript("OnEscapePressed", function(self)
		self:ClearFocus()
	end)
	input:SetScript("OnEditFocusGained", function()
		box:SetBackdropBorderColor(0.85, 0.47, 0.34, 1)
	end)
	input:SetScript("OnEditFocusLost", function()
		box:SetBackdropBorderColor(0.35, 0.35, 0.38, 1)
	end)
	input:SetScript("OnArrowPressed", function(self, key)
		local h = db().inputHistory
		if #h == 0 or (key ~= "UP" and key ~= "DOWN") then
			return
		end
		if key == "UP" then
			histIndex = math.max(1, (histIndex or (#h + 1)) - 1)
		else
			histIndex = (histIndex or #h) + 1
		end
		if histIndex > #h then
			histIndex = nil
			self:SetText("")
		else
			self:SetText(h[histIndex])
		end
	end)
	box:EnableMouse(true)
	box:SetScript("OnMouseDown", function()
		input:SetFocus()
	end)

	footer = frame:CreateFontString(nil, "OVERLAY")
	setFont(footer, 10)
	footer:SetPoint("BOTTOMLEFT", 12, 8)
	footer:SetText(DIM .. "enter enviar · ↑↓ historial · /ayuda · /sesiones · /proyecto · /modelo · /modo · /stop · esc cerrar|r")

	-- Asa para redimensionar.
	local grip = CreateFrame("Button", nil, frame)
	grip:SetSize(16, 16)
	grip:SetPoint("BOTTOMRIGHT", -2, 2)
	grip:SetNormalTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Up")
	grip:SetHighlightTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Highlight")
	grip:SetPushedTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Down")
	grip:SetScript("OnMouseDown", function()
		frame:StartSizing("BOTTOMRIGHT")
	end)
	grip:SetScript("OnMouseUp", function()
		frame:StopMovingOrSizing()
		savePosition()
	end)

	frame:SetScript("OnShow", function()
		db().window.open = true
	end)
	frame:SetScript("OnHide", function()
		db().window.open = false
	end)

	-- Pantalla de bienvenida + historial guardado.
	for _, line in ipairs(db().lines) do
		out:AddMessage(line, BASE[1], BASE[2], BASE[3])
	end
	if #db().lines == 0 then
		addLine(ORANGE .. "✶|r " .. WHITE .. "Bienvenido a Claude x WoW|r")
		addLine("  " .. GRAY .. "Escribe una tarea abajo y Claude Code la hará en tu proyecto.|r")
		addLine("  " .. GRAY .. "Puedes seguir jugando mientras trabaja.|r")
	end
	Term.SetConnected(false)
	local inbox = ClaudeXWoW_Inbox
	if type(inbox) == "table" and inbox.project then
		Term.SetProject(inbox.project)
	end
end

function Term.Init()
	build()
	if db().window.open then
		frame:Show()
	end
end

function Term.Show()
	frame:Show()
end

function Term.Toggle()
	frame:SetShown(not frame:IsShown())
	if frame:IsShown() then
		input:SetFocus()
		if ns.Minimap then
			ns.Minimap.Pulse(false)
		end
	end
end

-- Para el atajo de teclado (Bindings.xml).
function ClaudeXWoW_Toggle()
	Term.Toggle()
end
BINDING_HEADER_CLAUDEXWOW = "Claude x WoW"
BINDING_NAME_CLAUDEXWOW_TOGGLE = "Abrir/cerrar la terminal"
