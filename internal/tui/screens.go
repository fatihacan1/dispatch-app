package tui

import (
	"fmt"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/fatihacan1/dispatch-app/internal/provider"
	"github.com/fatihacan1/dispatch-app/internal/template"
	"os"
	"strings"
)

func (m model) updateScreen(k tea.KeyMsg) (tea.Model, tea.Cmd) {
	if k.String() == "esc" {
		m.screen = ""
		m.input.SetValue("")
		return m, nil
	}
	if m.screen == "boss" && m.formStep == 0 {
		names := m.bossChoices()
		switch k.String() {
		case "up", "k":
			m.choice = max(0, m.choice-1)
		case "down", "j":
			m.choice = min(len(names)-1, m.choice+1)
		case "enter":
			if m.agents[0].Status == "working" {
				m.notice = "Stop the boss first"
				m.screen = ""
			} else {
				chosen := names[m.choice]
				if strings.HasPrefix(chosen, "template: ") {
					t, err := template.Resolve(m.project, strings.TrimPrefix(chosen, "template: "))
					if err == nil {
						m.agents[0].Provider = t.Provider
						m.agents[0].Model = t.Model
						m.agents[0].Role = t.Role
						m.agents[0].Session = ""
						m.screen = ""
						m.save()
						return m, nil
					}
				}
				m.formValues = []string{chosen}
				m.formStep = 1
				m.input.SetValue("")
			}
		}
		return m, nil
	}
	if m.screen == "templates" {
		switch k.String() {
		case "up", "k":
			m.choice = max(0, m.choice-1)
		case "down", "j":
			m.choice = min(len(m.templates)-1, m.choice+1)
		case "n":
			m.screen = "template-form"
			m.formStep = 0
			m.formValues = nil
			m.input.SetValue("")
		case "e":
			if len(m.templates) > 0 {
				t := m.templates[m.choice]
				m.screen = "template-form"
				m.formStep = 0
				m.formValues = []string{t.Name, t.Provider, t.Model, t.Effort, t.Role, strings.Join(t.Tags, ",")}
				m.input.SetValue(t.Name)
			}
		case "d":
			if len(m.templates) > 0 {
				m.screen = "template-delete"
			}
		}
		return m, nil
	}
	if m.screen == "template-delete" {
		if k.String() == "y" && len(m.templates) > 0 {
			if m.templates[m.choice].File == "" {
				m.notice = "Built-in templates cannot be deleted"
			} else if e := os.Remove(m.templates[m.choice].File); e != nil {
				m.notice = e.Error()
			}
		}
		m.templates, _ = template.Catalogue(m.project)
		m.choice = 0
		m.screen = "templates"
		return m, nil
	}
	if m.screen == "template-form" && m.formStep == 4 {
		if k.String() == "ctrl+s" {
			if m.formStep < len(m.formValues) {
				m.formValues[4] = m.roleInput.Value()
			} else {
				m.formValues = append(m.formValues, m.roleInput.Value())
			}
			m.formStep++
			m.input.SetValue("")
			if m.formStep < len(m.formValues) {
				m.input.SetValue(m.formValues[m.formStep])
			}
			return m, nil
		}
		var cmd tea.Cmd
		m.roleInput, cmd = m.roleInput.Update(k)
		return m, cmd
	}
	if k.String() == "enter" {
		v := m.input.Value()
		if m.formStep < len(m.formValues) {
			m.formValues[m.formStep] = v
		} else {
			m.formValues = append(m.formValues, v)
		}
		m.formStep++
		m.input.SetValue("")
		switch m.screen {
		case "boss":
			if m.formStep == 2 {
				m.agents[0].Provider = m.formValues[0]
				m.agents[0].Model = m.formValues[1]
				m.agents[0].Session = ""
				m.screen = ""
				m.save()
			}
		case "spawn":
			if m.formStep == 3 {
				m.spawn(m.formValues[0], m.formValues[1], m.formValues[2])
				m.screen = ""
			}
		case "template-form":
			if m.formStep == 6 {
				v := m.formValues
				t := template.Template{Name: v[0], Provider: v[1], Model: v[2], Effort: v[3], Role: strings.ReplaceAll(v[4], `\n`, "\n")}
				for _, tag := range strings.Split(v[5], ",") {
					if strings.TrimSpace(tag) != "" {
						t.Tags = append(t.Tags, strings.TrimSpace(tag))
					}
				}
				if e := template.Save(template.ProjectDir(m.project), t); e != nil {
					m.notice = e.Error()
				} else {
					m.notice = "Template saved"
				}
				m.templates, _ = template.Catalogue(m.project)
				m.choice = 0
				m.screen = "templates"
			} else if m.formStep == 4 {
				m.roleInput.SetValue("")
				if len(m.formValues) > 4 {
					m.roleInput.SetValue(m.formValues[4])
				}
				m.roleInput.Focus()
			} else if m.formStep < len(m.formValues) {
				m.input.SetValue(m.formValues[m.formStep])
			}
		}
		return m, nil
	}
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(k)
	return m, cmd
}
func (m model) viewScreen() string {
	switch m.screen {
	case "agents":
		lines := []string{"AGENTS", ""}
		for _, a := range m.agents {
			lines = append(lines, a.Name+"  \u00b7  "+providerName(a.Provider)+"  \u00b7  "+a.Status)
		}
		return strings.Join(lines, "\n")
	case "settings":
		return "SETTINGS\n\nF7  Change boss provider\nCtrl+Y  Change theme"
	case "boss":
		if m.formStep == 0 {
			lines := []string{"SELECT BOSS", ""}
			for i, n := range m.bossChoices() {
				mark := " "
				if i == m.choice {
					mark = ">"
				}
				status := "not installed"
				if _, e := provider.Binary(n); e == nil {
					status = "installed"
				}
				lines = append(lines, fmt.Sprintf("%s %s %-12s %s", mark, provider.Icon(n), n, status))
			}
			return strings.Join(append(lines, "", "Enter select  Esc back"), "\n")
		}
		return "BOSS / MODEL (optional)\n\n" + m.input.View() + "\n\nEnter continue  Esc back"
	case "templates":
		lines := []string{"TEMPLATES", ""}
		for i, t := range m.templates {
			mark := " "
			if i == m.choice {
				mark = ">"
			}
			lines = append(lines, fmt.Sprintf("%s %s / %s", mark, t.Name, t.Provider))
		}
		return strings.Join(append(lines, "", "n new  e edit  d delete  Esc back", m.notice), "\n")
	case "template-delete":
		return "Delete template? [y/N]"
	case "spawn":
		return "NEW AGENT / " + []string{"NAME", "TEMPLATE OR PROVIDER", "TASK"}[m.formStep] + "\n\n" + m.input.View() + "\n\nEnter continue  Esc back"
	case "template-form":
		if m.formStep == 4 {
			return "TEMPLATE / ROLE\n\n" + m.roleInput.View() + "\n\nCtrl+S continue  Esc back"
		}
		return "TEMPLATE / " + []string{"NAME", "PROVIDER", "MODEL", "EFFORT", "ROLE (use \\n for newline)", "TAGS (comma separated)"}[m.formStep] + "\n\n" + m.input.View() + "\n\nEnter continue  Esc back"
	}
	return ""
}

func (m model) bossChoices() []string {
	names := append([]string{}, provider.Names[:6]...)
	custom, _ := provider.CustomProviders()
	for name := range custom {
		names = append(names, name)
	}
	ts, _ := template.Catalogue(m.project)
	for _, t := range ts {
		names = append(names, "template: "+t.Name)
	}
	return names
}
