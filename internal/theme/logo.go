package theme

import (
	"fmt"
	"os"
	"strings"
)

//go:generate go run ../../tools/logogen

const Wordmark = "███╗   ███╗██╗   ██╗     █████╗ ██████╗ ███╗   ███╗██╗   ██╗\n████╗ ████║╚██╗ ██╔╝    ██╔══██╗██╔══██╗████╗ ████║╚██╗ ██╔╝\n██╔████╔██║ ╚████╔╝     ███████║██████╔╝██╔████╔██║ ╚████╔╝ \n██║╚██╔╝██║  ╚██╔╝      ██╔══██║██╔══██╗██║╚██╔╝██║  ╚██╔╝  \n██║ ╚═╝ ██║   ██║       ██║  ██║██║  ██║██║ ╚═╝ ██║   ██║   \n╚═╝     ╚═╝   ╚═╝       ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝   ╚═╝"

func Logo(small bool) string {
	if os.Getenv("MYARMY_ASCII") == "1" {
		return "  .-~~~-.\n / o   o \\\n|    ^    |\n \\_______/"
	}
	p, w := largePixels, 32
	if small {
		p, w = smallPixels, 14
	}
	truecolor := strings.EqualFold(os.Getenv("COLORTERM"), "truecolor") || strings.EqualFold(os.Getenv("COLORTERM"), "24bit")
	var b strings.Builder
	color := func(c [3]uint8, bg bool) string {
		// Quantize the source art to four clean phosphor levels.
		v := int(c[1])
		switch {
		case v < 55:
			c = [3]uint8{11, 18, 11}
		case v < 125:
			c = [3]uint8{31, 95, 31}
		case v < 205:
			c = [3]uint8{47, 191, 47}
		default:
			c = [3]uint8{125, 255, 125}
		}
		mode := 38
		if bg {
			mode = 48
		}
		if c[0] < 20 && c[1] < 20 && c[2] < 20 {
			if bg {
				return "\x1b[49m"
			}
			c = [3]uint8{11, 18, 11}
		}
		if truecolor {
			return fmt.Sprintf("\x1b[%d;2;%d;%d;%dm", mode, c[0], c[1], c[2])
		}
		return fmt.Sprintf("\x1b[%d;5;%dm", mode, 16+36*(int(c[0])*5/255)+6*(int(c[1])*5/255)+int(c[2])*5/255)
	}
	for y := 0; y < len(p)/w; y += 2 {
		for x := 0; x < w; x++ {
			b.WriteString(color(p[y*w+x], false))
			b.WriteString(color(p[(y+1)*w+x], true))
			b.WriteRune('▀')
		}
		b.WriteString("\x1b[0m")
		if y+2 < len(p)/w {
			b.WriteByte('\n')
		}
	}
	return b.String()
}
