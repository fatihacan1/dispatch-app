package tui

import (
	"fmt"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/fatihacan1/dispatch-app/internal/agent"
	"github.com/fatihacan1/dispatch-app/internal/provider"
	"github.com/fatihacan1/dispatch-app/internal/theme"
	"strings"
	"time"
)

func demoAgents() []*agent.Agent {
	return []*agent.Agent{
		{Name: "boss", Provider: "claude", Status: "working", Tokens: 8100, Transcript: []string{"> refactor the auth module and split the work", "I'll recruit a coder and a scout.", "[tool] ran dispatch spawn --template coder --name c1", "✉ boss → c1: implement token refresh"}},
		{Name: "c1", Provider: "codex", Status: "idle", Tokens: 3200, Transcript: []string{"> implement token refresh", "I'm updating the token refresh flow.", "[tool] edit internal/auth/token.go", "✉ c1 → boss: implementation ready; tests pass"}},
		{Name: "scout", Provider: "antigravity", Status: "idle", Tokens: 1100, Unread: 1, Transcript: []string{"> inspect auth coverage", "I found two missing tests.", "✉ scout → boss: add expired-token coverage"}},
	}
}
func fit(s string, w int) string {
	if w <= 0 {
		return ""
	}
	s = ansi.Truncate(s, w, "")
	return s + strings.Repeat(" ", max(0, w-ansi.StringWidth(s)))
}
func token(n int) string {
	if n >= 1000 {
		return fmt.Sprintf("%.1fk", float64(n)/1000)
	}
	return fmt.Sprint(n)
}
func providerName(s string) string {
	switch s {
	case "claude":
		return "Claude Code"
	case "codex":
		return "Codex"
	case "antigravity":
		return "Antigravity"
	}
	return s
}
func providerColor(provider string) lipgloss.Color {
	c := map[string]string{"claude": "#D97757", "codex": "#10A37F", "antigravity": "#A142F4", "gemini": "#4285F4"}[provider]
	if c == "" {
		c = "#999999"
	}
	return lipgloss.Color(c)
}
func badge(a *agent.Agent) string {
	return lipgloss.NewStyle().Foreground(providerColor(a.Provider)).Render(provider.Icon(a.Provider))
}
func (m model) status(a *agent.Agent) string {
	if a.Status == "working" {
		return "● working"
	}
	if a.Unread > 0 {
		return fmt.Sprintf("✉ %d new message", a.Unread)
	}
	return "○ " + a.Status
}
func borderTitle(title, right string, w int) string {
	title = "─ " + title + " "
	if right != "" {
		title += "· " + right + " "
	}
	title = ansi.Truncate(title, max(0, w-2), "")
	return "╭" + title + strings.Repeat("─", max(0, w-2-ansi.StringWidth(title))) + "╮"
}
func box(title string, content []string, w, h int, col lipgloss.Color) []string {
	edge := lipgloss.NewStyle().Foreground(col)
	out := []string{edge.Render(borderTitle(title, "", w))}
	for i := 0; i < h-2; i++ {
		s := ""
		if i < len(content) {
			s = content[i]
		}
		out = append(out, edge.Render("│")+fit(" "+s, max(0, w-2))+edge.Render("│"))
	}
	return append(out, edge.Render("╰"+strings.Repeat("─", max(0, w-2))+"╯"))
}
func joinColumns(a, b []string) []string {
	out := make([]string, max(len(a), len(b)))
	for i := range out {
		if i < len(a) {
			out[i] += a[i]
		}
		if i < len(b) {
			out[i] += b[i]
		}
	}
	return out
}
func (m model) pane(a *agent.Agent, idx, w, h int) []string {
	t := theme.All[m.theme]
	col := t.Dim
	if idx == m.focus {
		col = t.Main
	}
	name := a.Name
	if idx == 0 {
		name = "BOSS"
	}
	title := fmt.Sprintf("2 %s %s · %s · %s", provider.Icon(a.Provider), name, providerName(a.Provider), m.status(a))
	var wrapped []string
	bubbleWidth := max(8, (w-4)*72/100)
	var bubble []string
	var titleText string
	var color lipgloss.Color
	var right bool
	flush := func() {
		if titleText == "" {
			return
		}
		bw := ansi.StringWidth(titleText) + 4
		for _, line := range bubble {
			bw = max(bw, ansi.StringWidth(line)+4)
		}
		bw = min(bubbleWidth, bw)
		var rows []string
		for _, line := range bubble {
			rows = append(rows, strings.Split(ansi.Wrap(line, max(1, bw-4), ""), "\n")...)
		}
		if len(wrapped) > 0 {
			wrapped = append(wrapped, "")
		}
		for _, line := range box(titleText, rows, bw, len(rows)+2, color) {
			if right {
				line = strings.Repeat(" ", max(0, w-4-bw)) + line
			}
			wrapped = append(wrapped, line)
		}
	}
	for _, v := range a.Transcript {
		switch {
		case strings.HasPrefix(v, "> "):
			flush()
			titleText = "YOU \u00b7 14:02"
			color = t.Accent
			right = true
			bubble = []string{strings.TrimPrefix(v, "> ")}
		case strings.HasPrefix(v, "[tool] "):
			bubble = append(bubble, lipgloss.NewStyle().Foreground(t.Dim).Render("\u2699 "+strings.TrimPrefix(v, "[tool] ")))
		case strings.HasPrefix(v, "\u2709"):
			parts := strings.SplitN(strings.TrimPrefix(v, "\u2709 "), ":", 2)
			if len(parts) == 2 {
				route := strings.SplitN(parts[0], " \u2192 ", 2)
				if len(route) == 2 {
					if route[0] == a.Name {
						v = "\u2709 to " + route[1] + ":" + parts[1]
					} else {
						v = "\u2709 from " + route[0] + ":" + parts[1]
					}
				}
			}
			bubble = append(bubble, lipgloss.NewStyle().Foreground(t.Accent).Render(v))
		default:
			flush()
			titleText = provider.Icon(a.Provider) + " " + strings.ToUpper(name) + " \u00b7 14:02"
			color = providerColor(a.Provider)
			right = false
			bubble = []string{v}
		}
	}
	flush()
	if len(wrapped) == 0 {
		wrapped = []string{"No messages yet.", "Type an order in MESSAGE and press Enter."}
	}
	if a.Status == "working" {
		wrapped = append(wrapped, "", []string{"\u28fe", "\u28fd", "\u28fb", "\u28bf"}[time.Now().Unix()%4]+" "+strings.ToUpper(name)+" is working\u2026")
	}
	end := max(0, len(wrapped)-m.scroll)
	start := max(0, end-max(0, h-2))
	return box(title, wrapped[start:end], w, h, col)
}
func (m model) dashboard() string {
	w, h := m.width, m.height
	if len(m.agents) == 0 {
		return m.home()
	}
	t := theme.All[m.theme]
	lines := []string{}
	if w >= 70 && w < 100 {
		var tabs []string
		for i, a := range m.agents {
			mark := " "
			if i == m.focus {
				mark = "▸"
			}
			tabs = append(tabs, fmt.Sprintf("%s%d %s %s", mark, i+1, provider.Icon(a.Provider), a.Name))
		}
		lines = append(lines, fit(strings.Join(tabs, "   "), w))
	}
	var hintLines []string
	bodyH := max(3, h-len(lines)-3-len(hintLines))
	var body []string
	if m.layout == 2 {
		body = m.commsView(w, bodyH)
	} else if m.layout == 1 {
		body = m.watchView(w, bodyH)
	} else if w >= 100 {
		sw := 30
		var roster []string
		for i, a := range m.agents {
			name := a.Name
			if i == 0 {
				name = "BOSS"
			}
			mark := " "
			if i == m.focus {
				mark = "▸"
			}
			roster = append(roster, fmt.Sprintf("%s %d %s %-8s %s", mark, i+1, badge(a), name, providerName(a.Provider)), "    "+m.status(a)+" · "+token(a.Tokens)+" tok")
		}
		roster = append(roster, "", "\uff0b Ctrl+N  recruit agent")
		body = joinColumns(box("1 SQUAD", roster, sw, bodyH, t.Dim), m.pane(m.agents[m.focus], m.focus, w-sw, bodyH))
	} else {
		body = m.pane(m.agents[m.focus], m.focus, w, bodyH)
	}
	if pop := m.popupLines(min(w, 48)); len(pop) > 0 {
		start := max(0, len(body)-len(pop))
		for i := 0; i < len(pop) && start+i < len(body); i++ {
			body[start+i] = fit(pop[i], w)
		}
	}
	lines = append(lines, body...)
	a := m.agents[m.focus]
	name := a.Name
	if m.focus == 0 {
		name = "BOSS"
	}
	value := m.input.Value()
	if value == "" {
		value = "Type an order and press Enter…"
	}
	target := fmt.Sprintf("To %s %s (%s) ▸ ", provider.Icon(a.Provider), name, providerName(a.Provider))
	if m.notice != "" {
		value += "  " + m.notice
	}
	lines = append(lines, box("3 MESSAGE", []string{lipgloss.NewStyle().Foreground(t.Accent).Render(target) + value}, w, 3, t.Main)...)
	lines = append(lines, hintLines...)
	return strings.Join(lines, "\n")
}
func shortProvider(s string) string { return s }

func (m model) home() string {
	t := theme.All[m.theme]
	w, h := m.width, m.height
	center := func(s string) string { return strings.Repeat(" ", max(0, (w-ansi.StringWidth(s))/2)) + s }
	var content []string
	if w >= 80 && h >= 24 {
		for _, line := range strings.Split(theme.Logo(w < 100 || h < 34), "\n") {
			content = append(content, center(line))
		}
	}
	if w >= 100 && h >= 34 {
		for _, line := range strings.Split(theme.Wordmark, "\n") {
			content = append(content, center(lipgloss.NewStyle().Foreground(t.Main).Render(line)))
		}
	} else {
		content = append(content, center(lipgloss.NewStyle().Foreground(t.Main).Bold(true).Render("DISPATCH")))
	}
	content = append(content, "")
	cta := "\u25b6 Press ENTER to start a new operation   BOSS: \u273b Claude Code (change: F7)"
	for _, line := range box("START", []string{cta}, min(w-2, 82), 3, t.Main) {
		content = append(content, center(line))
	}
	content = append(content, "")
	how := []string{"1  Press Enter to start an operation", "2  Type a mission in MESSAGE, then Enter", "3  F7 changes boss \u00b7 F5 manages agents", "4  F2 Direct \u00b7 F3 Watch \u00b7 F4 Comms"}
	recent := []string{"No recent operations yet."}
	if len(m.sessions) > 0 {
		recent = nil
		for _, v := range m.sessions {
			recent = append(recent, v.Title)
		}
	}
	recent = append(recent, "", "PROVIDERS")
	for _, name := range provider.Names[:6] {
		mark := "\u2717"
		if _, err := provider.Binary(name); err == nil {
			mark = "\u2713"
		}
		recent = append(recent, provider.Icon(name)+" "+name+" "+mark)
	}
	if w >= 80 {
		bw := min(w-2, 100)
		left := bw / 2
		cols := joinColumns(box("HOW IT WORKS", how, left, 10, t.Dim), box("RECENT OPERATIONS", recent, bw-left, 10, t.Dim))
		for _, line := range cols {
			content = append(content, center(line))
		}
	} else {
		for _, line := range box("HOW IT WORKS", how, w-2, 6, t.Dim) {
			content = append(content, center(line))
		}
		content = append(content, center("RECENT OPERATIONS \u00b7 "+recent[0]))
	}
	innerH := max(3, h-2)
	if len(content) > innerH {
		content = content[:innerH]
	}
	top := max(0, (innerH-len(content))/2)
	lines := []string{lipgloss.NewStyle().Foreground(t.Dim).Render(borderTitle("HOME", "", w))}
	for i := 0; i < top; i++ {
		lines = append(lines, "")
	}
	lines = append(lines, content...)
	for len(lines) < h-1 {
		lines = append(lines, "")
	}
	lines = append(lines, lipgloss.NewStyle().Foreground(t.Dim).Render("\u2570"+strings.Repeat("\u2500", max(0, w-2))+"\u256f"))
	return strings.Join(lines, "\n")
}
