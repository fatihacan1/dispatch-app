package session

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveLoadDelete(t *testing.T) {
	w := t.TempDir()
	s := New()
	s.Title = "task"
	s.Agents = []Agent{{Name: "boss", Provider: "claude", Session: "provider-id", Transcript: []string{"hello", "line\nnext"}}}
	if e := Save(w, s); e != nil {
		t.Fatal(e)
	}
	got, e := Load(w, s.ID)
	if e != nil || got.Agents[0].Session != "provider-id" || got.Agents[0].Transcript[1] != "line\nnext" {
		t.Fatalf("%+v %v", got, e)
	}
	if e = Delete(w, s.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = Load(w, s.ID); !os.IsNotExist(e) {
		t.Fatal(e)
	}
	if e = Delete(w, "../bad"); e == nil {
		t.Fatal("invalid id accepted")
	}
}
func TestWorkspaceIndex(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	w := filepath.Join(home, "project")
	if e := Touch(w); e != nil {
		t.Fatal(e)
	}
	ws, e := Workspaces()
	if e != nil || len(ws) != 1 || ws[0].Path != w {
		t.Fatalf("%v %v", ws, e)
	}
	if e = Forget(w); e != nil {
		t.Fatal(e)
	}
	ws, e = Workspaces()
	if e != nil || len(ws) != 0 {
		t.Fatal(ws, e)
	}
}
