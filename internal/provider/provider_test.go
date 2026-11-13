package provider

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestArgs(t *testing.T) {
	cases := []struct {
		name string
		opts Options
		want []string
	}{{"claude", Options{Prompt: "hi", Session: "s"}, []string{"-p", "--output-format", "stream-json", "--verbose", "--resume", "s", "hi"}}, {"codex", Options{Prompt: "hi", Session: "s"}, []string{"exec", "--json", "resume", "s", "hi"}}, {"antigravity", Options{Prompt: "hi", Session: "s"}, []string{"-p", "hi", "--output-format", "stream-json", "--conversation", "s"}}}
	for _, c := range cases {
		if got := Args(c.name, c.opts); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: %v", c.name, got)
		}
	}
}
func TestParse(t *testing.T) {
	cases := []struct{ line, kind, text string }{{`{"type":"thread.started","thread_id":"abc"}`, "status", ""}, {`{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}`, "text", "hello"}, {`{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"hi"}}`, "text", "hi"}, {`plain text`, "text", "plain text"}}
	for _, c := range cases {
		es := Parse(c.line)
		if len(es) == 0 || es[0].Kind != c.kind || es[0].Text != c.text {
			t.Errorf("%s: %#v", c.line, es)
		}
	}
}
func TestResumeArgs(t *testing.T) {
	for _, c := range []struct{ name, flag string }{{"claude", "--resume"}, {"qoder", "--resume"}, {"opencode", "--session"}, {"antigravity", "--conversation"}} {
		args := Args(c.name, Options{Prompt: "hi", Session: "sid"})
		found := false
		for i := range args {
			if args[i] == c.flag && i+1 < len(args) && args[i+1] == "sid" {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: %v", c.name, args)
		}
	}
}
func TestLiveClaudeFixture(t *testing.T) {
	data, e := os.ReadFile("testdata/claude-live.jsonl")
	if e != nil {
		t.Fatal(e)
	}
	textFound, usageFound := false, false
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		for _, event := range Parse(line) {
			if event.Kind == "text" {
				textFound = true
			}
			if event.Kind == "usage" && event.Tokens > 0 && event.Cost > 0 {
				usageFound = true
			}
		}
	}
	if !textFound || !usageFound {
		t.Fatal(textFound, usageFound)
	}
}
func TestProviderStreamFixtures(t *testing.T) {
	for _, name := range []string{"claude", "codex", "opencode", "qoder", "gemini", "antigravity"} {
		t.Run(name, func(t *testing.T) {
			b, err := os.ReadFile("testdata/" + name + "-stream.jsonl")
			if err != nil {
				t.Fatal(err)
			}
			seen := map[string]bool{}
			for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
				for _, e := range Parse(line) {
					if e.Session == "s" {
						seen["session"] = true
					}
					if e.Kind == "text" && e.Text == "hello" {
						seen["text"] = true
					}
					if e.Kind == "done" {
						seen["done"] = true
					}
				}
			}
			for _, key := range []string{"session", "text", "done"} {
				if !seen[key] {
					t.Errorf("missing %s", key)
				}
			}
		})
	}
}
