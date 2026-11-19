-- Claude x WoW - ventana de chat
local ADDON_NAME, ns = ...

local ROLE_LABEL = {
	user = "|cff66ccffTú:|r ",
	claude = "|cffd97757Claude:|r ",
	error = "|cffff5555Error:|r ",
	system = "|cff999999-- ",
}

local frame, history, input, statusText

local function build()
	frame = CreateFrame("Frame", "ClaudeXWoWFrame", UIParent, "BasicFrameTemplateWithInset")
	frame:SetSize(540, 420)
	frame:SetPoint("CENTER")
	frame:SetMovable(true)
	frame:EnableMouse(true)
	frame:RegisterForDrag("LeftButton")
	frame:SetScript("OnDragStart", frame.StartMoving)
	frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
	frame:SetClampedToScreen(true)
	frame:Hide()
	tinsert(UISpecialFrames, "ClaudeXWoWFrame") -- Esc la cierra

	local title = frame.TitleText or frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
	if not frame.TitleText then
		title:SetPoint("TOP", 0, -5)
	end
	title:SetText("Claude x WoW")

	statusText = frame:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
	statusText:SetPoint("TOPLEFT", 14, -30)

	local scroll = CreateFrame("ScrollFrame", nil, frame, "UIPanelScrollFrameTemplate")
	scroll:SetPoint("TOPLEFT", 12, -46)
	scroll:SetPoint("BOTTOMRIGHT", -32, 44)

	history = CreateFrame("EditBox", nil, scroll)
	history:SetMultiLine(true)
	history:SetFontObject(ChatFontNormal)
	history:SetWidth(480)
	history:SetAutoFocus(false)
	history:EnableMouse(true)
	history:SetScript("OnEscapePressed", history.ClearFocus)
	-- Solo lectura: si el usuario escribe, restauramos el texto.
	history:SetScript("OnTextChanged", function(self, userInput)
		if userInput and self.fullText then
			self:SetText(self.fullText)
		end
	end)
	scroll:SetScrollChild(history)
	frame.scroll = scroll

	input = CreateFrame("EditBox", nil, frame, "InputBoxTemplate")
	input:SetSize(330, 24)
	input:SetPoint("BOTTOMLEFT", 20, 12)
	input:SetAutoFocus(false)
	input:SetMaxLetters(2000)
	input:SetScript("OnEnterPressed", function(self)
		ns.Send(self:GetText())
	end)
	input:SetScript("OnEscapePressed", input.ClearFocus)

	local send = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
	send:SetSize(80, 24)
	send:SetPoint("LEFT", input, "RIGHT", 8, 0)
	send:SetText("Enviar")
	send:SetScript("OnClick", function()
		ns.Send(input:GetText())
	end)

	local refresh = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
	refresh:SetSize(90, 24)
	refresh:SetPoint("LEFT", send, "RIGHT", 6, 0)
	refresh:SetText("Actualizar")
	refresh:SetScript("OnClick", ns.Refresh)

	frame:SetScript("OnShow", function()
		ClaudeXWoWDB.windowOpen = true
		ns.RenderHistory()
	end)
	frame:SetScript("OnHide", function()
		ClaudeXWoWDB.windowOpen = false
	end)
end

function ns.RenderHistory()
	if not frame then
		return
	end
	local parts = {}
	for _, h in ipairs(ClaudeXWoWDB.history) do
		local label = ROLE_LABEL[h.role] or ""
		local text = (h.text or ""):gsub("|", "||") -- evita códigos de color raros
		if h.role == "system" then
			text = text .. " --|r"
		end
		table.insert(parts, label .. text)
	end
	history.fullText = table.concat(parts, "\n\n")
	history:SetText(history.fullText)

	local s = ns.Status()
	local bridge = (s.bridge == "ok") and "|cff55ff55conectado|r"
		or (s.bridge == "caido") and "|cffff5555no responde|r"
		or "|cffff5555sin conectar|r"
	local extra = ""
	if s.working > 0 then
		extra = "  |cffffff00trabajando...|r"
	elseif s.pending > 0 then
		extra = "  |cffffff00enviado, esperando|r"
	end
	statusText:SetText("Puente: " .. bridge .. "   Proyecto: " .. (s.project or "?") .. extra)

	C_Timer.After(0, function()
		frame.scroll:SetVerticalScroll(frame.scroll:GetVerticalScrollRange())
	end)
end

function ns.ToggleWindow()
	if not frame then
		build()
	end
	frame:SetShown(not frame:IsShown())
end

function ns.RestoreWindow()
	if ClaudeXWoWDB.windowOpen then
		if not frame then
			build()
		end
		frame:Show()
		ns.RenderHistory()
	end
end
