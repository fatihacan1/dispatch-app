package session

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Agent struct {
	Name, Provider, Model, Role, Session string
	Transcript                           []string `json:"-"`
}
type Session struct {
	ID, Title        string
	Created, Updated time.Time
	Agents           []Agent
}
type Workspace struct {
	Path             string
	LastUsed         time.Time
	SessionCount     int
	LastSessionTitle string
}

func root(w string) string { return filepath.Join(w, ".dispatch", "sessions") }
func valid(id string) bool {
	if len(id) != 16 {
		return false
	}
	_, e := hex.DecodeString(id)
	return e == nil
}
func New() Session {
	var b [8]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	n := time.Now().UTC()
	return Session{ID: hex.EncodeToString(b[:]), Created: n, Updated: n}
}
func Save(w string, s Session) error {
	if !valid(s.ID) {
		return fmt.Errorf("invalid session id")
	}
	d := filepath.Join(root(w), s.ID)
	if e := os.MkdirAll(d, 0700); e != nil {
		return e
	}
	s.Updated = time.Now().UTC()
	for i, a := range s.Agents {
		var data []byte
		for _, v := range a.Transcript {
			b, e := json.Marshal(v)
			if e != nil {
				return e
			}
			data = append(data, b...)
			data = append(data, '\n')
		}
		if e := os.WriteFile(filepath.Join(d, fmt.Sprintf("agent-%d.jsonl", i)), data, 0600); e != nil {
			return e
		}
	}
	b, e := json.MarshalIndent(s, "", "  ")
	if e != nil {
		return e
	}
	return os.WriteFile(filepath.Join(d, "meta.json"), b, 0600)
}
func Load(w, id string) (Session, error) {
	var s Session
	if !valid(id) {
		return s, fmt.Errorf("invalid session id")
	}
	d := filepath.Join(root(w), id)
	b, e := os.ReadFile(filepath.Join(d, "meta.json"))
	if e != nil {
		return s, e
	}
	if e = json.Unmarshal(b, &s); e != nil {
		return s, e
	}
	for i := range s.Agents {
		b, e = os.ReadFile(filepath.Join(d, fmt.Sprintf("agent-%d.jsonl", i)))
		if e != nil && !os.IsNotExist(e) {
			return s, e
		}
		for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			if line == "" {
				continue
			}
			var v string
			if e = json.Unmarshal([]byte(line), &v); e != nil {
				return s, e
			}
			s.Agents[i].Transcript = append(s.Agents[i].Transcript, v)
		}
	}
	return s, nil
}
func List(w string) ([]Session, error) {
	entries, e := os.ReadDir(root(w))
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var out []Session
	for _, v := range entries {
		if v.IsDir() && valid(v.Name()) {
			s, e := Load(w, v.Name())
			if e != nil {
				return nil, e
			}
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated.After(out[j].Updated) })
	return out, nil
}
func Delete(w, id string) error {
	if !valid(id) {
		return fmt.Errorf("invalid session id")
	}
	return os.RemoveAll(filepath.Join(root(w), id))
}
func indexPath() string {
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".dispatch", "workspaces.json")
}
func Workspaces() ([]Workspace, error) {
	b, e := os.ReadFile(indexPath())
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var w []Workspace
	e = json.Unmarshal(b, &w)
	return w, e
}
func writeIndex(w []Workspace) error {
	p := indexPath()
	if e := os.MkdirAll(filepath.Dir(p), 0700); e != nil {
		return e
	}
	b, e := json.MarshalIndent(w, "", "  ")
	if e != nil {
		return e
	}
	return os.WriteFile(p, b, 0600)
}
func Touch(path string) error {
	path, e := filepath.Abs(path)
	if e != nil {
		return e
	}
	ss, e := List(path)
	if e != nil {
		return e
	}
	w, e := Workspaces()
	if e != nil {
		return e
	}
	var out []Workspace
	for _, v := range w {
		if !strings.EqualFold(v.Path, path) {
			out = append(out, v)
		}
	}
	item := Workspace{Path: path, LastUsed: time.Now().UTC(), SessionCount: len(ss)}
	if len(ss) > 0 {
		item.LastSessionTitle = ss[0].Title
	}
	return writeIndex(append([]Workspace{item}, out...))
}
func Forget(path string) error {
	path, e := filepath.Abs(path)
	if e != nil {
		return e
	}
	w, e := Workspaces()
	if e != nil {
		return e
	}
	var out []Workspace
	for _, v := range w {
		if !strings.EqualFold(v.Path, path) {
			out = append(out, v)
		}
	}
	return writeIndex(out)
}
