package tui

import (
	"github.com/fatihacan1/dispatch-app/internal/bus"
	"testing"
	"time"
)

func TestDemoTicksChangeVisibleState(t *testing.T) {
	m := model{width: 120, height: 40, bar: true, demo: true, picker: true, agents: demoAgents()[:1], bus: bus.New(t.TempDir())}
	before := m.View()
	sizes := []int{}
	for i := 0; i < 6; i++ {
		next, _ := m.Update(tickMsg(time.Now()))
		m = next.(model)
		sizes = append(sizes, len(m.agents))
		if i == 0 && m.View() == before {
			t.Fatal("first tick did not change view")
		}
	}
	if sizes[2] < 3 || m.layout != 0 || len(m.agents[1].Transcript) < 5 {
		t.Fatalf("demo did not progress: %+v", sizes)
	}
}
