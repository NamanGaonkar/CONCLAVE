package pty

import (
	"bytes"
	"testing"
	"time"
)

func TestSessionBaseBufferAndSubscription(t *testing.T) {
	sb := newSessionBase("test", "C:\\temp")
	sb.AppendData([]byte("hello world\n"))

	sub := sb.Subscribe()
	defer sb.Unsubscribe(sub)

	select {
	case chunk := <-sub.C():
		if !bytes.Contains(chunk, []byte("hello world")) {
			t.Fatalf("unexpected chunk: %s", string(chunk))
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("timeout waiting for replayed buffer")
	}

	sb.AppendData([]byte("second line\n"))
	select {
	case chunk := <-sub.C():
		if !bytes.Contains(chunk, []byte("second line")) {
			t.Fatalf("unexpected chunk: %s", string(chunk))
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("timeout waiting for live output")
	}

	sb.Clear()
	if len(sb.Replay()) != 0 {
		t.Fatalf("buffer not empty after clear")
	}
}
