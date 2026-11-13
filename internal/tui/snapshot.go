package tui

import (
	"fmt"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/mattn/go-runewidth"
	"github.com/muesli/termenv"
	"github.com/fatihacan1/dispatch-app/internal/session"
	"github.com/fatihacan1/dispatch-app/internal/template"
	"github.com/fatihacan1/dispatch-app/internal/theme"
	"strings"
	"time"
)

func init() { runewidth.DefaultCondition.EastAsianWidth = false }

// Snapshot renders a deterministic demo frame without launching a terminal.
func Snapshot(demo bool, width, height int, screen string, plain bool) (string, error) {
	if !demo {
		return "", fmt.Errorf("snapshot requires --demo")
	}
	if width < 20 || height < 5 {
		return "", fmt.Errorf("terminal size too small")
	}
	lipgloss.SetColorProfile(termenv.TrueColor)
	in := textinput.New()
	in.Placeholder = "Message focused agent or /command"
	in.Width = width - 6
	m := model{width: width, height: height, bar: true, input: in, demo: true, project: `C:\Projects\acme-shop`, operation: session.New(), agents: demoAgents()}
	m.operation.Title = "refactor-auth"
	switch screen {
	case "main", "focus", "direct":
	case "watch":
		m.layout = 1
	case "agents", "settings":
		m.screen = screen
	case "welcome":
		m.welcome = 1
	case "demo-step-1", "demo-step-2", "demo-step-3", "demo-step-4", "demo-step-5", "demo-step-6":
		m.picker = true
		m.agents = demoAgents()[:1]
		n := int(screen[len(screen)-1] - '0')
		for i := 0; i < n; i++ {
			m.advanceDemo()
		}
	case "grid":
		m.layout = 1
	case "comms":
		m.layout = 2
	case "home":
		m.picker = true
	case "palette":
		m.input.SetValue("/")
	case "help":
		m.help = true
	case "picker":
		m.picker = true
		m.sessions = []session.Session{{ID: "0123456789abcdef", Title: "Example operation"}}
	case "workspaces":
		m.workspaceView = true
		m.workspaceRows = []workspaceRow{{path: "/example/project"}, {path: "/example/project", operation: &session.Session{ID: "0123456789abcdef", Title: "Example operation"}}}
	case "templates":
		m.screen = "templates"
		m.templates = []template.Template{{Name: "coder", Provider: "codex"}, {Name: "reviewer", Provider: "claude"}}
	default:
		return "", fmt.Errorf("unknown screen %q", screen)
	}
	out := m.View()
	if plain {
		out = ansi.Strip(out)
	}
	lines := strings.Split(out, "\n")
	if len(lines) > height {
		lines = lines[:height]
	}
	for i := range lines {
		lines[i] = ansi.Truncate(lines[i], width, "")
	}
	return strings.Join(lines, "\n"), nil
}

// View keeps all screens within the current terminal dimensions.
func (m model) View() string {
	keys := m.keyLines()
	footer := len(keys)
	if m.demo {
		footer++
	}
	t := theme.All[m.theme]
	total := 0
	for _, a := range m.agents {
		total += a.Tokens
	}
	clock := time.Now().Format("15:04")
	if m.demo {
		clock = "21:04"
	}
	op := m.operation.Title
	if op == "" {
		op = "new operation"
	}
	head := fmt.Sprintf("\u25b2 DISPATCH  \u2502  ops: %s  \u2502  ws: %s  \u2502  %d agents \u00b7 %s tok  \u2502  %s", op, m.project, len(m.agents), token(total), clock)
	active := 1
	if m.picker || m.boot {
		active = 0
	} else if m.layout == 1 {
		active = 2
	} else if m.layout == 2 {
		active = 3
	}
	if m.screen == "agents" {
		active = 4
	}
	if m.screen == "settings" {
		active = 5
	}
	labels := []string{"F12 HOME", "F2 DIRECT", "F3 WATCH ALL", "F4 COMMS", "F5 AGENTS", "F6 SETTINGS"}
	var tabs string
	for i, label := range labels {
		style := lipgloss.NewStyle().Foreground(t.Dim)
		if i == active {
			style = lipgloss.NewStyle().Background(t.Main).Foreground(lipgloss.Color("#0b120b")).Bold(true)
		}
		tabs += style.Render(" "+label+" ") + " "
	}
	subtitles := []string{"Start or resume an operation.", "Talk to one agent. Pick it on the left, type below.", "Watch all agents at once.", "Follow messages between agents.", "Manage your agents.", "Configure your settings."}
	header := []string{lipgloss.NewStyle().Foreground(t.Main).Render(fit(head, m.width)), fit(tabs, m.width), fit(lipgloss.NewStyle().Foreground(t.Dim).Italic(true).Render(subtitles[active]), m.width)}
	bodyHeight := max(1, m.height-len(header)-footer)
	inner := m
	inner.height = bodyHeight
	body := strings.Split(inner.renderView(), "\n")
	if len(body) > bodyHeight {
		body = body[:bodyHeight]
	}
	for len(body) < bodyHeight {
		body = append(body, "")
	}
	lines := append(header, body...)
	if m.demo {
		lines = append(lines, fit(m.coach(), m.width))
	}
	lines = append(lines, keys...)
	for i := range lines {
		lines[i] = ansi.Truncate(lines[i], m.width, "")
	}
	return strings.Join(lines, "\n")
}
