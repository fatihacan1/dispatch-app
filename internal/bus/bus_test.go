package bus

import "testing"

func TestSendReceive(t *testing.T) {
	b := New(t.TempDir())
	if e := b.Send(Message{From: "a", To: "b", Text: "hello"}); e != nil {
		t.Fatal(e)
	}
	ms, e := b.Receive("b")
	if e != nil || len(ms) != 1 || ms[0].Text != "hello" {
		t.Fatalf("%v %v", ms, e)
	}
	ms, e = b.Receive("b")
	if e != nil || len(ms) != 0 {
		t.Fatal(ms, e)
	}
	if e = b.Send(Message{To: "../oops"}); e == nil {
		t.Fatal("accepted invalid name")
	}
}
func TestReplyCorrelation(t *testing.T) {
	b := New(t.TempDir())
	if e := b.Send(Message{To: "a", ReplyTo: "other", Text: "other"}); e != nil {
		t.Fatal(e)
	}
	if e := b.Send(Message{To: "a", ReplyTo: "wanted", Text: "yes"}); e != nil {
		t.Fatal(e)
	}
	m, e := b.ReceiveReply("a", "wanted")
	if e != nil || m == nil || m.Text != "yes" {
		t.Fatal(m, e)
	}
	rest, e := b.Receive("a")
	if e != nil || len(rest) != 1 || rest[0].Text != "other" {
		t.Fatal(rest, e)
	}
}
