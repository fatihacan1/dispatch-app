package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPrintTasks(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	file := filepath.Join(t.TempDir(), "tasks.json")
	var out bytes.Buffer
	if err := printTasks(file, false, now, &out); err != nil || out.String() != "No open tasks.\n" {
		t.Fatalf("missing file: %q %v", out.String(), err)
	}
	board := `[{"agent":"old","lead":"boss","title":"Old","status":"done","startedAt":"2026-01-01T10:00:00Z","endedAt":"2026-01-01T10:30:00Z"},
{"agent":"coder","lead":"boss","title":"` + strings.Repeat("x", 100) + `","status":"stalled","startedAt":"2026-01-01T11:48:00Z"}]`
	if err := os.WriteFile(file, []byte(board), 0o644); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	_ = printTasks(file, false, now, &out)
	want := "coder\tstalled\t12m\tboss\t" + strings.Repeat("x", 79) + "…\n"
	if out.String() != want {
		t.Fatalf("got %q want %q", out.String(), want)
	}
	out.Reset()
	_ = printTasks(file, true, now, &out)
	if !strings.Contains(out.String(), "old\tdone\t30m\tboss\tOld\n") {
		t.Fatalf("--all: %q", out.String())
	}
}
