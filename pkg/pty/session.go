package pty

import (
	"bytes"
	"sync"
	"time"
)

const (
	maxBufferBytes  = 512 * 1024
	replayLines     = 2000
	lineTrimTrigger = replayLines + 1000
)

// Subscriber receives live output chunks from a PTY session.
type Subscriber struct {
	ch     chan []byte
	closed bool
	mu     sync.Mutex
}

// C is the channel the server reads output chunks from.
func (s *Subscriber) C() <-chan []byte {
	return s.ch
}

// Close detaches the subscriber.
func (s *Subscriber) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.closed = true
		close(s.ch)
	}
}

// Append feeds output to the subscriber (non-blocking).
func (s *Subscriber) Append(b []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	select {
	case s.ch <- b:
	default:
	}
}

// SessionBase encapsulates common buffer and subscription logic.
type SessionBase struct {
	ID       string
	Dir      string
	mu       sync.Mutex
	buf      []byte
	lineCnt  int
	subs     map[*Subscriber]struct{}
	closed   bool
	exited   bool
	exitCode int
	lastOut  time.Time
}

func newSessionBase(id, dir string) SessionBase {
	return SessionBase{
		ID:      id,
		Dir:     dir,
		subs:    make(map[*Subscriber]struct{}),
		lastOut: time.Now(),
	}
}

// Subscribe attaches a reader and immediately replays the cached history buffer.
func (sb *SessionBase) Subscribe() *Subscriber {
	sub := &Subscriber{ch: make(chan []byte, 256)}
	sb.mu.Lock()
	sb.subs[sub] = struct{}{}
	replay := append([]byte(nil), sb.buf...)
	sb.mu.Unlock()

	if len(replay) > 0 {
		sub.Append(replay)
	}
	return sub
}

// Unsubscribe detaches a reader.
func (sb *SessionBase) Unsubscribe(sub *Subscriber) {
	sb.mu.Lock()
	delete(sb.subs, sub)
	sb.mu.Unlock()
	sub.Close()
}

// Clear wipes the replay buffer.
func (sb *SessionBase) Clear() {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	sb.buf = sb.buf[:0]
	sb.lineCnt = 0
}

// Replay returns a copy of the current buffer.
func (sb *SessionBase) Replay() []byte {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	return append([]byte(nil), sb.buf...)
}

// AppendData saves output to buffer and broadcasts to all active subscribers.
func (sb *SessionBase) AppendData(b []byte) {
	sb.mu.Lock()
	sb.buf = append(sb.buf, b...)
	sb.lineCnt += bytes.Count(b, []byte("\n"))
	if len(sb.buf) > maxBufferBytes || sb.lineCnt > lineTrimTrigger {
		sb.buf = trimToLines(sb.buf, replayLines)
		sb.lineCnt = bytes.Count(sb.buf, []byte("\n"))
	}
	sb.lastOut = time.Now()

	subs := make([]*Subscriber, 0, len(sb.subs))
	for sub := range sb.subs {
		subs = append(subs, sub)
	}
	sb.mu.Unlock()

	data := append([]byte(nil), b...)
	for _, sub := range subs {
		sub.Append(data)
	}
}

func trimToLines(buf []byte, n int) []byte {
	count := 0
	for i := len(buf) - 1; i >= 0; i-- {
		if buf[i] == '\n' {
			count++
			if count >= n {
				out := make([]byte, len(buf)-i-1)
				copy(out, buf[i+1:])
				return out
			}
		}
	}
	out := make([]byte, len(buf))
	copy(out, buf)
	return out
}
