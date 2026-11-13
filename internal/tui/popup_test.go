package tui

import (
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"strings"
	"testing"
)

func TestHTML(t *testing.T) {
	s := HTML("\x1b[38;2;12;34;56m▀<&\x1b[0m")
	for _, want := range []string{"#0c2238", "▀&lt;&amp;", "Cascadia Mono", "line-height:1.15"} {
		if !strings.Contains(s, want) {
			t.Fatalf("missing %q", want)
		}
	}
}
func TestPopups(t *testing.T) {
	m := model{agents: demoAgents(), input: textinput.New()}
	m.input.SetValue("@sc")
	_, items := m.popup()
	if len(items) != 1 || items[0].value != "scout" {
		t.Fatal(items)
	}
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(model)
	if m.input.Value() != "@scout " {
		t.Fatal(m.input.Value())
	}
	m.input.SetValue("/lyt")
	_, items = m.popup()
	if len(items) != 1 || items[0].value != "layout" {
		t.Fatal(items)
	}
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if next.(model).layout != 1 {
		t.Fatal("layout not selected")
	}
}
