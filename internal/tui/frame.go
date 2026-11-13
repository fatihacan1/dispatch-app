package tui

import (
	"fmt"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/fatihacan1/dispatch-app/internal/theme"
	"strings"
)

func (m model) modal(title string, content []string) string {
	w := min(m.width-2, 76)
	h := len(content) + 4
	b := box(title, append([]string{""}, content...), w, h, theme.All[m.theme].Main)
	var lines []string
	for i := 0; i < max(0, (m.height-h)/2); i++ {
		lines = append(lines, "")
	}
	for _, s := range b {
		lines = append(lines, strings.Repeat(" ", max(0, (m.width-w)/2))+s)
	}
	return strings.Join(lines, "\n")
}
func (m model) keyLines() []string {
	t := theme.All[m.theme]
	badge := lipgloss.NewStyle().Foreground(lipgloss.Color("#0b120b")).Background(t.Main)
	if !m.bar {
		s := badge.Render(" F1 ") + " keys"
		return []string{strings.Repeat(" ", max(0, m.width-ansi.StringWidth(s))) + s}
	}
	pairs := [][2]string{{"F2", "Direct"}, {"F3", "Watch all"}, {"F4", "Comms"}, {"F5", "Agents"}, {"F6", "Settings"}, {"Enter", "Send"}, {"TAB", "Next agent"}, {"?", "All keys"}, {"F1", "Hide this bar"}}
	var lines []string
	line := ""
	for _, p := range pairs {
		chip := badge.Render(" "+p[0]+" ") + " " + p[1] + "  "
		if line != "" && ansi.StringWidth(line)+ansi.StringWidth(chip) > m.width {
			lines = append(lines, line)
			line = ""
		}
		line += chip
	}
	return append(lines, line)
}
func (m *model) advanceDemo() {
	if m.demoStep >= 6 {
		return
	}
	m.demoStep++
	switch m.demoStep {
	case 1:
		m.picker = false
		m.operation.Title = "refactor auth"
		m.agents = demoAgents()[:1]
		m.agents[0].Transcript = []string{"> Refactor the auth module", "I'll assemble a team."}
	case 2:
		m.agents = demoAgents()[:2]
	case 3:
		m.agents = demoAgents()
	case 4:
		m.layout = 1
	case 5:
		m.layout = 2
	case 6:
		m.layout = 0
		m.focus = 1
		m.agents[1].Transcript = append(m.agents[1].Transcript, "Tests passed; changes are ready.")
	}
}
func (m model) coach() string {
	return fmt.Sprintf("DEMO ⓵ step %d of 6  ·  press → next, Space pause, Esc exit", max(1, m.demoStep))
}
