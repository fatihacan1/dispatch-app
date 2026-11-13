package tui

import (
	"github.com/charmbracelet/lipgloss"

	"github.com/fatihacan1/dispatch-app/internal/theme"
)

func (m model) renderView() string {
	if m.welcome > 0 {
		return m.modal("WELCOME", []string{"1 / 3  Your boss coordinates the operation.", "2 / 3  Use MESSAGE to send a mission; @name targets an agent.", "3 / 3  Use the tabs and key bar to explore views.", "", "Enter next  \u00b7  Esc skip"}[m.welcome-1:m.welcome])
	}
	if m.help {
		return m.modal("ALL KEYS", []string{"NAVIGATION   F12 / Esc Home \u00b7 F2 Direct \u00b7 F3 Watch \u00b7 F4 Comms", "VIEWS        F5 Agents \u00b7 F6 Settings \u00b7 F7 Boss", "MESSAGING    Enter Send \u00b7 @name target \u00b7 /broadcast", "AGENTS       Tab / Shift+Tab select \u00b7 Ctrl+N recruit \u00b7 Ctrl+K stop", "APP          ? Help \u00b7 F1 key bar \u00b7 Ctrl+Y theme \u00b7 Ctrl+C quit", "", "Press ? to close"})
	}
	if m.boot {
		return m.home()
	}

	if m.screen != "" {
		return m.viewScreen()
	}
	t := theme.All[m.theme]
	style := lipgloss.NewStyle().Foreground(t.Main)

	if m.workspaceView {
		return m.viewWorkspaces()
	}
	if m.picker {
		return m.home()
	}

	if m.confirm {
		return style.Render("Agents are working. Quit and stop them? [y/N]")
	}
	if m.help {
		return style.Render("DISPATCH HELP\n\nTab focus  Ctrl+N spawn  Ctrl+T templates\nCtrl+L layout  Ctrl+Z zoom  Ctrl+B boss  Ctrl+K stop\nCtrl+Y theme  F1 shortcuts  Ctrl+C quit\n\n/spawn NAME TEMPLATE TASK   @NAME MESSAGE\n/broadcast MESSAGE   /template   /kill\n\nPress ? to close")
	}
	return m.dashboard()
}
