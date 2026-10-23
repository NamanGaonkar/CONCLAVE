//go:build !windows

package pty

import (
	"errors"
	"os/exec"
	"sync"
)

type Session struct {
	SessionBase
	cmd *exec.Cmd
}

type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

func (m *Manager) Get(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *Manager) Start(id, dir string, cols, rows int) (*Session, error) {
	return nil, errors.New("interactive ConPTY terminal only supported on Windows")
}

func (sess *Session) Write(p []byte) (int, error) {
	return 0, errors.New("terminal not running")
}

func (sess *Session) Resize(cols, rows int) error {
	return nil
}

func (sess *Session) Close() error {
	return nil
}

func (m *Manager) Close(id string) {}

func (m *Manager) CloseAll() {}
