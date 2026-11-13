package tui

import "testing"

func TestLayoutColumns(t *testing.T) {
	for _, c := range []struct {
		layout, n, width int
		zoom             bool
		want             int
	}{{0, 4, 100, false, 1}, {1, 3, 100, false, 3}, {2, 3, 100, false, 1}, {3, 4, 100, false, 2}, {4, 5, 160, false, 3}, {4, 5, 100, true, 1}} {
		if got := layoutColumns(c.layout, c.n, c.zoom, c.width); got != c.want {
			t.Errorf("%+v: %d", c, got)
		}
	}
}
