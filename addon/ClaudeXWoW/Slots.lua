-- Claude x WoW - canal PC -> juego
--
-- El puente escribe cada lote de eventos en un "addon ranura" (ClaudeXWoW_S001,
-- S002...): addons LoadOnDemand que el WoW lee del disco en el momento de
-- cargarlos. Para saber CUÁNDO cargar, el puente mantiene un contador K en la
-- carpeta sig/ con archivos vacíos que borra o recrea (bit=1 <=> borrado), en
-- código Gray. PlaySoundFile(ruta) devuelve true si el archivo existe, y el
-- cliente lo comprueba en caliente para archivos que existían al arrancar.
-- Ver bridge/signals.js.

local ADDON_NAME, ns = ...

local C = C_AddOns or {}
local GetNumAddOns = C.GetNumAddOns or GetNumAddOns
local GetAddOnInfo = C.GetAddOnInfo or GetAddOnInfo
local LoadAddOn = C.LoadAddOn or LoadAddOn
local floor = math.floor

local BITS, MOD = 10, 1024
local SIG = "Interface\\AddOns\\ClaudeXWoW\\sig\\"
local POLL = 0.2
local FULL_READ_EVERY = 2

local Slots = { k = 0, loads = 0, pool = 0, ok = false }
ns.Slots = Slots

local function slotName(i)
	return string.format("ClaudeXWoW_S%03d", i)
end

local function present(name)
	local willPlay, handle = PlaySoundFile(SIG .. name .. ".wav", "Master")
	if handle then
		StopSound(handle)
	end
	return willPlay and true or false
end

local function bxor(a, b)
	local r, p = 0, 1
	while a > 0 or b > 0 do
		local x, y = a % 2, b % 2
		if x ~= y then
			r = r + p
		end
		a, b, p = (a - x) / 2, (b - y) / 2, p * 2
	end
	return r
end

local function readK()
	local g, p = 0, 1
	for b = 0, BITS - 1 do
		if not present("b" .. b) then
			g = g + p
		end
		p = p * 2
	end
	local n, s = g, floor(g / 2)
	while s > 0 do
		n = bxor(n, s)
		s = floor(s / 2)
	end
	return n
end
Slots.readK = readK

local function slotFor(k)
	local kk = (k == 0) and MOD or k
	return (kk - 1) % Slots.pool + 1
end

function Slots.Init()
	-- Cuántas ranuras hay: lo que vemos en la lista de addons y lo que dice el puente.
	local listed = 0
	for i = 1, GetNumAddOns() do
		local name = GetAddOnInfo(i)
		local n = type(name) == "string" and name:match("^ClaudeXWoW_S(%d+)$")
		if n then
			listed = math.max(listed, tonumber(n))
		end
	end
	local fromBridge = (type(ClaudeXWoW_Inbox) == "table" and tonumber(ClaudeXWoW_Inbox.slotPool)) or 0
	local pool = math.max(listed, fromBridge)
	if C.DoesAddOnExist then
		while pool > 0 and not C.DoesAddOnExist(slotName(pool)) do
			pool = pool - 1
		end
	end
	Slots.pool = pool
	Slots.listed, Slots.fromBridge = listed, fromBridge

	-- Autotest: "on" existe siempre y "off" nunca.
	Slots.signalsOk = present("on") and not present("off")
	Slots.ok = Slots.pool > 0 and Slots.signalsOk

	if Slots.pool == 0 then
		ns.Info("No hay canal en directo instalado. Ejecuta |cffffffffclaude-x-wow start|r y reinicia el WoW.")
	elseif not Slots.signalsOk then
		ns.Info("El canal en directo no está disponible (señales no detectadas). Abre |cffffffffclaude-x-wow start|r, cierra el WoW y vuelve a abrirlo. Mientras, funciona en modo lento.")
	end

	if Slots.ok then
		-- Lo publicado antes de entrar ya no es para nosotros.
		Slots.k = readK()
		Slots.tick = present("t")
		Slots.lastFull = GetTime()
		ns.Info(string.format("Canal en directo listo (%d canales).", Slots.pool))
		C_Timer.NewTicker(POLL, Slots.Poll)
	end
end

function Slots.Exhausted()
	return Slots.ok and Slots.loads >= Slots.pool
end

local RELOAD_LINK = "|Haddon:cxw:reload:0|h|cffd97757[ Reiniciar canal ]|r|h"

local function loadNext()
	if Slots.loads >= Slots.pool then
		if not Slots.warnedEmpty then
			Slots.warnedEmpty = true
			ns.Info("Canal en directo agotado. Lo que falte no se pierde: llegará al reiniciar. " .. RELOAD_LINK)
		end
		return false
	end
	Slots.k = (Slots.k + 1) % MOD
	Slots.loads = Slots.loads + 1
	if not Slots.warnedLow and Slots.loads >= math.floor(Slots.pool * 0.8) then
		Slots.warnedLow = true
		ns.Info(string.format("Canal en directo al 80%% (%d/%d). Cuando Claude acabe, reinícialo sin perder nada: ", Slots.loads, Slots.pool) .. RELOAD_LINK)
	end
	local name = slotName(slotFor(Slots.k))
	local loaded, reason = LoadAddOn(name)
	if not loaded then
		ns.Info("No se pudo cargar " .. name .. " (" .. tostring(reason) .. "). Activa los addons \"Claude x WoW - canal\" en la lista de addons.")
	end
	return true
end

function Slots.Poll()
	local tick = present("t")
	if tick == Slots.tick and GetTime() - Slots.lastFull < FULL_READ_EVERY then
		return
	end
	Slots.tick = tick
	Slots.lastFull = GetTime()
	local k = readK()
	local diff = (k - Slots.k) % MOD
	if diff == 0 or diff > MOD / 2 then
		return
	end
	for _ = 1, diff do
		if not loadNext() then
			break
		end
	end
	ns.RefreshFrame()
end

-- Lo llama el Data.lua de cada ranura.
function ClaudeXWoW_OnSlot(nonce, ack, events)
	ns.HandleSlot(nonce, ack, events)
end
