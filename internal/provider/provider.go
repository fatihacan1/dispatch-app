package provider

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

type Event struct {
	Kind, Text, Session string
	Tokens              int
	Cost                float64
}
type Options struct{ Prompt, Session, Model, Role, Custom string }

var Names = []string{"claude", "codex", "opencode", "qoder", "antigravity", "gemini", "custom"}

func Binary(name string) (string, error) {
	candidates := []string{name}
	if name == "qoder" {
		candidates = []string{"qodercli", "qoder"}
	}
	if name == "antigravity" {
		candidates = []string{"agy"}
	}
	for _, n := range candidates {
		if p, e := exec.LookPath(n); e == nil {
			return p, nil
		}
	}
	home, _ := os.UserHomeDir()
	dirs := []string{filepath.Join(os.Getenv("LOCALAPPDATA"), "agy", "bin"), filepath.Join(os.Getenv("APPDATA"), "npm"), filepath.Join(home, ".local", "bin")}
	for _, dir := range dirs {
		for _, n := range candidates {
			for _, ext := range []string{"", ".exe", ".cmd", ".ps1"} {
				p := filepath.Join(dir, n+ext)
				if info, err := os.Stat(p); err == nil && !info.IsDir() {
					return p, nil
				}
			}
		}
	}
	return "", fmt.Errorf("%s not found on PATH or standard install directories", name)
}
func Args(name string, o Options) []string {
	var a []string
	switch name {
	case "claude":
		a = []string{"-p", "--output-format", "stream-json", "--verbose"}
		if o.Session != "" {
			a = append(a, "--resume", o.Session)
		}
		if o.Role != "" {
			a = append(a, "--append-system-prompt", o.Role)
		}
	case "codex":
		a = []string{"exec", "--json"}
		if o.Model != "" {
			a = append(a, "-m", o.Model)
		}
		if o.Session != "" {
			a = append(a, "resume", o.Session)
		}
	case "opencode":
		a = []string{"run", "--format", "json"}
		if o.Session != "" {
			a = append(a, "--session", o.Session)
		}
	case "qoder":
		a = []string{"-p", "--output-format", "stream-json"}
		if o.Session != "" {
			a = append(a, "--resume", o.Session)
		}
	case "gemini":
		a = []string{"-p", o.Prompt, "--output-format", "stream-json"}
		if o.Session != "" {
			a = append(a, "--resume", o.Session)
		}
		if o.Model != "" {
			a = append(a, "--model", o.Model)
		}
		return a
	case "antigravity":
		a = []string{"-p", o.Prompt, "--output-format", "stream-json"}
		if o.Session != "" {
			a = append(a, "--conversation", o.Session)
		}
		if o.Model != "" {
			a = append(a, "--model", o.Model)
		}
		return a
	case "custom":
		if runtime.GOOS == "windows" {
			return []string{"/C", strings.ReplaceAll(o.Custom, "{prompt}", o.Prompt)}
		}
		return []string{"-c", strings.ReplaceAll(o.Custom, "{prompt}", o.Prompt)}
	}
	if o.Model != "" && name != "codex" {
		a = append(a, "--model", o.Model)
	}
	return append(a, o.Prompt)
}
func Parse(line string) []Event {
	var m map[string]any
	if json.Unmarshal([]byte(line), &m) != nil {
		return []Event{{Kind: "text", Text: line}}
	}
	var out []Event
	str := func(m map[string]any, k string) string { v, _ := m[k].(string); return v }
	kind := str(m, "type")
	if kind == "" {
		kind = str(m, "event")
	}
	session := str(m, "session_id")
	if session == "" {
		session = str(m, "sessionID")
	}
	if session == "" {
		session = str(m, "thread_id")
	}
	if session == "" {
		session = str(m, "conversation_id")
	}
	if session != "" {
		out = append(out, Event{Kind: "status", Session: session})
	}
	add := func(k, s string) {
		if s != "" {
			out = append(out, Event{Kind: k, Text: s})
		}
	}
	switch kind {
	case "message":
		if str(m, "role") == "assistant" {
			add("text", str(m, "content"))
		}
	case "assistant":
		if msg, ok := m["message"].(map[string]any); ok {
			if blocks, ok := msg["content"].([]any); ok {
				for _, v := range blocks {
					if b, ok := v.(map[string]any); ok {
						if str(b, "type") == "text" {
							add("text", str(b, "text"))
						} else if str(b, "type") == "tool_use" {
							add("tool", str(b, "name"))
						}
					}
				}
			}
		}
	case "item.completed":
		if item, ok := m["item"].(map[string]any); ok {
			if str(item, "type") == "agent_message" {
				add("text", str(item, "text"))
			} else {
				add("tool", str(item, "command"))
			}
		}
	case "text":
		if p, ok := m["part"].(map[string]any); ok {
			add("text", str(p, "text"))
		}
	case "tool_use":
		add("tool", str(m, "tool_name"))
	case "error":
		add("error", fmt.Sprint(m["error"]))
	case "step_update":
		if p, ok := m["step_update"].(map[string]any); ok {
			if str(p, "step_type") == "agent_response" {
				add("text", str(p, "text_delta"))
			} else if str(p, "step_type") == "tool" {
				add("tool", str(p, "tool_name"))
			}
		}
	case "result", "turn.completed", "step_finish":
		ev := Event{Kind: "usage"}
		if u, ok := m["usage"].(map[string]any); ok {
			for _, key := range []string{"input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"} {
				if v, ok := u[key].(float64); ok {
					ev.Tokens += int(v)
				}
			}
		}
		if v, ok := m["total_cost_usd"].(float64); ok {
			ev.Cost = v
		}
		out = append(out, ev)
		out = append(out, Event{Kind: "done"})
	}
	return out
}
func Icon(name string) string {
	if os.Getenv("MYARMY_ASCII") == "1" {
		return "*"
	}
	if os.Getenv("MYARMY_NERDFONT") == "1" {
		switch name {
		case "claude":
			return "\U000f06a9"
		case "codex", "openai":
			return "\U000f02a4"
		case "gemini":
			return "\U000f02ad"
		}
	}
	switch name {
	case "claude":
		return "\u273b"
	case "codex", "openai":
		return "\u25ce"
	case "opencode":
		return "\u25a3"
	case "qoder":
		return "\u25c6"
	case "antigravity", "gemini":
		return "\u2726"
	default:
		return "\u2b22"
	}
}

// InteractiveArgs builds the native CLI's interactive resume command.
func InteractiveArgs(name, id string) []string {
	if id == "" {
		return nil
	}
	switch name {
	case "claude":
		return []string{"--resume", id}
	case "codex":
		return []string{"resume", id}
	case "opencode":
		return []string{"--session", id}
	case "qoder":
		return []string{"--resume", id}
	case "antigravity":
		return []string{"--conversation", id}
	case "gemini":
		return []string{"--resume", id}
	}
	return nil
}
