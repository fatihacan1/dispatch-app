package theme

import (
	"github.com/charmbracelet/x/ansi"
	"strings"
	"testing"
)

func TestLogoDimensions(t *testing.T) {
	t.Setenv("MYARMY_ASCII", "")
	for _, tc := range []struct {
		small bool
		w, h  int
	}{{false, 32, 16}, {true, 14, 7}} {
		lines := strings.Split(Logo(tc.small), "\n")
		if len(lines) != tc.h {
			t.Fatalf("height %d", len(lines))
		}
		for _, line := range lines {
			if ansi.StringWidth(line) != tc.w {
				t.Fatalf("width %d", ansi.StringWidth(line))
			}
		}
	}
	t.Setenv("COLORTERM", "truecolor")
	if !strings.Contains(Logo(true), ";2;") {
		t.Fatal("truecolor missing")
	}
	t.Setenv("MYARMY_ASCII", "1")
	if strings.Contains(Logo(true), "▀") {
		t.Fatal("ASCII fallback")
	}
}
