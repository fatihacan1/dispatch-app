package tui

import (
	"encoding/json"
	"fmt"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/fatihacan1/dispatch-app/internal/config"
	"github.com/fatihacan1/dispatch-app/internal/provider"
	"github.com/fatihacan1/dispatch-app/internal/session"
	"github.com/fatihacan1/dispatch-app/internal/template"
	"github.com/fatihacan1/dispatch-app/internal/theme"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch x := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = x.Width
		m.height = x.Height
		m.input.Width = max(10, x.Width-6)
	case eventMsg:
		for _, a := range m.agents {
			if a.Name == x.name {
				if x.event.Session != "" {
					a.Session = x.event.Session
				}
				switch x.event.Kind {
				case "usage":
					a.Tokens += x.event.Tokens
					a.Cost += x.event.Cost
				case "text":
					a.Transcript = append(a.Transcript, x.event.Text)
				case "tool":
					a.Transcript = append(a.Transcript, "[tool] "+x.event.Text)
				case "error":
					a.Transcript = append(a.Transcript, "[error] "+x.event.Text)
					a.Status = "error"
				case "done":
					if a.Status != "error" {
						a.Status = "done"
					}
				}
			}
		}
		m.save()
		return m, wait(m.events)
	case tickMsg:
		m.frame++
		if m.demo {
			if !m.demoPaused {
				m.advanceDemo()
			}
			return m, tick()
		}
		if m.boot && m.frame >= 3 {
			m.boot = false
		}
		requests, err := m.bus.Receive("orchestrator")
		if err != nil {
			m.notice = err.Error()
		}
		for _, req := range requests {
			switch req.Kind {
			case "spawn":
				parts := strings.SplitN(req.Text, "\n", 3)
				if len(parts) == 3 {
					m.spawn(parts[0], parts[1], parts[2])
				}
			case "kill":
				for _, a := range m.agents {
					if a.Name == req.Text {
						a.Stop()
					}
				}
			}
		}
		type registryAgent struct {
			Name     string `json:"name"`
			Provider string `json:"provider"`
			Status   string `json:"status"`
		}
		var registry []registryAgent
		for _, a := range m.agents {
			registry = append(registry, registryAgent{a.Name, a.Provider, a.Status})
		}
		if err := os.MkdirAll(m.bus.Root, 0700); err == nil {
			if data, err := json.MarshalIndent(registry, "", "  "); err == nil {
				tmp := filepath.Join(m.bus.Root, "agents.tmp")
				if os.WriteFile(tmp, data, 0600) == nil {
					_ = os.Rename(tmp, filepath.Join(m.bus.Root, "agents.json"))
				}
			}
		}
		for _, a := range m.agents {
			if a.Status != "working" {
				messages, _ := m.bus.Receive(a.Name)
				var pending []string
				for _, v := range messages {
					a.Transcript = append(a.Transcript, "\u2709 "+v.From+" \u2192 "+a.Name+": "+v.Text)
					if a != m.agents[m.focus] {
						a.Unread++
					}
					pending = append(pending, "From "+v.From+" (message id "+v.ID+", reply with dispatch reply --to "+v.From+" --reply-to "+v.ID+"): "+v.Text)
				}
				if len(pending) > 0 {
					m.send(a, strings.Join(pending, "\n"))
				}
			}
		}
		return m, tick()
	case tea.MouseMsg:
		if x.Action == tea.MouseActionPress {
			if x.Button == tea.MouseButtonWheelUp {
				m.scroll += 3
			}
			if x.Button == tea.MouseButtonWheelDown {
				m.scroll = max(0, m.scroll-3)
			}
		}
		return m, nil
	case tea.KeyMsg:
		key := x.String()
		if m.welcome > 0 {
			if key == "enter" {
				m.welcome++
				if m.welcome > 3 {
					m.welcome = 0
					c := config.Load()
					c.WelcomeSeen = true
					_ = config.Save(c)
				}
			}
			if key == "esc" {
				m.welcome = 0
				c := config.Load()
				c.WelcomeSeen = true
				_ = config.Save(c)
			}
			return m, nil
		}
		if m.demo {
			switch key {
			case "esc":
				return m, tea.Quit
			case " ":
				m.demoPaused = !m.demoPaused
				return m, nil
			case "right":
				if m.layout == 1 || m.layout == 2 {
					break
				}
				m.advanceDemo()
				return m, nil
			}
		}
		switch key {
		case "f1":
			m.bar = !m.bar
			return m, nil
		case "?":
			if m.input.Value() == "" || m.picker || m.help {
				m.help = !m.help
				return m, nil
			}
		case "f12", "esc":
			m.picker = true
			m.screen = ""
			m.workspaceView = false
			m.help = false
			return m, nil
		case "f2", "f3", "f4", "f5", "f6":
			m.picker = false
			m.help = false
			m.workspaceView = false
			m.screen = ""
			m.layout = 0
			m.tileFocus = false
			m.input.Focus()
			switch key {
			case "f3":
				m.layout = 1
				m.tileFocus = true
				m.input.Blur()
			case "f4":
				m.layout = 2
			case "f5":
				m.screen = "agents"
			case "f6":
				m.screen = "settings"
			}
			return m, nil
		case "f7":
			m.picker = false
			m.screen = "boss"
			m.choice = 0
			m.formStep = 0
			return m, nil
		}
		if m.help {
			return m, nil
		}
		if m.boot {
			m.boot = false
			return m, nil
		}
		if m.screen != "" {
			return m.updateScreen(x)
		}
		if m.workspaceView {
			return m.updateWorkspaces(x)
		}
		if m.picker && x.String() == "ctrl+w" {
			m.openWorkspaces()
			return m, nil
		}
		if m.picker {
			if m.deleting {
				if x.String() == "y" && m.selected < len(m.sessions) {
					if e := session.Delete(m.project, m.sessions[m.selected].ID); e != nil {
						m.notice = e.Error()
					}
					m.sessions, _ = session.List(m.project)
					_ = session.Touch(m.project)
					if m.selected >= len(m.sessions) {
						m.selected = len(m.sessions)
					}
				}
				m.deleting = false
				return m, nil
			}
			switch x.String() {
			case "B":
				m.picker = false
				m.screen = "boss"
				return m, nil
			case "N":
				m.picker = false
				m.screen = "spawn"
				return m, nil
			case "T":
				m.picker = false
				m.screen = "templates"
				m.templates, _ = template.Catalogue(m.project)
				return m, nil
			case "up", "k":
				if m.selected > 0 {
					m.selected--
				}
			case "down", "j":
				if m.selected < len(m.sessions) {
					m.selected++
				}
			case "d":
				if m.selected < len(m.sessions) {
					m.deleting = true
				}
			case "enter":
				if m.selected < len(m.sessions) {
					m.restore(m.sessions[m.selected])
				} else {
					m.operation = session.New()
					m.screen = ""
				}
				m.picker = false
				m.save()
			case "ctrl+c":
				return m, tea.Quit
			}
			return m, nil
		}
		if m.boot {
			m.boot = false
			return m, nil
		}
		if m.confirm {
			if x.String() == "y" {
				for _, a := range m.agents {
					a.Stop()
				}
				return m, tea.Quit
			}
			m.confirm = false
			return m, nil
		}
		if title, items := m.popup(); title != "" {
			switch x.String() {
			case "up":
				if m.popupSelected > 0 {
					m.popupSelected--
				}
				return m, nil
			case "down":
				if m.popupSelected+1 < len(items) {
					m.popupSelected++
				}
				return m, nil
			case "esc":
				m.input.SetValue("")
				m.popupSelected = 0
				return m, nil
			case "enter":
				if len(items) > 0 {
					i := min(m.popupSelected, len(items)-1)
					item := items[i].value
					if title == "TARGET AGENT" {
						m.input.SetValue("@" + item + " ")
						m.input.CursorEnd()
					} else {
						switch item {
						case "spawn":
							m.screen = "spawn"
							m.input.SetValue("")
						case "boss":
							m.screen = "boss"
							m.input.SetValue("")
						case "template":
							m.screen = "templates"
							m.templates, _ = template.Catalogue(m.project)
							m.input.SetValue("")
						case "broadcast":
							m.input.SetValue("/broadcast ")
							m.input.CursorEnd()
						default:
							m.input.SetValue("")
							m.command("/" + item)
						}
					}
					m.popupSelected = 0
					return m, nil
				}
			}
		}
		if m.layout == 1 && key == "tab" {
			m.tileFocus = !m.tileFocus
			if m.tileFocus {
				m.input.Blur()
			} else {
				m.input.Focus()
			}
			return m, nil
		}
		if m.layout == 1 && m.tileFocus && m.input.Value() == "" {
			cols := watchColumns(min(6, len(m.agents)))
			switch key {
			case "left", "h":
				m.focus = max(0, m.focus-1)
			case "right", "l":
				m.focus = min(len(m.agents)-1, m.focus+1)
			case "up", "k":
				m.focus = max(0, m.focus-cols)
			case "down", "j":
				m.focus = min(len(m.agents)-1, m.focus+cols)
			case "enter":
				m.layout = 0
				m.tileFocus = false
				m.input.Focus()
			default:
				return m, nil
			}
			return m, nil
		}
		if m.layout == 2 && m.input.Value() == "" {
			switch key {
			case "up", "k":
				m.threadSelected = max(0, m.threadSelected-1)
				return m, nil
			case "down", "j":
				m.threadSelected = min(len(groupThreads(m.traffic())), m.threadSelected+1)
				return m, nil
			}
		}
		if m.input.Value() == "" {
			switch x.String() {
			case "G":
				m.layout = 1
				return m, nil
			case "C":
				m.layout = 2
				return m, nil
			case "esc":
				m.layout = 0
				return m, nil
			case "N":
				m.screen = "spawn"
				m.formStep = 0
				m.formValues = nil
				return m, nil
			case "B":
				m.screen = "boss"
				m.choice = 0
				m.formStep = 0
				return m, nil
			case "T":
				m.screen = "templates"
				m.templates, _ = template.Catalogue(m.project)
				return m, nil
			case "W":
				m.openWorkspaces()
				return m, nil
			case "1", "2", "3", "4", "5", "6", "7", "8", "9":
				i := int(x.String()[0] - '1')
				if i < len(m.agents) {
					m.focus = i
					m.agents[i].Unread = 0
					m.scroll = 0
				}
				return m, nil
			}
		}
		switch x.String() {
		case "ctrl+c":
			for _, a := range m.agents {
				if a.Status == "working" {
					m.confirm = true
					return m, nil
				}
			}
			return m, tea.Quit
		case "f1", "ctrl+h":
			m.bar = !m.bar
			return m, nil
		case "ctrl+w":
			m.openWorkspaces()
			return m, nil
		case "ctrl+o":
			a := m.agents[m.focus]
			bin, e := provider.Binary(a.Provider)
			if e != nil {
				m.notice = e.Error()
				return m, nil
			}
			args := provider.InteractiveArgs(a.Provider, a.Session)
			shown := bin + " " + strings.Join(args, " ")
			a.Transcript = append(a.Transcript, "[take over] "+shown)
			var cmd *exec.Cmd
			switch runtime.GOOS {
			case "windows":
				if wt, e := exec.LookPath("wt.exe"); e == nil {
					cmd = exec.Command(wt, append([]string{"-d", m.project, bin}, args...)...)
				} else {
					cmd = exec.Command("cmd", "/c", "start", "", bin)
					cmd.Args = append(cmd.Args, args...)
				}
			case "darwin":
				cmd = exec.Command("osascript", "-e", `tell application "Terminal" to do script `+fmt.Sprintf("%q", shown))
			default:
				cmd = exec.Command("x-terminal-emulator", append([]string{"-e", bin}, args...)...)
			}
			cmd.Dir = m.project
			if e = cmd.Start(); e != nil {
				m.notice = e.Error()
			} else {
				m.notice = "Opened: " + shown
			}
			m.save()
			return m, nil
		case "pgup":
			m.scroll += 10
			return m, nil
		case "pgdown":
			m.scroll = max(0, m.scroll-10)
			return m, nil
		case "ctrl+l":
			m.layout = (m.layout + 1) % 5
			return m, nil
		case "ctrl+z":
			m.zoom = !m.zoom
			return m, nil
		case "ctrl+y":
			m.theme = (m.theme + 1) % len(theme.All)
			return m, nil
		case "tab":
			m.focus = (m.focus + 1) % len(m.agents)
			m.agents[m.focus].Unread = 0
			m.scroll = 0
			return m, nil
		case "shift+tab":
			m.focus = (m.focus + len(m.agents) - 1) % len(m.agents)
			return m, nil
		case "ctrl+k":
			m.agents[m.focus].Stop()
			return m, nil
		case "ctrl+n":
			m.screen = "spawn"
			m.formStep = 0
			m.formValues = nil
			m.input.SetValue("")
			return m, nil
		case "ctrl+t":
			m.screen = "templates"
			m.templates, _ = template.Catalogue(m.project)
			m.choice = 0
			return m, nil
		case "ctrl+b":
			m.screen = "boss"
			m.choice = 0
			m.formStep = 0
			m.input.SetValue("")
			return m, nil
		case "enter":
			s := strings.TrimSpace(m.input.Value())
			m.input.SetValue("")
			if strings.HasPrefix(s, "/") {
				m.command(s)
			} else if strings.HasPrefix(s, "@") {
				parts := strings.SplitN(s, " ", 2)
				if len(parts) == 2 {
					for _, a := range m.agents {
						if a.Name == strings.TrimPrefix(parts[0], "@") {
							m.send(a, parts[1])
							return m, nil
						}
					}
					m.notice = "Unknown agent"
				}
			} else if s != "" {
				m.send(m.agents[m.focus], s)
			}
			return m, nil
		case "?":
			if m.input.Value() == "" {
				m.help = !m.help
				return m, nil
			}
		}
	}
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	if _, items := m.popup(); m.popupSelected >= len(items) {
		m.popupSelected = 0
	}
	return m, cmd
}
