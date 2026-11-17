package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/fatihacan1/dispatch-app/internal/bus"
	"github.com/fatihacan1/dispatch-app/internal/provider"
	"github.com/fatihacan1/dispatch-app/internal/session"
	"github.com/fatihacan1/dispatch-app/internal/storage"
	"github.com/fatihacan1/dispatch-app/internal/template"
	"github.com/fatihacan1/dispatch-app/internal/tui"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"
)

func usage() {
	fmt.Println(`dispatch - agent orchestration terminal

Usage: dispatch [--demo|--new|-c|--continue|--resume ID] | sessions | workspaces | doctor | spawn | send | ask | reply | list | status | log | tasks | kill | template | schedule | telegram | outputs
Run dispatch COMMAND --help for command flags.`)
}
func fatal(e error) {
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
var agentName = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_-]*$`)

// readText reads a message from a file, or from standard input when the path is "-".
func readText(path string) string {
	var data []byte
	var err error
	if path == "-" {
		data, err = io.ReadAll(os.Stdin)
	} else {
		data, err = os.ReadFile(path)
	}
	fatal(err)
	// Windows PowerShell writes files and pipes as UTF-16 or with a UTF-8 byte order mark.
	if len(data) >= 2 && data[0] == 0xFF && data[1] == 0xFE {
		units := make([]uint16, 0, len(data)/2)
		for i := 2; i+1 < len(data); i += 2 {
			units = append(units, uint16(data[i])|uint16(data[i+1])<<8)
		}
		data = []byte(string(utf16.Decode(units)))
	}
	text := strings.TrimPrefix(string(data), "\xEF\xBB\xBF")
	return strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n"))
}
func envName(primary, legacy string) string {
	if value := os.Getenv(primary); value != "" {
		return value
	}
	return os.Getenv(legacy)
}
func main() {
	args := os.Args[1:]
	if len(args) > 0 && (args[0] == "--help" || args[0] == "-h") {
		usage()
		return
	}
	project, e := os.Getwd()
	fatal(e)
	fatal(storage.Migrate(project))
	if os.Getenv("DISPATCH_HOME") == "" && os.Getenv("MYARMY_HOME") == "" {
		if home, err := os.UserHomeDir(); err == nil {
			fatal(storage.Migrate(home))
		}
	}
	b := bus.New(project)
	if h := envName("DISPATCH_HOME", "MYARMY_HOME"); h != "" {
		b.Root = h
	}
	if len(args) == 0 || args[0] == "--demo" || args[0] == "--new" || args[0] == "-c" || args[0] == "--continue" || args[0] == "--resume" {
		if len(args) == 0 || args[0] != "--demo" {
			fatal(template.Defaults(template.Dir()))
		}
		mode := ""
		id := ""
		if len(args) > 0 {
			mode = args[0]
		}
		if mode == "--resume" {
			if len(args) < 2 {
				fatal(fmt.Errorf("session id required"))
			}
			id = args[1]
		}
		fatal(tui.Run(project, mode == "--demo", mode, id))
		return
	}
	switch args[0] {
	case "index":
		if len(args) < 3 || args[1] != "search" {
			fatal(fmt.Errorf("usage: dispatch index search <symbol>"))
		}
		file := os.Getenv("DISPATCH_INDEX_INFO")
		if file == "" {
			fatal(fmt.Errorf("workspace index is unavailable"))
		}
		contents, err := os.ReadFile(file)
		fatal(err)
		var info struct {
			Port  int    `json:"port"`
			Token string `json:"token"`
		}
		fatal(json.Unmarshal(contents, &info))
		if info.Port < 1 || info.Port > 65535 || info.Token == "" {
			fatal(fmt.Errorf("invalid workspace index connection"))
		}
		req, err := http.NewRequest("GET", fmt.Sprintf("http://127.0.0.1:%d/search?q=%s", info.Port, url.QueryEscape(strings.Join(args[2:], " "))), nil)
		fatal(err)
		req.Header.Set("Authorization", "Bearer "+info.Token)
		client := &http.Client{Timeout: 5 * time.Second}
		response, err := client.Do(req)
		fatal(err)
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			fatal(fmt.Errorf("index returned HTTP %d", response.StatusCode))
		}
		_, err = io.Copy(os.Stdout, io.LimitReader(response.Body, 65536))
		fatal(err)
		fmt.Println()
	case "snapshot":
		f := flag.NewFlagSet("snapshot", flag.ExitOnError)
		demo := f.Bool("demo", false, "use demo data")
		width := f.Int("width", 80, "terminal width")
		height := f.Int("height", 24, "terminal height")
		screen := f.String("screen", "main", "screen")
		plain := f.Bool("plain", false, "remove ANSI styling")
		htmlPath := f.String("html", "", "write standalone HTML")
		_ = f.Parse(args[1:])
		if *htmlPath != "" {
			_ = os.Setenv("COLORTERM", "truecolor")
		}
		out, err := tui.Snapshot(*demo, *width, *height, *screen, *plain && *htmlPath == "")
		fatal(err)
		if *htmlPath != "" {
			fatal(os.WriteFile(*htmlPath, []byte(tui.HTML(out)), 0644))
		} else {
			fmt.Println(out)
		}

	case "sessions":
		action := "list"
		if len(args) > 1 {
			action = args[1]
		}
		switch action {
		case "list":
			ss, e := session.List(project)
			fatal(e)
			for _, v := range ss {
				fmt.Printf("%s\t%s\t%s\n", v.ID, v.Updated.Format(time.RFC3339), v.Title)
			}
		case "show":
			if len(args) < 3 {
				fatal(fmt.Errorf("session id required"))
			}
			v, e := session.Load(project, args[2])
			fatal(e)
			data, _ := json.MarshalIndent(v, "", "  ")
			fmt.Println(string(data))
			for _, a := range v.Agents {
				fmt.Printf("\n[%s]\n%s\n", a.Name, strings.Join(a.Transcript, "\n"))
			}
		case "delete":
			if len(args) < 3 {
				fatal(fmt.Errorf("session id required"))
			}
			fatal(session.Delete(project, args[2]))
			fatal(session.Touch(project))
		case "prune":
			ss, e := session.List(project)
			fatal(e)
			for _, v := range ss {
				if len(v.Agents) == 0 {
					fatal(session.Delete(project, v.ID))
				}
			}
			fatal(session.Touch(project))
		default:
			fatal(fmt.Errorf("usage: dispatch sessions [list|show ID|delete ID|prune]"))
		}
	case "workspaces":
		action := "list"
		if len(args) > 1 {
			action = args[1]
		}
		switch action {
		case "list":
			ws, e := session.Workspaces()
			fatal(e)
			for _, w := range ws {
				fmt.Printf("%s\t%d\t%s\n", w.Path, w.SessionCount, w.LastSessionTitle)
			}
		case "forget":
			if len(args) < 3 {
				fatal(fmt.Errorf("workspace path required"))
			}
			fatal(session.Forget(args[2]))
		default:
			fatal(fmt.Errorf("usage: dispatch workspaces [list|forget PATH]"))
		}
	case "doctor":
		for _, n := range provider.Names[:6] {
			p, e := provider.Binary(n)
			if e != nil {
				fmt.Printf("%-12s not found\n", n)
				continue
			}
			out, e := exec.Command(p, "--version").CombinedOutput()
			if e != nil {
				fmt.Printf("%-12s %s (version unavailable)\n", n, p)
			} else {
				fmt.Printf("%-12s %s %s\n", n, p, strings.TrimSpace(string(out)))
			}
		}
	case "send", "reply", "ask":
		f := flag.NewFlagSet(args[0], flag.ExitOnError)
		to := f.String("to", "", "recipient")
		from := f.String("from", envName("DISPATCH_AGENT", "MYARMY_AGENT"), "sender")
		wait := f.Bool("wait", false, "wait for reply")
		replyTo := f.String("reply-to", "", "request message id to answer")
		f.StringVar(replyTo, "re", "", "request message id to answer")
		file := f.String("file", "", "read the message from this file (keeps line breaks and quotes)")
		stdin := f.Bool("stdin", false, "read the message from standard input")
		parseArgs := append([]string(nil), args[1:]...)
		// Go's flag parser stops at the first positional argument.
		for i, arg := range parseArgs {
			if arg == "--wait" && i > 0 {
				parseArgs = append([]string{"--wait"}, append(parseArgs[:i], parseArgs[i+1:]...)...)
				break
			}
		}
		_ = f.Parse(parseArgs)
		if *from == "" {
			*from = "user"
		}
		text := strings.Join(f.Args(), " ")
		if *file != "" {
			text = readText(*file)
		} else if *stdin || text == "-" {
			text = readText("-")
		}
		if *to == "" || strings.TrimSpace(text) == "" {
			fatal(fmt.Errorf("recipient and message required: dispatch %s --to <agent> \"<message>\" (or --file <path>, or --stdin)", args[0]))
		}
		id := bus.NewID()
		kind := args[0]
		if kind == "ask" && *wait {
			kind = "ask-wait"
		}
		fatal(b.Send(bus.Message{ID: id, From: *from, To: *to, Text: text, Kind: kind, ReplyTo: *replyTo}))
		if *wait {
			for {
				m, e := b.ReceiveReply(*from, id)
				fatal(e)
				if m != nil {
					fmt.Println(m.Text)
					return
				}
				time.Sleep(time.Second)
			}
		}
	case "spawn":
		f := flag.NewFlagSet("spawn", flag.ExitOnError)
		name := f.String("name", "", "agent name")
		tpl := f.String("template", "coder", "template")
		task := f.String("task", "", "task")
		prompt := f.String("prompt", "", "role prompt for a temporary agent (no template is saved)")
		provider := f.String("provider", "", "provider for a temporary agent (default: same as the caller)")
		model := f.String("model", "", "model for a temporary agent")
		toolsList := f.String("tools", "", "comma-separated Dispatch tools for a temporary agent, e.g. comfyui,unreal")
		taskFile := f.String("task-file", "", "read the task from this file (keeps line breaks and quotes)")
		autoApprove := f.Bool("auto-approve", false, "run without stopping for command approvals (works with --template too)")
		_ = f.Parse(args[1:])
		// A quote inside the task ends the shell argument early; the rest used to be dropped without a word.
		if f.NArg() > 0 {
			fatal(fmt.Errorf("unexpected text after the flags: %q. The task was cut by a quote in it; write the task to a file and pass --task-file <path>", strings.Join(f.Args(), " ")))
		}
		if *taskFile != "" {
			*task = readText(*taskFile)
		} else if *task == "-" {
			*task = readText("-")
		}
		if !agentName.MatchString(*name) {
			fatal(fmt.Errorf("--name is required: letters, digits, - and _ only"))
		}
		from := envName("DISPATCH_AGENT", "MYARMY_AGENT")
		if from == "" {
			from = "user"
		}
		ref := *tpl
		if *prompt != "" {
			inline, err := json.Marshal(map[string]any{"name": *name, "provider": *provider, "model": *model, "body": *prompt, "tools": *toolsList, "temporary": true, "autoApprove": *autoApprove})
			fatal(err)
			ref = string(inline)
		} else if *autoApprove {
			// Saved template, but this agent skips approvals: the app reads the "+auto-approve" suffix.
			ref += "+auto-approve"
		}
		fatal(b.Send(bus.Message{From: from, To: "orchestrator", Kind: "spawn", Text: *name + "\n" + ref + "\n" + *task}))
	case "kill", "stop", "restart":
		if len(args) < 2 || args[1] == "--help" || args[1] == "-h" || args[1] == "help" {
			fmt.Printf("Usage: dispatch %s <agent name>\n", args[0])
			return
		}
		if !agentName.MatchString(args[1]) {
			fatal(fmt.Errorf("%q is not an agent name. Usage: dispatch %s <agent name>", args[1], args[0]))
		}
		from := envName("DISPATCH_AGENT", "MYARMY_AGENT")
		if from == "" {
			from = "user"
		}
		fatal(b.Send(bus.Message{From: from, To: "orchestrator", Kind: args[0], Text: args[1]}))
	case "schedule":
		// Dispatch (the desktop app) owns schedules and checks who may manage them; this command only asks it.
		if len(args) < 2 {
			fatal(fmt.Errorf("usage: dispatch schedule add|list|remove|pause|resume|approve"))
		}
		action := args[1]
		req := map[string]any{"action": action}
		switch action {
		case "add":
			f := flag.NewFlagSet("schedule add", flag.ExitOnError)
			title := f.String("title", "", "short name, e.g. Daily video")
			why := f.String("why", "", "why this schedule exists (shown to the user)")
			task := f.String("task", "", "the message the target agent gets each run")
			to := f.String("to", "", "agent that runs it (default: you)")
			every := f.String("every", "", "repeat interval: 30m, 2h, 1d, 1w")
			at := f.String("at", "", "time of day HH:MM (with --every 1d/1w), or a single date-time YYYY-MM-DD HH:MM")
			_ = f.Parse(args[2:])
			req["title"], req["why"], req["task"], req["to"], req["every"], req["at"] = *title, *why, *task, *to, *every, *at
		case "list":
		case "remove", "pause", "resume", "approve":
			if len(args) < 3 {
				fatal(fmt.Errorf("schedule id required"))
			}
			req["id"] = args[2]
		default:
			fatal(fmt.Errorf("unknown schedule command %q", action))
		}
		from := envName("DISPATCH_AGENT", "MYARMY_AGENT")
		if from == "" {
			from = "user"
		}
		data, e := json.Marshal(req)
		fatal(e)
		id := bus.NewID()
		fatal(b.Send(bus.Message{ID: id, From: from, To: "orchestrator", Kind: "schedule", Text: string(data)}))
		reply := filepath.Join(b.Root, "replies", id+".txt")
		for i := 0; i < 100; i++ {
			if out, e := os.ReadFile(reply); e == nil {
				_ = os.Remove(reply)
				text := string(out)
				if strings.HasPrefix(text, "ERROR: ") {
					fatal(fmt.Errorf("%s", strings.TrimPrefix(text, "ERROR: ")))
				}
				fmt.Println(text)
				return
			}
			time.Sleep(200 * time.Millisecond)
		}
		fatal(fmt.Errorf("Dispatch did not answer; schedules need the Dispatch app to be running"))
	case "telegram":
		// Boss only: send a message or a file to the user's Telegram chat (Dispatch checks access).
		usage := fmt.Errorf("usage: dispatch telegram send --text <message> [--file <path>] | owner <agent> | profile [--photo <path>] [--name <name>] [--description <text>] [--about <text>]")
		if len(args) < 2 {
			fatal(usage)
		}
		req := map[string]any{"action": args[1]}
		switch args[1] {
		case "send":
			f := flag.NewFlagSet("telegram send", flag.ExitOnError)
			text := f.String("text", "", "message text (caption when --file is given)")
			file := f.String("file", "", "image, video, audio or any file to send")
			_ = f.Parse(args[2:])
			if *text == "" && f.NArg() > 0 {
				*text = strings.Join(f.Args(), " ")
			}
			if *text == "" && *file == "" {
				fatal(fmt.Errorf("give --text and/or --file"))
			}
			req["text"], req["file"] = *text, *file
		case "owner":
			if len(args) < 3 {
				fatal(fmt.Errorf("usage: dispatch telegram owner <agent>  (boss to take it back)"))
			}
			req["agent"] = args[2]
		case "profile":
			f := flag.NewFlagSet("telegram profile", flag.ExitOnError)
			photo := f.String("photo", "", "new profile photo (jpg or png)")
			name := f.String("name", "", "bot display name")
			desc := f.String("description", "", "text shown in an empty chat")
			about := f.String("about", "", "short text on the bot's profile")
			_ = f.Parse(args[2:])
			req["photo"], req["name"], req["description"], req["about"] = *photo, *name, *desc, *about
		default:
			fatal(usage)
		}
		from := envName("DISPATCH_AGENT", "MYARMY_AGENT")
		if from == "" {
			from = "user"
		}
		data, e := json.Marshal(req)
		fatal(e)
		id := bus.NewID()
		fatal(b.Send(bus.Message{ID: id, From: from, To: "orchestrator", Kind: "telegram", Text: string(data)}))
		reply := filepath.Join(b.Root, "replies", id+".txt")
		for i := 0; i < 300; i++ {
			if out, e := os.ReadFile(reply); e == nil {
				_ = os.Remove(reply)
				if s := string(out); strings.HasPrefix(s, "ERROR: ") {
					fatal(fmt.Errorf("%s", strings.TrimPrefix(s, "ERROR: ")))
				} else {
					fmt.Println(s)
				}
				return
			}
			time.Sleep(200 * time.Millisecond)
		}
		fatal(fmt.Errorf("Dispatch did not answer; Telegram needs the Dispatch app to be running"))
	case "outputs":
		// Shared gallery: every agent's finished files under .dispatch/outputs/<agent>/.
		root := filepath.Join(b.Root, "outputs")
		count := 0
		_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || strings.HasPrefix(info.Name(), ".") {
				return nil
			}
			rel, _ := filepath.Rel(root, p)
			if len(args) > 1 && !strings.HasPrefix(filepath.ToSlash(rel), args[1]+"/") {
				return nil
			}
			fmt.Printf("%s\t%d\t%s\n", info.ModTime().Format("2006-01-02 15:04"), info.Size(), p)
			count++
			return nil
		})
		if count == 0 {
			fmt.Println("No outputs yet. Save finished files in " + filepath.Join(root, "<your name>"))
		}
	case "list", "status":
		data, e := os.ReadFile(filepath.Join(b.Root, "agents.json"))
		fatal(e)
		fmt.Println(string(data))
	case "log":
		data, e := os.Open(filepath.Join(b.Root, "log.jsonl"))
		fatal(e)
		defer data.Close()
		sc := bufio.NewScanner(data)
		for sc.Scan() {
			var m bus.Message
			if json.Unmarshal(sc.Bytes(), &m) == nil && (len(args) < 2 || m.To == args[1] || m.From == args[1]) {
				fmt.Println(sc.Text())
			}
		}
		fatal(sc.Err())
	case "tasks":
		// The task board of the current operation (kept by the app in tasks.json): open cards, one per line.
		fatal(printTasks(filepath.Join(b.Root, "tasks.json"), len(args) > 1 && args[1] == "--all", time.Now(), os.Stdout))
	case "template":
		fatal(template.Defaults(template.Dir()))
		if len(args) < 2 {
			fatal(fmt.Errorf("template list|show|create|edit|delete|path"))
		}
		switch args[1] {
		case "list":
			ts, e := template.Catalogue(project)
			fatal(e)
			for _, t := range ts {
				fmt.Printf("%s\t%s\t%s\t%s\n", t.Name, t.Provider, t.Scope, t.Description)
			}
		case "path":
			fmt.Println(template.ProjectDir(project))
			fmt.Println(template.Dir())
		case "show", "edit", "delete":
			if len(args) < 3 {
				fatal(fmt.Errorf("name required"))
			}
			t, e := template.Resolve(project, args[2])
			fatal(e)
			if args[1] == "show" {
				b, e := template.Marshal(t)
				fatal(e)
				fmt.Print(string(b))
				break
			}
			if t.File == "" {
				fatal(fmt.Errorf("built-in template cannot be %s", args[1]))
			}
			if args[1] == "delete" {
				fatal(os.Remove(t.File))
				break
			}
			editor := os.Getenv("EDITOR")
			if editor == "" {
				fatal(fmt.Errorf("EDITOR is not set"))
			}
			cmd := exec.Command(editor, t.File)
			cmd.Stdin = os.Stdin
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			fatal(cmd.Run())
		case "create":
			f := flag.NewFlagSet("template create", flag.ExitOnError)
			name := f.String("name", "", "name")
			prov := f.String("provider", "codex", "provider")
			description := f.String("description", "", "description")
			model := f.String("model", "", "model")
			effort := f.String("effort", "", "effort")
			role := f.String("role", "", "role prompt")
			promptFile := f.String("prompt-file", "", "role prompt file")
			global := f.Bool("global", false, "save globally")
			autoApprove := f.Bool("auto-approve", false, "run without stopping for command approvals")
			_ = f.Parse(args[2:])
			if *promptFile != "" {
				b, e := os.ReadFile(*promptFile)
				fatal(e)
				*role = string(b)
			}
			dir := template.ProjectDir(project)
			if *global {
				dir = template.Dir()
			}
			approve := ""
			if *autoApprove {
				approve = "auto"
			}
			fatal(template.Save(dir, template.Template{Name: *name, Provider: *prov, Description: *description, Model: *model, Effort: *effort, Role: *role, Approve: approve}))
		default:
			fatal(fmt.Errorf("unknown template command"))
		}

	default:
		usage()
		os.Exit(2)
	}
}
