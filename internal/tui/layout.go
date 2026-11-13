package tui

// layoutColumns selects single, vertical split, horizontal split, 2x2 or auto grid.
func layoutColumns(layout, n int, zoom bool, width int) int {
	if zoom || n <= 1 {
		return 1
	}
	switch layout {
	case 0:
		return 1
	case 1:
		return n
	case 2:
		return 1
	case 3:
		return 2
	default:
		if width >= 140 && n >= 3 {
			return 3
		}
		return 2
	}
}
