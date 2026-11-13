package tui

import (
	"github.com/charmbracelet/x/ansi"
	"strings"
	"testing"
)

func TestSnapshotBounds(t *testing.T) {
	for _, size := range [][2]int{{80, 24}, {120, 40}, {200, 60}} {
		for _, screen := range []string{"main", "direct", "home", "watch", "grid", "comms", "agents", "settings", "welcome", "picker", "help", "templates", "workspaces", "palette", "demo-step-1", "demo-step-2", "demo-step-3", "demo-step-4", "demo-step-5", "demo-step-6"} {
			out, err := Snapshot(true, size[0], size[1], screen, true)
			if err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(out, "\n")
			if len(lines) > size[1] {
				t.Fatalf("%s: too tall", screen)
			}
			for _, line := range lines {
				if ansi.StringWidth(line) > size[0] {
					t.Fatalf("%s: too wide: %q", screen, line)
				}
			}
			if screen == "main" {
				for _, want := range []string{"DISPATCH", "BOSS", "c1", "scout", "F1", "TAB"} {
					if !strings.Contains(out, want) {
						t.Errorf("%dx%d missing %q", size[0], size[1], want)
					}
				}
			}
			if out == "" {
				t.Fatal("empty snapshot")
			}
		}
	}
}

func TestBoxBorderAlignment(t *testing.T) {
	for _, width := range []int{20, 30, 80, 120, 200} {
		rows := box("test", []string{"\u273b \u25ce \u2709 \u2699 \u25cf \u25cb \u25b8", strings.Repeat("x", width+4)}, width, 4, "#ffffff")
		for _, row := range rows {
			if ansi.StringWidth(row) != width {
				t.Fatalf("box width %d: got %d", width, ansi.StringWidth(row))
			}
		}
	}
}
