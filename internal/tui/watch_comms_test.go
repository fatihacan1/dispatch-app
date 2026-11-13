package tui

import (
	"github.com/fatihacan1/dispatch-app/internal/bus"
	"testing"
	"time"
)

func TestWatchRects(t *testing.T) {
	for n := 1; n <= 7; n++ {
		rs := watchRects(n, 120, 30)
		want := min(n, 6)
		if len(rs) != want {
			t.Fatalf("%d agents: got %d tiles", n, len(rs))
		}
		for i, r := range rs {
			if r.w <= 0 || r.h <= 0 || r.x+r.w > 120 || r.y+r.h > 30 {
				t.Fatalf("invalid rectangle: %+v", r)
			}
			for j := 0; j < i; j++ {
				q := rs[j]
				if r.x < q.x+q.w && q.x < r.x+r.w && r.y < q.y+q.h && q.y < r.y+r.h {
					t.Fatalf("overlap %d: %+v %+v", n, r, q)
				}
			}
		}
	}
	r := watchRects(3, 120, 30)
	if r[0].h != 30 || r[1].x != 60 || r[2].y != 15 {
		t.Fatal(r)
	}
}
func TestMapPositions(t *testing.T) {
	for n := 1; n <= 6; n++ {
		p := mapPositions(n)
		if len(p) != n || p[0] != [2]int{0, 0} {
			t.Fatal(n, p)
		}
		seen := map[[2]int]bool{}
		for _, v := range p {
			if seen[v] {
				t.Fatal("duplicate", v)
			}
			seen[v] = true
		}
	}
}
func TestGroupThreads(t *testing.T) {
	now := time.Now()
	ts := groupThreads([]bus.Message{{From: "boss", To: "c1", Time: now}, {From: "c1", To: "boss", Time: now.Add(time.Second)}, {From: "scout", To: "boss", Time: now.Add(2 * time.Second)}})
	if len(ts) != 2 || len(ts[1].messages) != 2 || ts[1].a != "boss" || ts[1].b != "c1" {
		t.Fatal(ts)
	}
}
