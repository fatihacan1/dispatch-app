package tui

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/fatihacan1/dispatch-app/internal/agent"
	"github.com/fatihacan1/dispatch-app/internal/bus"
	"github.com/fatihacan1/dispatch-app/internal/provider"
	"github.com/fatihacan1/dispatch-app/internal/theme"
)

type rect struct{ x, y, w, h int }

func watchColumns(n int) int {
	if n <= 1 {
		return 1
	}
	if n <= 4 {
		return 2
	}
	return 3
}
func watchRects(n, w, h int) []rect {
	n = min(n, 6)
	if n <= 0 {
		return nil
	}
	if n == 3 {
		return []rect{{0, 0, w / 2, h}, {w / 2, 0, w - w/2, h / 2}, {w / 2, h / 2, w - w/2, h - h/2}}
	}
	cols := watchColumns(n)
	rows := (n + cols - 1) / cols
	out := make([]rect, 0, n)
	for i := 0; i < n; i++ {
		x := i % cols
		y := i / cols
		out = append(out, rect{w * x / cols, h * y / rows, w*(x+1)/cols - w*x/cols, h*(y+1)/rows - h*y/rows})
	}
	return out
}
func agentName(a *agent.Agent) string {
	if strings.EqualFold(a.Name, "boss") {
		return "BOSS"
	}
	return a.Name
}
func (m model) watchTile(a *agent.Agent, selected bool, w, h int) []string {
	t := theme.All[m.theme]
	dim := lipgloss.NewStyle().Foreground(t.Dim)
	brand := lipgloss.NewStyle().Foreground(providerColor(a.Provider)).Bold(true)
	status := "\u25cb idle"
	if a.Status == "working" {
		status = []string{"\u28fe", "\u28fd", "\u28fb", "\u28bf"}[m.frame%4] + " working"
	}
	if a.Status == "error" {
		status = "\u2716 error"
	}
	title := provider.Icon(a.Provider) + " " + agentName(a) + " \u00b7 " + providerName(a.Provider)
	if selected {
		title = "\u25b6 " + title
	}
	activity := "waiting for messages"
	if a.Status == "working" {
		activity = "thinking\u2026"
		for i := len(a.Transcript) - 1; i >= 0; i-- {
			if strings.HasPrefix(a.Transcript[i], "[tool] ") {
				activity = strings.TrimPrefix(a.Transcript[i], "[tool] ")
				break
			}
		}
	}
	chip := lipgloss.NewStyle().Foreground(lipgloss.Color("#101010")).Background(t.Main).Bold(true).Render(" NOW ")
	rows := []string{chip + " " + lipgloss.NewStyle().Bold(true).Render(activity), dim.Render(strings.Repeat("\u2500", max(0, w-4)))}
	available := max(0, h-5)
	start := max(0, len(a.Transcript)-available)
	for len(rows)+len(a.Transcript)-start < h-3 {
		rows = append(rows, "")
	}
	for _, v := range a.Transcript[start:] {
		v = strings.ReplaceAll(v, "\n", " ")
		switch {
		case strings.HasPrefix(v, "> "):
			v = "YOU  " + strings.TrimPrefix(v, "> ")
		case strings.HasPrefix(v, "[tool] "):
			v = dim.Render("\u2699 " + strings.TrimPrefix(v, "[tool] "))
		case strings.HasPrefix(v, "\u2709"):
			v = lipgloss.NewStyle().Foreground(t.Accent).Render(v)
		default:
			v = agentName(a) + "  " + v
		}
		rows = append(rows, v)
	}
	for len(rows) < h-3 {
		rows = append(rows, "")
	}
	rows = append(rows, dim.Render(fmt.Sprintf("%s tok \u00b7 %d msgs", token(a.Tokens), len(a.Transcript))))
	col := t.Dim
	if selected {
		col = t.Main
	}
	out := box("", rows, w, h, col)
	if len(out) > 0 {
		edge := lipgloss.NewStyle().Foreground(col)
		left, right, bar := "\u256d", "\u256e", "\u2500"
		if selected {
			left, right, bar = "\u2554", "\u2557", "\u2550"
		}
		caption := brand.Render(title)
		gap := max(1, w-2-ansi.StringWidth(caption)-ansi.StringWidth(status))
		out[0] = edge.Render(left) + fit(caption+strings.Repeat(" ", gap)+status, w-2) + edge.Render(right)
		if selected && len(out) > 1 {
			for i := 1; i < len(out)-1; i++ {
				out[i] = edge.Render("\u2551") + ansi.Cut(out[i], 1, w-1) + edge.Render("\u2551")
			}
			out[len(out)-1] = edge.Render("\u255a" + strings.Repeat(bar, max(0, w-2)) + "\u255d")
		}
	}
	return out
}
func (m model) watchView(w, h int) []string {
	page := m.focus / 6
	start := page * 6
	n := min(6, len(m.agents)-start)
	footer := 0
	if len(m.agents) > 6 {
		footer = 1
	}
	rects := watchRects(n, w, max(0, h-footer))
	lines := make([]string, max(0, h-footer))
	for i := range lines {
		lines[i] = strings.Repeat(" ", w)
	}
	for i, r := range rects {
		tile := m.watchTile(m.agents[start+i], start+i == m.focus, r.w, r.h)
		for y := 0; y < len(tile) && r.y+y < len(lines); y++ {
			lines[r.y+y] = ansi.Cut(lines[r.y+y], 0, r.x) + tile[y] + ansi.Cut(lines[r.y+y], r.x+r.w, w)
		}
	}
	if footer > 0 {
		lines = append(lines, fit(fmt.Sprintf("page %d/%d", page+1, (len(m.agents)+5)/6), w))
	}
	return lines
}

type thread struct {
	a, b     string
	messages []bus.Message
}

func groupThreads(messages []bus.Message) []thread {
	var out []thread
	indices := map[string]int{}
	for _, v := range messages {
		if v.From == "" || v.To == "" || v.From == v.To {
			continue
		}
		a, b := v.From, v.To
		if a > b {
			a, b = b, a
		}
		key := a + "\x00" + b
		i, ok := indices[key]
		if !ok {
			i = len(out)
			indices[key] = i
			out = append(out, thread{a: a, b: b})
		}
		out[i].messages = append(out[i].messages, v)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].messages[len(out[i].messages)-1].Time.After(out[j].messages[len(out[j].messages)-1].Time)
	})
	return out
}
func (m model) traffic() []bus.Message {
	if m.demo {
		base := time.Date(2026, 1, 1, 14, 3, 0, 0, time.Local)
		return []bus.Message{{From: "boss", To: "c1", Text: "implement token refresh", Time: base}, {From: "c1", To: "boss", Text: "implementation ready; tests pass", Time: base.Add(time.Minute)}, {From: "scout", To: "boss", Text: "add expired-token coverage", Time: base.Add(2 * time.Minute)}}
	}
	f, e := os.Open(filepath.Join(m.bus.Root, "log.jsonl"))
	if e != nil {
		return nil
	}
	defer f.Close()
	var out []bus.Message
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 4096), 1024*1024)
	for sc.Scan() {
		var v bus.Message
		if json.Unmarshal(sc.Bytes(), &v) == nil && (v.Kind == "" || v.Kind == "message") {
			out = append(out, v)
		}
	}
	return out
}
func mapPositions(n int) [][2]int {
	points := [][2]int{{0, 0}, {-1, 0}, {1, 0}, {0, -1}, {0, 1}, {-1, -1}, {1, -1}, {-1, 1}, {1, 1}}
	if n > len(points) {
		n = len(points)
	}
	return points[:max(0, n)]
}
func (m model) lookup(name string) *agent.Agent {
	for _, a := range m.agents {
		if a.Name == name {
			return a
		}
	}
	return &agent.Agent{Name: name}
}
func (m model) node(name string) string { a := m.lookup(name); return badge(a) + " " + agentName(a) }
func (m model) commsView(w, h int) []string {
	t := theme.All[m.theme]
	messages := m.traffic()
	threads := groupThreads(messages)
	mapH := min(7, max(3, h/2))
	canvas := make([][]rune, max(1, mapH-2))
	for i := range canvas {
		canvas[i] = []rune(strings.Repeat(" ", max(0, w-4)))
	}
	put := func(x, y int, s string) {
		if y < 0 || y >= len(canvas) {
			return
		}
		for _, r := range s {
			if x >= 0 && x < len(canvas[y]) {
				canvas[y][x] = r
			}
			x++
		}
	}
	positions := mapPositions(len(m.agents))
	cx := (w - 4) / 2
	cy := len(canvas) / 2
	for i, p := range positions {
		if i == 0 {
			continue
		}
		x := cx + p[0]*min(25, max(8, w/4))
		y := cy + p[1]*2
		count := 0
		recent := false
		for _, v := range messages {
			if (v.From == m.agents[0].Name && v.To == m.agents[i].Name) || (v.To == m.agents[0].Name && v.From == m.agents[i].Name) {
				count++
				if time.Since(v.Time) >= 0 && time.Since(v.Time) < 5*time.Second {
					recent = true
				}
			}
		}
		label := fmt.Sprintf("\u2500%d\u2500", count)
		if recent {
			label = fmt.Sprintf("\u2550%d\u2550", count)
		}
		if p[0] != 0 {
			put((cx+x)/2-1, y, label)
		} else {
			put(cx-1, (cy+y)/2, label)
		}
		name := provider.Icon(m.agents[i].Provider) + " " + agentName(m.agents[i])
		put(x-len([]rune(name))/2, y, name)
	}
	if len(m.agents) > 0 {
		name := provider.Icon(m.agents[0].Provider) + " " + agentName(m.agents[0])
		put(cx-len([]rune(name))/2, cy, name)
	}
	var mapRows []string
	for _, row := range canvas {
		mapRows = append(mapRows, string(row))
	}
	result := box("NETWORK MAP", mapRows, w, mapH, t.Dim)
	remaining := h - mapH
	if remaining < 3 {
		return result
	}
	left := max(20, w*35/100)
	left = min(left, w/2)
	var list []string
	marker := func(i int) string {
		if i == m.threadSelected {
			return "\u25b6 "
		}
		return "  "
	}
	list = append(list, marker(0)+"ALL TRAFFIC")
	for i, th := range threads {
		last := th.messages[len(th.messages)-1]
		unread := ""
		if m.lookup(th.a).Unread > 0 || m.lookup(th.b).Unread > 0 {
			unread = " \u25cf"
		}
		list = append(list, fmt.Sprintf("%s%s \u21c4 %s  %d \u00b7 %s%s", marker(i+1), m.node(th.a), m.node(th.b), len(th.messages), last.Time.Format("15:04"), unread))
	}
	var detail []string
	selected := min(m.threadSelected, len(threads))
	if len(messages) == 0 {
		text := "No radio traffic yet. When agents message each other (dispatch send), it shows up here."
		detail = append(detail, strings.Repeat(" ", max(0, (w-left-4-ansi.StringWidth(text))/2))+lipgloss.NewStyle().Foreground(t.Dim).Render(text))
	} else if selected == 0 {
		for _, v := range messages {
			detail = append(detail, fmt.Sprintf("%s %s \u2192 %s  %s", v.Time.Format("15:04"), m.node(v.From), m.node(v.To), v.Text))
		}
	} else {
		th := threads[selected-1]
		bw := max(8, (w-left-4)*70/100)
		for _, v := range th.messages {
			lines := strings.Split(ansi.Wrap(v.Text, max(1, bw-4), ""), "\n")
			bubble := box(m.node(v.From)+" \u00b7 "+v.Time.Format("15:04"), lines, bw, len(lines)+2, providerColor(m.lookup(v.From).Provider))
			if v.From == th.b {
				for i := range bubble {
					bubble[i] = strings.Repeat(" ", max(0, w-left-4-bw)) + bubble[i]
				}
			}
			detail = append(detail, bubble...)
		}
	}
	if len(detail) > remaining-2 {
		detail = detail[len(detail)-(remaining-2):]
	}
	result = append(result, joinColumns(box("THREADS", list, left, remaining, t.Dim), box("RADIO", detail, w-left, remaining, t.Main))...)
	return result
}
