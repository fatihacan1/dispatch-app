package tui

import (
	"fmt"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/fatihacan1/dispatch-app/internal/bus"
	"github.com/fatihacan1/dispatch-app/internal/session"
	"strings"
)

type workspaceRow struct {
	path      string
	operation *session.Session
}

func (m *model) openWorkspaces() {
	m.workspaceView = true
	m.workspaceRows = nil
	ws, err := session.Workspaces()
	if err != nil {
		m.notice = err.Error()
		return
	}
	for _, w := range ws {
		m.workspaceRows = append(m.workspaceRows, workspaceRow{path: w.Path})
		ss, err := session.List(w.Path)
		if err != nil {
			m.notice = err.Error()
			continue
		}
		for i := range ss {
			s := ss[i]
			m.workspaceRows = append(m.workspaceRows, workspaceRow{path: w.Path, operation: &s})
		}
	}
	if m.workspaceSelected >= len(m.workspaceRows) {
		m.workspaceSelected = max(0, len(m.workspaceRows)-1)
	}
}
func (m model) updateWorkspaces(k tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.workspaceConfirm != "" {
		if k.String() == "y" && len(m.workspaceRows) > 0 {
			row := m.workspaceRows[m.workspaceSelected]
			var err error
			if m.workspaceConfirm == "delete" && row.operation != nil {
				err = session.Delete(row.path, row.operation.ID)
				if err == nil {
					err = session.Touch(row.path)
				}
			} else if m.workspaceConfirm == "forget" {
				err = session.Forget(row.path)
			}
			if err != nil {
				m.notice = err.Error()
			}
			m.openWorkspaces()
		}
		m.workspaceConfirm = ""
		return m, nil
	}
	switch k.String() {
	case "esc", "ctrl+w":
		m.workspaceView = false
	case "up", "k":
		m.workspaceSelected = max(0, m.workspaceSelected-1)
	case "down", "j":
		m.workspaceSelected = min(len(m.workspaceRows)-1, m.workspaceSelected+1)
		if m.workspaceSelected < 0 {
			m.workspaceSelected = 0
		}
	case "d":
		if len(m.workspaceRows) > 0 && m.workspaceRows[m.workspaceSelected].operation != nil {
			m.workspaceConfirm = "delete"
		}
	case "x":
		if len(m.workspaceRows) > 0 {
			m.workspaceConfirm = "forget"
		}
	case "enter":
		if len(m.workspaceRows) > 0 {
			r := m.workspaceRows[m.workspaceSelected]
			if r.operation != nil {
				for _, a := range m.agents {
					if a.Status == "working" {
						m.notice = "Stop working agents before switching workspaces"
						return m, nil
					}
				}
				m.save()
				m.project = r.path
				m.bus = bus.New(r.path)
				m.restore(*r.operation)
				m.picker = false
				m.workspaceView = false
				m.save()
			}
		}
	}
	return m, nil
}
func (m model) viewWorkspaces() string {
	lines := []string{"RECENT WORKSPACES"}
	for i, r := range m.workspaceRows {
		mark := "  "
		if i == m.workspaceSelected {
			mark = "> "
		}
		if r.operation == nil {
			lines = append(lines, mark+r.path)
		} else {
			lines = append(lines, fmt.Sprintf("%s  %s  %s", mark, r.operation.ID, r.operation.Title))
		}
	}
	if m.workspaceConfirm != "" {
		lines = append(lines, "Confirm "+m.workspaceConfirm+"? [y/N]")
	} else {
		lines = append(lines, "Enter resume  d delete session  x forget workspace  Esc back")
	}
	if m.notice != "" {
		lines = append(lines, m.notice)
	}
	return strings.Join(lines, "\n")
}
