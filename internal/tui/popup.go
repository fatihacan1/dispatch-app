package tui

import (
	"github.com/fatihacan1/dispatch-app/internal/provider"
	"github.com/fatihacan1/dispatch-app/internal/theme"
	"strings"
)

type popupItem struct{ value, description string }

var commands = []popupItem{{"spawn", "Recruit an agent"}, {"kill", "Stop focused agent"}, {"boss", "Choose boss provider"}, {"template", "Browse templates"}, {"layout", "Change layout"}, {"theme", "Change color theme"}, {"broadcast", "Message all agents"}, {"help", "Show keyboard help"}}

func fuzzy(s, q string) bool {
	s = strings.ToLower(s)
	for _, r := range strings.ToLower(q) {
		i := strings.IndexRune(s, r)
		if i < 0 {
			return false
		}
		s = s[i+1:]
	}
	return true
}
func (m model) popup() (string, []popupItem) {
	s := m.input.Value()
	if strings.HasPrefix(s, "/") && !strings.Contains(s, " ") {
		var out []popupItem
		for _, c := range commands {
			if fuzzy(c.value, s[1:]) {
				out = append(out, c)
			}
		}
		return "COMMANDS", out
	}
	if strings.HasPrefix(s, "@") && !strings.Contains(s, " ") {
		var out []popupItem
		for _, a := range m.agents {
			if fuzzy(a.Name, s[1:]) {
				out = append(out, popupItem{a.Name, provider.Icon(a.Provider) + "  " + providerName(a.Provider)})
			}
		}
		return "TARGET AGENT", out
	}
	return "", nil
}
func (m model) popupLines(w int) []string {
	title, items := m.popup()
	if title == "" {
		return nil
	}
	var rows []string
	for i, it := range items {
		mark := "  "
		if i == m.popupSelected {
			mark = "▸ "
		}
		rows = append(rows, mark+it.value+"  —  "+it.description)
	}
	if len(rows) == 0 {
		rows = []string{"No matches"}
	}
	return box(title, rows, w, len(rows)+2, theme.All[m.theme].Main)
}
