package tui

import (
	"fmt"
	"html"
	"strconv"
	"strings"
)

// HTML converts an ANSI frame into a self-contained terminal rendering.
func HTML(frame string) string {
	var b strings.Builder
	b.WriteString("<!doctype html><html><head><meta charset=\"utf-8\"><title>dispatch snapshot</title><style>body{background:#0b120b;color:#d7ffd7;margin:0;padding:1em}pre{font-family:'Cascadia Mono','Consolas','Menlo',monospace;line-height:1.15;margin:0;white-space:pre}</style></head><body><pre>")
	fg, bg := "", ""
	bold := false
	open := false
	closeSpan := func() {
		if open {
			b.WriteString("</span>")
			open = false
		}
	}
	apply := func() {
		closeSpan()
		var css []string
		if fg != "" {
			css = append(css, "color:"+fg)
		}
		if bg != "" {
			css = append(css, "background-color:"+bg)
		}
		if bold {
			css = append(css, "font-weight:bold")
		}
		if len(css) > 0 {
			b.WriteString("<span style=\"" + strings.Join(css, ";") + "\">")
			open = true
		}
	}
	for i := 0; i < len(frame); {
		if frame[i] == 27 && i+1 < len(frame) && frame[i+1] == '[' {
			j := i + 2
			for j < len(frame) && (frame[j] < '@' || frame[j] > '~') {
				j++
			}
			if j == len(frame) {
				break
			}
			if frame[j] == 'm' {
				raw := strings.Split(frame[i+2:j], ";")
				var nums []int
				for _, s := range raw {
					n, _ := strconv.Atoi(s)
					nums = append(nums, n)
				}
				for k := 0; k < len(nums); k++ {
					n := nums[k]
					switch {
					case n == 0:
						fg = ""
						bg = ""
						bold = false
					case n == 1:
						bold = true
					case n == 22:
						bold = false
					case n == 39:
						fg = ""
					case n == 49:
						bg = ""
					case (n == 38 || n == 48) && k+4 < len(nums) && nums[k+1] == 2:
						c := fmt.Sprintf("#%02x%02x%02x", nums[k+2], nums[k+3], nums[k+4])
						if n == 38 {
							fg = c
						} else {
							bg = c
						}
						k += 4
					case (n == 38 || n == 48) && k+2 < len(nums) && nums[k+1] == 5:
						v := nums[k+2]
						c := ""
						if v >= 16 && v <= 231 {
							v -= 16
							levels := []int{0, 95, 135, 175, 215, 255}
							c = fmt.Sprintf("#%02x%02x%02x", levels[v/36], levels[v/6%6], levels[v%6])
						} else if v >= 232 {
							x := 8 + (v-232)*10
							c = fmt.Sprintf("#%02x%02x%02x", x, x, x)
						}
						if n == 38 {
							fg = c
						} else {
							bg = c
						}
						k += 2
					}
				}
				apply()
			}
			i = j + 1
			continue
		}
		j := i + 1
		for j < len(frame) && frame[j] != 27 {
			j++
		}
		b.WriteString(html.EscapeString(frame[i:j]))
		i = j
	}
	closeSpan()
	b.WriteString("</pre></body></html>\n")
	return b.String()
}
