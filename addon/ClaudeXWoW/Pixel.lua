-- Claude x WoW - canal juego -> PC
-- Dibuja una tira de bloques de colores en la esquina superior izquierda.
-- El puente la captura de la pantalla y la decodifica.
-- Formato: ver bridge/protocol.js (deben coincidir).

local ADDON_NAME, ns = ...

local COLS, ROWS = 64, 12
local DATA_START = COLS + 4
local SYMBOLS = COLS * ROWS - DATA_START
local HEADER = 9
local BLOCK_PX = 4 -- píxeles físicos por bloque (el puente mide el tamaño real)
local LEVEL = { 0, 85 / 255, 170 / 255, 1 }
local floor = math.floor

local Pixel = {}
ns.Pixel = Pixel
Pixel.MAX_PAYLOAD = floor(SYMBOLS * 6 / 8) - HEADER - 2

local strip
local tex = {}

local function blockSize()
	local _, physH = GetPhysicalScreenSize()
	return BLOCK_PX * GetScreenHeight() / physH
end

local function layout()
	local s = blockSize()
	strip:SetSize(COLS * s, ROWS * s)
	for i = 0, COLS * ROWS - 1 do
		local t = tex[i]
		t:ClearAllPoints()
		t:SetSize(s, s)
		t:SetPoint("TOPLEFT", strip, "TOPLEFT", (i % COLS) * s, -floor(i / COLS) * s)
	end
end

local function build()
	strip = CreateFrame("Frame", "ClaudeXWoWStrip", UIParent)
	strip:SetFrameStrata("TOOLTIP")
	strip:SetToplevel(true)
	strip:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
	for i = 0, COLS * ROWS - 1 do
		local t = strip:CreateTexture(nil, "OVERLAY")
		t:SetColorTexture(0, 0, 0, 1)
		tex[i] = t
	end
	-- Fila 0: sincronía (blanco/negro alterno).
	for c = 0, COLS - 1 do
		local v = (c % 2 == 0) and 1 or 0
		tex[c]:SetColorTexture(v, v, v, 1)
	end
	-- Fila 1: calibración.
	for k = 0, 3 do
		local v = LEVEL[k + 1]
		tex[COLS + k]:SetColorTexture(v, v, v, 1)
	end
	layout()
	strip:RegisterEvent("UI_SCALE_CHANGED")
	strip:RegisterEvent("DISPLAY_SIZE_CHANGED")
	strip:SetScript("OnEvent", layout)
	strip:Hide()
end

local function fletcher16(s)
	local s1, s2 = 0, 0
	for i = 1, #s do
		s1 = (s1 + s:byte(i)) % 255
		s2 = (s2 + s1) % 255
	end
	return s2 * 256 + s1
end

local function u16(n)
	return string.char(floor(n / 256) % 256, n % 256)
end

local function setSymbol(i, s)
	local r, g, b = floor(s / 16) % 4, floor(s / 4) % 4, s % 4
	tex[DATA_START + i]:SetColorTexture(LEVEL[r + 1], LEVEL[g + 1], LEVEL[b + 1], 1)
end

function Pixel.Show(nonce, seq, cursor, payload)
	if not strip then
		build()
	end
	local body = string.char(1) .. u16(nonce) .. u16(seq) .. u16(cursor) .. u16(#payload) .. payload
	local bytes = body .. u16(fletcher16(body))
	local idx = 0
	for i = 1, #bytes, 3 do
		local a, b, c = bytes:byte(i, i + 2)
		local n = a * 65536 + (b or 0) * 256 + (c or 0)
		setSymbol(idx, floor(n / 262144))
		setSymbol(idx + 1, floor(n / 4096) % 64)
		setSymbol(idx + 2, floor(n / 64) % 64)
		setSymbol(idx + 3, n % 64)
		idx = idx + 4
	end
	for i = idx, SYMBOLS - 1 do
		setSymbol(i, 0)
	end
	strip:Show()
end

function Pixel.Hide()
	if strip then
		strip:Hide()
	end
end
