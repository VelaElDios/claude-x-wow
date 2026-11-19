-- Claude x WoW - botón del minimapa (arrastrable alrededor del borde)
local ADDON_NAME, ns = ...

local Btn = {}
ns.Minimap = Btn

local ICON = "Interface\\Icons\\Spell_Nature_Lightning"
local button, glow

local function db()
	return ns.db.minimap
end

local function place()
	local angle = math.rad(db().angle or 200)
	local r = (Minimap:GetWidth() / 2) + 6
	button:ClearAllPoints()
	button:SetPoint("CENTER", Minimap, "CENTER", math.cos(angle) * r, math.sin(angle) * r)
end

local function build()
	button = CreateFrame("Button", "ClaudeXWoWMinimapButton", Minimap)
	button:SetSize(31, 31)
	button:SetFrameStrata("MEDIUM")
	button:SetFrameLevel(8)
	button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
	button:RegisterForDrag("LeftButton")
	button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

	local bg = button:CreateTexture(nil, "BACKGROUND")
	bg:SetTexture("Interface\\Minimap\\UI-Minimap-Background")
	bg:SetSize(20, 20)
	bg:SetPoint("TOPLEFT", 7, -5)

	local icon = button:CreateTexture(nil, "ARTWORK")
	icon:SetTexture(ICON)
	icon:SetSize(17, 17)
	icon:SetPoint("TOPLEFT", 7, -6)
	icon:SetTexCoord(0.05, 0.95, 0.05, 0.95)

	local border = button:CreateTexture(nil, "OVERLAY")
	border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
	border:SetSize(53, 53)
	border:SetPoint("TOPLEFT")

	-- Brillo naranja cuando hay algo nuevo.
	glow = button:CreateTexture(nil, "OVERLAY")
	glow:SetTexture("Interface\\Buttons\\UI-ActionButton-Border")
	glow:SetBlendMode("ADD")
	glow:SetVertexColor(0.85, 0.47, 0.34)
	glow:SetSize(52, 52)
	glow:SetPoint("CENTER", icon, "CENTER")
	glow:Hide()

	button:SetScript("OnClick", function(_, mouse)
		if mouse == "RightButton" then
			ns.Command("estado")
		else
			ns.Term.Toggle()
		end
	end)
	button:SetScript("OnDragStart", function(self)
		self:SetScript("OnUpdate", function()
			local mx, my = Minimap:GetCenter()
			local cx, cy = GetCursorPosition()
			local scale = Minimap:GetEffectiveScale()
			db().angle = math.deg(math.atan2(cy / scale - my, cx / scale - mx))
			place()
		end)
	end)
	button:SetScript("OnDragStop", function(self)
		self:SetScript("OnUpdate", nil)
	end)
	button:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_LEFT")
		GameTooltip:AddLine("|cffd97757Claude x WoW|r")
		GameTooltip:AddLine("Clic: abrir/cerrar la terminal", 1, 1, 1)
		GameTooltip:AddLine("Clic derecho: estado de la conexión", 1, 1, 1)
		GameTooltip:AddLine("Arrastra para moverlo", 0.6, 0.6, 0.6)
		GameTooltip:Show()
	end)
	button:SetScript("OnLeave", function()
		GameTooltip:Hide()
	end)
	place()
end

function Btn.Init()
	ns.db.minimap = ns.db.minimap or { angle = 200, hidden = false }
	if not db().hidden then
		build()
	end
end

function Btn.Toggle()
	db().hidden = not db().hidden
	if db().hidden then
		if button then
			button:Hide()
		end
		ns.Info("Botón del minimapa oculto. /claude minimapa para volver a mostrarlo.")
	else
		if not button then
			build()
		end
		button:Show()
	end
end

-- Enciende (o apaga) el brillo de "hay algo nuevo".
function Btn.Pulse(on)
	if glow then
		glow:SetShown(on ~= false)
	end
end
