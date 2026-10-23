//go:build windows

package pty

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/UserExistsError/conpty"
	"golang.org/x/sys/windows"
)

const ShellCommand = "powershell.exe -NoLogo"

type Session struct {
	SessionBase
	cpty     *conpty.ConPty
	job      *killJob
	exitedCh chan struct{}
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
	if dir == "" {
		return nil, errors.New("no working directory specified")
	}
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 30
	}

	m.mu.Lock()
	if old, exists := m.sessions[id]; exists {
		delete(m.sessions, id)
		m.mu.Unlock()
		_ = old.Close()
		m.mu.Lock()
	}

	cpty, err := conpty.Start(
		ShellCommand,
		conpty.ConPtyWorkDir(dir),
		conpty.ConPtyDimensions(cols, rows),
	)
	if err != nil {
		m.mu.Unlock()
		return nil, fmt.Errorf("failed to spawn pseudo-terminal in %s: %w", dir, err)
	}

	sess := &Session{
		SessionBase: newSessionBase(id, dir),
		cpty:        cpty,
		job:         newKillJob(cpty.Pid()),
		exitedCh:    make(chan struct{}),
	}

	m.sessions[id] = sess
	m.mu.Unlock()

	go sess.readLoop()
	go sess.waitLoop()

	// Nav safety net
	escapedDir := strings.ReplaceAll(dir, "'", "''")
	_, _ = sess.Write([]byte("Set-Location -LiteralPath '" + escapedDir + "'\r"))

	return sess, nil
}

func (sess *Session) readLoop() {
	buf := make([]byte, 16*1024)
	for {
		n, err := sess.cpty.Read(buf)
		if n > 0 {
			sess.AppendData(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

const _stillActive = 259

func (sess *Session) waitLoop() {
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		code, err := sess.cpty.Wait(ctx)
		cancel()
		if err != nil && code == _stillActive {
			continue
		}
		exitCode := 0
		if err == nil || code != _stillActive {
			exitCode = int(code)
		}
		sess.mu.Lock()
		sess.exited = true
		sess.exitCode = exitCode
		sess.mu.Unlock()
		close(sess.exitedCh)
		return
	}
}

func (sess *Session) Write(p []byte) (int, error) {
	sess.mu.Lock()
	c := sess.cpty
	exited := sess.exited
	closed := sess.closed
	sess.mu.Unlock()

	if exited || closed || c == nil {
		return 0, errors.New("terminal session not active")
	}
	return c.Write(p)
}

func (sess *Session) Resize(cols, rows int) error {
	sess.mu.Lock()
	c := sess.cpty
	sess.mu.Unlock()

	if c == nil {
		return errors.New("terminal not running")
	}
	if cols < 2 {
		cols = 2
	}
	if rows < 2 {
		rows = 2
	}
	return c.Resize(cols, rows)
}

func (sess *Session) Close() error {
	sess.mu.Lock()
	if sess.closed {
		sess.mu.Unlock()
		return nil
	}
	sess.closed = true
	sess.exited = true
	c := sess.cpty
	job := sess.job
	subs := make([]*Subscriber, 0, len(sess.subs))
	for sub := range sess.subs {
		subs = append(subs, sub)
		delete(sess.subs, sub)
	}
	sess.mu.Unlock()

	if c != nil {
		_ = c.Close()
	}
	if job != nil {
		_ = job.Close()
	}
	for _, sub := range subs {
		sub.Close()
	}
	return nil
}

func (m *Manager) Close(id string) {
	m.mu.Lock()
	sess, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if ok {
		_ = sess.Close()
	}
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	all := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		all = append(all, s)
	}
	m.sessions = make(map[string]*Session)
	m.mu.Unlock()

	for _, s := range all {
		_ = s.Close()
	}
}

// killJob uses Windows Job Objects to guarantee tree cleanup.
type killJob struct {
	handle windows.Handle
	pid    int
}

func newKillJob(pid int) *killJob {
	h, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return &killJob{pid: pid}
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		h,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		_ = windows.CloseHandle(h)
		return &killJob{pid: pid}
	}
	proc, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		uint32(pid),
	)
	if err != nil {
		_ = windows.CloseHandle(h)
		return &killJob{pid: pid}
	}
	defer windows.CloseHandle(proc)
	if err := windows.AssignProcessToJobObject(h, proc); err != nil {
		_ = windows.CloseHandle(h)
		return &killJob{pid: pid}
	}
	return &killJob{handle: h, pid: pid}
}

func (j *killJob) Close() error {
	if j == nil {
		return nil
	}
	if j.handle != 0 {
		err := windows.CloseHandle(j.handle)
		j.handle = 0
		return err
	}
	if j.pid > 0 {
		_ = exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprint(j.pid)).Run()
	}
	return nil
}
