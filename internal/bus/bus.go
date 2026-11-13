package bus

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"
)

type Message struct {
	ID      string    `json:"id"`
	From    string    `json:"from"`
	To      string    `json:"to"`
	Text    string    `json:"text"`
	Kind    string    `json:"kind"`
	ReplyTo string    `json:"reply_to,omitempty"`
	Time    time.Time `json:"time"`
}
type Bus struct{ Root string }

var valid = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func New(project string) Bus { return Bus{filepath.Join(project, ".dispatch")} }
func (b Bus) Send(m Message) error {
	if !valid.MatchString(m.To) {
		return fmt.Errorf("invalid recipient")
	}
	var id [8]byte
	if _, e := rand.Read(id[:]); e != nil {
		return e
	}
	if m.ID == "" {
		m.ID = hex.EncodeToString(id[:])
	}
	m.Time = time.Now().UTC()
	d := filepath.Join(b.Root, "inbox", m.To)
	if e := os.MkdirAll(d, 0700); e != nil {
		return e
	}
	data, e := json.Marshal(m)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(d, ".pending-")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if _, e = f.Write(data); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Rename(name, filepath.Join(d, fmt.Sprintf("%020d-%s.json", m.Time.UnixNano(), m.ID))); e != nil {
		return e
	}
	lf, e := os.OpenFile(filepath.Join(b.Root, "log.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer lf.Close()
	_, e = lf.Write(append(data, '\n'))
	return e
}
func (b Bus) Receive(name string) ([]Message, error) {
	if !valid.MatchString(name) {
		return nil, fmt.Errorf("invalid recipient")
	}
	d := filepath.Join(b.Root, "inbox", name)
	fs, e := os.ReadDir(d)
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	sort.Slice(fs, func(i, j int) bool { return fs[i].Name() < fs[j].Name() })
	var out []Message
	for _, f := range fs {
		if filepath.Ext(f.Name()) != ".json" {
			continue
		}
		p := filepath.Join(d, f.Name())
		data, e := os.ReadFile(p)
		if e != nil {
			return out, e
		}
		var m Message
		if e = json.Unmarshal(data, &m); e != nil {
			return out, e
		}
		if e = os.Remove(p); e != nil {
			return out, e
		}
		out = append(out, m)
	}
	return out, nil
}

// ReceiveReply removes only the reply to the specified request, leaving other messages queued.
func (b Bus) ReceiveReply(name, requestID string) (*Message, error) {
	if !valid.MatchString(name) {
		return nil, fmt.Errorf("invalid recipient")
	}
	d := filepath.Join(b.Root, "inbox", name)
	fs, e := os.ReadDir(d)
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	for _, f := range fs {
		if filepath.Ext(f.Name()) != ".json" {
			continue
		}
		p := filepath.Join(d, f.Name())
		data, e := os.ReadFile(p)
		if e != nil {
			return nil, e
		}
		var m Message
		if e = json.Unmarshal(data, &m); e != nil {
			return nil, e
		}
		if m.ReplyTo == requestID {
			if e = os.Remove(p); e != nil {
				return nil, e
			}
			return &m, nil
		}
	}
	return nil, nil
}
func NewID() string {
	var id [8]byte
	if _, err := rand.Read(id[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(id[:])
}
