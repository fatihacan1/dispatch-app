package agent

import (
	"bufio"
	"context"
	"fmt"
	"github.com/fatihacan1/dispatch-app/internal/provider"
	"github.com/fatihacan1/dispatch-app/internal/template"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

type Agent struct {
	Name, Provider, Model, Role, Workdir, Status, Session string
	Transcript                                            []string
	Tokens                                                int
	Unread                                                int
	Cost                                                  float64
	cancel                                                context.CancelFunc
	mu                                                    sync.Mutex
}

func (a *Agent) Stop() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cancel != nil {
		a.cancel()
	}
}
func (a *Agent) Run(prompt, home string, emit func(provider.Event)) {
	a.mu.Lock()
	if a.cancel != nil {
		a.mu.Unlock()
		emit(provider.Event{Kind: "error", Text: "Agent is already working"})
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.cancel = cancel
	session := a.Session
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.cancel = nil; a.mu.Unlock(); cancel() }()
	if a.Provider == "fake" {
		emit(provider.Event{Kind: "text", Text: "GHOST-01 acknowledges: " + prompt})
		emit(provider.Event{Kind: "done", Session: "demo"})
		return
	}
	role := a.Role + "\nYou are " + a.Name + ". Use dispatch list, dispatch spawn --template coder --name NAME --task TASK, dispatch send --to NAME MESSAGE and dispatch reply --to NAME ANSWER to coordinate."
	if a.Name == "boss" {
		role += "\n\n" + template.Preamble(a.Workdir)
		// Include the current catalogue on every turn, including resumed sessions.
		if session != "" {
			prompt = template.Preamble(a.Workdir) + "\n" + prompt
		}
	}
	if a.Provider != "claude" && session == "" {
		prompt = role + "\n\n" + prompt
	}
	configs, e := provider.CustomProviders()
	if e != nil {
		emit(provider.Event{Kind: "error", Text: e.Error()})
		return
	}
	custom, isCustom := configs[a.Provider]
	var bin string
	var args []string
	if isCustom {
		bin = "sh"
		flag := "-c"
		if runtime.GOOS == "windows" {
			bin = "cmd"
			flag = "/C"
		}
		args = []string{flag, provider.CustomCommand(custom, provider.Options{Prompt: prompt, Session: session, Model: a.Model}, a.Workdir)}
	} else {
		bin, e = provider.Binary(a.Provider)
		if e != nil {
			emit(provider.Event{Kind: "error", Text: e.Error()})
			return
		}
		args = provider.Args(a.Provider, provider.Options{Prompt: prompt, Session: session, Model: a.Model, Role: role})
	}

	if runtime.GOOS == "windows" {
		ext := strings.ToLower(filepath.Ext(bin))
		if ext == ".cmd" || ext == ".bat" {
			args = append([]string{"/d", "/s", "/c", bin}, args...)
			bin = "cmd.exe"
		} else if ext == ".ps1" {
			args = append([]string{"-NoProfile", "-File", bin}, args...)
			bin = "powershell.exe"
		}
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = a.Workdir
	cmd.Env = append(os.Environ(), "DISPATCH_AGENT="+a.Name, "DISPATCH_HOME="+home, "MYARMY_AGENT="+a.Name, "MYARMY_HOME="+home)
	stdout, e := cmd.StdoutPipe()
	if e != nil {
		emit(provider.Event{Kind: "error", Text: e.Error()})
		return
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if e = cmd.Start(); e != nil {
		emit(provider.Event{Kind: "error", Text: e.Error()})
		return
	}
	s := bufio.NewScanner(stdout)
	s.Buffer(make([]byte, 4096), 4*1024*1024)
	for s.Scan() {
		events := provider.Parse(s.Text())
		if isCustom && custom.Output == "text" {
			events = []provider.Event{{Kind: "text", Text: s.Text()}}
		}
		for _, ev := range events {

			if ev.Kind != "done" {
				emit(ev)
			}
		}
	}
	if e = s.Err(); e != nil {
		emit(provider.Event{Kind: "error", Text: e.Error()})
	}
	if e = cmd.Wait(); e != nil {
		emit(provider.Event{Kind: "error", Text: fmt.Sprintf("%v: %s", e, stderr.String())})
		return
	}
	emit(provider.Event{Kind: "done"})
}
