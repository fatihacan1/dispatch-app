package theme

import "github.com/charmbracelet/lipgloss"

type Theme struct {
	Name                     string
	Main, Dim, Accent, Error lipgloss.Color
}

var All = []Theme{{"phosphor", "#39ff14", "#2f6b2f", "#ffb000", "#ff6262"}, {"amber", "#ffc45b", "#8e6630", "#ffe4a0", "#ff6262"}, {"neon", "#54f4ef", "#417f8e", "#ff75df", "#ff6262"}}
