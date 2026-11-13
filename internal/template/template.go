package template

import (
	"fmt"
	"gopkg.in/yaml.v3"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type Template struct {
	Name        string   `yaml:"name"`
	Description string   `yaml:"description,omitempty"`
	Provider    string   `yaml:"provider,omitempty"`
	Model       string   `yaml:"model,omitempty"`
	Effort      string   `yaml:"effort,omitempty"`
	Tags        []string `yaml:"tags,omitempty"`
	Color       string   `yaml:"color,omitempty"`
	// Approve "auto": Dispatch starts the CLI with its skip-approval flag (read by the desktop app as extra.dispatch_approve).
	Approve string `yaml:"dispatch_approve,omitempty"`
	Role        string   `yaml:"-"`
	Scope       string   `yaml:"-"`
	File        string   `yaml:"-"`
}

var valid = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func Dir() string                      { h, _ := os.UserHomeDir(); return filepath.Join(h, ".dispatch", "agents") }
func ProjectDir(project string) string { return filepath.Join(project, ".dispatch", "agents") }
func path(dir, name string) (string, error) {
	if !valid.MatchString(name) {
		return "", fmt.Errorf("invalid template name %q", name)
	}
	return filepath.Join(dir, name+".md"), nil
}
func Parse(b []byte) (Template, error) {
	var t Template
	s := strings.ReplaceAll(string(b), "\r\n", "\n")
	if !strings.HasPrefix(s, "---\n") {
		return t, fmt.Errorf("missing YAML frontmatter")
	}
	end := strings.Index(s[4:], "\n---\n")
	if end < 0 {
		return t, fmt.Errorf("unterminated YAML frontmatter")
	}
	end += 4
	if err := yaml.Unmarshal([]byte(s[4:end]), &t); err != nil {
		return t, err
	}
	if !valid.MatchString(t.Name) {
		return t, fmt.Errorf("invalid template name %q", t.Name)
	}
	t.Role = strings.TrimSpace(s[end+5:])
	return t, nil
}
func Marshal(t Template) ([]byte, error) {
	if !valid.MatchString(t.Name) {
		return nil, fmt.Errorf("invalid template name %q", t.Name)
	}
	b, e := yaml.Marshal(t)
	if e != nil {
		return nil, e
	}
	return []byte("---\n" + string(b) + "---\n" + strings.TrimSpace(t.Role) + "\n"), nil
}
func Save(dir string, t Template) error {
	p, e := path(dir, t.Name)
	if e != nil {
		return e
	}
	b, e := Marshal(t)
	if e != nil {
		return e
	}
	if e = os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	return os.WriteFile(p, b, 0600)
}
func Load(dir, name string) (Template, error) {
	p, e := path(dir, name)
	if e != nil {
		return Template{}, e
	}
	b, e := os.ReadFile(p)
	if e != nil {
		return Template{}, e
	}
	t, e := Parse(b)
	t.File = p
	return t, e
}
func Delete(dir, name string) error {
	p, e := path(dir, name)
	if e != nil {
		return e
	}
	return os.Remove(p)
}
func List(dir string) ([]Template, error) {
	es, e := os.ReadDir(dir)
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var ts []Template
	for _, f := range es {
		if !f.IsDir() && filepath.Ext(f.Name()) == ".md" {
			b, err := os.ReadFile(filepath.Join(dir, f.Name()))
			if err != nil {
				return nil, err
			}
			t, err := Parse(b)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", f.Name(), err)
			}
			t.File = filepath.Join(dir, f.Name())
			ts = append(ts, t)
		}
	}
	return ts, nil
}

var builtins = []Template{
	{Name: "boss", Provider: "claude", Description: "Coordinates agents and delivers the final result.", Role: "You are the team lead. Decompose missions, recruit suitable agents, coordinate their work, verify results, and report clearly."},
	{Name: "coder", Provider: "codex", Description: "Implements features and fixes in the codebase. Use for concrete coding tasks.", Role: "You are a focused senior engineer. Implement the assigned change, run appropriate tests, and report results and risks."},
	{Name: "researcher", Provider: "codex", Description: "Investigates questions and gathers evidence.", Role: "Research the assigned question carefully. Cite evidence, distinguish uncertainty, and report actionable conclusions."},
	{Name: "reviewer", Provider: "claude", Description: "Reviews changes for defects and regressions.", Role: "Review the work independently. Identify actionable bugs and risks with evidence, then report findings by severity."},
	{Name: "scout", Provider: "antigravity", Description: "Explores the codebase and finds relevant context.", Role: "Explore the assigned area efficiently. Map relevant files and interfaces and share findings with the team."},
	{Name: "tester", Provider: "codex", Description: "Designs and runs meaningful tests.", Role: "Verify the assigned behavior with targeted tests. Investigate failures and report coverage and remaining risks."},
	{Name: "docs-writer", Provider: "codex", Description: "Writes and improves project documentation.", Role: "Write accurate, concise documentation grounded in the implementation. Check examples and report changes."},
}

// Defaults migrates legacy templates without overwriting existing Markdown files.
func Defaults(dir string) error {
	old := filepath.Join(filepath.Dir(dir), "templates")
	es, e := os.ReadDir(old)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	for _, f := range es {
		if filepath.Ext(f.Name()) != ".yaml" {
			continue
		}
		b, e := os.ReadFile(filepath.Join(old, f.Name()))
		if e != nil {
			return e
		}
		var v struct {
			Name, Provider, Model, Role, Effort string
			Tags                                []string
		}
		if e = yaml.Unmarshal(b, &v); e != nil {
			return e
		}
		t := Template{Name: v.Name, Provider: v.Provider, Model: v.Model, Role: v.Role, Effort: v.Effort, Tags: v.Tags}
		p, e := path(dir, t.Name)
		if e != nil {
			return e
		}
		if _, e = os.Stat(p); os.IsNotExist(e) {
			if e = Save(dir, t); e != nil {
				return e
			}
		} else if e != nil {
			return e
		}
	}
	return nil
}
func Catalogue(project string) ([]Template, error) {
	if e := Defaults(Dir()); e != nil {
		return nil, e
	}
	h, _ := os.UserHomeDir()
	merged := map[string]Template{}
	// Claude imports have lower precedence than built-ins and native templates.
	for _, src := range []struct{ dir, scope string }{{filepath.Join(h, ".claude", "agents"), "Imported (Claude Code)"}, {filepath.Join(project, ".claude", "agents"), "Imported (Claude Code)"}} {
		ts, e := List(src.dir)
		if e != nil {
			return nil, e
		}
		for _, t := range ts {
			if t.Provider == "" {
				t.Provider = "claude"
			}
			t.Scope = src.scope
			merged[t.Name] = t
		}
	}
	for _, t := range builtins {
		t.Scope = "Built-in"
		merged[t.Name] = t
	}
	for _, src := range []struct{ dir, scope string }{{Dir(), "Global"}, {ProjectDir(project), "Project"}} {
		ts, e := List(src.dir)
		if e != nil {
			return nil, e
		}
		for _, t := range ts {
			t.Scope = src.scope
			merged[t.Name] = t
		}
	}
	out := make([]Template, 0, len(merged))
	for _, t := range merged {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}
func Resolve(project, name string) (Template, error) {
	ts, e := Catalogue(project)
	if e != nil {
		return Template{}, e
	}
	for _, t := range ts {
		if t.Name == name {
			return t, nil
		}
	}
	return Template{}, fmt.Errorf("template %q not found", name)
}
func Preamble(project string) string {
	ts, e := Catalogue(project)
	if e != nil {
		return "Template catalogue unavailable: " + e.Error()
	}
	var b strings.Builder
	b.WriteString("Template catalogue:\n| Name | Description | Provider |\n| --- | --- | --- |\n")
	for _, t := range ts {
		fmt.Fprintf(&b, "| %s | %s | %s |\n", t.Name, strings.ReplaceAll(strings.ReplaceAll(t.Description, "|", "\\|"), "\n", " "), t.Provider)
	}
	b.WriteString("Recruit with dispatch spawn --template <name> --name <id> --task \"...\". Create templates with dispatch template create --name x --provider y --description \"...\" --prompt-file file.md.\n")
	return b.String()
}
