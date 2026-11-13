package template

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCRUD(t *testing.T) {
	d := t.TempDir()
	v := Template{Name: "test", Provider: "codex", Role: "review"}
	if e := Save(d, v); e != nil {
		t.Fatal(e)
	}
	got, e := Load(d, "test")
	if e != nil || got.Role != v.Role {
		t.Fatal(got, e)
	}
	ts, e := List(d)
	if e != nil || len(ts) != 1 {
		t.Fatal(ts, e)
	}
	if e = Delete(d, "test"); e != nil {
		t.Fatal(e)
	}
	if _, e = Load(d, "test"); e == nil {
		t.Fatal("deleted template remains")
	}
}

func TestMarkdownRoundTrip(t *testing.T) {
	original := Template{Name: "coder", Description: "Writes code", Provider: "codex", Role: "First line\n\nSecond line", Tags: []string{"code", "build"}, Color: "green"}
	b, err := Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Parse(b)
	if err != nil {
		t.Fatal(err)
	}
	if got.Role != original.Role || got.Description != original.Description || len(got.Tags) != 2 {
		t.Fatalf("round trip: %#v", got)
	}
}
func TestMigration(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "templates")
	dir := filepath.Join(root, "agents")
	if err := os.MkdirAll(old, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "coder.yaml"), []byte("name: coder\nprovider: codex\nrole: legacy prompt\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Defaults(dir); err != nil {
		t.Fatal(err)
	}
	got, err := Load(dir, "coder")
	if err != nil || got.Role != "legacy prompt" {
		t.Fatalf("%#v %v", got, err)
	}
	got.Role = "edited"
	if err = Save(dir, got); err != nil {
		t.Fatal(err)
	}
	if err = Defaults(dir); err != nil {
		t.Fatal(err)
	}
	got, _ = Load(dir, "coder")
	if got.Role != "edited" {
		t.Fatal("migration overwrote template")
	}
}
func TestCataloguePrecedence(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	project := t.TempDir()
	if err := Save(Dir(), Template{Name: "coder", Provider: "global"}); err != nil {
		t.Fatal(err)
	}
	if err := Save(ProjectDir(project), Template{Name: "coder", Provider: "project", Description: "Project coder"}); err != nil {
		t.Fatal(err)
	}
	got, err := Resolve(project, "coder")
	if err != nil || got.Provider != "project" {
		t.Fatalf("%#v %v", got, err)
	}
	if !strings.Contains(Preamble(project), "| coder | Project coder | project |") {
		t.Fatal("catalogue missing from preamble")
	}
}
