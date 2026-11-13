package tui

import (
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/fatihacan1/dispatch-app/internal/agent"
	"github.com/fatihacan1/dispatch-app/internal/bus"
	"github.com/fatihacan1/dispatch-app/internal/config"
	"github.com/fatihacan1/dispatch-app/internal/provider"
	"github.com/fatihacan1/dispatch-app/internal/session"
	"github.com/fatihacan1/dispatch-app/internal/template"
	"github.com/fatihacan1/dispatch-app/internal/theme"
	"os"
	"strings"
	"time"
)

type eventMsg struct {
	name  string
	event provider.Event
}
type tickMsg time.Time
type model struct {
	agents                              []*agent.Agent
	focus, width, height, layout, theme int
	threadSelected                      int
	tileFocus                           bool
	zoom, bar, help, boot, confirm      bool
	input                               textinput.Model
	roleInput                           textarea.Model
	events                              chan eventMsg
	bus                                 bus.Bus
	project                             string
	demo                                bool
	notice                              string
	operation                           session.Session
	sessions                            []session.Session
	picker                              bool
	selected                            int
	deleting                            bool
	scroll                              int
	frame                               int
	workspaceView                       bool
	workspaceRows                       []workspaceRow
	workspaceSelected                   int
	workspaceConfirm                    string
	screen                              string
	formStep                            int
	formValues                          []string
	choice                              int
	popupSelected                       int
	welcome, demoStep                   int
	demoPaused                          bool
	templates                           []template.Template
}

func Run(project string, demo bool, mode, id string) error {
	if demo {
		var err error
		project, err = os.MkdirTemp("", "dispatch-demo-*")
		if err != nil {
			return err
		}
		defer os.RemoveAll(project)
	}
	in := textinput.New()
	in.Placeholder = "Message focused agent or /command"
	in.Width = 70
	in.Focus()
	roleInput := textarea.New()
	roleInput.Placeholder = "Describe the agent role"
	roleInput.SetWidth(70)
	roleInput.SetHeight(6)
	m := model{roleInput: roleInput, width: 80, height: 24, bar: true, boot: true, input: in, events: make(chan eventMsg, 256), bus: bus.New(project), project: project, demo: demo}
	p := "claude"
	if demo {
		p = "claude"
	}
	m.agents = []*agent.Agent{{Name: "boss", Provider: p, Status: "idle", Workdir: project, Role: "You coordinate the team."}}
	if demo {
		m.picker = true
	}
	m.operation = session.New()
	ss, e := session.List(project)
	if e != nil {
		return e
	}
	m.sessions = ss
	if mode == "--resume" {
		v, err := session.Load(project, id)
		if err != nil {
			return err
		}
		m.restore(v)
	} else if (mode == "-c" || mode == "--continue") && len(ss) > 0 {
		m.restore(ss[0])
	} else if mode == "" {
		m.picker = true
		m.boot = false
	}
	if !demo {
		c := config.Load()
		if !c.WelcomeSeen {
			m.welcome = 1
		}
	}
	if !m.picker && !demo && mode != "--resume" && mode != "-c" && mode != "--continue" {
		m.screen = "boss"
	}
	if !m.picker && !demo {
		m.save()
	}
	_, e = tea.NewProgram(m, tea.WithAltScreen(), tea.WithMouseCellMotion()).Run()
	return e
}

func (m *model) restore(s session.Session) {
	m.operation = s
	m.agents = nil
	for _, a := range s.Agents {
		m.agents = append(m.agents, &agent.Agent{Name: a.Name, Provider: a.Provider, Model: a.Model, Role: a.Role, Session: a.Session, Transcript: a.Transcript, Workdir: m.project, Status: "idle"})
	}
	if len(m.agents) == 0 {
		m.agents = []*agent.Agent{{Name: "boss", Provider: "claude", Workdir: m.project, Status: "idle"}}
	}
	m.focus = 0
}
func (m *model) save() {
	if m.demo {
		return
	}
	m.operation.Agents = nil
	for _, a := range m.agents {
		m.operation.Agents = append(m.operation.Agents, session.Agent{Name: a.Name, Provider: a.Provider, Model: a.Model, Role: a.Role, Session: a.Session, Transcript: a.Transcript})
	}
	if e := session.Save(m.project, m.operation); e != nil {
		m.notice = e.Error()
		return
	}
	if e := session.Touch(m.project); e != nil {
		m.notice = e.Error()
	}
}

func wait(ch chan eventMsg) tea.Cmd { return func() tea.Msg { return <-ch } }
func tick() tea.Cmd                 { return tea.Tick(time.Second, func(t time.Time) tea.Msg { return tickMsg(t) }) }
func (m model) Init() tea.Cmd       { return tea.Batch(textinput.Blink, wait(m.events), tick()) }
func (m *model) send(a *agent.Agent, s string) {
	if a.Status == "working" {
		m.notice = "Agent is busy; try again after the current turn"
		return
	}
	a.Transcript = append(a.Transcript, "> "+s)
	if m.operation.Title == "" {
		r := []rune(s)
		if len(r) > 60 {
			r = r[:60]
		}
		m.operation.Title = string(r)
	}
	m.scroll = 0
	m.save()
	a.Status = "working"
	if m.demo {
		a.Transcript = append(a.Transcript, "Demo response: "+s)
		a.Status = "idle"
		return
	}
	go a.Run(s, m.bus.Root, func(e provider.Event) { m.events <- eventMsg{a.Name, e} })
}
func (m *model) spawn(name, prov, task string) {
	for _, a := range m.agents {
		if a.Name == name {
			m.notice = "Agent name already exists"
			return
		}
	}
	if name == "" {
		m.notice = "Name required"
		return
	}
	t, e := template.Resolve(m.project, prov)
	role := ""
	modelName := ""
	if e == nil {
		prov = t.Provider
		role = t.Role
		modelName = t.Model
	}

	a := &agent.Agent{Name: name, Provider: prov, Model: modelName, Status: "idle", Role: role, Workdir: m.project}
	m.agents = append(m.agents, a)
	m.save()
	if task != "" {
		m.send(a, task)
	}
}
func (m *model) command(s string) {
	f := strings.Fields(s)
	if len(f) == 0 {
		return
	}
	switch f[0] {
	case "/spawn":
		if len(f) < 3 {
			m.notice = "Usage: /spawn NAME TEMPLATE [TASK]"
			return
		}
		m.spawn(f[1], f[2], strings.Join(f[3:], " "))
	case "/kill":
		m.agents[m.focus].Stop()
	case "/boss":
		if len(f) < 2 {
			m.notice = "Usage: /boss PROVIDER [MODEL]"
			return
		}
		a := m.agents[0]
		if a.Status == "working" {
			m.notice = "Stop the boss before changing provider"
			return
		}
		a.Provider = f[1]
		a.Model = ""
		if len(f) > 2 {
			a.Model = f[2]
		}
		a.Session = ""
		m.save()
		m.notice = "Boss changed to " + a.Provider
	case "/template":
		ts, _ := template.Catalogue(m.project)
		var names []string
		for _, t := range ts {
			names = append(names, t.Name)
		}
		m.notice = "Templates: " + strings.Join(names, ", ")
	case "/layout":
		m.layout = (m.layout + 1) % 3
	case "/theme":
		m.theme = (m.theme + 1) % len(theme.All)
	case "/help":
		m.help = true
	case "/broadcast":
		for _, a := range m.agents {
			m.send(a, strings.TrimSpace(strings.TrimPrefix(s, "/broadcast")))
		}
	default:
		m.notice = "Unknown command"
	}
}
