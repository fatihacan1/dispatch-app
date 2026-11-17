package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

type taskCard struct {
	Agent     string `json:"agent"`
	Lead      string `json:"lead"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	StartedAt string `json:"startedAt"`
	EndedAt   string `json:"endedAt"`
}

// printTasks writes the open cards (working, waiting, stalled) one per line: agent, status, elapsed, lead, title.
// With all it adds the last 10 done or stopped cards.
func printTasks(file string, all bool, now time.Time, out io.Writer) error {
	var cards []taskCard
	if data, err := os.ReadFile(file); err == nil {
		_ = json.Unmarshal(data, &cards)
	} else if !os.IsNotExist(err) {
		return err
	}
	line := func(c taskCard, end time.Time) {
		start, _ := time.Parse(time.RFC3339, c.StartedAt)
		title := []rune(strings.Join(strings.Fields(c.Title), " "))
		if len(title) > 80 {
			title = append(title[:79], '…')
		}
		fmt.Fprintf(out, "%s\t%s\t%s\t%s\t%s\n", c.Agent, c.Status, elapsed(end.Sub(start)), c.Lead, string(title))
	}
	var closed []taskCard
	count := 0
	for _, c := range cards {
		switch c.Status {
		case "working", "waiting", "stalled":
			line(c, now)
			count++
		case "done", "stopped":
			closed = append(closed, c)
		}
	}
	if all {
		if len(closed) > 10 {
			closed = closed[len(closed)-10:]
		}
		for _, c := range closed {
			end, err := time.Parse(time.RFC3339, c.EndedAt)
			if err != nil {
				end = now
			}
			line(c, end)
			count++
		}
	}
	if count == 0 {
		fmt.Fprintln(out, "No open tasks.")
	}
	return nil
}

func elapsed(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%dh%02dm", int(d.Hours()), int(d.Minutes())%60)
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}
